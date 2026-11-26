# Implementation Plan: Aprovação, moderação e visibilidade de grupos públicos

**Slug**: `005-aprovacao-grupos` | **Date**: 2026-11-26 | **Spec**: `sdd/specs/005-aprovacao-grupos/spec.md`

**Nota**: Este template é preenchido pelo skill `sdd-plan`; a definição do skill
descreve o fluxo de execução completo.

## Summary

Todo grupo novo nasce `em_aprovacao` e só fica público (`ativo`) por decisão do
admin do sistema ou por aprovação automática após 2 dias úteis; o ciclo inclui
`ajustes` (reenviável), `rejeitado` (final) e `cancelado` (final: desistência do
dono ou cancelamento pelo Cotea). Não há estado suspenso. Abordagem: o próprio
`grupos.status` carrega o estado de moderação (o bloqueio de `pay`/`join` da
B-04 já recusa tudo que não é `ativo`), um subdocumento `grupos.moderacao`
guarda envio, prazo, marca de revisão posterior e histórico; um módulo puro
(`lib/moderacao.js`) define a tabela de transições e a visibilidade, e um
módulo de servidor aplica cada transição com `findOneAndUpdate` condicional,
notificação idempotente e auditoria. A aprovação automática é uma rotina do
mecanismo da 001. Fila no `/admin` (aba nova), banner/ações para o dono no
detalhe, filtros na home, na listagem e no detalhe, e migração dos 5 grupos
atuais para "aprovado (legado)".

## Technical Context

**Language/Version**: JavaScript (ES modules), Node.js da Vercel; Next.js 14 Pages Router.

**Primary Dependencies**: `next`, `next-auth` v4 (JWT), driver `mongodb` v6,
`lib/calendario.js` e `lib/rotinas/*` (001), `lib/authz.js`, `lib/audit.js`,
`lib/grupo-entrada.js` (B-04), `lib/grupo-publico.js`,
`lib/cadastro-financeiro-servidor.js` (004).

**Storage**: MongoDB Atlas (`usaComigo`). Coleções tocadas: `grupos` (campos
novos), `membrosGrupo` (leitura), `notificacoesUsuario` (inserção com `_id`
string), `auditLogs` (via `logAudit`), `rotinaItens`/`rotinaExecucoes` (via
executor da 001). Nenhuma coleção nova.

**Testing**: Vitest (`npm test`; contratos em `npm run test:contrato`). Handlers
testados com o fake `tests/helpers/db-grupos-memoria.js` (estendido e travado
nesta feature) e mocks de `next-auth`, `lib/mongodb`, `lib/audit`.

**Target Platform**: Vercel (`gru1`), funções serverless; agendador Vercel
Schedules a cada 15 min (`/api/rotinas/executar`, ADR-001).

**Performance Goals**: N/A (dezenas de grupos). A rotina lê todos os
`em_aprovacao` por execução; aceitável até milhares (índice
`{ status, moderacao.enviadoEm }`).

**Constraints**: estado só muda no servidor (Constitution I); sem timers em
processo; função ≤ 60 s (executor da 001 com orçamento de 45 s); mensagens em
português sem acento nas APIs, como as atuais.

**Scale/Scope**: 5 grupos em produção, todos `ativo`/`publico` (conferido
2026-11-26).

## Decisões Invariantes

- **D-01 — `status` é o estado de moderação**: valores `em_aprovacao`,
  `ajustes`, `rejeitado`, `ativo` (= aprovado e público), `cancelado`. Não há
  `aprovado` nem `suspenso`. `statusDetalhado` não é tocado (V2-07).
- **D-02 — `status` ausente = `ativo` (legado)**, o mesmo critério já usado por
  `motivoGrupoIndisponivel` e pelos testes de B-04 e do bug
  `get-grupo-expoe-dados-internos`. A migração grava `status: 'ativo'`
  explicitamente nesses casos. Diverge do texto do FR-029 ("sem status → fora
  do ar"); ver R-001.
- **D-03 — Subdocumento `grupos.moderacao`** embutido (formato em
  `data-model.md`), histórico com `$push`/`$slice: -100`. Atualizações sempre por
  caminho pontuado; nunca sobrescrever `moderacao` inteiro.
- **D-04 — Toda transição passa por `planejarTransicao` (puro) +
  `executarTransicao` (servidor)**: `findOneAndUpdate` com filtro no status de
  origem (e no `moderacao.envio` na automática) garante que só uma decisão
  vence; perdedor recebe 409 `moderacao_conflito`. Notificação com `_id`
  determinístico `moderacao:<grupoId>:<envio>:<acao>:<userId>` (11000 ignorado);
  auditoria `grupo.moderacao.<acao>` só após gravar; `actorId: 'sistema'` na
  automática. Sem transação Mongo (um documento por transição).
- **D-05 — Tabela de transições** de `logic/moderacao.md` §2 é a única fonte;
  rejeitado e cancelado são finais.
- **D-06 — Visibilidade**: público = status efetivo `ativo`. Não público só
  para staff (`GROUPS_TAB`), dono ou membro atual não banido; demais → 404 /
  `notFound` (sem distinguir de "não existe"). Aplicado em `GET /api/grupos`,
  SSR da home, `GET /api/grupos/[id]` e SSR de `pages/grupos/[id].js`.
- **D-07 — Edição e exclusão**: `PUT` ignora `status`/`statusDetalhado` do
  body; dono não-admin edita só em `ajustes`/`ativo`; admin do sistema edita
  fora de estados finais; editar não muda estado nem prazo. `DELETE` só em
  `ativo` (fluxo atual até V2-14); pendente usa `desistir`; finais preservam
  histórico.
- **D-08 — Permissões**: `PERMISSIONS.MODERAR_GRUPOS = ['admin']` para decidir;
  a fila é lida com `GROUPS_TAB` (suporte e admin).
- **D-09 — Prazo**: `vencimentoDiasUteis(enviadoEm, 2)` da 001 (fim do 2º dia
  útil após o dia do envio, Brasília), sem função nova (decisão do usuário).
- **D-10 — Rotina** `aprovacao-automatica-grupos` com chave
  `grupo:<id>:envio:<n>` (reenvio = item novo), registrada em
  `lib/rotinas/registro.js`.
- **D-11 — Sem efeito financeiro**: nenhuma escrita em `walletTransactions`,
  `invoices` ou `payments`. `moderacao.revisaoPendente` é a interface para a
  V2-11 reter o repasse.
- **D-12 — Fronteira de módulos**: `lib/moderacao.js` não importa
  `lib/mongodb.js` nem `next-auth` (pode importar `lib/calendario.js`).

## Constitution Check

*GATE: deve passar antes da Fase 0. Reavaliado após o design da Fase 1.*

| Princípio | Pré-Design | Pós-Design | Notas |
| --- | --- | --- | --- |
| I. Segurança no servidor | ✅ | ✅ | Status deixa de vir do cliente (criação e PUT); decisões checadas com `hasRole(PERMISSIONS.MODERAR_GRUPOS)` após `getServerSession` e releitura do grupo; rota de rotina segue protegida por segredo (001); detalhe não público 404 para terceiros. Achado lateral: SSR do detalhe envia o documento inteiro ao cliente (R-003). |
| II. Integridade financeira | ✅ N/A | ✅ N/A | Nenhum movimento de dinheiro (D-11). Bloqueio de cobrança reaproveita B-04. Estornos de cancelamento pelo Cotea ficam com o suporte/V2-14. |
| III. Regras de negócio como fonte | ⚠️ | ✅ | A entrega diverge de RN (sem suspensão, rejeição definitiva, prazo no fim do dia útil): T046 atualiza `.docs/regras-negocio-v2.md` na mesma entrega, e a spec registra as decisões. D-02 diverge do FR-029 → R-001 (registrar na spec). |
| IV. Persistência documentada | ✅ | ✅ | T004 atualiza `database/schemas/grupos.schema.json`; T005 adiciona índice `{ status, moderacao.enviadoEm }` em `setupDatabase.js` e `setup-indexes.js`; IDs normalizados com `parseObjectId` (adminId pode ser string em `adminIdString`). |
| Restrições (stack, helpers, Vercel, agendamento) | ✅ | ✅ | Pages Router; `logAudit`, `hasRole`, `getDb`/`clientPromise` reutilizados; trabalho agendado pelo mecanismo da 001 (sem timers); lote limitado pelo executor. |
| Fluxo de desenvolvimento | ✅ | ✅ | Gates no Checklist de Release (build, lint, test, quickstart, consumidores de API atualizados na mesma mudança: home, detalhe, Meus Grupos, novo/edição de grupo, admin). |

## Project Structure

### Documentation (this feature)

```text
sdd/specs/005-aprovacao-grupos/
├── spec.md
├── plan.md
├── data-model.md
├── quickstart.md
├── contracts/api-moderacao.md
├── logic/moderacao.md
├── tasks.md
├── contract-tests.lock
└── handoff.md
```

### Source Code (repository root)

```text
lib/
├── moderacao.js                 # NOVO (stub): estados, transições, visibilidade, prazo — puro
├── moderacao-servidor.js        # NOVO (stub): executarTransicao, notificarEventoModeracao
├── rotinas/
│   ├── aprovacao-automatica.js  # NOVO (stub): rotina aprovacao-automatica-grupos
│   └── registro.js              # registrar a rotina
├── authz.js                     # + PERMISSIONS.MODERAR_GRUPOS
├── grupo-entrada.js             # sem mudança (já recusa status != ativo)
├── grupo-publico.js             # sem mudança de allowlist (moderacao fica fora)
└── calendario.js                # reutilizado (vencimentoDiasUteis)
pages/
├── index.js                     # SSR: filtro de públicos
├── meus-grupos.js               # badge de estado/motivo
├── grupos/[id].js               # SSR: visibilidade; banner + ações do dono
├── admin/
│   ├── index.js                 # aba "Moderação"
│   └── grupos/{novo.js,[id].js} # sem seletor de status; aviso de aprovação/bloqueio
└── api/
    ├── grupos/index.js          # POST em_aprovacao; GET filtrado
    ├── grupos/[id].js           # GET visibilidade; PUT/DELETE por estado
    ├── grupos/[id]/moderacao.js # NOVO (stub): reenviar/desistir
    ├── admin/grupos/[id]/moderacao.js # NOVO (stub): decisões
    ├── admin/moderacao/index.js # NOVO (stub): fila + contagens
    └── meus-grupos.js           # projeção de moderacao
components/admin/ModeracaoTab.js # NOVO: fila (pendentes / revisão posterior)
database/
├── schemas/grupos.schema.json   # status + moderacao
├── setupDatabase.js             # índice novo
└── setup-indexes.js             # índice novo
scripts/migrar-moderacao-grupos.js # NOVO: dry-run / --aplicar
tests/
├── contract/005-aprovacao-grupos.contract.test.js  # TRAVADO
├── helpers/db-grupos-memoria.js                    # estendido e TRAVADO
└── moderacao/                                       # NOVO: testes adicionais do execute
.docs/regras-negocio-v2.md       # atualizar (sem suspensão etc.)
```

**Structure Decision**: projeto Next.js único; lógica de domínio pura em `lib/`
(padrão de `lib/preco.js`, `lib/cadastro-financeiro.js`), I/O em módulo
`-servidor` (padrão da 004), rotas em `pages/api/`, componentes de admin em
`components/admin/` (padrão de `RotinasTab`), testes em `tests/<area>/`.

## Complexity Tracking

> Sem violações não justificadas.

| Violação | Por que é necessária | Alternativa mais simples rejeitada porque |
| --- | --- | --- |
| — | — | — |

## Estratégia de Testes

Prioridade: unitário → contrato/integração → E2E → manual (último recurso).

Comandos-base (de `J:\Cotea`):

```powershell
npm run build
npm run lint
npm test
npm run test:contrato
npx vitest run tests/contract/005-aprovacao-grupos.contract.test.js
.\.planning\scripts\powershell\check-contract-tests.ps1 -Slug 005-aprovacao-grupos
```

- Unitários de `lib/moderacao.js` (tabela de transições inteira, texto,
  visibilidade, prazo com feriado) em `tests/moderacao/`.
- Handlers com o fake travado (`db-grupos-memoria.js`): fila, cancelamento
  pelo Cotea, desistência, revisão, DELETE/PUT por estado, Meus Grupos.
- Listagem (`GET /api/grupos`) e SSR usam `aggregate`, que o fake não tem:
  testar o filtro exportado (`FILTRO_GRUPOS_PUBLICOS` em `lib/moderacao.js`) e
  um teste de handler com `aggregate` mockado conferindo o `$match` inicial.
- Manual: `quickstart.md` (UI da fila, banner, notificações, rotina pelo painel).

### Testes de Contrato

Arquivos travados em `contract-tests.lock`:
`tests/contract/005-aprovacao-grupos.contract.test.js` (5 testes) e
`tests/helpers/db-grupos-memoria.js` (helper, 0 testes; estendido de forma
compatível — suíte anterior 280/280 verde com ele).

Comando: `npx vitest run tests/contract/005-aprovacao-grupos.contract.test.js`

| Teste | Origem | Fase | Vermelho esperado (antes do execute) |
| --- | --- | --- | --- |
| criação ignora status/moderação do cliente, nasce em_aprovacao (inclusive por admin do sistema) e não aceita pagamento | US1/AC1, FR-002, FR-004, FR-007, Constitution I | Fase 3 | `expected 'ativo' to be 'em_aprovacao'` |
| detalhe de grupo não público responde 404 a terceiros e abre para dono, membro atual e staff | US1/AC2-AC3, FR-006 | Fase 3 | `expected 200 to be 404` |
| fila: suporte não decide; ajuste exige texto; admin aprova uma única vez e o dono é notificado uma vez | US2/AC2, AC5, AC6, FR-010-012, FR-014, FR-026 | Fase 4 | `Error: not implemented` (rota stub) |
| rotina aprova automaticamente só após o fim do 2º dia útil, uma única vez, com marca de revisão pendente | US3/AC1-AC3, FR-015-017, SC-003 | Fase 5 | `Error: not implemented` (rotina stub) |
| dono não edita em aprovação; em ajustes edita sem mudar status e o reenvio reinicia o prazo | US4/AC2-AC3, US1/AC6, FR-003, FR-019, FR-020, US3/AC6 | Fase 6 | `expected 200 to be 409` |

Os 5 ficam verdes só com a feature inteira das fases 2-6 (o 5º depende de
ajuste pela rota do admin e da rotina). Saída vermelha confirmada em
2026-11-26: 5/5 falham pelas asserções acima.

Stubs criados pelo plan (ponto de partida do execute, não travados):
`lib/moderacao.js` (constantes definitivas, funções `not implemented`),
`lib/moderacao-servidor.js`, `lib/rotinas/aprovacao-automatica.js`,
`pages/api/admin/grupos/[id]/moderacao.js`, `pages/api/grupos/[id]/moderacao.js`,
`pages/api/admin/moderacao/index.js`.

## Estado Atual

<!-- Sobrescrita a cada checkpoint pelo sdd-execute. Vazia na criação. -->

| Área | Estado |
| --- | --- |
| US1 a US5 (Fases 1-7) | Concluídas |
| Polish (Fase 8) | T043-T048 feitas; T048 por Playwright com a sessão logada, dados de teste apagados; T050/T051 corrigidas no caminho |
| Contratos | 001-005: 25/25 verdes (`npm run test:contrato`); 5 travas íntegras |
| Gates | `npm test` 427/427; `npm run lint` 0 erros (5 warnings pré-existentes); `npm run build` ok |
| Banco (`usaComigo`) | Migração aplicada (5 grupos → aprovado/legado), reexecução 0 alterações; índice `status_1_moderacao.enviadoEm_1` criado |
| Implantação | Nada commitado; falta só o gate de implantação conjunta (US1 com US2/US3) e reexecutar a migração após o deploy |
## Riscos e Decisões

<!--
  IDs estáveis (R-001, R-002...), nunca deletados. Item resolvido ganha
  prefixo "Resolvido:" na célula de Mitigação em vez de sumir da tabela.
-->

| ID | Risco/Decisão | Impacto | Mitigação/Encaminhamento |
| --- | --- | --- | --- |
| R-001 | D-02 (status ausente = `ativo`) diverge do FR-029 ("sem status → fora do ar"). | Baixo: 0 grupos sem status no banco (2026-11-26); manter o critério evita quebrar B-04 e o teste de `get-grupo-expoe-dados-internos`. | Registrar a decisão na spec (Clarifications/FR-029) antes ou durante o execute (T046). A migração grava `ativo` explícito e lista esses grupos no relatório. |
| R-002 | Queda entre gravar a transição e notificar/auditar perde a notificação ou a auditoria das ações manuais. | Baixo: notificação é informativa; a transição em si é atômica. | Rotina renotifica no reprocessamento (idempotente pelo `_id`). Ações manuais: aceito; auditoria via `logAudit` já é "melhor esforço" no projeto. |
| R-003 | SSR de `pages/grupos/[id].js` envia o documento inteiro do grupo nas props (inclui `observacoesInternas`, `necessitaAnalise`, e-mails) — achado pré-existente, fora do escopo. | Médio (exposição a qualquer visitante de grupo público). | Não corrigir aqui (escopo); abrir `sdd-bugfix` separado. Esta feature só acrescenta o gate de visibilidade ao SSR e NÃO deve passar `moderacao` a terceiros (o gate já garante que só dono/membro/staff veem grupo não público). |
| R-004 | Cancelamento pelo Cotea deixa membros pagantes sem estorno automático. | Médio operacional. | Decisão do usuário: suporte trata; notificação aos membros; V2-14/V2-15 automatizam. |
| R-005 | Fake de Mongo travado: features futuras que precisarem de operadores novos não podem editá-lo. | Baixo. | Criar helper próprio na feature futura ou reabrir a trava via plan. |
| R-007 | **Defeito no contrato travado** (`detalhe de grupo não público…`, `tests/contract/005-aprovacao-grupos.contract.test.js:142,157`): `semearGrupo({ status: undefined, moderacao: null })` aplica o default `status = 'em_aprovacao'` do destructuring, então o "grupo legado" vira um grupo em aprovação e o teste espera 200 para anônimo — o oposto do FR-006. Achado na Fase 3 (2026-11-26). | Bloqueia o contrato: impossível ficar verde sem violar o FR-006. | Resolvido: emenda aprovada pelo usuário (2026-11-26). Só `semearGrupo` mudou (`'status' in opcoes` / `'moderacao' in opcoes`; `moderacao: null` passa a semear documento sem o campo); asserções intactas; trava regravada com `check-contract-tests.ps1 -Write`. |
| R-008 | Conflito spec × código achado na T016: o botão "Cancelar grupo" do dono (`pages/admin/grupos/[id].js`) cancelava por `PUT` com `status: 'cancelado'`, que o FR-003 passa a ignorar; a spec também diz que o encerramento atual do dono não muda (V2-14). | Sem tratamento, o dono perderia o encerramento sem aviso. | Resolvido: decisão do usuário (2026-11-26) — ação nova `encerrar` do dono em `lib/moderacao.js` (`ativo` → `cancelado`, `origem: 'dono'`, texto opcional, notifica só os membros, sem estorno) pela rota do dono; o botão usa `desistir` em `em_aprovacao`/`ajustes`. Task T049. |
| R-009 | `/admin/grupos` lista só os grupos do próprio staff (via `/api/meus-grupos`), sem lugar para o Cotea cancelar qualquer grupo aprovado (T040). | Baixo. | Resolvido: visão `aprovados` na fila de moderação (API e aba), com a ação `cancelar`; contrato de API atualizado. |
| R-010 | O validador `$jsonSchema` do banco exige `fidelidade.periodoMeses` numérico: criar grupo pela API sem período de fidelidade falha com 400 "Validacao do documento falhou" (achado na T048; pré-existente, a tela sempre envia o período). O schema também está aplicado no banco, ao contrário do que diz o `CLAUDE.md` ("documentation only"). | Baixo para a 005; o `moderacao` novo passa porque o validador não tem `additionalProperties: false`. | Fora do escopo: registrar no backlog como `[Bug]` e ajustar a frase do `CLAUDE.md` em `sdd-adhoc`. |
| R-006 | Edição concorrente com decisão: admin do sistema edita conteúdo durante `em_aprovacao` enquanto outro admin aprova; dono edita em `ajustes` enquanto desiste em outra aba. | Baixo. | Coberto por D-04/D-07: o `PUT` nunca toca `status`, e a checagem de estado do `PUT` é feita no filtro do `updateOne` (`status` lido + `$in` permitido), não só na leitura. |

## Execution Notes

<!--
  Tabela append-only, mantida pelo sdd-execute. Quando passar de ~40 linhas,
  arquivar as mais antigas (exceto as ~10 mais recentes) em history.md,
  substituindo por uma linha de resumo consolidado aqui.
-->

| Data | Fase/Story | Resumo | Pendência Principal |
| --- | --- | --- | --- |
| 2026-11-26 | Fases 1-2 | Permissão `MODERAR_GRUPOS`, núcleo puro e de servidor, schema e índices; 89 testes novos verdes | — |
| 2026-11-26 | Fase 3 (US1, parcial) | T009-T014: criação em aprovação, filtro público na listagem/home, gate de visibilidade na API (agora via `identificarVisaoGrupo`) e no SSR (prop nova `estadoGrupo`), PUT sem status e com regra do dono; contrato de criação verde | Bloqueio R-007 (contrato do detalhe com defeito) |
| 2026-11-26 | Fase 3 (US1) | R-007 resolvido (emenda aprovada), R-008 (ação `encerrar`) decidido; T015-T020 e T049 (tela); dry-run 5/0; 2/2 contratos da fase verdes | T049 fecha com a T033 |
| 2026-11-26 | Fase 4 (US2) | Rota de decisões, API da fila, `ModeracaoTab` (com ações de revisão) e aba com contador; contrato da fila verde | Validação no navegador (T048) |
| 2026-11-26 | Fase 5 (US3) | Rotina de aprovação automática registrada; contrato da rotina verde; 001 intacto | — |
| 2026-11-26 | Fase 6 (US4) | Rota do dono, Meus Grupos, banner no detalhe, edição em ajustes com reenvio; 5/5 contratos e 423/423 | Validação no navegador (T048) |
| 2026-11-26 | Fase 7 (US5) | Cancelar pelo Cotea na fila (visão nova Aprovados), estado na lista do admin; 127/127 em tests/moderacao | — |
| 2026-11-26 | Fase 8 (Polish) | RN (18 trocas, sem suspensão), CLAUDE.md, backlog (V2-11/14/15); migração aplicada e índice criado no banco com autorização do usuário; gates lint/test/build verdes | T048 no navegador |
| 2026-11-26 | T048 (quickstart) | Passos 1-9 no navegador via Playwright (admin = dono); 2 bugs de UI corrigidos (T050 corrida na fila, T051 reenvio do dono-admin); banco limpo (5 grupos, 5 membros, 7 notificações, 16 auditorias, 2 itens de rotina apagados) | Gate de implantação conjunta |

**PRÓXIMO**: commit; implantar US1-US5 juntas (gate da Phase 8); reexecutar `scripts/migrar-moderacao-grupos.js --aplicar` após o deploy; depois `sdd-converge 005-aprovacao-grupos`.

## Arquivos Principais

<!-- Sobrescrita a cada checkpoint — foco da etapa atual, não a árvore inteira. -->

- Núcleo: `lib/moderacao.js`, `lib/moderacao-servidor.js`, `lib/rotinas/aprovacao-automatica.js`
- APIs: `pages/api/admin/grupos/[id]/moderacao.js`, `pages/api/admin/moderacao/index.js`, `pages/api/grupos/[id]/moderacao.js`, `pages/api/grupos/index.js`, `pages/api/grupos/[id].js`, `pages/api/meus-grupos.js`
- Telas: `components/admin/ModeracaoTab.js`, `pages/admin/index.js`, `pages/grupos/[id].js`, `pages/admin/grupos/[id].js`, `pages/admin/grupos/novo.js`, `pages/admin/grupos/index.js`, `pages/meus-grupos.js`, `pages/index.js`
- Migração: `scripts/migrar-moderacao-grupos.js`
## Cuidados para Retomada

<!-- Armadilhas operacionais específicas desta feature, anexadas conforme descobertas. -->

- `R` é alias de `Invoke-History` no PowerShell: não use como nome de função em scripts de edição.
- `lib/moderacao.js` importa `./calendario.js` com extensão porque o script de migração (Node ESM, sem `"type"` no package.json) o importa direto; não remova a extensão.
- O `PUT /api/grupos/[id]` exige ser dono/admin do grupo mesmo para admin do sistema (regra pré-existente); testes de admin precisam do admin como dono.
- A `visao` da SSR do detalhe ficou `{ jaMembro, souAdmin }` por causa do teste do bug `ssr-grupo-…`; o estado de moderação vai na prop `estadoGrupo`.
