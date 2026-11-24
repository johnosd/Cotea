# Handoff — 002-ledger-segmentado (sdd-plan → sdd-execute)

## Contexto

- Repositório `J:\Cotea`, branch `feature/godfiles` (há mudanças não commitadas da 001 na árvore; não são desta feature).
- Stack: Next.js 14 Pages Router + MongoDB driver nativo 6.16 (Atlas, banco `usaComigo`) + NextAuth v4 + Vitest 5.
- Próximo comando: `/sdd-execute 002-ledger-segmentado`. Backlog: **Planejada** (o script conta 0/48 porque inclui os itens do Checklist de Release).
- `spec.md` e `.planning/backlog.md` foram editados em disco fora da sessão do plan (status atualizado por script) — reler antes de mexer.

## O que a feature entrega

- **US1 (P1)**: categoria/contexto/`operacaoId` em todo lançamento; resumo derivado (total, disponível = sacável, saque em andamento, caução/retido/recebível/disputa por grupo); débitos nunca deixam categoria negativa, mesmo concorrentes; os 6 fluxos atuais passam pelo núcleo; migração dos 13 legados para `pessoal` sem mudar saldo.
- **US2 (P2)**: resumo segmentado em `/wallet` (extrato completo **não** — é V2-23).
- **US3 (P3)**: financeiro/admin veem o saldo do usuário no saque e a conta da plataforma; **suporte não vê**.
- **US4 (P3)**: rotina diária `ledger-consistencia` que **só alerta**, nunca corrige.
- Decisões do usuário que contrariam o óbvio: o pagamento de assinatura atual **não** grava receita do Cotea (conta começa vazia; taxa vem em V2-03/V2-11); recebível liberado vira saldo `pessoal` comum (pode pagar grupos, não só sacar); o refund continua chamável pelo usuário (B-02 fora).

## Leitura obrigatória, em ordem

1. `spec.md` — FRs 001–021, SCs, 8 clarificações.
2. `plan.md` — Decisões Invariantes D-01..D-13 e Riscos R-001..R-007.
3. `tasks.md` — 36 tasks em 7 fases.
4. `logic/ledger.md` — algoritmo do núcleo, código de referência do repositório Mongo (§7), rotina (§9).
5. `data-model.md` — campos novos, semântica dos saldos, migração, conta da plataforma, estado real do banco.
6. `contracts/api-carteira.md` — `/api/wallet/balance` compatível, 2 rotas novas, mudanças internas nas rotas existentes.
7. `quickstart.md` — validação manual no banco dev.
8. `.planning/memory/constitution.md` — princípios I–IV.

## Testes de contrato

- `tests/contract/002-ledger-segmentado.contract.test.js` — 5 testes, todos da **Fase 3**.
- `tests/helpers/ledger-memoria.js` — 0 testes; é a **porta** do repositório (o Mongo replica).
- Rodar: `npx vitest run tests/contract/002-ledger-segmentado.contract.test.js` (de `J:\Cotea`).
- Integridade: `.\.planning\scripts\powershell\check-contract-tests.ps1 -Slug 002-ledger-segmentado`.
- Não quebrar a trava da 001: `check-contract-tests.ps1 -Slug 001-rotinas-agendadas` (a Fase 6 mexe em `lib/rotinas/registro.js`).
- Vermelho confirmado: 5/5 `Error: not implemented`; suíte existente 43/43. Um protótipo descartável passou 5/5 e um mutante sem trava por carteira falhou só o teste de concorrência — os contratos são satisfazíveis.

## Stubs criados

- `lib/ledger/ledger.js` — `SaldoInsuficienteError`/`LancamentoInvalidoError` **reais** (os testes checam `instanceof`; manter `code`, `disponivel`, `solicitado`); `calcularResumo` e `criarLedger` com `throw new Error('not implemented')`; reexporta `CATEGORIAS`, `CATEGORIAS_BLOQUEADAS`, `CONTA_PLATAFORMA_ID`.
- `lib/ledger/categorias.js` — constantes definitivas (não é stub).

## Armadilhas já mapeadas

- `registrarOperacao` precisa passar em `travar` as carteiras com perna de **débito**; o fake só serializa o que for travado (o contrato de concorrência pega quem esquecer).
- Operação já existente (mesmo `operacaoId`) retorna `{ criada: false }` **antes** de checar saldo — senão a repetição de um saque falha por saldo.
- `extra` recebe `{ sessao, lancamentos }` (o fake passa `sessao: null`); `markInvoicePaid` precisa do `ledgerId` e `markInvoiceRefunded` ainda não aceita `{ session }` (T013).
- `withTransaction` pode rodar `fn` de novo: nada fora da sessão dentro do `extra`; `logAudit` depois do commit (R-003).
- Driver 6.16: `findOneAndUpdate` devolve o documento, não `{ value }` — não copiar o padrão de `approve.js`/`reject.js`/`lib/invoices.js`.
- `wallets.userId` tem índice único não esparso: a conta da plataforma usa `userId: 'cotea:plataforma'`, não `null`.
- `grupos._id` é `ObjectId`; `grupoId` no ledger é string — normalizar em `enriquecerResumo`.
- `lib/ledger/ledger.js`, `consistencia.js`, `migracao.js`, `apresentacao.js` (parte pura) **não** podem importar `lib/mongodb.js` (valida env no import e quebra o Vitest).
- `insertWithdrawal` gera o `_id` dentro; T009 aceita `_id` porque `saque:<withdrawalId>` tem de existir antes da operação.
- Saque legado pendente não tem `operacaoId` até a migração (R-005): migrar **antes** do deploy (ordem D-10).
- `node database/setupDatabase.js` faz `collMod` em todas as coleções e aplica o validator com campos obrigatórios: **só com autorização do usuário** e depois da migração (R-001).
- `database/setup-indexes.js` aborta em `walletTransactions` (B-09) — não depender dele para validar.
- Vitest só de `J:\Cotea` (drive maiúsculo).
- Os dados de dev têm a carteira `11a282cf…` com soma `0.6799999999999997` no cálculo antigo — esperado virar `0.68`.

## Pendências do Analyze

- A-01 · LOW · `spec.md` FR-001/FR-012 tratam "saque em andamento" como categoria gravada; o plano (D-01) a deriva do débito `blocked` de `pessoal`. Recomendação: no `sdd-converge`, anexar nota em `## Clarifications` registrando a decisão (sem reescrever FR).
- A-02 · MEDIUM · Trava real por carteira (WriteConflict) só é validada manualmente (R-004). Recomendação: executar `quickstart.md` 2.5 antes de dar a Fase 3 por concluída.
- A-03 · LOW · Escopo: auditoria nova em `withdraw/create` e PIX e o `.value` removido em `approve`/`reject` (R-006) vão além da spec, justificados pela constitution II; T035 atualiza B-06 no backlog.
- A-04 · LOW · `uso_saldo` continua sem idempotência por requisição (`uso_saldo:<uuid>` novo a cada chamada), como hoje. Sem ação nesta feature.

## Gate de pronto

- Contratos 002 5/5 verdes e travas 002 **e** 001 íntegras.
- `npm test`, `npm run lint` (0 erros), `npm run build` (dev server parado).
- `quickstart.md` 1–4 no banco dev; migração com resumo idêntico antes/depois.
- Docs no Polish: `.docs/regras-negocio-v2.md` (Fluxos 16, 18, 19), `CLAUDE.md`, `AGENTS.md`, backlog (B-06 parcial).
- Não há hardware real; a validação na Vercel fica para o primeiro deploy (recomendação, não gate).
