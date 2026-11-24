# Handoff — 003-preco-por-vaga

## Contexto

- Repositório `J:\Cotea`, branch `feature/godfiles`. Next.js 14 Pages Router + MongoDB driver nativo + NextAuth; testes Vitest.
- Próximo comando: `/sdd-execute 003-preco-por-vaga`. Backlog: **Planejada** (0/38).
- Na branch há mudanças de 002 sem commit (`.planning/backlog.md`, `sdd/specs/002-ledger-segmentado/plan.md`/`tasks.md`, `tests/ledger/categorias-bloqueadas.test.js`) — não são desta feature; não reverter.

## O que a feature entrega

- **Fundação**: `lib/preco.js` puro = única fonte da regra (centavos inteiros, meio-para-cima exato, taxa = valorPorVaga − repasse).
- **US1 (P1)**: POST/PUT de grupo calculam e gravam `valorPorVaga`/`repassePorVaga`/`taxaPorVaga`/`precoValido`; body nunca é fonte; `C ≥ 2`; `vagasReservadasAdmin` **sempre 1**; PUT recusa capacidade < dono + membros. A **UI de edição mantém T e C só-leitura** (D-05) — só a API muda preço; mudança pela tela é V2-13.
- **US2 (P1)**: `pay.js` cobra só por `precoDoGrupo` (sem fallback para `valorTotal` nem `req.body.amount`), 409 `preco_indisponivel`, grava `composicao` na fatura nova. **Não** lança `receita_taxa` nem repasse no ledger (V2-06/V2-11).
- **US3 (P2)**: prévia nos formulários e mesmo preço em home, página do grupo, lista admin e checkout; checkout deixa de ler `preco` da query.
- **US4 (P2)**: `scripts/migrar-precos-grupos.js` (dry-run padrão, `--aplicar`), idempotente, não toca faturas.

## Leitura obrigatória, em ordem

1. `spec.md` — stories, FR-001..017, clarificações da sessão 2026-11-24.
2. `plan.md` — Decisões Invariantes D-01..D-11, riscos R-001..R-005.
3. `tasks.md` — T001..T025 por fase.
4. `logic/preco.md` — fórmula inteira, ordem das validações, retorno exato de `precoDoGrupo`, planner.
5. `data-model.md` — campos de `grupos`/`invoices`, auditoria, migração.
6. `contracts/api-grupos.md` — status/bodies de POST/PUT grupos, pay, participar, join, checkout.
7. `quickstart.md` — roteiro manual com valores esperados da base real.
8. `.planning/memory/constitution.md`.

## Testes de contrato

- `tests/contract/003-preco-por-vaga.contract.test.js` — 5 testes, travado. Testes 1–4 → Fase 2; teste 5 (migração) → Fase 6.
- Rodar: `npx vitest run tests/contract/003-preco-por-vaga.contract.test.js` (de `J:\Cotea`).
- Integridade: `.\.planning\scripts\powershell\check-contract-tests.ps1 -Slug 003-preco-por-vaga` (e `-Slug 001-rotinas-agendadas`, `-Slug 002-ledger-segmentado` no Polish).
- Validados contra uma implementação de referência descartável: são satisfazíveis tal como estão.
- Esta feature toca `pay.js`, que usa o núcleo do ledger (002): não mudar a chamada `registrarOperacao` além do `valor` — os contratos 002 não importam `pay.js`, mas o quickstart da 002 cobre o fluxo.

## Stubs criados

- `lib/preco.js`: constantes `TAXA_COTEA_PERCENTUAL = 5`, `CAPACIDADE_MINIMA = 2`, `VAGAS_DONO = 1`, `MOTIVOS_PRECO_INVALIDO` (definitivas) e 4 funções com `throw new Error('not implemented')` + JSDoc com formato de retorno.

## Armadilhas já mapeadas

- `Math.round(T/C*1.05*100)` **erra** (ex.: 3,30/3 → 1,15 em vez de 1,16; 0,57/2 repasse 0,28 em vez de 0,29) — usar `floor((2n+d)/(2d))` em centavos.
- `lib/preco.js` é importado no cliente: **não** importar `lib/wallet.js` (`normalizeAmount`), `lib/grupos-utils.js` (importa `mongodb`) nem `lib/mongodb.js`.
- `precoDoGrupo` é comparado com `toEqual`: retornar exatamente `{ valido, valorPorVaga, repasse, taxa }` ou `{ valido: false }`.
- Grupo "heygen" na base não tem documento `membrosGrupo` do dono: participantes = membros não-admin + 1, nunca contar o doc do dono.
- Validator de `grupos` está ativo: campos novos sem `required`.
- `pay.js` com `invoiceId` deve debitar `invoice.amount`, não o preço atual (hoje usa o preço do grupo).
- Handlers importam `lib/mongodb.js` (valida env no import) → sem teste unitário; validar pelo quickstart.
- Migração: rodar **antes** do deploy e de novo depois (R-001); `--aplicar` na base exige autorização do usuário.
- Vitest só de `J:\Cotea`; `npm run build` com o dev server parado.

## Pendências do Analyze

- A1 · MEDIUM · FR-011 diz "recusar ingresso", mas `join.js` não recusa por preço (D-08/R-003) → aceitar como está ou anotar a exceção na spec no Polish.
- A2 · MEDIUM · US1-AC5 ("o dono edita T ou C") só é exercitável pela API; a tela de edição mantém T/C só-leitura (D-05) → confirmar com o usuário ou deixar para V2-13.
- A3 · LOW · Spec fala em "membros ativos"; o plano conta `status !== 'banido'` (critério do `join.js`) → manter coerência com join; registrar no T023.
- A4 · LOW · Comando `grep` do critério da Fase 5/T024 é heurístico → revisar manualmente os arquivos de T014–T017.

## Gate de pronto

- Contratos 003 5/5 verdes; travas 001/002/003 íntegras.
- `npm test`, `npm run lint`, `npm run build`.
- `quickstart.md` §1–§4 executado (migração real com autorização).
- Docs no Polish: `.docs/regras-negocio-v2.md` (T023); schemas já na Fase 2.
- Sem hardware/E2E: validação manual no navegador é gate (quickstart).
