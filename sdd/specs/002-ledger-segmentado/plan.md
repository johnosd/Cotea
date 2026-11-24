# Implementation Plan: Ledger segmentado e saldo sacável

**Slug**: `002-ledger-segmentado` | **Date**: 2026-11-24 | **Spec**: `sdd/specs/002-ledger-segmentado/spec.md`

**Nota**: Este template é preenchido pelo skill `sdd-plan`; a definição do skill
descreve o fluxo de execução completo.

## Summary

Todo lançamento de `walletTransactions` passa a ter `categoria`, `organizacaoId`
(nulo no público), `grupoId`/`participacaoId` opcionais e `operacaoId`
(idempotência). Um núcleo puro (`lib/ledger/ledger.js`, repositório injetado,
mesmo padrão da 001) calcula o resumo derivado em centavos inteiros (total,
disponível = sacável, saque em andamento, caução/retido/recebível/disputa por
grupo, receita da plataforma) e grava operações com várias pernas tudo-ou-nada,
travando por carteira (transação Mongo + `$inc` em `wallets.versaoLedger`) para
que débitos simultâneos nunca deixem saldo negativo. Os 6 fluxos que já gravam
no ledger passam pelo núcleo; os 13 lançamentos legados são migrados para
`pessoal` sem mudar saldo. A carteira mostra o resumo segmentado; financeiro e
admin veem o saldo do usuário no saque e a conta da plataforma; uma rotina
diária (mecanismo da 001) confere a consistência e alerta o admin. Caução,
recebíveis e disputa ganham só as categorias e a movimentação — quem gera esses
valores são V2-06/07/11/15/16.

## Technical Context

**Language/Version**: JavaScript (ES modules transpilados pelo Next.js), Node.js 22 local

**Primary Dependencies**: Next.js 14.2 (Pages Router), `mongodb` 6.16 (driver nativo, transações), `next-auth` 4.24, React 18, Tailwind 3; reaproveita `lib/rotinas/*` e `lib/calendario.js` (001)

**Storage**: MongoDB Atlas (replica set, transações disponíveis), banco `usaComigo`. Altera `walletTransactions` e `wallets`; documento fixo `wallets._id = 'plataforma'`; reutiliza `withdrawals`, `invoices`, `payments`, `rotinaItens`, `notificacoesUsuario`, `auditLogs` (ver `data-model.md`)

**Testing**: Vitest 5.1 (`npm test`, `npm run test:contrato`); núcleo puro testado com o repositório em memória travado; repositório Mongo e rotas validados por `quickstart.md`

**Target Platform**: Vercel, funções serverless em `gru1` (ADR-001); agendador Vercel Schedules a cada 15 min chamando `/api/rotinas/executar`

**Performance Goals**: operação de carteira em < 1 s com dezenas a poucos milhares de lançamentos por carteira; rotina diária dentro do orçamento de 45 s da 001

**Constraints**: `lib/mongodb.js` valida env no import (núcleo não pode importá-lo); `withTransaction` pode reexecutar a função (efeitos dentro da transação só com `{ session }`); `findOneAndUpdate` do driver 6.16 devolve o documento, não `{ value }`; `wallets.userId` tem índice único não esparso; Windows: rodar Vitest de `J:\Cotea`

**Scale/Scope**: hoje 3 carteiras e 13 lançamentos (dev); pré-lançamento

## Decisões Invariantes

- **D-01 · Categorias armazenadas**: `pessoal`, `caucao`, `retido_entrada`,
  `recebivel_retido`, `disputa`, `receita_taxa` (`lib/ledger/categorias.js`).
  "Saque em andamento" é categoria de **apresentação**: no armazenamento é o
  débito `blocked` de `pessoal`, mantendo a máquina de status atual do saque
  (`blocked` → `confirmed`/`cancelled`). Débito `blocked` só existe em `pessoal`.
- **D-02 · Saldos sempre derivados** dos lançamentos, em centavos inteiros
  (`Math.round(v*100)`), devolvidos em reais com 2 casas. Nada de saldo
  materializado como fonte da verdade.
- **D-03 · Núcleo puro com repositório injetado**: `lib/ledger/ledger.js` não
  importa `lib/mongodb.js`; a porta é a do fake travado
  `tests/helpers/ledger-memoria.js`; `lib/ledger/repositorio-mongo.js` replica
  métodos e retornos. Rotas obtêm o ledger por `lib/ledger/servidor.js`.
- **D-04 · Trava por carteira**: toda operação abre transação
  (`readConcern: snapshot`, `w: majority`) e faz `$inc wallets.versaoLedger`
  em cada carteira com perna de **débito** antes de ler saldos; carteiras só
  creditadas (inclusive a da plataforma) não travam.
- **D-05 · Idempotência por `operacaoId`** determinístico
  (`<source>:<referenceId>`, ex.: `pix:<paymentId>`, `saque:<withdrawalId>`,
  `assinatura_grupo:<invoiceId>`, `estorno_assinatura:<invoiceId>`;
  `uso_saldo:<uuid>`), com índice único parcial
  `{ operacaoId, walletId, categoria, type }`. Operação já existente devolve
  `{ criada: false }` sem revalidar saldo.
- **D-06 · Saldo verificado por (carteira, categoria, grupoId)**: `pessoal`
  usa o disponível; caução/retido/recebível/disputa usam o saldo do grupo — a
  caução de um grupo não cobre outro.
- **D-07 · Conta da plataforma** = `wallets { _id: 'plataforma', userId:
  'cotea:plataforma', tipo: 'plataforma' }`; só aceita `receita_taxa`, e
  `receita_taxa` só existe nela. Começa vazia; nenhum fluxo desta feature
  grava receita.
- **D-08 · Efeitos externos na mesma transação** via `extra({ sessao })`
  (status de `payments`, `invoices`, `withdrawals`); `logAudit` só depois do
  commit, no handler.
- **D-09 · Compatibilidade de resposta**: `calculateBalances` mantém
  `balance`/`available`/`blockedDebits`/`pendingTotal`/`returnedTotal` e
  acrescenta `resumo`; lançamento sem categoria conta como `pessoal` na
  leitura (cobre a janela entre deploy e migração).
- **D-10 · Migração** por `scripts/migrar-ledger-categorias.js`: dry-run por
  padrão, `--aplicar` para gravar, só documentos sem `categoria`, aborta se o
  resumo de alguma carteira mudar. Ordem de implantação: migrar → deploy do
  código → migrar de novo → `setupDatabase.js` (validator com `categoria` e
  `organizacaoId` obrigatórios só depois que nenhum código antigo grava).
- **D-11 · `insertLedgerEntry` deixa de ser porta de entrada**: passa a exigir
  `categoria`, `organizacaoId` e `operacaoId` (FR-021); os handlers usam o núcleo.
- **D-12 · Permissão** `PERMISSIONS.LEDGER_FINANCEIRO = ['finance', 'admin']`
  para `GET /api/withdraw/resumo-usuario` e `GET /api/admin/plataforma/receita`;
  `support` não vê valores novos.
- **D-13 · Rotina `ledger-consistencia`**: 1 item por dia
  (`consistencia:<AAAA-MM-DD de Brasília>`), só alerta (notificação a admins +
  `logAudit('ledger.inconsistencia')`), nunca corrige.

## Constitution Check

*GATE: deve passar antes da Fase 0. Reavaliado após o design da Fase 1.*

| Princípio | Pré-Design | Pós-Design | Notas |
| --- | --- | --- | --- |
| I. Segurança no servidor | PASS | PASS | Rotas novas com `getServerSession` + `hasRole(PERMISSIONS.LEDGER_FINANCEIRO)`; saldo, categoria, `operacaoId` e valores de referência calculados no servidor (o `valor` do saque/uso continua vindo do body, como hoje, mas é validado contra o saldo dentro da transação). Resumo do usuário no saque não devolve CPF. Rotina usa o disparo protegido da 001. |
| II. Integridade financeira | PASS | PASS | Todo movimento continua em `walletTransactions`; idempotência por `operacaoId` (D-05) e atomicidade por transação (D-04, D-08); `normalizeAmount` + centavos (D-02). Auditoria: além das existentes, `withdrawal.requested` e `wallet.credit` (PIX), que hoje faltam — exigência deste princípio nos handlers que esta feature reescreve (R-006). |
| III. Regras de negócio como fonte | PASS | PASS | Spec cita RN:46-47, 836-840, 896-897, 919-928 e as regras financeiras consolidadas. RN:840 ("disponível = confirmado − bloqueado") passa a ser "saldo pessoal − saques em andamento"; T034 atualiza Fluxos 16, 18 e 19 (seções Gap e Regras) na mesma entrega. |
| IV. Persistência documentada | PASS | PASS | `walletTransactions.schema.json` e `wallets.schema.json` atualizados; índices novos em `setupDatabase.js` e `setup-indexes.js`; conta da plataforma por upsert no `setupDatabase.js` (T001–T003). IDs: `walletId` string (real), `grupoId` gravado como string do `ObjectId` e normalizado na leitura de `grupos`. |
| Restrições do Projeto | PASS | PASS | Pages Router, driver nativo, helpers de `lib/`; Vitest; mensagens em português; rotina pela rota HTTP + Schedules (ADR-001), sem timer em processo; rotina diária cabe no orçamento de 45 s. |
| Fluxo de Desenvolvimento | PASS | PASS | Polish cobre build, lint, `npm test` (contratos 001+002), quickstart, consumidores de `/api/wallet/balance` atualizados na mesma mudança, schemas/índices documentados; nenhuma variável de ambiente nova. |

## Project Structure

### Documentation (this feature)

```text
sdd/specs/002-ledger-segmentado/
├── spec.md
├── plan.md                 # este arquivo
├── data-model.md           # campos novos, semântica dos saldos, migração, conta da plataforma
├── contracts/
│   └── api-carteira.md     # balance (compatível), resumo-usuario, receita, rotas alteradas por dentro
├── logic/
│   └── ledger.md           # algoritmo do núcleo, trava por carteira, repositório Mongo, rotina
├── quickstart.md
├── tasks.md
├── contract-tests.lock
└── handoff.md
```

### Source Code (repository root)

Arquivos que esta feature cria (+) ou altera (~), na árvore real:

```text
lib/
├── ledger/
│   ├── categorias.js                + (plan) constantes de categoria e conta da plataforma
│   ├── ledger.js                    + STUB (plan) → calcularResumo, criarLedger
│   ├── repositorio-mongo.js         + porta do fake sobre transações Mongo
│   ├── servidor.js                  + obterLedger(), garantirContaPlataforma(db)
│   ├── apresentacao.js              + enriquecer resumo com grupoNome; rótulos/explicações
│   ├── migracao.js                  + classificação pura dos legados
│   └── consistencia.js              + verificação pura de achados
├── rotinas/
│   ├── ledger-consistencia.js       + rotina diária
│   └── registro.js                  ~ registra a rotina
├── wallet.js                        ~ calculateBalances sobre calcularResumo (compat)
├── mongodb.js                       ~ insertLedgerEntry exige categoria/contexto/operacaoId; insertWithdrawal aceita _id
└── authz.js                         ~ PERMISSIONS.LEDGER_FINANCEIRO
pages/
├── wallet/index.js                  ~ resumo segmentado
├── admin/withdrawals.js             ~ saldo do usuário no saque + receita do Cotea
└── api/
    ├── wallet/balance.js            ~ resumo + grupoNome
    ├── wallet/pay.js                ~ via núcleo
    ├── pix/simulated/confirm.js     ~ via núcleo + auditoria
    ├── assinaturas/pay.js           ~ via núcleo (extra: markInvoicePaid)
    ├── assinaturas/refund.js        ~ via núcleo (extra: markInvoiceRefunded)
    ├── withdraw/create.js           ~ via núcleo (extra: insertWithdrawal) + auditoria
    ├── withdraw/approve.js          ~ liquidarReserva, sem .value
    ├── withdraw/reject.js           ~ liquidarReserva, sem .value
    ├── withdraw/resumo-usuario.js   + GET (finance/admin)
    └── admin/plataforma/receita.js  + GET (finance/admin)
database/
├── schemas/walletTransactions.schema.json  ~
├── schemas/wallets.schema.json             ~
├── setupDatabase.js                 ~ índices + upsert da conta da plataforma
└── setup-indexes.js                 ~ índices
scripts/
├── migrar-ledger-categorias.js      + migração (dry-run / --aplicar)
└── semear-ledger-teste.js           + só dev: lançamentos de teste por categoria (quickstart)
tests/
├── contract/002-ledger-segmentado.contract.test.js  TRAVADO
├── helpers/ledger-memoria.js                        TRAVADO
└── ledger/*.test.js                 + testes adicionais (execute)
.docs/regras-negocio-v2.md           ~ Fluxos 16, 18, 19
CLAUDE.md, AGENTS.md                 ~ lib/ledger e regra "todo lançamento pelo núcleo"
```

**Structure Decision**: segue o padrão da 001 — domínio puro em subpasta de
`lib/` (`lib/ledger/`, como `lib/rotinas/`), rotas em `pages/api/`, telas em
`pages/`. A tela de saques do admin continua em `pages/admin/withdrawals.js`
(página própria, não aba de `pages/admin/index.js`).

## Complexity Tracking

> **Preencher SOMENTE se o Constitution Check tiver violações que precisam ser justificadas**

| Violação | Por que é necessária | Alternativa mais simples rejeitada porque |
| --- | --- | --- |

## Estratégia de Testes

Prioridade: unitário → contrato/integração → E2E → manual (último recurso).

- Unitário (Vitest): núcleo (`calcularResumo`, `criarLedger`) com o repositório
  em memória; funções puras de migração, consistência e apresentação.
- Integração com Mongo real: **manual** (`quickstart.md` 1–4). Não há Mongo em
  memória no projeto; a trava por carteira (D-04) é validada pelo passo 2.5
  (2 saques simultâneos) — R-004.
- Rotas e telas: manual (`quickstart.md` 2–4).

Comandos-base (de `J:\Cotea`):

```powershell
npm run build
npm run lint
npm test
npm run test:contrato
.\.planning\scripts\powershell\check-contract-tests.ps1 -Slug 002-ledger-segmentado
.\.planning\scripts\powershell\check-contract-tests.ps1 -Slug 001-rotinas-agendadas
```

### Testes de Contrato

Arquivos travados em `contract-tests.lock`:
`tests/contract/002-ledger-segmentado.contract.test.js` (5 testes) e o helper
`tests/helpers/ledger-memoria.js` (0 testes; porta do repositório).

Comando: `npx vitest run tests/contract/002-ledger-segmentado.contract.test.js`
(ou `npm run test:contrato`, que roda também os da 001)

| Teste | Origem | Fase | Vermelho esperado (antes do execute) |
| --- | --- | --- | --- |
| calcula total, disponível e caução por grupo, ignora pending/cancelled e não gera centavos fantasmas | US1-AC1 · FR-003/004/005/020 | Fase 3 | `Error: not implemented` (`calcularResumo`) |
| recusa sem gravar nada saque, pagamento ou movimentação acima do saldo da categoria e lançamentos inválidos | US1-AC2 · FR-002/008/021 · SC-003 | Fase 3 | `Error: not implemented` (`criarLedger`) |
| duas reservas de saque simultâneas acima do disponível: só uma passa e o disponível nunca fica negativo | US1-AC3 · FR-008 · SC-002 | Fase 3 | `Error: not implemented` (`criarLedger`) |
| reserva de saque reduz o disponível; rejeitar devolve, aprovar baixa do total; repetir não duplica | US1-AC4 · FR-010/014 | Fase 3 | `Error: not implemented` (`criarLedger`) |
| libera recebível retido para o disponível mantendo a origem e grava operação com várias carteiras tudo ou nada | US1-AC6 · FR-006/007/009/011 | Fase 3 | `Error: not implemented` (`criarLedger`) |

Vermelho confirmado em 2026-11-24: `Tests 5 failed (5)`, todos por
`Error: not implemented`, rodando de `J:\Cotea`; suíte existente 43/43 verde.
Satisfazibilidade conferida com um protótipo descartável (5/5 verdes) e um
mutante sem trava por carteira (falha só o teste de concorrência).

Stubs criados pelo plan (ponto de partida do execute, não travados):
`lib/ledger/ledger.js` (assinaturas, classes de erro reais, corpos
`not implemented`), `lib/ledger/categorias.js` (constantes reais).

## Estado Atual

<!-- Sobrescrita a cada checkpoint pelo sdd-execute. Vazia na criação. -->

| Área | Estado |
| --- | --- |
| Setup (schemas, índices, permissão) | Concluído; `setupDatabase.js` rodado pelo usuário em 2026-11-24 |
| Fundação (repositório Mongo, servidor) | Concluída |
| US1 núcleo + 6 fluxos + migração | Concluída; contratos 5/5; migração aplicada (13/13); concorrência real 3× (1 aceito, 1 recusado) |
| US2 resumo na carteira | Concluída; `/wallet` conferida pelo usuário com caução semeada em 2 grupos |
| US3 visões do financeiro | Concluída; 403 para `user`/`support`, 200 e saldo correto para `finance` (Playwright) |
| US4 rotina de consistência | Concluída; execução pelo painel com sucesso e 0 achados (4.2 coberto por testes) |
| Polish | Concluído |
| Convergência (Phase 8) | T037 (deploy em produção, PR #5) e T038 (SC-003 em todas as categorias bloqueadas, 13 casos) concluídas; T039 (alerta pelo painel) aguarda outro dia |

## Riscos e Decisões

<!--
  IDs estáveis (R-001, R-002...), nunca deletados. Item resolvido ganha
  prefixo "Resolvido:" na célula de Mitigação em vez de sumir da tabela.
-->

| ID | Risco/Decisão | Impacto | Mitigação/Encaminhamento |
| --- | --- | --- | --- |
| R-001 | Validator com `categoria`/`organizacaoId` obrigatórios aplicado antes do código novo | Código antigo passa a falhar ao inserir lançamento | Ordem D-10 (migrar → deploy → migrar → `setupDatabase.js`); `validationLevel: moderate`; `setupDatabase.js` só com autorização do usuário |
| R-002 | Cada débito lê todos os lançamentos da carteira dentro da transação | Latência cresce com o histórico | Índice `{ walletId, categoria, status }`; escala atual mínima; se passar de alguns milhares por carteira, avaliar saldo materializado validado pela rotina (nova decisão, não nesta feature) |
| R-003 | `withTransaction` reexecuta `fn` em erro transitório | `extra` com efeito fora da sessão duplicaria (e-mail, auditoria) | D-08: dentro da transação só escritas com `{ session }`; `logAudit` depois do commit; revisar cada `extra` (T010–T015) |
| R-004 | Contratos usam o fake; trava real (WriteConflict) não tem teste automatizado | Divergência fake × Mongo passaria despercebida | Resolvido: 2.5 rodado 3× no banco dev (núcleo + repositório Mongo reais): 1 aceito, 1 recusado, disponível ≥ 0 |
| R-005 | Saque legado pendente sem `operacaoId` até a migração | Aprovar/rejeitar via `liquidarReserva` não acha a reserva | Migração antes do deploy (D-10); handler responde 409 `Lancamento do saque sem migracao` se achar o lançamento por `referenceId` sem `operacaoId` |
| R-006 | Escopo: handlers reescritos ganham auditoria (`withdrawal.requested`, `wallet.credit`) e perdem o `.value` (B-06) só em `withdraw/approve.js` e `reject.js` | Toca parte de V2-26 e B-06 | Exigência da constitution II nos arquivos já reescritos; `block.js` e `lib/invoices.js` continuam em B-06; T035 atualiza o backlog |
| R-007 | Rodar Vitest de `j:\` (minúsculo) quebra a suíte | Falso vermelho | Rodar de `J:\Cotea` (R-005 da 001) |
| R-008 | `apresentacao.js` importa `ObjectId` do pacote `mongodb`; páginas cliente que o importassem levariam o driver ao bundle | Build/bundle do cliente quebrado ou inchado | Rótulos em `lib/ledger/rotulos.js` (sem dependências); páginas importam só esse arquivo |

## Execution Notes

<!--
  Tabela append-only, mantida pelo sdd-execute. Quando passar de ~40 linhas,
  arquivar as mais antigas (exceto as ~10 mais recentes) em history.md,
  substituindo por uma linha de resumo consolidado aqui.
-->

| Data | Fase/Story | Resumo | Pendência Principal |
| --- | --- | --- | --- |
| 2026-11-24 | Fases 1–3 (Setup, Fundação, US1) | Núcleo, repositório Mongo, 6 fluxos pelo núcleo, migração; contratos 5/5, `npm test` 62/62, dry-run igual nas 3 carteiras | Migração `--aplicar` e concorrência real (quickstart 2.5) com autorização |
| 2026-11-24 | Fase 4 (US2) | `/api/wallet/balance` com `resumo` + `grupoNome`; `/wallet` segmentada; rótulos em `lib/ledger/rotulos.js`; semeadura de teste; `npm test` 66/66 | Conferir tela (quickstart 2.1/2.6) |
| 2026-11-24 | Fase 5 (US3) | Rotas `resumo-usuario` e `plataforma/receita` (finance/admin); saldo do usuário e receita do Cotea em `/admin/withdrawals`; `npm test` 68/68 | quickstart 3 com contas finance/support/user |
| 2026-11-24 | Fase 6 (US4) | `verificarConsistencia` + rotina `ledger-consistencia` registrada (1 item/dia em Brasília, só alerta); `npm test` 79/79; travas 001/002 íntegras | quickstart 4 no painel |
| 2026-11-24 | T033 (parcial) | Usuário rodou --aplicar e setupDatabase.js; conferido via MCP: 13 lançamentos em pessoal com operacaoId/organizacaoId, índices operacaoId_1_walletId_1_categoria_1_type_1 e walletId_1_categoria_1_status_1, wallets._id='plataforma' | quickstart 2–4 com login |
| 2026-11-24 | Fase 7 (Polish, parcial) | Fluxos 16/18/19, `CLAUDE.md`, `AGENTS.md`, B-06 parcial; `npm run lint` 0 erros (5 avisos antigos), `npm run build` ok, `npm test` 79/79, `test:contrato` 10/10, travas íntegras | T033: `--aplicar`, `setupDatabase.js` e quickstart 2–4 com login |
| 2026-11-24 | T033 (final) | Quickstart 2–4: concorrência real 3× ok; caução conferida na tela e removida; 403/200 por papel via Playwright com `systemRole` temporário (restaurado); rotina pelo painel com sucesso e 0 achados | Nenhuma da feature; achado fora de escopo no rebaixamento de papel (ver Cuidados) |
| 2026-11-24 | Phase 8 (Convergence) | T037: 002 em produção (PR #5), rotas respondem sem 500; T038: `tests/ledger/categorias-bloqueadas.test.js` 13/13, `npm test` 92/92, contratos 10/10, travas íntegras | T039 em outro dia |

**PRÓXIMO**: T039 num dia seguinte (lançamento sem categoria no banco dev → executar `ledger-consistencia` pela aba Rotinas → ver alerta → remover), depois `sdd-converge 002-ledger-segmentado`

## Arquivos Principais

<!-- Sobrescrita a cada checkpoint — foco da etapa atual, não a árvore inteira. -->

- `tests/ledger/categorias-bloqueadas.test.js` — SC-003 para todas as categorias bloqueadas (T038)
- `lib/rotinas/ledger-consistencia.js`, `lib/ledger/consistencia.js` — rotina diária e alerta (T039, quickstart 4.2)
- `sdd/specs/002-ledger-segmentado/quickstart.md` §4.2 — roteiro do alerta pelo painel
