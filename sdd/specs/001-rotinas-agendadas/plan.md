# Implementation Plan: Rotinas agendadas idempotentes e calendário de dias úteis

**Slug**: `001-rotinas-agendadas` | **Date**: 2026-11-20 | **Spec**: `sdd/specs/001-rotinas-agendadas/spec.md`

**Nota**: Este template é preenchido pelo skill `sdd-plan`; a definição do skill
descreve o fluxo de execução completo.

## Summary

Base para todos os prazos da v2: um executor de rotinas que processa cada
item/evento vencido no máximo uma vez com efeito (idempotência por
`rotinaId + chave` com índice único e lease), com retentativa até 5 vezes e
alerta ao admin, e um calendário puro de dias corridos/úteis no horário de
Brasília (feriados nacionais calculados + datas extras do admin). O disparo é
agnóstico de plataforma: uma rota HTTP protegida por segredo, chamada por
qualquer agendador. O admin do sistema acompanha execuções, reexecuta itens e
mantém as datas extras numa aba nova do `/admin`. Só a rotina de saúde é
registrada nesta feature; as regras de negócio de cada prazo ficam nas features
consumidoras.

## Technical Context

**Language/Version**: JavaScript (ES modules transpilados pelo Next.js), Node.js 22.16 local

**Primary Dependencies**: Next.js 14.2 (Pages Router), `mongodb` 6.16 (driver nativo), `next-auth` 4.24, React 18, Tailwind 3; `Intl` com ICU completo (fuso `America/Sao_Paulo`); `crypto` (`randomUUID`, `timingSafeEqual`)

**Storage**: MongoDB — coleções novas `rotinaItens`, `rotinaExecucoes`, `calendarioDatasExtras`, `rotinaSaudeSondas`; reutiliza `notificacoesUsuario` e `auditLogs` (ver `data-model.md`)

**Testing**: Vitest 5.1 (instalado por este plano), `npm test` / `npm run test:contrato`; validação manual por `quickstart.md`

**Target Platform**: aplicação web Next.js; plataforma de deploy **não definida** (R-001)

**Performance Goals**: item vencido processado em até 1 hora (FR-002) com o agendador chamando a cada 15 minutos; até 500 itens por rotina por execução

**Constraints**: rotas serverless com tempo limitado; `lib/mongodb.js` valida env no import (lógica testável não pode importá-lo); `middleware.js` redireciona rotas não públicas para login; Brasil sem horário de verão, mas o código não pode fixar -03:00

**Scale/Scope**: hoje só a rotina de saúde; futuras rotinas com dezenas a milhares de itens/dia; datas extras na casa das dezenas

## Decisões Invariantes

- **D-01 · Disparo por HTTP com segredo**: `GET|POST /api/rotinas/executar`,
  `Authorization: Bearer <ROTINAS_SECRET>`, `timingSafeEqual`; sem agendador
  dentro do processo (`setInterval`, `node-cron`). A escolha do agendador
  externo fica para uma ADR (R-001).
- **D-02 · Idempotência pelo registro do item**: `rotinaItens` com índice único
  `{ rotinaId, chave }`; posse por `findOneAndUpdate` com upsert + lease de 10
  min; E11000 = já processado ou em posse de outra execução. Itens nunca
  expiram.
- **D-03 · Executor e calendário puros**: `lib/rotinas/executor.js` recebe o
  repositório por injeção; `lib/calendario.js` recebe `datasExtras` por
  parâmetro. Nenhum dos dois importa `lib/mongodb.js`.
- **D-04 · A interface do repositório é a do fake travado**
  (`tests/helpers/repositorio-rotinas-memoria.js`); `repositorio-mongo.js`
  replica métodos e retornos.
- **D-05 · Processamento sequencial dentro da execução**; concorrência só entre
  execuções.
- **D-06 · Prazos em dias úteis não são persistidos**: guarda-se o instante do
  evento e calcula-se o vencimento a cada verificação (FR-014).
- **D-07 · Vencimento**: corridos = evento + N × 24h; úteis = 23:59:59.999
  (Brasília) do N-ésimo dia útil após o dia do evento; vencido quando
  `agora >= vencimento`.
- **D-08 · Limites**: `MAX_TENTATIVAS = 5`, `LEASE_PADRAO_MS = 10 min`,
  `limite = 500` itens/rotina/execução, histórico de execuções com TTL de 90
  dias.
- **D-09 · Painel só para `admin`**: `PERMISSIONS.ROTINAS_TAB = ['admin']`;
  checagem no servidor em toda rota `/api/admin/rotinas*` e `/api/admin/calendario`.
- **D-10 · Alerta de falha definitiva** = notificação interna para cada usuário
  `systemRole: 'admin'` não bloqueado + auditoria; sem e-mail.

## Constitution Check

*GATE: deve passar antes da Fase 0. Reavaliado após o design da Fase 1.*

| Princípio | Pré-Design | Pós-Design | Notas |
| --- | --- | --- | --- |
| I. Segurança no servidor | PASS | PASS | Agendador autentica por segredo com comparação em tempo constante; rotas de admin usam `getServerSession` + `hasRole`; `ROTINAS_SECRET` nunca logado; `dados` do item não guarda CPF/segredo. A liberação em `PUBLIC_PATHS` só vale para `/api/rotinas/executar`. |
| II. Integridade financeira | PASS | PASS | A feature não movimenta dinheiro. Fornece a idempotência do mecanismo e documenta (logic/executor.md, item 5) que `processarItem` financeira DEVE ser idempotente pelo próprio evento (R-006). |
| III. Regras de negócio como fonte | PASS | PASS | Spec cita RN:437-441, 526, 568-570, 778, 855-856, 893, 911. O documento de regras não define "dia útil"; T029 acrescenta a definição adotada, sem divergência. |
| IV. Persistência documentada | PASS | PASS | 4 coleções novas com schema em `database/schemas/`, `setupDatabase.js` e `setup-indexes.js` (T002–T004). IDs: coleções novas usam string; `userId` das notificações continua `ObjectId` (formato existente). |
| Restrições do Projeto | PASS | PASS | Pages Router; helpers `getDb`/`logAudit`/`hasRole`; Vitest; mensagens em português; disparo agnóstico de plataforma, conforme a restrição. |
| Fluxo de Desenvolvimento | PASS | PASS | Polish cobre build, lint, `npm test`, quickstart e docs (`CLAUDE.md`/`AGENTS.md` com `ROTINAS_SECRET` e `npm test`). |

## Project Structure

### Documentation (this feature)

```text
sdd/specs/001-rotinas-agendadas/
├── spec.md
├── plan.md                 # este arquivo
├── data-model.md           # 4 coleções novas + reutilizadas
├── contracts/
│   └── api-rotinas.md      # disparo + painel + calendário
├── logic/
│   ├── executor.md         # algoritmo, posse/lease, repositório Mongo
│   └── calendario.md       # dia local, Páscoa, fim do dia, casos de referência
├── quickstart.md
├── tasks.md
├── contract-tests.lock
└── handoff.md
```

### Source Code (repository root)

Arquivos que esta feature cria (+) ou altera (~), na árvore real:

```text
lib/
├── authz.js                         ~ PERMISSIONS.ROTINAS_TAB
├── calendario.js                    + STUB (plan) → implementar
├── calendario-dados.js              + carregarDatasExtras(db)
├── mongodb.js                         (só getDb; não importar em código puro)
├── audit.js                           (logAudit, reutilizado)
└── rotinas/
    ├── executor.js                  + STUB (plan) → implementar
    ├── repositorio-mongo.js         + criarRepositorioMongo(db)
    ├── registro.js                  + listarRotinas(), obterRotina(id)
    ├── saude.js                     + rotina 'saude' (batimento horário + sondas)
    └── alertas.js                   + criarAlertaAdmins(db)
pages/
├── admin/index.js                   ~ aba 'rotinas'
└── api/
    ├── rotinas/executar.js          + disparo do agendador
    └── admin/
        ├── rotinas/index.js         + GET lista
        ├── rotinas/[id]/index.js    + GET detalhe
        ├── rotinas/[id]/executar.js + POST manual
        ├── rotinas/[id]/reexecutar.js + POST item
        └── calendario.js            + GET/POST/DELETE datas extras
components/admin/
├── RotinasTab.js                    + lista/detalhe/reexecução
└── CalendarioDatasExtras.js         + datas extras
middleware.js                        ~ PUBLIC_PATHS += /api/rotinas/executar
database/
├── schemas/rotinaItens.schema.json            +
├── schemas/rotinaExecucoes.schema.json        +
├── schemas/calendarioDatasExtras.schema.json  +
├── schemas/rotinaSaudeSondas.schema.json      +
├── setupDatabase.js                 ~
└── setup-indexes.js                 ~
scripts/criar-sonda-rotina.js        + sondas para teste manual
tests/
├── contract/001-rotinas-agendadas.contract.test.js  TRAVADO
├── helpers/repositorio-rotinas-memoria.js           TRAVADO
├── rotinas/executor.test.js         + testes adicionais (execute)
└── calendario.test.js               + testes adicionais (execute)
vitest.config.mjs                    + (plan)
package.json                         ~ scripts test/test:contrato, devDep vitest (plan)
CLAUDE.md, AGENTS.md                 ~ ROTINAS_SECRET, npm test
.docs/regras-negocio-v2.md           ~ definição de dia útil/contagem
```

**Structure Decision**: segue o padrão existente — lógica em `lib/`, rotas em
`pages/api/`, telas em `pages/`, componentes em `components/` (subpasta
`components/admin/` nova para não inchar `pages/admin/index.js`, hoje com 359
linhas). Domínio de rotinas agrupado em `lib/rotinas/`.

## Complexity Tracking

> **Preencher SOMENTE se o Constitution Check tiver violações que precisam ser justificadas**

| Violação | Por que é necessária | Alternativa mais simples rejeitada porque |
| --- | --- | --- |

## Estratégia de Testes

Prioridade: unitário → contrato/integração → E2E → manual (último recurso).

- Unitário (Vitest): `lib/calendario.js` e `lib/rotinas/executor.js` com o
  repositório em memória; cobrem toda a lógica de prazo, idempotência,
  retentativa e reexecução.
- Integração com Mongo real: **manual** (`quickstart.md` passos 2–6). Não há
  Mongo em memória no projeto; a atomicidade do `findOneAndUpdate` + índice
  único é validada pelo passo 4 do quickstart (R-003).
- Rotas e painel: manual (`quickstart.md` 1, 7–11).

Comandos-base (no Windows, a partir de `J:\Cotea`, ver Cuidados):

```powershell
npm run build
npm run lint
npm test
npm run test:contrato
.\.planning\scripts\powershell\check-contract-tests.ps1 -Slug 001-rotinas-agendadas
```

### Testes de Contrato

Arquivos travados em `contract-tests.lock`:
`tests/contract/001-rotinas-agendadas.contract.test.js` (5 testes) e o helper
`tests/helpers/repositorio-rotinas-memoria.js` (0 testes; interface do repositório).

Comando: `npm run test:contrato` (= `vitest run tests/contract`)

| Teste | Origem | Fase | Vermelho esperado (antes do execute) |
| --- | --- | --- | --- |
| processa só os itens vencidos e não repete efeito ao rodar de novo | US1-AC1, US1-AC2 · FR-001/002/003/008 | Fase 3 | `Error: not implemented` (executor.js) |
| duas execuções simultâneas processam cada item com efeito uma única vez | US1-AC3 · FR-003 | Fase 3 | `Error: not implemented` (executor.js) |
| isola falhas, retenta até 5 vezes, vira falha definitiva e alerta uma única vez | US3-AC2/AC3 · FR-005/006/007 | Fase 3 | `Error: not implemented` (executor.js) |
| calcula vencimentos em dias corridos e úteis no horário de Brasília | US2-AC1..5 · FR-010..013 · SC-004 | Fase 4 | `Error: not implemented` (calendario.js) |
| considera datas extras e o calendário atual ao verificar se o prazo venceu | US4-AC1 · FR-012/014 | Fase 4 | `Error: not implemented` (calendario.js) |

Vermelho confirmado em 2026-11-20: `Tests 5 failed (5)`, todos por
`Error: not implemented`, rodando de `J:\Cotea`.

Stubs criados pelo plan (ponto de partida do execute, não travados):
`lib/calendario.js`, `lib/rotinas/executor.js`, `vitest.config.mjs`, scripts
`test`/`test:contrato` em `package.json`.

## Estado Atual

<!-- Sobrescrita a cada checkpoint pelo sdd-execute. Vazia na criação. -->

| Área | Estado |
| --- | --- |
| Persistência | 4 coleções + índices aplicados no banco de desenvolvimento (`setupDatabase.js`) |
| Executor / repositório Mongo | prontos; contratos 3/3; concorrência real validada (quickstart 4); orçamento de tempo `prazoMs` (45 s) com corte e continuação validados no banco dev (T035) |
| Calendário | pronto; contratos 2/2 |
| Disparo | `/api/rotinas/executar` validado (quickstart 1–6) |
| Painel / datas extras | implementados; validados com login Google real (2026-11-24: quickstart 7–10 admin 15/15; passo 11 com conta `user` 9/9 com 403); US4-AC1 em ambiente real e `support`/financeiro em runtime aceitos pelo usuário como cobertos por contrato e leitura de código |
| Testes | Vitest 43/43 (contratos 5/5, trava íntegra), conferido em 2026-11-24 após a Fase 8 |
| Gates | build ok (exit 0); `npm run lint` 0 erros (5 warnings pré-existentes) |
| Convergência | Fase 8 (T035–T037) concluída; falta rodar `sdd-converge` de novo |
| Docs | `CLAUDE.md`, `AGENTS.md`, `.docs/regras-negocio-v2.md` atualizados |

## Riscos e Decisões

<!--
  IDs estáveis (R-001, R-002...), nunca deletados. Item resolvido ganha
  prefixo "Resolvido:" na célula de Mitigação em vez de sumir da tabela.
-->

| ID | Risco/Decisão | Impacto | Mitigação/Encaminhamento |
| --- | --- | --- | --- |
| R-001 | Plataforma de deploy e agendador indefinidos | FR-002 (até 1h) depende de alguém chamar a rota | Resolvido: ADR-001 — Vercel (região `gru1`) com Vercel Schedules chamando `/api/rotinas/executar` a cada 15 min (Hobby: até ~30 min de atraso com jitter; Pro obrigatório antes do primeiro pagamento real, jitter 5). Rota passa a aceitar `CRON_SECRET` (T033) |
| R-002 | Lease (10 min) expira durante um processamento longo e outra execução assume o item | Efeito duplicado | Resolvido: lease de 10 min contra `maxDuration` de 60 s e orçamento de 45 s por execução (T035), então uma função cortada pelo timeout nunca tem o lease vigente por mais que 10 min; `processarItem` idempotente pelo evento segue exigido das features consumidoras (R-006) |
| R-003 | Contratos usam o repositório em memória; a atomicidade real do Mongo não tem teste automatizado | Divergência fake × Mongo passaria despercebida | Resolvido: quickstart passo 4 no banco de desenvolvimento — 20 sondas, 2 chamadas simultâneas, 10 + 10 processados, 0 duplicatas (2026-11-20) |
| R-004 | Tempo limite serverless com muitos itens vencidos | Execução cortada no meio | `limite` de 500 itens; itens restantes na próxima execução; item interrompido volta após o lease. Resolvido (2026-11-24, T035): orçamento de tempo `prazoMs` = 45 s no executor + `maxDuration` 60 s em `vercel.json`; corte e continuação validados no banco dev (a validação na Vercel real fica para o 1º deploy) |
| R-005 | Vitest no Windows falha com `Cannot read properties of undefined (reading 'config')` quando o caminho usa `j:` minúsculo | Falso vermelho / suíte não roda | Rodar de `J:\Cotea` (PowerShell `Set-Location J:\Cotea`) |
| R-006 | Processo morre depois do efeito e antes de `concluirItem` | Item reprocessado | Exigência às features consumidoras: efeito idempotente (ex.: índice único do ledger) |
| R-007 | `findOneAndUpdate` no driver 6.16 retorna o documento, não `{ value }`; handlers antigos usam `.value` | Copiar o padrão antigo quebra o repositório | `logic/executor.md` alerta; suspeita de bug existente registrada no backlog |
| R-008 | Gates de lint/build do projeto falham por problemas PRÉ-EXISTENTES fora desta feature: `next lint` (Next 14) não reconhece o `eslint.config.mjs` flat e abre prompt; `npx eslint .` acusa 22 erros em `pages/admin/grupos/[id].js` e `novo.js` (hooks condicionais, prop duplicada); `npm run build` falha em `pages/api/admin/users/[id]/block.js` (import `'../../auth/[...nextauth]'` inexistente — o correto é `'../../../auth/…'`, como em `role.js`) | Checklist de Release não fecha (build/lint) | Resolvido parcialmente: usuário aprovou corrigir o import de `block.js` (T032) — build passa; erros de lint viraram B-07/B-08 no backlog; conflito do `setup-indexes.js` virou B-09. Resolvido (2026-11-24): B-07/B-08 corrigidos por decisão do usuário (R-009) — lint e build passam |
| R-009 | Desvio T034 (fora do escopo, aprovado): hooks React depois de `return` antecipado em `pages/admin/grupos/[id].js` e `novo.js` quebravam as duas telas com "Rendered more hooks" (bug real, não só aviso de lint); `next lint` incompatível com config flat e `eslint` varrendo `.next/` | Telas de grupo do admin inutilizáveis; `npm run lint` não rodava | Resolvido: retornos movidos para depois dos hooks; prop `className` duplicada removida (a 1ª já era ignorada); `lint` → `eslint .` com `ignores`; regressão confirmada com Playwright (antigo FAIL 2/2, novo PASS 2/2) |

## Execution Notes

<!--
  Tabela append-only, mantida pelo sdd-execute. Quando passar de ~40 linhas,
  arquivar as mais antigas (exceto as ~10 mais recentes) em history.md,
  substituindo por uma linha de resumo consolidado aqui.
-->

| Data | Fase/Story | Resumo | Pendência Principal |
| --- | --- | --- | --- |
| 2026-11-20 | Fase 1 Setup | Schemas, coleções/índices e permissão `ROTINAS_TAB` | Rodar `node database/setupDatabase.js` no banco (decisão do usuário) |
| 2026-11-20 | Fase 2 Foundational | Repositório Mongo, registro, rotina de saúde, script de sondas, leitura/validação de datas extras | Validar repositório no banco real (quickstart) |
| 2026-11-20 | Fase 3 US1 | Executor, alertas, rota do agendador e middleware; contratos 3/3 + 6 testes extras | Quickstart 1–6 no banco real (R-003) |
| 2026-11-20 | Fase 4 US2 | Calendário puro; contratos 5/5, suíte 17/17 | — |
| 2026-11-20 | Fase 5 US3 | APIs do painel, `RotinasTab`, aba admin, testes de reexecução (suíte 21/21) | Quickstart 7–9, 11 |
| 2026-11-20 | Fase 6 US4 | API e componente de datas extras (suíte 25/25) | Quickstart 10 |
| 2026-11-20 | Fase 7 Polish (parcial) | Docs (`CLAUDE.md`, `AGENTS.md`, regra de prazos em `.docs/regras-negocio-v2.md`), R-001 encaminhado; suíte 25/25 | Build/lint bloqueados por problemas pré-existentes (R-008); quickstart pendente |
| 2026-11-20 | Fase 7 Polish | T032 (import `block.js`), build ok, banco configurado, quickstart 1–6 ok; B-07/B-08/B-09 no backlog | Quickstart 7–11 com login do usuário |
| 2026-11-20 | ADR-001/002 | Plataforma (Vercel gru1), agendador (Schedules 15 min), plano (Hobby→Pro), e-mail (Gmail até o lançamento); constitution 1.1.0; T033 | Quickstart 7–11 |
| 2026-11-22 | Fase 7 Polish (T031) | Login Google validado com Playwright até a tela do Google (8/8: `callbackUrl`, `redirect_uri`, escopo); login manual na janela não concluído, quickstart 7–11 não rodou | Alguém logar como admin na janela; passo 11 exige 2ª conta sem role admin |
| 2026-11-24 | Fase 7 Polish (T031) | Login Google real (admin) + quickstart 7–10 pela UI com Playwright: 15/15; `callbackUrl` respeitado; auditoria conferida | Passo 11 (2ª conta sem role admin) e US4-AC1 no ambiente real |
| 2026-11-24 | Fase 7 Polish (T031) | Passo 11 com login Google real e conta `user`: aba ausente e 6 rotas → 403 (9/9) | US4-AC1 no ambiente real; `support`/financeiro só por leitura de código |
| 2026-11-24 | Fase 7 Polish (fechamento) | Usuário aceitou US4-AC1 em ambiente real e 403 de `support`/financeiro como cobertos; T031, Fases 5/6 e quickstart marcados; suíte 28/28, contratos 5/5, trava íntegra | Só resta o item de lint do Checklist (B-07/B-08 pré-existentes) |
| 2026-11-24 | Fase 7 Polish (T034) | Desvio aprovado: B-07/B-08 resolvidos (hooks nas telas de grupo, script `lint`, `ignores`); lint 0 erros, build ok, suíte 28/28, contratos 5/5, trava íntegra; regressão Playwright antigo FAIL 2/2 → novo PASS 2/2 | — |
| 2026-11-24 | Fase 8 Convergence (T035–T037) | Orçamento de tempo do executor (`prazoMs` 45 s, `maxDuration` 60 s), ignorados na lista do painel, auditoria da falha definitiva independente da notificação; suíte 43/43, contratos 5/5, trava íntegra, lint 0 erros, build ok; corte por tempo validado no banco dev | Validar `maxDuration` na Vercel real no 1º deploy |

**PRÓXIMO**: rodar `sdd-converge` de novo; se convergir limpo, `spec.md` vira Convergida e o plan ganha `## Resultado Final`

## Arquivos Principais

<!-- Sobrescrita a cada checkpoint — foco da etapa atual, não a árvore inteira. -->

- `lib/rotinas/executor.js` (`prazoMs`/`relogio`), `lib/rotinas/dependencias.js` (`PRAZO_EXECUCAO_MS`), `lib/rotinas/alertas.js`
- `pages/api/rotinas/executar.js`, `pages/api/admin/rotinas/[id]/executar.js`, `vercel.json` (`functions.maxDuration`)
- `components/admin/RotinasTab.js` (ignorados na lista; aviso de corte por tempo)
- `tests/rotinas/executor-prazo.test.js`, `tests/rotinas/alertas.test.js`; `logic/executor.md`, `contracts/api-rotinas.md`

## Cuidados para Retomada

<!-- Armadilhas operacionais específicas desta feature, anexadas conforme descobertas. -->

- Rodar Vitest a partir de `J:\Cotea` (drive maiúsculo); de `j:\` a suíte quebra com `reading 'config'` (R-005).
- `database/setupDatabase.js` aplica `collMod` em TODAS as coleções: só rodar com autorização do usuário.
- Heredoc no Git Bash comeu `\d` num `pattern` de JSON Schema; o schema usa `[0-9]`.
- `lib/rotinas/autorizacao.js` importa `authOptions` de `pages/api/auth/[...nextauth]` (lib → pages); se isso virar problema de build, mover a guarda para cada rota.
- `npm run lint` agora é `eslint .` (T034); o `next lint` do Next 14 não lê config flat. O `eslint.config.mjs` ignora `.next/`; pare o dev server antes de `npm run build` (mesma pasta `.next`).
- `database/setup-indexes.js` aborta em `walletTransactions` (B-09) antes de chegar aos índices de rotinas; use `node database/setupDatabase.js`, que cria os mesmos índices.
- Para o quickstart, o segredo local foi passado só ao processo do dev server (`$env:ROTINAS_SECRET`), sem gravar no `.env.local`.
- `vercel.json` `functions` usa globs de arquivo (`pages/api/admin/rotinas/*/executar.js` cobre a rota dinâmica `[id]` sem escapar colchetes); `schedules` segue o formato do ADR-001. O corte por tempo só aparece em lotes grandes (~74 ms/item no banco dev): para reproduzir, `node --env-file=.env.local scripts/criar-sonda-rotina.js -1440 --quantidade=N` e rodar o executor com `prazoMs` pequeno.

## Resultado Final

<!-- Anexado pelo sdd-converge em 2026-11-24, após convergir sem achados acionáveis. -->

**O que foi construído** (FR-001..FR-020, SC-001..SC-006 e US1..US4 confirmados no código, nos contratos e no quickstart 1–11 com login Google real):

- **Executor idempotente** (`lib/rotinas/executor.js`, puro, repositório injetado): idempotência por `rotinaId + chave` com índice único e lease de 10 min, falha isolada por item, até 5 tentativas, falha definitiva com alerta uma única vez, itens "ignorados", reexecução manual que zera as tentativas e orçamento de tempo `prazoMs`. Repositório Mongo com a mesma interface do fake travado (`lib/rotinas/repositorio-mongo.js`).
- **Disparo** `GET|POST /api/rotinas/executar` com `Bearer CRON_SECRET` (alternativa `ROTINAS_SECRET`), `timingSafeEqual`, 401/404/405/503, liberada só ela em `PUBLIC_PATHS`; `vercel.json` com região `gru1`, schedule a cada 15 min e `maxDuration` de 60 s.
- **Rotina de saúde** (batimento horário + sondas de teste) e `scripts/criar-sonda-rotina.js`.
- **Calendário puro** (`lib/calendario.js`): dias corridos e úteis no horário de Brasília sem fixar -03:00, feriados fixos + Sexta-feira Santa, datas extras recebidas por parâmetro; `lib/calendario-dados.js` para leitura e validação.
- **Painel** `/admin?tab=rotinas` (só `admin`, checagem no servidor): lista, detalhe, histórico, itens em falha, "Executar agora", "Reexecutar" e datas extras com auditoria (`rotina.executada_manual`, `rotina.item_reexecutado`, `rotina.item_falha_definitiva`, `calendario.data_extra_incluida/_removida`).
- **Persistência**: 4 coleções com schema, índices e TTL (90 d de execuções, 7 d de sondas) em `setupDatabase.js` e `setup-indexes.js`.
- **Qualidade**: 49 tasks; contratos 5/5 com a trava íntegra; Vitest 43/43; `npm run lint` 0 erros; `npm run build` ok.

**Desvios em relação ao plano original** (todos registrados nas Execution Notes e em Riscos):

- ADR-001/002 definiram Vercel + Schedules; a rota passou a aceitar `CRON_SECRET` (T033) e a constitution foi para 1.1.0.
- T032 e T034 (desvios aprovados pelo usuário): import quebrado em `pages/api/admin/users/[id]/block.js`; B-07 (hooks React depois de retorno antecipado em `pages/admin/grupos/[id].js` e `novo.js`, que derrubava as telas) e B-08 (`lint` → `eslint .` com `ignores` de `.next/`).
- Fase 8 (convergência): T035 orçamento de tempo (45 s) e `maxDuration` 60 s; T036 ignorados na lista do painel; T037 auditoria da falha definitiva independente da notificação.
- Extras não previstos nas tasks originais: `lib/rotinas/autorizacao.js`, `consultas.js`, `dependencias.js`.
- Batimento da rotina de saúde usa a hora em UTC (só precisa ser único por hora); `processarItem` da sonda relê a sonda do banco (revalidação, FR-007).
- Aceitos pelo usuário: US4-AC1 no ambiente real (coberta pelo contrato automatizado) e 403 em runtime de `support`/financeiro (coberto pela guarda `exigirAdminRotinas`; só `user` foi exercitado).

**Pontos que ficaram em aberto fora desta feature**:

- Validar `maxDuration` e o corte por tempo na Vercel real no primeiro deploy (Hobby: atraso de até ~30 min com jitter; Pro obrigatório antes do primeiro pagamento real, R-001).
- Features consumidoras devem tornar o efeito idempotente pelo próprio evento (R-006) e registrar a própria rotina em `lib/rotinas/registro.js`.
- Itens fora do escopo, registrados no backlog: B-09 (`setup-indexes.js` x `setupDatabase.js`), e a suspeita sobre `.value` do `findOneAndUpdate` em handlers antigos (R-007). O login que respeita `callbackUrl` (`lib/redirecionamento.js`, commit `1a23f1a`) não pertence a esta feature.
