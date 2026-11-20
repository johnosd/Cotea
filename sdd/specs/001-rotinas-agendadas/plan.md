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
| Persistência | 4 schemas + coleções/índices em `setupDatabase.js` e `setup-indexes.js`; ainda não aplicados ao banco |
| Permissão | `PERMISSIONS.ROTINAS_TAB = ['admin']` |
| Executor / calendário | stubs (contratos 0/5) |
| Rotas / painel | não iniciados |

## Riscos e Decisões

<!--
  IDs estáveis (R-001, R-002...), nunca deletados. Item resolvido ganha
  prefixo "Resolvido:" na célula de Mitigação em vez de sumir da tabela.
-->

| ID | Risco/Decisão | Impacto | Mitigação/Encaminhamento |
| --- | --- | --- | --- |
| R-001 | Plataforma de deploy e agendador indefinidos | FR-002 (até 1h) depende de alguém chamar a rota | D-01: rota agnóstica; abrir `sdd-adr` antes do deploy (Vercel Cron, GitHub Actions ou cron do sistema); frequência recomendada de 15 min |
| R-002 | Lease (10 min) expira durante um processamento longo e outra execução assume o item | Efeito duplicado | Lease maior que o timeout serverless típico; `processarItem` idempotente pelo evento (R-006) |
| R-003 | Contratos usam o repositório em memória; a atomicidade real do Mongo não tem teste automatizado | Divergência fake × Mongo passaria despercebida | `logic/executor.md` fixa a operação; quickstart passo 4 (duas chamadas simultâneas) é gate da Fase 3 |
| R-004 | Tempo limite serverless com muitos itens vencidos | Execução cortada no meio | `limite` de 500 itens; itens restantes na próxima execução; item interrompido volta após o lease |
| R-005 | Vitest no Windows falha com `Cannot read properties of undefined (reading 'config')` quando o caminho usa `j:` minúsculo | Falso vermelho / suíte não roda | Rodar de `J:\Cotea` (PowerShell `Set-Location J:\Cotea`) |
| R-006 | Processo morre depois do efeito e antes de `concluirItem` | Item reprocessado | Exigência às features consumidoras: efeito idempotente (ex.: índice único do ledger) |
| R-007 | `findOneAndUpdate` no driver 6.16 retorna o documento, não `{ value }`; handlers antigos usam `.value` | Copiar o padrão antigo quebra o repositório | `logic/executor.md` alerta; suspeita de bug existente registrada no backlog |

## Execution Notes

<!--
  Tabela append-only, mantida pelo sdd-execute. Quando passar de ~40 linhas,
  arquivar as mais antigas (exceto as ~10 mais recentes) em history.md,
  substituindo por uma linha de resumo consolidado aqui.
-->

| Data | Fase/Story | Resumo | Pendência Principal |
| --- | --- | --- | --- |
| 2026-11-20 | Fase 1 Setup | Schemas, coleções/índices e permissão `ROTINAS_TAB` | Rodar `node database/setupDatabase.js` no banco (decisão do usuário) |

**PRÓXIMO**: Fase 2 — T005 `lib/rotinas/repositorio-mongo.js` (replicar a interface do fake travado)

## Arquivos Principais

<!-- Sobrescrita a cada checkpoint — foco da etapa atual, não a árvore inteira. -->

- `database/schemas/rotinaItens.schema.json`, `rotinaExecucoes.schema.json`, `calendarioDatasExtras.schema.json`, `rotinaSaudeSondas.schema.json`
- `database/setupDatabase.js`, `database/setup-indexes.js`
- `lib/authz.js`

## Cuidados para Retomada

<!-- Armadilhas operacionais específicas desta feature, anexadas conforme descobertas. -->

- Rodar Vitest a partir de `J:\Cotea` (drive maiúsculo); de `j:\` a suíte quebra com `reading 'config'` (R-005).
- `database/setupDatabase.js` aplica `collMod` em TODAS as coleções: só rodar com autorização do usuário.
- Heredoc no Git Bash comeu `\d` num `pattern` de JSON Schema; o schema usa `[0-9]`.
