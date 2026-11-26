---
description: "Tasks da feature 006-checkout-caucao"
---

# Tasks: Checkout v2 com caução e elegibilidade no servidor

**Input**: Documentos de design de `sdd/specs/006-checkout-caucao/`

**Prerequisites**: plan.md, spec.md, data-model.md, contracts/api-entrada.md, logic/checkout.md, quickstart.md

**Organization**: Tasks agrupadas por user story. **Publicação única no final**:
as stories não vão para produção separadas (a entrada já cobra caução e retém
mensalidade, e depende da devolução e da liberação).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Pode rodar em paralelo (arquivos diferentes, sem dependência)
- **[Story]**: US1–US5

## Path Conventions

- Regras puras em `lib/checkout.js`; banco em `lib/checkout-servidor.js`
- Rotas em `pages/api/`, telas em `pages/`
- Testes novos em `tests/checkout/`; rodar de `J:\Cotea` (maiúsculo)
- Contrato: `npx vitest run tests/contract/006-checkout-caucao.contract.test.js`
  (use `-t "<trecho do nome>"` para um só)

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: confirmar o ponto de partida.

- [X] T001 Rodar `npm test` (esperado: 430 verdes e 5 vermelhos do contrato 006) e `check-contract-tests.ps1 -Slug 006-checkout-caucao` (íntegro)

**Registro da Fase**:

- Status: concluída (2026-11-26).
- Feito: T001 — ponto de partida confirmado; nenhum código alterado.
- Contrato: `check-contract-tests.ps1 -Slug 006-checkout-caucao` → trava íntegra; contratos 006 5/5 vermelhos com `Error: not implemented`; travas 001–005 íntegras.
- Testes executados: `npm test` → 55 arquivos, 430 verdes e 5 vermelhos (só os do contrato 006).
- Pendências: nenhuma.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: regras puras, fatura, ocupação e índice.

**⚠️ CRITICAL**: nenhuma user story começa antes desta fase.

- [X] T002 [P] Ocupação = 1 + não donos não banidos em `lib/grupo-entrada.js` (`motivoGrupoCheio`, D-12; logic §2)
- [X] T003 `grupoJaLotou`, `calcularResumoEntrada`, `dividirPagamento`, `validarDadosEntrada`, `pernasDaEntrada` em `lib/checkout.js` (logic §2–§5)
- [X] T004 `planejarLiquidacao`, `pernasDaLiquidacao`, `planejarMigracaoCheckout` em `lib/checkout.js` (logic §6, §10)
- [X] T005 [P] `lib/invoices.js`: `composicao.caucao`/`taxaPagamento` opcionais na soma (sem mudar o formato antigo), `createInvoice` aceitando `_id`, `entrada`, `walletId`, `ledgerId`, `paidAt`; `INVOICE_STATUS.CANCELADA` (data-model)
- [X] T006 [P] Índice `{ referenceId, type, source }` parcial não único em `database/setupDatabase.js` e `database/setup-indexes.js`; ajustar a asserção "único parcial" de `tests/bugs/b09-setup-indexes-conflito.test.js` (D-08, R-001)
- [X] T007 [P] Campos novos (opcionais) em `database/schemas/membrosGrupo.schema.json`, `invoices.schema.json`, `grupos.schema.json` (data-model)

### Testes da Fase

- [X] T008 [P] Resumo, lotação, divisão, validação, pernas e plano de liquidação (inclusive grupo excluído e `a_liberar`) em `tests/checkout/regras.test.js`
- [X] T009 [P] `planejarMigracaoCheckout` (os casos do banco real) em `tests/checkout/migracao-plano.test.js`; caso de composição com caução em `tests/preco/invoices-composicao.test.js`

**Critério de Conclusão**: `npx vitest run tests/checkout tests/preco tests/bugs/b09-setup-indexes-conflito.test.js` verde.

**Registro da Fase**:

- Status: concluída (2026-11-26).
- Feito: ocupação sempre com a vaga do dono (`lib/grupo-entrada.js`); regras puras completas em `lib/checkout.js` (inclui `chaveValida` e `rotuloVinculo`, além das assinaturas do stub); `createInvoice` com caução/taxa e campos da entrada, status `cancelada`; índice por referência não único nos dois scripts e asserção do b09 ajustada; schemas de `grupos`, `membrosGrupo` e `invoices`.
- Contrato: sem contrato nesta fase; trava 006 íntegra.
- Testes executados: `npx vitest run tests/checkout tests/preco tests/bugs` → 19 arquivos, 164/164; `npx eslint lib database tests/checkout` sem erros.
- Pendências: nenhuma. Nada foi aplicado no banco (índice muda só na T040).

---

## Phase 3: User Story 1 - Entrada atômica (Priority: P1) 🎯 MVP

**Objetivo**: entrar pagando mensalidade + caução numa única operação, com recusas sem efeito.

**Independent Test**: entrar num grupo com saldo e conferir um débito, a participação e a caução; grupo cheio não cobra.

### Contrato da Fase

- `entrada cobra mensalidade + caução com valores do servidor…` — US1/AC1, AC4
- `última vaga disputada…` — US1/AC2, FR-017
- `resumo divide saldo e PIX…` — US3 e US5/AC2 (parte de servidor)
- Comando: `npx vitest run tests/contract/006-checkout-caucao.contract.test.js -t "entrada cobra|última vaga|resumo divide"`

### Implementation

- [X] T010 [US1] `registrarEntrada` em `lib/checkout-servidor.js`: operação única com `extra`, trava do grupo, participação, fatura, notificações e auditoria (logic §5; data-model) → contratos: entrada, última vaga
- [X] T011 [US1] Reescrever `pages/api/assinaturas/pay.js` na ordem de `contracts/api-entrada.md`, com reconsulta da chave antes de recusar → contratos: os três
- [X] T012 [P] [US1] `pages/api/assinaturas/resumo.js` (substitui o stub) → contrato: resumo divide
- [X] T013 [P] [US1] `POST` de `pages/api/grupos/[id]/join.js` → 410 (remover `estornarFaturaSemVaga`); `pages/api/assinaturas/refund.js` → 410 → contrato: resumo divide
- [X] T014 [US1] Reescrever os testes antigos para o fluxo novo, mantendo o invariante de cada bug: `tests/bugs/b04-pagamento-grupo-indisponivel`, `b02-estorno-sem-cancelamento` (manter a parte pura), `join-reusa-fatura-vinculada`, `pay-aceita-fatura-estornada`, `tests/preco/handler-pay` (R-004)

### Testes da Fase

- [X] T015 [P] [US1] `tests/checkout/handler-resumo.test.js`: recusas do GET, usuário bloqueado entra (US1/AC5), preço inválido, `chave_invalida`
- [X] T016 [P] [US1] `tests/checkout/entrada-falhas.test.js`: falha no `extra` não debita nem cria nada; fatura de outro grupo com a mesma chave

**Critério de Conclusão**: comando do contrato → 3/3 verdes e trava íntegra; `npm run test:contrato` com 001–005 verdes; `tests/cadastro/gate-handlers.test.js` verde sem edição.

**Checkpoint**: entrada funcional pela API.

**Registro da Fase**:

- Status: concluída (2026-11-26).
- Feito: `registrarEntrada` e `buscarEntradaPorChave` em `lib/checkout-servidor.js`; `pay` reescrito na ordem do contrato; `GET /api/assinaturas/resumo`; `POST /join` e `/api/assinaturas/refund` em 410; `montarResumoParaTela` em `lib/checkout.js`; testes antigos (`b02`, `b04`, `join-reusa-fatura-vinculada`, `pay-aceita-fatura-estornada`, `preco/handler-pay`) reescritos sobre o novo fluxo, com cenário compartilhado em `tests/helpers/checkout-cenario.js` (não travado).
- Contrato: `npx vitest run tests/contract/006-checkout-caucao.contract.test.js -t "entrada cobra|última vaga|resumo divide"` → 3/3 verdes; trava íntegra.
- Testes executados: `npm test` → 452 casos, 450 verdes e 2 vermelhos (contratos das fases 4 e 6); `tests/cadastro/gate-handlers` verde sem edição; contratos 001–005 verdes; `npx eslint lib pages tests database` sem erros.
- Pendências: a saída ainda apaga o membro sem devolver a caução (Fase 4) e a retenção não é liberada (Fase 6): não publicar antes do fim.

---

## Phase 4: User Story 2 - Devolução em toda saída (Priority: P1)

**Objetivo**: a caução (e a retenção ainda devida) volta exatamente uma vez por qualquer caminho de saída.

**Independent Test**: sair, cancelar e excluir grupos e conferir uma devolução por participação.

### Contrato da Fase

- `a caução volta uma única vez na saída do membro e no cancelamento…` — US2
- Comando: `npx vitest run tests/contract/006-checkout-caucao.contract.test.js -t "volta uma única vez"`

### Implementation

- [X] T017 [US2] `encerrarParticipacao` e `liquidarParticipacoesDoGrupo` em `lib/checkout-servidor.js` (logic §6, §7; limite 25) → contrato: volta uma única vez
- [X] T018 [US2] `DELETE` de `pages/api/grupos/[id]/join.js` pela liquidação, com `devolvido` e motivo (membro × staff) → contrato: volta uma única vez
- [X] T019 [US2] Gatilho em `lib/moderacao-servidor.js` para `cancelado`/`rejeitado`, com `import` dinâmico (logic §7) → contrato: volta uma única vez
- [X] T020 [US2] `DELETE` de `pages/api/grupos/[id].js` na ordem da logic §7 (marcar `a_liberar`, excluir, liquidar, remover o resto)
- [X] T021 [US2] `lib/rotinas/liquidacao-participacoes.js` (itens `liquidar:`) e registro em `lib/rotinas/registro.js` (logic §9)
- [X] T042 [US2] *(descoberta na T018/T021)* Preservar o registro de membro banido: o próprio banido que "cancela" e a rotina devolvem a caução sem apagar o documento (senão ele poderia reentrar; edge case da spec)
- [X] T022 [P] [US2] `pages/grupos/[id]/cancelar.js`: prop `devolucao` e texto do que volta e do que não volta, sem alterar a prop `grupo` (FR-023)

### Testes da Fase

- [X] T023 [US2] `tests/checkout/liquidacao.test.js`: exclusão do grupo, remoção pelo staff, encerramento pelo dono, falha no meio seguida da rotina, rotina com órfão e banido, chamadas simultâneas, liquidação que falha mantém o membro
- [X] T024 [P] [US2] SSR do cancelar com `devolucao` em `tests/checkout/cancelar-devolucao.test.js`; `tests/moderacao/*` verdes sem editar

**Critério de Conclusão**: contrato 4 verde (contratos 1–3 seguem verdes) e trava íntegra; `tests/moderacao` verde.

**Checkpoint**: nenhum caminho deixa caução presa.

**Registro da Fase**:

- Status: concluída (2026-11-26).
- Feito: `liquidarParticipacao`, `encerrarParticipacao` e `liquidarParticipacoesDoGrupo` (limite 25); `DELETE /join` pela liquidação com `devolvido`; gatilho na moderação (`import` dinâmico) e aviso de cancelamento ajustado (A-04); `DELETE` do grupo na ordem da logic §7; rotina `liquidacao-participacoes` registrada; tela de cancelar mostra o que volta. T042: banido não perde o registro (R-011).
- Contrato: `-t "volta uma única vez"` verde (contratos 1–3 seguem verdes); trava íntegra.
- Testes executados: `npm test` → 472 casos, 471 verdes e 1 vermelho (contrato da Fase 6); `tests/moderacao` verde sem edição; `npx eslint lib pages tests database` sem erros (5 warnings anteriores).
- Pendências: itens `liberar:` da rotina e liberação da retenção ficam na Fase 6.

---

## Phase 5: User Story 3 - Resumo, aceite e telas (Priority: P1)

**Objetivo**: a tela mostra o que se paga, exige aceite e vínculo e conduz saldo + PIX.

**Independent Test**: abrir o checkout com saldo zero, parcial e total (quickstart 1–7).

### Implementation

- [X] T025 [P] [US3] `pages/assinatura/relacionamento.js`: quatro vínculos de `VINCULOS`, nenhum marcado, `vinculo` na query (FR-010)
- [X] T026 [US3] `pages/assinatura/pagamento.js` conforme "Telas" de `contracts/api-entrada.md`: detalhamento, textos de FR-007/FR-008, fidelidade, aviso de retenção, aceite, um botão, PIX da diferença, `chave`, tratamento dos códigos (FR-003, FR-005, FR-006, FR-013, FR-014)
- [X] T027 [P] [US3] `pages/assinatura/sucesso.js` sem chamada ao `join`

### Testes da Fase

- [X] T028 [US3] `npm run lint` e `npm run build` sem erros; `grep` sem `0.68`, `/api/assinaturas/refund` ou `POST` para `/join` em `pages/`

**Critério de Conclusão**: build e lint limpos; contratos 1–4 verdes; telas conferidas no navegador na T041.

**Registro da Fase**:

- Status: concluída (2026-11-26); falta conferir no navegador (T041).
- Feito: `relacionamento.js` com os quatro vínculos, nenhum marcado, e `vinculo` na query; `pagamento.js` refeito sobre o resumo do servidor (detalhamento, textos de FR-007/FR-008, fidelidade, aviso de retenção, aceite, um botão, Pix da diferença, `chave`, tratamento dos códigos); `sucesso.js` sem chamada ao `join` e sem textos fictícios.
- Contrato: sem contrato nesta fase.
- Testes executados: `npm run lint` 0 erros (4 warnings anteriores); `npm run build` ok; busca em `pages/` sem `0.68`, `assinaturas/refund`, cupom ou `POST` para `/join`.
- Pendências: telas sem teste automatizado (A-01): só serão vistas funcionando na T041, que depende de autorização (banco de produção).

---

## Phase 6: User Story 4 - Grupo "após completar" (Priority: P2)

**Objetivo**: reter a mensalidade até lotar (ou até o acesso) e liberar depois.

**Independent Test**: sair antes de lotar devolve tudo; depois de lotar, só a caução.

### Contrato da Fase

- `grupo após completar: retém a mensalidade…` — US4
- Comando: `npx vitest run tests/contract/006-checkout-caucao.contract.test.js -t "após completar"`

### Implementation

- [X] T029 [US4] `liberarRetencoes` em `lib/checkout-servidor.js`, chamada pela entrada que completa o grupo, com notificação de grupo lotado e auditoria (logic §5, §8; FR-020, FR-026, FR-029) → contrato: após completar
- [X] T030 [P] [US4] `pages/api/grupos/[id]/acessos.js`: liberar depois do envio (logic §7)
- [X] T031 [US4] `PUT` de `pages/api/grupos/[id].js`: filtro por `versaoParticipacao`, lotação por redução de capacidade e liberação (D-13)
- [X] T032 [US4] Itens `liberar:` na rotina `lib/rotinas/liquidacao-participacoes.js`

### Testes da Fase

- [X] T033 [US4] `tests/checkout/retencao.test.js`: lotação por redução de capacidade, acesso enviado, rotina libera o que ficou, saída concorrente com a entrada que lota (um só resultado), `PUT` concorrente → 409

**Critério de Conclusão**: comando do contrato → verde; os 5 contratos 006 verdes e trava íntegra.

**Checkpoint**: comportamento completo pela API.

**Registro da Fase**:

- Status: concluída (2026-11-26).
- Feito: `liberarParticipacao`, `liberarRetencoes` e `aposLotar` (libera e avisa dono e membros); a entrada que completa o grupo dispara a liberação antes de responder; envio de acesso libera quem recebeu; `PUT` condicionado a `versaoParticipacao` e lotação por redução de capacidade; itens `liberar:` na rotina.
- Contrato: 5/5 contratos 006 verdes; trava íntegra.
- Testes executados: `npm test` → 62 arquivos, 482/482; `npx eslint lib pages tests database` sem erros (4 warnings anteriores).
- Pendências: nenhuma.

---

## Phase 7: User Story 5 - Vínculo visível ao dono (Priority: P2)

**Objetivo**: o dono e a equipe veem o vínculo declarado; mais ninguém.

**Independent Test**: abrir o grupo como dono, outro membro e visitante.

### Implementation

- [X] T034 [US5] `pages/grupos/[id].js`: `vinculo` no `$project`, só nos participantes da visão completa, com rótulo na lista (FR-011)

### Testes da Fase

- [X] T035 [US5] `tests/checkout/vinculo-visibilidade.test.js`: SSR para dono, staff, membro e anônimo; `GET /api/meus-grupos` e `GET /api/grupos/[id]` sem `vinculo`

**Critério de Conclusão**: teste novo e `tests/bugs/ssr-grupo-detalhe-expoe-dados-internos.test.js` verdes.

**Registro da Fase**:

- Status: concluída (2026-11-26).
- Feito: `vinculo` no `$project` do SSR de `/grupos/[id]`, só nos participantes da visão completa (dono e staff), com rótulo na lista.
- Contrato: sem contrato nesta fase; trava 006 íntegra.
- Testes executados: `npm test` → 63 arquivos, 490/490 (inclui `ssr-grupo-detalhe-expoe-dados-internos`); lint sem erros.
- Pendências: conferir a lista no navegador (T041).

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: migração, documentos, gates e implantação.

- [X] T036 [P] Atualizar `.docs/regras-negocio-v2.md` (FR-032: data-base do ciclo, taxa zero, devolução transitória, retenção, gaps dos Fluxos 7, 11 e 12)
- [X] T037 [P] Atualizar `CLAUDE.md` (entrada, liquidação, índice, rotas 410, rotina) e `README.md` (fluxo e migração)
- [X] T038 `scripts/migrar-checkout-v2.js` (logic §10; padrão de `scripts/migrar-moderacao-grupos.js`), dry-run por padrão (FR-030)
- [X] T043 *(descoberta na T041)* `grupo.saida` registrar `grupoId` e `userId` na auditoria (data-model), com asserção em `tests/checkout/liquidacao.test.js`
- [X] T039 Gates: `npm run test:contrato`, `npm test`, `npm run lint`, `npm run build`, travas 001–006
- [ ] T040 Dry-run da migração, mostrar ao usuário e, **com autorização**, `--aplicar` (antes do deploy; repetir depois)
- [X] T041 Roteiro manual do `quickstart.md` §3 e §4 (com autorização: banco de produção) e limpeza dos dados criados

### Checklist de Release

- [X] Fase 2 (fundação) concluída
- [X] Fase 3 (US1) concluída
- [X] Fase 4 (US2) concluída
- [X] Fase 5 (US3) concluída
- [X] Fase 6 (US4) concluída
- [X] Fase 7 (US5) concluída
- [X] 5 contratos 006 verdes na suíte completa e `check-contract-tests.ps1` íntegro (001–006)
- [X] `npm test`, `npm run lint` e `npm run build` verdes
- [X] Índice migrado antes do deploy
- [X] Schemas, índices e documentos atualizados
- [X] `quickstart.md` executado

**Critério de Conclusão**: checklist completo; deploy só depois da migração do índice.

**Registro da Fase**:

- Status: concluída exceto a segunda metade da T040 (2026-11-26): repetir a migração depois do deploy.
- Feito: regras de negócio, `CLAUDE.md` e `README.md`; `lib/checkout-migracao.js` + script; **migração aplicada** com autorização do usuário (índice não único; 3 faturas estornadas, R$ 127,50, com aviso e auditoria; reexecução 0 alterações); roteiro do `quickstart.md` no navegador (resultado registrado nele) e dados de teste apagados; T043: auditoria `grupo.saida` com grupo e usuário.
- Contrato: `npm run test:contrato` → 30/30; travas 001–006 íntegras.
- Testes executados: `npm test` → 497/497; `npm run lint` 0 erros (4 warnings anteriores); `npm run build` ok; concorrência conferida com transações reais; consistência do ledger com 0 achados; documentos aceitos pelos validadores reais.
- Pendências: T040: depois do deploy, rodar `scripts/migrar-checkout-v2.js` (dry-run e, se houver algo, `--aplicar`). Revisão do texto de `REGRAS_CAUCAO` pelo usuário (A-02). Achados fora do escopo aguardando decisão: rolagem horizontal do `FlowStepper` no celular, recursos bloqueados pela CSP e botões "Entrar" que abrem o WhatsApp (A-05).

---

## Dependencies & Execution Order

- Phase 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8. A 5 e a 7 podem ser feitas em paralelo com a 6 (arquivos diferentes, exceto `pages/grupos/[id].js`, só da 7).
- T020 e T031 editam o mesmo arquivo (`pages/api/grupos/[id].js`): em sequência.
- T018 e T013 editam `join.js`: em sequência.
- T021 e T032 editam a mesma rotina: em sequência.

## Parallel Opportunities

- Fase 2: T002, T005, T006, T007 juntas; depois T003 → T004; testes T008, T009.
- Fase 8: T036 e T037.

## Implementation Strategy

Implementar na ordem das fases, parando em cada checkpoint com os contratos da
fase verdes. Publicar só ao fim da Fase 8.

<!-- sdd-converge anexa "## Phase N: Convergence" abaixo desta linha -->
