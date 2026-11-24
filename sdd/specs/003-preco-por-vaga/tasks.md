---
description: "Lista de tasks da feature 003-preco-por-vaga"
---

# Tasks: Regra única de preço por vaga (taxa Cotea 5%) e capacidade mínima

**Input**: Documentos de design de `sdd/specs/003-preco-por-vaga/`

**Prerequisites**: plan.md, spec.md, data-model.md, contracts/api-grupos.md, logic/preco.md, quickstart.md

**Organization**: Tasks agrupadas por user story pra permitir implementação e teste independentes de cada uma.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Pode rodar em paralelo (arquivos diferentes, sem dependência)
- **[Story]**: A qual user story esta task pertence (ex: US1, US2)

## Path Conventions

- Regra pura em `lib/preco.js` (importável no cliente: sem `lib/mongodb.js`, `mongodb` ou módulos Node).
- APIs em `pages/api/` (Pages Router); telas em `pages/`.
- Scripts operacionais em `scripts/` (ESM, `MongoClient` próprio, `node --env-file=.env.local`).
- Schemas de documentação em `database/schemas/`.
- Testes Vitest em `tests/**/*.test.js`; contrato travado em `tests/contract/003-preco-por-vaga.contract.test.js` (NÃO editar).
- Rodar testes de `J:\Cotea` (drive maiúsculo).

---

## Phase 1: Setup

Nada a fazer: stub `lib/preco.js` e contrato já criados pelo `sdd-plan`.

---

## Phase 2: Foundational — regra pura (Blocking Prerequisites)

**Purpose**: `lib/preco.js` implementado; todas as stories dependem dele.

**⚠️ CRITICAL**: Nenhuma user story pode começar antes desta fase terminar.

### Contrato da Fase

- `calcula valor por vaga, repasse e taxa pela regra única, com meio-para-cima exato e taxa absorvendo o resíduo` — FR-001, SC-001
- `recusa capacidade < 2 ou não inteira, valor total inválido e repasse abaixo de R$ 0,01` — FR-004/005/006
- `precoDoGrupo usa só o preço vigente gravado e nunca cai em fallback legado` — FR-010/011/014
- `recusa capacidade nova abaixo de dono + membros ativos e aceita igual` — FR-007
- Comando: `npx vitest run tests/contract/003-preco-por-vaga.contract.test.js`

### Implementation

- [X] T001 Implementar `calcularPrecoVaga`, `precoDoGrupo` e `validarNovaCapacidade` em `lib/preco.js` seguindo `logic/preco.md` (fórmula inteira, ordem capacidade → valor → repasse, retorno exato de `precoDoGrupo`) → contratos 1–4
- [X] T002 [P] Acrescentar `repassePorVaga` (number), `taxaPorVaga` (number), `precoValido` (bool) em `database/schemas/grupos.schema.json` e `composicao { repasseDono, taxaCotea }` em `database/schemas/invoices.schema.json`, sem `required` novo

### Testes da Fase

- [X] T003 [P] Testes adicionais em `tests/preco/preco.test.js`: valores grandes (`T = 9999999.99`), `C` string `'4'`, `T` com espaços/vírgula, `T = 10.1` (1 casa), `precoDoGrupo` com `Double`-like (`{ valueOf }`) ou números como string, garantia de que `lib/preco.js` não importa nada (leitura do fonte sem `import`)

**Critério de Conclusão**: `npx vitest run tests/contract/003-preco-por-vaga.contract.test.js` → 4/5 verdes (o 5º é da Fase 6) e `check-contract-tests.ps1 -Slug 003-preco-por-vaga` íntegro; `tests/preco/preco.test.js` verde; schemas atualizados.

**Checkpoint**: Fundação pronta - user stories podem começar.

**Registro da Fase**:

- Status: Concluída (2026-11-24)
- Feito: `lib/preco.js`: `calcularPrecoVaga`, `precoDoGrupo`, `validarNovaCapacidade` em centavos inteiros (`floor((2n+d)/(2d))`); `planejarMigracaoPrecos` segue stub até T019. Schemas `grupos` (`repassePorVaga`, `taxaPorVaga`, `precoValido`) e `invoices` (`composicao`) sem `required` novo.
- Contrato: `npx vitest run tests/contract/003-preco-por-vaga.contract.test.js` → 4/5 verdes (o 5º, migração, é da Fase 6 e falha por `not implemented`); trava íntegra.
- Testes executados: `npx vitest run tests/contract/003-preco-por-vaga.contract.test.js tests/preco` → 12 passed, 1 failed (contrato 5, esperado); `tests/preco/preco.test.js` 8/8 (inclui varredura de 3.000+ combinações e checagem de que o módulo não importa nada). 1 iteração.
- Pendências: nenhuma

---

## Phase 3: User Story 1 - Preço calculado e validado no servidor (Priority: P1) 🎯 MVP

**Objetivo**: criação e edição gravam o trio calculado pelo servidor, com capacidade mínima 2, reservadas = 1 e recusa de capacidade abaixo dos participantes.

**Independent Test**: `quickstart.md` §2 passos 3–5 e §3 passos 1–2 (POST/PUT pela API com valores adulterados).

### Implementation

- [X] T004 [US1] Em `pages/api/grupos/index.js` (`handleCreate`): trocar `normalizarPreco`/validações de valor e capacidade por `calcularPrecoVaga({ valorTotal, capacidade: capacidadeTotal })` (400 `{ error: mensagem, campo: motivo }`); gravar `valorTotal`, `capacidadeTotal`, `valorPorVaga`, `repassePorVaga`, `taxaPorVaga` (`Double`/`Int32`), `precoValido: true`, `vagasReservadasAdmin: new Int32(VAGAS_DONO)`, `vagasDisponiveis: C − 1`; remover `valorPorVaga`, `vagasReservadasAdmin` e `vagasDisponiveis` da desestruturação do body; auditoria `grupo.created` com os campos de `data-model.md`
- [X] T005 [US1] Em `pages/api/grupos/[id].js` (`handleUpdate`): mesmo cálculo/recusas de T004; contar `membrosAtivos` (`papel !== 'admin'`, `status !== 'banido'`) e aplicar `validarNovaCapacidade` (400 `campo: 'capacidade_participantes'`); `vagasDisponiveis = max(C − participantes, 0)`; `precoValido: true` (regulariza legado); resposta 200 com `preco: { valorPorVaga, repasse, taxa }`; auditoria `grupo.updated` com `preco.antes`/`preco.depois` (antes = valores do `grupo` já carregado)
- [X] T006 [P] [US1] Em `pages/api/grupos/[id]/join.js`: trocar `grupo.vagasReservadasAdmin` por `VAGAS_DONO` no cálculo de `vagasDisponiveis` (e tirar o campo da projeção)

### Testes da Fase

- [X] T007 [US1] Executar `quickstart.md` §2 (passos 3–5) e §3 (passos 1–2) e registrar resultado no Registro da Fase — **feito como teste automatizado** `tests/preco/handlers-grupos.test.js` (handlers reais com `vi.mock` de sessão/Mongo e banco em memória `tests/helpers/db-grupos-memoria.js`, R-006); a passada manual no navegador fica na T025

**Critério de Conclusão**: contratos 1, 2 e 4 seguem verdes; POST com `valorPorVaga: 1`/`vagasReservadasAdmin: 3` grava 10,50 e 1; POST/PUT com `C = 1` → 400; PUT abaixo dos participantes → 400; auditoria com antes/depois; `npm run lint` sem erros novos nos arquivos tocados.

**Checkpoint**: User Story 1 funcional e testável isoladamente.

**Registro da Fase**:

- Status: Concluída (2026-11-24)
- Feito: POST `pages/api/grupos/index.js` e PUT `pages/api/grupos/[id].js` usam `calcularPrecoVaga`; body `valorPorVaga`/`vagasReservadasAdmin`/`vagasDisponiveis` ignorado; 400 `{ error, campo }`; PUT conta membros não-dono não banidos e aplica `validarNovaCapacidade` (`campo: 'capacidade_participantes'`), devolve `preco`; auditoria com trio (criação) e `preco.antes/depois` (edição). Helpers `camposPrecoParaGravar`/`resumoPrecoAuditoria` em `lib/grupos-utils.js`. `join.js` usa `VAGAS_DONO`.
- Contrato: sem contrato nesta fase (contratos 1, 2 e 4 seguem verdes; trava íntegra)
- Testes executados: `npx vitest run tests/preco` → 13/13 (5 de handler). 2 iterações: o fake devolvia a mesma referência no `findOne` e o `updateOne` mutava o 'antes' da auditoria — corrigido no fake (cópia, como o driver). `npx eslint` nos 5 arquivos tocados → sem erros.
- Pendências: passada manual no navegador (T025)

---

## Phase 4: User Story 2 - Cobrança pelo preço único com decomposição (Priority: P1)

**Objetivo**: cobrança só pelo preço vigente gravado, sem fallback, com `composicao` na fatura nova.

**Independent Test**: `quickstart.md` §4 passos 3–4.

### Implementation

- [X] T008 [P] [US2] Em `lib/invoices.js` (`createInvoice`): aceitar `composicao` opcional; quando presente, validar `round(repasseDono*100) + round(taxaCotea*100) === round(amount*100)` (lança erro se não) e gravar
- [X] T009 [US2] Em `pages/api/assinaturas/pay.js`: remover `getGrupoPreco` e o fallback `req.body.amount`; projeção com `valorPorVaga, repassePorVaga, taxaPorVaga, precoValido`; sem `invoiceId` → `precoDoGrupo` inválido = 409 `{ error: 'Preco indisponivel para este grupo', codigo: 'preco_indisponivel' }` antes de criar fatura; válido → `createInvoice` com `amount: valorPorVaga` e `composicao`; com `invoiceId` → debitar `invoice.amount` (congelado). Ledger: mesma perna `pessoal`, sem `receita_taxa` (D-07)
- [X] T010 [P] [US2] Em `pages/api/grupos/[id]/participar.js`: projeção com os campos de preço; `precoDoGrupo` inválido → 409 `preco_indisponivel`

### Testes da Fase

- [X] T011 [US2] Executar `quickstart.md` §4 passos 3–4 (fatura com `composicao`, um único débito `pessoal`, 409 em grupo inválido sem criar fatura) — **feito como teste automatizado** `tests/preco/handler-pay.test.js` + `tests/preco/invoices-composicao.test.js` (R-006); passada manual na T025

**Critério de Conclusão**: contrato 3 verde; pagamento cria fatura com `amount` = valor por vaga e `composicao` somando `amount`; grupo com `precoValido: false` → 409 sem fatura; body `amount` não tem efeito; `npm test` verde exceto contrato 5.

**Checkpoint**: User Story 2 funcional e testável isoladamente.

**Registro da Fase**:

- Status: Concluída (2026-11-24)
- Feito: `lib/invoices.js`: `createInvoice` aceita `composicao` e recusa soma divergente. `pay.js`: sem `getGrupoPreco` nem fallback `req.body.amount`; fatura nova só com `precoDoGrupo` válido (409 `preco_indisponivel` antes de criar fatura) e com `composicao`; fatura existente debitada pelo próprio `invoice.amount`; ledger inalterado (1 perna `pessoal`). `participar.js`: 409 `preco_indisponivel`.
- Contrato: sem contrato nesta fase (contrato 3 `precoDoGrupo` verde; trava íntegra)
- Testes executados: `npx vitest run tests/preco` → 19/19 (3 de `pay.js`, 3 de `createInvoice`). `npx eslint` nos arquivos tocados → sem erros. 1 iteração.
- Pendências: passada manual no navegador (T025)

---

## Phase 5: User Story 3 - Exibição consistente para dono e membro (Priority: P2)

**Objetivo**: prévia nos formulários e mesmo valor (com nota da taxa) em todas as telas, via `lib/preco.js`.

**Independent Test**: `quickstart.md` §2 passos 1–2, §3 passo 3 e §4 passos 1–2.

### Implementation

- [X] T012 [US3] `pages/admin/grupos/novo.js`: substituir o `useEffect` de `T / C` (linhas ~74–91) por `calcularPrecoVaga`; prévia "Membro paga / Voce recebe por membro / Taxa Cotea (5%) / Sua parte (sem taxa)"; erros do formulário usam `mensagem` da função; remover o input editável de reservadas (mostrar "1 (vaga do dono)"); payload sem `valorPorVaga`, `vagasReservadasAdmin`, `vagasDisponiveis`
- [X] T013 [US3] `pages/admin/grupos/[id].js`: remover estado/validação/input de `vagasReservadasAdmin` (linhas ~77, 115–118, 132–142, 163–171, 545–560) e mostrar "1 (vaga do dono)"; prévia da decomposição via `calcularPrecoVaga` com T/C atuais (continuam só-leitura, D-05); payloads de `handleSalvar` e `handleCancelar` sem `valorPorVaga`, `vagasReservadasAdmin`, `vagasDisponiveis`; exibir erro `error` do 400 do servidor
- [X] T014 [P] [US3] `pages/admin/grupos/index.js`: preço da lista via `precoDoGrupo` (mostrar valor e decomposição, ou "Preco indisponivel"); vagas usando `VAGAS_DONO`
- [X] T015 [P] [US3] `pages/index.js`: mensalidade via `precoDoGrupo` (remover fallbacks `preco`/`T/C`); inválido → "Preco indisponivel"; nota "inclui taxa Cotea de 5%"
- [X] T016 [P] [US3] `pages/grupos/[id].js`: `preco` via `precoDoGrupo` (remover `precoCalculado`/`DEFAULT_CONTENT.preco` como fallback de preço); nota da taxa nos 4 pontos de exibição (~303, 339, 453, 564); inválido → "Preco indisponivel" e botão de entrar desabilitado; link do checkout sem `preco` (~255)
- [X] T017 [US3] `pages/assinatura/pagamento.js`: buscar `GET /api/grupos/${grupoId}` e usar `precoDoGrupo` no lugar de `router.query.preco`; nota da taxa; inválido → mensagem e sem botão de pagar; remover `append('preco', …)` (~243); `pages/assinatura/relacionamento.js`: não repassar `preco` (~15)

### Testes da Fase

- [X] T018 [US3] Executar `quickstart.md` §2 passos 1–2, §3 passo 3 e §4 passos 1–2 (inclusive `&preco=1` na URL do checkout sem efeito)

**Critério de Conclusão**: para um mesmo grupo, prévia, home, página, lista admin e checkout mostram o mesmo valor (SC-003); nenhuma tela calcula `T/C` própria (`grep -rn "valorTotal.*/\|/ *capacidade" pages` sem cálculo de preço restante); `npm run build` passa.

**Checkpoint**: User Story 3 funcional e testável isoladamente.

**Registro da Fase**:

- Status: Concluída (2026-11-24)
- Feito: Componente `components/PrevisaoPreco.js` (prévia + `NOTA_TAXA_COTEA`). `novo.js` e `[id].js` (admin): prévia por `calcularPrecoVaga`, reservadas fixas '1 (vaga do dono)', payloads sem `valorPorVaga`/`vagasReservadasAdmin`/`vagasDisponiveis`, erro do servidor exibido. Lista admin, home, página do grupo e checkout via `precoDoGrupo` (sem fallback `preco`/`T/C`), nota da taxa, 'Preco indisponivel'; página do grupo bloqueia 'Assinar' sem preço; checkout busca `GET /api/grupos/[id]`, não envia `amount` e não lê/passa `preco` na URL (também `relacionamento.js`). `pages/api/meus-grupos.js` projeta `repassePorVaga`/`taxaPorVaga`/`precoValido` (descoberto na T014: a lista admin lê dessa API).
- Contrato: sem contrato nesta fase (contratos 1–4 verdes; trava íntegra)
- Testes executados: `npx eslint` nos 10 arquivos tocados → 0 erros (1 warning pré-existente em `pages/grupos/[id].js:81`, não tocado). `npx vitest run` → 115 passed, 1 failed (contrato 5, Fase 6).
- Pendências: nenhuma. T018 no navegador (Playwright, dev server, sessão `user`): home 5 preços + nota; `/grupos/<Canva Pro>` 44,63 consistente + nota; checkout com `&preco=1` mostra/cobraria 44,63 (Pix 45,31); `/admin/grupos/novo` prévia 10,50/10,00/0,50 e 3,50/3,33/0,17, `C=1` → mensagem de capacidade mínima, reservadas = 1, sem campo de valor por vaga; `/admin/grupos/<id>` prévia 44,63/42,50/2,13 e '1 (vaga do dono)'. Lista `/admin/grupos` exige papel suporte/admin: validada só a API `/api/meus-grupos` (traz `repassePorVaga`/`taxaPorVaga`/`precoValido`). Erro de console de CSP do Font Awesome é pré-existente.

---

## Phase 6: User Story 4 - Migração dos grupos existentes (Priority: P2)

**Objetivo**: recalcular todos os grupos existentes, marcar inválidos, normalizar reservadas, idempotente.

**Independent Test**: `quickstart.md` §1.

### Contrato da Fase

- `migração recalcula válidos, marca inválidos sem inventar valores, normaliza reservadas e é idempotente` — FR-008/015, SC-005
- Comando: `npx vitest run tests/contract/003-preco-por-vaga.contract.test.js`

### Implementation

- [X] T019 [US4] Implementar `planejarMigracaoPrecos` em `lib/preco.js` conforme `logic/preco.md` → contrato: `migração recalcula válidos, ...`
- [X] T020 [US4] Criar `scripts/migrar-precos-grupos.js` no padrão de `scripts/migrar-ledger-categorias.js` (cabeçalho de uso, dry-run padrão, `--aplicar`, sem imprimir env): lê grupos com a projeção de `data-model.md`, aplica `$set` onde `set !== null`, insere `grupo.preco_migrado` em `auditLogs` no formato de `lib/audit.js`, imprime relatório (atualizados antes→depois, inalterados, inválidos com nome e motivo)

### Testes da Fase

- [X] T021 [P] [US4] Testes adicionais em `tests/preco/migracao.test.js`: grupo com `valorTotal` como string legada, `capacidadeTotal` ausente, grupo já correto mas `vagasReservadasAdmin: 2` (vira `atualizar` só por reservadas)
- [X] T022 [US4] Executar `quickstart.md` §1 na base de desenvolvimento (com autorização do usuário para `--aplicar`)

**Critério de Conclusão**: `npx vitest run tests/contract/003-preco-por-vaga.contract.test.js` → 5/5 verdes e `check-contract-tests.ps1 -Slug 003-preco-por-vaga` íntegro; dry-run mostra os 5 valores esperados do quickstart; segunda execução `--aplicar` = 0 alterados; faturas inalteradas.

**Checkpoint**: User Story 4 funcional e testável isoladamente.

**Registro da Fase**:

- Status: Concluída (2026-11-24)
- Feito: `planejarMigracaoPrecos` em `lib/preco.js` (alvo por grupo, `set` só com diferença, inválido sem valores inventados). `scripts/migrar-precos-grupos.js`: dry-run padrão, `--aplicar`, relatório por grupo, `grupo.preco_migrado` em `auditLogs` no formato de `lib/audit.js`.
- Contrato: `npx vitest run tests/contract/003-preco-por-vaga.contract.test.js` → 5/5 verdes; trava íntegra.
- Testes executados: `npx vitest run tests/contract/003-preco-por-vaga.contract.test.js tests/preco` → 29/29 (`tests/preco/migracao.test.js` 5/5, inclui os 5 grupos reais). Dry-run real: `node --env-file=.env.local scripts/migrar-precos-grupos.js` → 5 a alterar, 0 inválidos, valores idênticos ao quickstart §1 (47,25 / 26,25 / 44,63 / 10,50 / 36,75). Aviso `MODULE_TYPELESS_PACKAGE_JSON` do Node é inofensivo (mesmo do script da 002).
- Pendências: nenhuma. T022 (autorizado pelo usuário): `node --env-file=.env.local scripts/migrar-precos-grupos.js --aplicar` → 5 de 5 alterados; 2ª execução → 0 alterados, 5 inalterados; 5 `grupo.preco_migrado` em `auditLogs`; as 5 faturas com o mesmo `amount` de antes e sem `composicao` (FR-016).

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Documentação de regras, gates do projeto.

- [X] T023 Atualizar `.docs/regras-negocio-v2.md` Fluxo 4 (Regras: arredondamento meio-para-cima com taxa absorvendo o resíduo; `vagasReservadasAdmin` = 1; recusa de capacidade abaixo dos participantes; sem fallback de preço; seção Gap: marcar o item de valor por vaga como resolvido por `003-preco-por-vaga`) e "Regras financeiras consolidadas" (decomposição gravada na fatura; lançamento da taxa em V2-06/V2-11) — Constitution III
- [X] T024 Conferir que nenhum consumidor ainda lê `grupo.preco` ou calcula `valorTotal / capacidade` (`grep -rn "\.preco\b\|valorTotalNumero /" pages components`)
- [X] T025 Rodar validação completa de `quickstart.md`

### Checklist de Release

- [X] Fase 2 (Foundational) concluída
- [X] Fase 3 (User Story 1) concluída
- [X] Fase 4 (User Story 2) concluída
- [X] Fase 5 (User Story 3) concluída
- [X] Fase 6 (User Story 4) concluída
- [X] Testes de contrato 003 5/5 verdes na suíte completa e `check-contract-tests.ps1` íntegro para 001, 002 e 003
- [X] `npm test` verde
- [X] `npm run lint` sem erros novos
- [X] `npm run build` passa (dev server parado)
- [X] Schemas `grupos`/`invoices` atualizados; nenhuma variável de ambiente nova
- [X] `.docs/regras-negocio-v2.md` atualizado (T023)
- [X] Ordem de implantação D-10 anotada para o deploy: migrar → deploy → migrar de novo
- [X] `quickstart.md` executado com sucesso

**Registro da Fase**:

- Status: Concluída (2026-11-24)
- Feito: `.docs/regras-negocio-v2.md` (Fluxo 4, gap 12, regras financeiras consolidadas, Fluxo 19); varredura T024 sem cálculo de preço restante nas telas; quickstart executado (ver T018/T022).
- Contrato: `npx vitest run tests/contract/003-preco-por-vaga.contract.test.js` → 5/5; `check-contract-tests.ps1` íntegro para 001, 002 e 003.
- Testes executados: `npx vitest run` → 121/121 (23 arquivos); `npx eslint .` → 0 erros, 5 avisos pré-existentes; `npx next build` → ok (em cópia `J:/Cotea/.tmp-build-003`, removida depois, porque o dev server ocupava `.next`).
- Pendências: nenhuma da feature. Validar a lista `/admin/grupos` com uma conta suporte/admin é recomendação (código e API conferidos).

---

## Dependencies & Execution Order

### Phase Dependencies

- **Foundational (Phase 2)**: bloqueia todas as stories
- **US1 (Phase 3)** e **US2 (Phase 4)**: dependem só da Fase 2; podem rodar em paralelo
- **US3 (Phase 5)**: depende da Fase 2; para validação ponta a ponta, de US1 (prévia = gravado) e US2 (checkout = cobrado)
- **US4 (Phase 6)**: depende da Fase 2; o script pode ser escrito em paralelo, mas `--aplicar` real deve rodar antes do deploy (D-10)
- **Polish (Phase 7)**: depois de todas

### Parallel Opportunities

- T002 ∥ T001; T006 ∥ T004/T005; T008 ∥ T010; T014/T015/T016 entre si

---

## Implementation Strategy

### MVP First

1. Fase 2 → Fase 3 (US1) → Fase 4 (US2): preço correto gravado e cobrado.
2. **PARAR E VALIDAR** com quickstart §2–§4 (passos de API).

### Incremental Delivery

1. Fundação → US1 → US2 (MVP financeiro)
2. US3 (telas coerentes) → US4 (migração) → Polish

## Notes

- `[P]` = arquivos diferentes, sem dependência
- Nunca editar `tests/contract/003-preco-por-vaga.contract.test.js` nem os contratos de 001/002
- Commitar após cada task ou grupo lógico coerente

<!-- sdd-converge anexa "## Phase N: Convergence" abaixo desta linha -->
