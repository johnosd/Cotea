---
description: "Lista de tasks da feature 002-ledger-segmentado"
---

# Tasks: Ledger segmentado e saldo sacável

**Input**: Documentos de design de `sdd/specs/002-ledger-segmentado/`

**Prerequisites**: plan.md, spec.md, data-model.md, contracts/api-carteira.md, logic/ledger.md, quickstart.md

**Organization**: Tasks agrupadas por user story pra permitir implementação e teste independentes de cada uma.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Pode rodar em paralelo (arquivos diferentes, sem dependência)
- **[Story]**: A qual user story esta task pertence (ex: US1, US2)

## Path Conventions

- Domínio puro em `lib/ledger/` (sem importar `lib/mongodb.js`); montagem com Mongo em `lib/ledger/servidor.js` e `lib/ledger/repositorio-mongo.js`.
- Rotas em `pages/api/`, telas em `pages/`; rotina em `lib/rotinas/` registrada em `lib/rotinas/registro.js`.
- Schemas em `database/schemas/`, coleções/índices em `database/setupDatabase.js` e `database/setup-indexes.js`; scripts em `scripts/`.
- Testes em `tests/` (Vitest); contratos travados em `tests/contract/` e `tests/helpers/ledger-memoria.js`. Rodar de `J:\Cotea`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Persistência documentada e permissão.

- [X] T001 [P] Atualizar `database/schemas/walletTransactions.schema.json` (campos `categoria` enum, `organizacaoId` string|null, `grupoId`, `participacaoId`, `operacaoId`, `pernasTotal`; `required` inclui `categoria` e `organizacaoId`) e `database/schemas/wallets.schema.json` (`versaoLedger` int, `tipo`) conforme `data-model.md`
- [X] T002 Em `database/setupDatabase.js`: índices `{ operacaoId, walletId, categoria, type }` único parcial (`operacaoId` string) e `{ walletId, categoria, status }` em `walletTransactions`; upsert da conta `{ _id: 'plataforma', userId: 'cotea:plataforma', tipo: 'plataforma', status: 'active' }` em `wallets`. Mesmos índices em `database/setup-indexes.js` (sem consertar B-09). **Não rodar** o script sem autorização do usuário
- [X] T003 [P] `PERMISSIONS.LEDGER_FINANCEIRO = ['finance', 'admin']` em `lib/authz.js`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Repositório Mongo e montagem, seguindo a porta do fake travado.

**⚠️ CRITICAL**: Nenhuma user story pode começar antes desta fase terminar.

- [X] T004 Criar `lib/ledger/repositorio-mongo.js` com `criarRepositorioLedgerMongo({ client, db })` replicando a interface de `tests/helpers/ledger-memoria.js` (`executarAtomico`, `tx.listarLancamentos`, `tx.buscarPorOperacao`, `tx.inserir`, `tx.atualizarStatus`, `tx.sessao`) — código de referência em `logic/ledger.md` §7 (trava `$inc versaoLedger`, `readConcern snapshot`, sem `.value`; carteira inexistente lança)
- [X] T005 Criar `lib/ledger/servidor.js` com `obterLedger()` e `garantirContaPlataforma(db)` (upsert idempotente) — `logic/ledger.md` §8

**Checkpoint**: Fundação pronta - user stories podem começar.

---

## Phase 3: User Story 1 - Saldo por categoria e saque só do disponível (Priority: P1) 🎯 MVP

**Objetivo**: Núcleo do ledger implementado, fluxos atuais passando por ele, legados migrados sem mudança de saldo.

**Independent Test**: contratos 5/5; no banco dev, migração em dry-run com resumo igual antes/depois e saques simultâneos sem saldo negativo (`quickstart.md` 1 e 2).

### Contrato da Fase

- `calcula total, disponível e caução por grupo, ignora pending/cancelled e não gera centavos fantasmas` — US1-AC1 · FR-003/004/005/020
- `recusa sem gravar nada saque, pagamento ou movimentação acima do saldo da categoria e lançamentos inválidos` — US1-AC2 · FR-002/008/021
- `duas reservas de saque simultâneas acima do disponível: só uma passa e o disponível nunca fica negativo` — US1-AC3 · FR-008
- `reserva de saque reduz o disponível; rejeitar devolve, aprovar baixa do total; repetir não duplica` — US1-AC4 · FR-010/014
- `libera recebível retido para o disponível mantendo a origem e grava operação com várias carteiras tudo ou nada` — US1-AC6 · FR-006/007/009/011
- Comando: `npx vitest run tests/contract/002-ledger-segmentado.contract.test.js`

### Implementation

- [X] T006 [US1] Implementar `calcularResumo` em `lib/ledger/ledger.js` (centavos inteiros, `porGrupo` sem zerados) — `logic/ledger.md` §1 → contrato: `calcula total, disponível e caução por grupo…`
- [X] T007 [US1] Implementar `criarLedger` em `lib/ledger/ledger.js`: validação de pernas (§2, inclusive `receita_taxa` ↔ conta da plataforma e `de !== para`), `registrarOperacao` com trava só das carteiras debitadas, checagem por (carteira, categoria, grupoId), idempotência por `operacaoId`, `extra({ sessao, lancamentos })` (§3); `mover` (§4); `liquidarReserva` com `extra` (§5); `resumo` (§6) → contratos: `recusa sem gravar nada…`, `duas reservas de saque simultâneas…`, `reserva de saque reduz o disponível…`, `libera recebível retido…`
- [X] T008 [US1] Reescrever `calculateBalances` em `lib/wallet.js` sobre `calcularResumo` mantendo os campos antigos e acrescentando `resumo`; ausência de `categoria` conta como `pessoal` (D-09)
- [X] T009 [US1] Em `lib/mongodb.js`: `insertLedgerEntry` passa a exigir `categoria`, `organizacaoId` (presente) e `operacaoId` (FR-021, D-11); `insertWithdrawal` aceita `_id` opcional
- [X] T010 [P] [US1] `pages/api/pix/simulated/confirm.js`: crédito `pessoal` via `obterLedger().registrarOperacao` (`pix:<paymentId>`), atualização `pending → confirmed` do pagamento no `extra`; pagamento já confirmado chama a operação sem `extra` (idempotente); `logAudit('wallet.credit')` depois do commit; resposta igual
- [X] T011 [P] [US1] `pages/api/wallet/pay.js`: débito `pessoal` via núcleo (`uso_saldo:<randomUUID>`); `SaldoInsuficienteError` → 400 `Saldo insuficiente`; resposta igual
- [X] T012 [P] [US1] `pages/api/assinaturas/pay.js`: débito `pessoal` (`assinatura_grupo:<invoiceId>`) com `markInvoicePaid` no `extra` (usar `lancamentos[0]._id` como `ledgerId`); `SaldoInsuficienteError` → fluxo `aguardando_recarga` com `faltante = amount − err.disponivel`; resposta igual
- [X] T013 [P] [US1] `pages/api/assinaturas/refund.js` + `lib/invoices.js` (`markInvoiceRefunded` aceita `{ session }`): crédito `pessoal` (`estorno_assinatura:<invoiceId>`) com a fatura no `extra`; quem pode chamar não muda (B-02 fora); resposta igual
- [X] T014 [P] [US1] `pages/api/withdraw/create.js`: gerar `withdrawalId` antes; reserva `blocked`/`pessoal` (`saque:<withdrawalId>`) com `insertWithdrawal({ _id })` no `extra` — checagem de saldo dentro da transação; `SaldoInsuficienteError` → 400 `Saldo insuficiente para saque`; `logAudit('withdrawal.requested')`; resposta igual
- [X] T015 [US1] `pages/api/withdraw/approve.js` e `reject.js`: `liquidarReserva({ operacaoId: 'saque:<id>', acao, extra })` com o status de `withdrawals` no `extra`; `alterados: 0` → 400 `Saque ja finalizado`; lançamento achado por `referenceId` sem `operacaoId` → 409 `Lancamento do saque sem migracao` (R-005); sem `.value`; auditoria como hoje
- [X] T016 [US1] `lib/ledger/migracao.js` (puro: `classificarLegado(doc)` → `$set` de `data-model.md`) e `scripts/migrar-ledger-categorias.js` (dry-run padrão, `--aplicar`, só docs sem `categoria`, resumo por carteira antes/depois via `calcularResumo`, aborta se divergir, imprime contagens; não imprime valores de env)

### Testes da Fase

- [X] T017 [P] [US1] `tests/ledger/ledger.test.js`: `receita_taxa` só na conta da plataforma e vice-versa; `mover` com `de === para` recusado; operação repetida devolve os lançamentos existentes sem revalidar saldo; `blocked` fora de débito `pessoal` recusado; `extra` recebe `lancamentos` com `_id`; `liquidarReserva` repassa `alterados` ao `extra`
- [X] T018 [P] [US1] `tests/ledger/migracao.test.js`: `classificarLegado` para as 5 combinações reais de `data-model.md` (inclui saque `blocked` → `operacaoId: saque:<ref>`, `uso_saldo` sem referência → `legado:<_id>`); resumo antes = depois numa base com os 13 casos
- [X] T019 [P] [US1] `tests/ledger/wallet-compat.test.js`: campos antigos de `calculateBalances` derivados do resumo (testar a função pura de mapeamento, sem Mongo — extrair `mapearSaldosLegados(resumo, lancamentos)` em `lib/ledger/apresentacao.js` se preciso)

**Critério de Conclusão**: `npx vitest run tests/contract/002-ledger-segmentado.contract.test.js` → 5/5 verdes e `check-contract-tests.ps1 -Slug 002-ledger-segmentado` íntegro; `npm test` verde; `quickstart.md` 1 (dry-run igual, `--aplicar`, reexecução com 0 alterados) e 2.2–2.5 no banco dev, com o passo 2.5 (concorrência real) mostrando um 201 e um 400; nenhum handler grava em `walletTransactions` fora do núcleo (`Grep insertLedgerEntry|collection\('walletTransactions'\)\.insert` só em `lib/`).

**Checkpoint**: User Story 1 funcional e testável isoladamente.

**Registro da Fase**:

- Status: Concluída (2026-11-24).
- Feito: núcleo `lib/ledger/ledger.js` (resumo em centavos, validação de pernas, trava só das carteiras debitadas, idempotência por `operacaoId` com tratamento de E11000, `mover`, `liquidarReserva`, `resumo`); `repositorio-mongo.js` e `servidor.js`; `calculateBalances` compatível via `mapearSaldosLegados` (`lib/ledger/apresentacao.js`); `insertLedgerEntry` exige categoria/contexto/operação e `insertWithdrawal` aceita `_id`; os 6 fluxos (PIX, uso de saldo, assinatura, estorno, criação/aprovação/rejeição de saque) passam pelo núcleo; aprovar/rejeitar centralizado em `lib/ledger/saque.js` (sem `.value`, 409 para legado sem migração); migração `lib/ledger/migracao.js` + `scripts/migrar-ledger-categorias.js`; auditoria nova `wallet.credit` (PIX) e `withdrawal.requested`.
- Contrato: `npx vitest run tests/contract/002-ledger-segmentado.contract.test.js` → 5/5 verdes (1ª iteração); trava íntegra (002 e 001).
- Testes executados: `npm test` → 12 arquivos, 62/62 verdes; `npx eslint` nos arquivos tocados → 0 problemas; `node --env-file=.env.local scripts/migrar-ledger-categorias.js` (dry-run) → 13 legados, 3 carteiras `[OK]` com resumo igual antes/depois (`11a282cf…` total 0.68); Grep de `insertLedgerEntry`/insert em `walletTransactions` em `pages/` → 0.
- Pendências: `quickstart.md` 1.2–1.5 feitos pelo usuário em 2026-11-24 (`--aplicar` + `setupDatabase.js`; conferido no banco: 13/13 lançamentos com `categoria`/`operacaoId`/`organizacaoId`, índices novos e conta `plataforma` presentes). 2.1–2.4 conferidos pelo usuário na tela; 2.5 (concorrência real) rodado 3× no banco dev pelo núcleo + repositório Mongo (mesma chamada da rota, sem HTTP/login): sempre 1 reserva aceita e 1 `SaldoInsuficienteError`, disponível nunca negativo, lançamentos `source: teste` removidos. Resolve A-02/R-004 (com login, inclusive a concorrência real do A-02/R-004) dependem de autorização/sessão do usuário → T033.

---

## Phase 4: User Story 2 - Resumo segmentado na carteira (Priority: P2)

**Objetivo**: O usuário vê o disponível em destaque e cada valor não disponível com explicação e grupo.

**Independent Test**: `quickstart.md` 2.1 e 2.6 (caução de teste em dois grupos).

### Implementation

- [X] T020 [US2] `lib/ledger/apresentacao.js`: `enriquecerResumo(db, resumo)` (busca `grupos` por `ObjectId` dos `grupoId`, grupo inexistente → `grupoNome: null`) e `ROTULOS_CATEGORIAS` com rótulo e explicação curta em português (caução, retido de entrada/fila, a receber, em disputa, saque em andamento)
- [X] T021 [US2] `pages/api/wallet/balance.js`: resposta de `contracts/api-carteira.md` (campos antigos + `resumo` enriquecido, sem `receitaTaxa`)
- [X] T022 [US2] `pages/wallet/index.js`: disponível em destaque, total; linhas só para categorias com valor (incluindo saque em andamento) com explicação e lista por grupo; remover os cartões "Valores pendentes"/"Valores estornados"; conferir `pages/assinatura/pagamento.js` (usa `available`, não deve mudar)
- [X] T023 [P] [US2] `scripts/semear-ledger-teste.js` (só dev): `<walletId> <categoria> <grupoId> <valor>` grava pelo núcleo com `source: 'teste'`; `--remover <walletId>` apaga só `source: 'teste'`

### Testes da Fase

- [X] T024 [P] [US2] `tests/ledger/apresentacao.test.js`: `enriquecerResumo` com `db` fake (ids string ↔ `ObjectId`, grupo apagado) e todas as categorias com rótulo e explicação

**Critério de Conclusão**: `npm test` verde; `quickstart.md` 2.1 e 2.6 conferidos na tela (US2-AC1..AC3).

**Registro da Fase**:

- Status: Concluída (2026-11-24).
- Feito: `enriquecerResumo` (ObjectId ↔ string, grupo apagado → `null`) e `resumoPublico` (sem `receitaTaxa`) em `lib/ledger/apresentacao.js`; rótulos/explicações em `lib/ledger/rotulos.js` (arquivo à parte, sem dependências, para a página cliente não levar o pacote `mongodb` ao bundle — `apresentacao.js` o reexporta); `/api/wallet/balance` com campos antigos + `resumo`; `/wallet` com disponível em destaque, total e linhas só das categorias com valor (incluindo saque em andamento) com explicação e grupos; cartões "Valores pendentes"/"estornados" removidos; `scripts/semear-ledger-teste.js`. `pages/assinatura/pagamento.js` conferido (usa `available`, inalterado).
- Contrato: sem contrato nesta fase; travas 002 e 001 íntegras.
- Testes executados: `npm test` → 13 arquivos, 66/66 verdes; `npx eslint` nos arquivos tocados → 0 problemas.
- Pendências: 2.6 — caução semeada (Claude Pro 12,34 + NeoReader 5,00 = 17,34; `resumo` com `grupoNome` correto, disponível inalterado 77,50); conferido pelo usuário em `/wallet` (NeoReader R$ 5,00, Claude Pro R$ 12,34); `--remover` apagou os 2 lançamentos de teste e a carteira voltou a total 82,50 / disponível 77,50. Quickstart 2 completo.

---

## Phase 5: User Story 3 - Visões do financeiro e conta da plataforma (Priority: P3)

**Objetivo**: Financeiro/admin veem o saldo do usuário no saque e a receita do Cotea; suporte não.

**Independent Test**: `quickstart.md` 3.

### Implementation

- [X] T025 [P] [US3] `pages/api/withdraw/resumo-usuario.js` (GET, `PERMISSIONS.LEDGER_FINANCEIRO`) conforme `contracts/api-carteira.md`
- [X] T026 [P] [US3] `pages/api/admin/plataforma/receita.js` (GET, `PERMISSIONS.LEDGER_FINANCEIRO`, `limite` 1–200) conforme `contracts/api-carteira.md`
- [X] T027 [US3] `pages/admin/withdrawals.js`: botão "Ver saldo do usuário" em cada saque pendente (carrega `resumo-usuario` sob demanda) e seção "Receita do Cotea" (total + últimos lançamentos), ambos só para `LEDGER_FINANCEIRO`

### Testes da Fase

- [X] T028 [P] [US3] `tests/ledger/autorizacao.test.js`: `hasRole` com `PERMISSIONS.LEDGER_FINANCEIRO` aceita `finance`/`admin` e recusa `support`/`user`/bloqueado

**Critério de Conclusão**: `npm test` verde; `quickstart.md` 3.1–3.5 (inclui 403 para `support` e `user`).

**Registro da Fase**:

- Status: Concluída (2026-11-24).
- Feito: `GET /api/withdraw/resumo-usuario` e `GET /api/admin/plataforma/receita` (ambas `PERMISSIONS.LEDGER_FINANCEIRO`, conta bloqueada → 403, sem CPF, `limite` 1–200 com padrão 50); `/admin/withdrawals` com "Ver saldo do usuário" sob demanda e a seção "Receita do Cotea" (total + últimos 20), só para finance/admin.
- Contrato: sem contrato nesta fase; travas 002 e 001 íntegras.
- Testes executados: `npm test` → 14 arquivos, 68/68 verdes; `npx eslint` nos arquivos tocados → 0 problemas.
- Pendências: nenhuma. Quickstart 3 em 2026-11-24 via Playwright no localhost, trocando temporariamente o `systemRole` da conta logada (restaurado para `user` ao final): `user` e `support` → 403 nas duas rotas; `finance` → receita 200 (total R$ 0,00, sem receita até V2-03) e "Ver saldo do usuário" em `/admin/withdrawals` mostrando disponível R$ 77,50 / saque em andamento R$ 5,00 / total R$ 82,50 (bate com o banco). Aprovar/rejeitar não exercitados nesta rodada.

---

## Phase 6: User Story 4 - Conferência diária de consistência (Priority: P3)

**Objetivo**: Rotina diária que acha inconsistência e alerta o admin, sem corrigir.

**Independent Test**: `quickstart.md` 4.

### Implementation

- [X] T029 [US4] `lib/ledger/consistencia.js` (puro): `verificarConsistencia({ agregados, semCampos, operacoesIncompletas })` → achados de `logic/ledger.md` §9
- [X] T030 [US4] `lib/rotinas/ledger-consistencia.js`: rotina `ledger-consistencia` (`buscarVencidos` 1 item/dia com a data de Brasília via `Intl`/`lib/calendario.js`; `processarItem` com as agregações e o alerta: notificação "Inconsistência no ledger" para admins não bloqueados + `logAudit('ledger.inconsistencia')`, auditoria mesmo se a notificação falhar, como `lib/rotinas/alertas.js`) e registro em `lib/rotinas/registro.js`

### Testes da Fase

- [X] T031 [P] [US4] `tests/ledger/consistencia.test.js`: cada tipo de achado; ledger consistente → 0 achados
- [X] T032 [P] [US4] `tests/rotinas/ledger-consistencia.test.js`: chave diária no fuso de Brasília (23:30 BRT ainda é o mesmo dia; 00:10 BRT é o seguinte) e execução idempotente com `criarRepositorioMemoria` da 001

**Critério de Conclusão**: `npm test` verde (contratos 001 intactos); `quickstart.md` 4.1–4.2.

**Registro da Fase**:

- Status: Concluída (2026-11-24).
- Feito: `lib/ledger/consistencia.js` (`verificarConsistencia` com os 6 tipos de achado, `descreverAchado`); `lib/rotinas/ledger-consistencia.js` (fábrica `criarRotinaLedgerConsistencia` com `coletar`/`alertar` injetáveis; 3 agregações em `walletTransactions` com soma em centavos; chave `consistencia:<AAAA-MM-DD de Brasília>` via `dataLocalBrasilia`; notificação "Inconsistência no ledger" a admins não bloqueados + `logAudit('ledger.inconsistencia')`, auditoria mesmo se a notificação falhar — a falha só vai para o log, sem relançar, para não repetir a auditoria em retentativa); registrada em `lib/rotinas/registro.js`.
- Contrato: sem contrato nesta fase; `check-contract-tests.ps1` 002 e 001 → PASS.
- Testes executados: `npm test` → 16 arquivos, 79/79 verdes; `npx eslint lib/ledger lib/rotinas tests/ledger tests/rotinas` → 0 problemas.
- Pendências: 2026-11-24 — coleta + verificação da rotina rodadas no banco dev só leitura (8 agregados, 0 sem campos, 0 operações incompletas → 0 achados). Quickstart 4.1: executada pela aba Rotinas (papel admin temporário) → "sucesso — 1 processados, 0 falhas, 0 pulados", 0,2 s, sem alerta. 4.2 (lançamento ruim inserido à mão gerando alerta) não executado: o item do dia (`consistencia:2026-11-24`) já foi processado e o executor é idempotente; o caminho de alerta está coberto por `tests/ledger/consistencia.test.js` e `tests/rotinas/ledger-consistencia.test.js`.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Documentação, gates e validação final.

- [X] T033 Rodar `quickstart.md` completo no banco dev (migração com autorização do usuário; `setupDatabase.js` só com autorização)
- [X] T034 [P] `.docs/regras-negocio-v2.md`: Fluxo 16 (disponível = pessoal − saques em andamento; débitos via núcleo), Fluxo 18 (saque só do disponível, checado na transação) e Fluxo 19 (Gap: categorias prontas, recebíveis ainda não gerados)
- [X] T035 [P] `CLAUDE.md` e `AGENTS.md`: `lib/ledger/` e a regra "todo lançamento passa por `obterLedger()`"; `.planning/backlog.md`: B-06 resolvido em `withdraw/approve.js`/`reject.js` (resta `block.js` e `lib/invoices.js`)
- [X] T036 `npm run lint`, `npm run build` (dev server parado) e `npm test`

### Checklist de Release

- [X] Fase 3 (User Story 1) concluída
- [X] Fase 4 (User Story 2) concluída
- [X] Fase 5 (User Story 3) concluída
- [X] Fase 6 (User Story 4) concluída
- [X] Testes de contrato todos verdes na suíte completa e `check-contract-tests.ps1` íntegro para 002 **e** 001
- [X] `npm test` verde
- [X] `npm run build` ok
- [X] `npm run lint` sem erros
- [X] Migração aplicada no banco dev com resumo idêntico antes/depois (SC-001) e 0 lançamentos sem `categoria`/`organizacaoId`
- [X] Schemas e índices documentados (`database/schemas/`, `setupDatabase.js`, `setup-indexes.js`); nenhuma variável de ambiente nova
- [X] Consumidores de `/api/wallet/balance` atualizados/conferidos (`pages/wallet/index.js`, `pages/assinatura/pagamento.js`)
- [X] `quickstart.md` executado com sucesso

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: sem dependências
- **Foundational (Phase 2)**: depende do Setup — BLOQUEIA todas as user stories
- **US1 (Phase 3)**: depende da Fase 2; T006/T007 antes de T008–T016
- **US2, US3 (Phases 4, 5)**: dependem da US1 (resumo e handlers); podem rodar em paralelo
- **US4 (Phase 6)**: depende da US1 (categorias gravadas); independente de US2/US3
- **Polish (Phase 7)**: depende de todas as stories

### Parallel Opportunities

- T001 e T003; T010–T014 (arquivos diferentes) depois de T007–T009; T025 e T026; testes marcados [P]

---

## Parallel Example: User Story 1

```text
Task: "T010 [P] [US1] pix/simulated/confirm.js via núcleo"
Task: "T011 [P] [US1] wallet/pay.js via núcleo"
Task: "T012 [P] [US1] assinaturas/pay.js via núcleo"
Task: "T014 [P] [US1] withdraw/create.js via núcleo"
```

---

## Implementation Strategy

### MVP First (User Story 1 apenas)

1. Fases 1 e 2
2. Fase 3 (contratos verdes, fluxos adaptados, migração)
3. **PARAR E VALIDAR**: `quickstart.md` 1 e 2 no banco dev

### Incremental Delivery

1. US1 → entrega (proteção do saque e base para V2-03/V2-06)
2. US2 → transparência na carteira
3. US3 e US4 → visões do financeiro e rede de segurança

## Notes

- `[P]` = arquivos diferentes, sem dependência
- Commitar após cada task ou grupo lógico coerente
- Nunca editar `tests/contract/002-ledger-segmentado.contract.test.js` nem `tests/helpers/ledger-memoria.js`

<!-- sdd-converge anexa "## Phase N: Convergence" abaixo desta linha -->

## Phase 8: Convergence

**Goal**: Fechar as lacunas apontadas pelo `sdd-converge` em 2026-11-24.

- [ ] T037 Confirmar se o `MONGODB_DB` da produção (Vercel) é o mesmo banco do `.env.local`, onde o validator com `categoria`/`organizacaoId` obrigatórios já foi aplicado; se for, publicar a 002 no `main` (ou relaxar temporariamente o validator) antes de qualquer gravação de carteira em produção — origem `plan: D-10 / R-001` (achado C-01, HIGH)
- [ ] T038 [P] Teste em `tests/ledger/categorias-bloqueadas.test.js` iterando todas as `CATEGORIAS_BLOQUEADAS` (`caucao`, `retido_entrada`, `recebivel_retido`, `disputa`): crédito não altera disponível; saque e uso de saldo acima do `pessoal` recusados sem gravar; categoria de um grupo não cobre débito de outro — origem `SC-003` (achado C-02, MEDIUM)
- [ ] T039 Rodar `quickstart.md` 4.2 num dia em que `consistencia:<data>` ainda não foi processado: lançamento sem categoria inserido à mão no banco dev → execução pela aba Rotinas → notificação "Inconsistência no ledger" aos admins → remover o lançamento — origem `SC-005` (achado C-03, LOW)

**Critério de Conclusão**: T037 com o banco de produção confirmado e protegido; `npm test` verde incluindo T038; T039 com o alerta visto no painel; contratos 001/002 verdes e travas íntegras.

**Registro da Fase**:
- Status:
- Feito:
- Contrato:
- Testes executados:
- Pendências:
