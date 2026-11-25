# Bug Fix: Leitura de `.value` em `findOneAndUpdate` com driver 6.x (B-06)

- **Slug**: b-06-leitura-value-findoneandupdate-driver-6x
- **Corrigido**: 2026-11-24
- **Assessment**: ./assessment.md
- **Status**: applied

## Summary

`block.js` e as três funções `markInvoice*` de `lib/invoices.js` passam a tratar o retorno de `findOneAndUpdate` como o documento (ou `null`), como o driver 6.16 faz por padrão. O bloqueio/desbloqueio de usuário deixa de responder 404 depois de gravar, e `markInvoice*` deixam de devolver `undefined`.

## Changes

| Arquivo | Mudança | Notas |
| --- | --- | --- |
| `pages/api/admin/users/[id]/block.js` | modified | `!updated.value` -> `!updated`; `updated.value.email/isBlocked` -> `updated.email/isBlocked` |
| `lib/invoices.js` | modified | `markInvoicePaid`/`markInvoiceAwaitingTopUp`/`markInvoiceRefunded` retornam direto o resultado de `findOneAndUpdate` (documento atualizado ou `null`) |
| `tests/bugs/findoneandupdate-value-driver6.test.js` | added | regressão (7 testes) |

## Tests Added or Updated

- `tests/bugs/findoneandupdate-value-driver6.test.js` — `markInvoicePaid`/`AwaitingTopUp`/`Refunded` devolvem a fatura atualizada; fatura inexistente -> `null` sem lançar; `block.js`: bloqueio e desbloqueio respondem 200 com `isBlocked` correto + `logAudit`; usuário inexistente -> 404 (antes `TypeError` -> 500) sem auditoria. Os 7 testes falham com o código original (verificado revertendo temporariamente os dois arquivos ao HEAD) e passam com o fix.

## Local Verification

- `npx vitest run tests/bugs/findoneandupdate-value-driver6.test.js tests/preco tests/ledger` (de `J:\Cotea`) -> 13 arquivos, 70 testes passando.
- `npx vitest run` (suíte completa) -> 188/189; a única falha é `tests/bugs/b09-setup-indexes-conflito.test.js` ("TTLs ... iguais nos dois"), teste de outro agente (B-09, `database/setup-indexes.js` em edição), não relacionado.
- `npx eslint` nos 3 arquivos -> sem avisos.
- Versão do driver confirmada: 6.16.0 (`package-lock.json`, `node_modules/mongodb/package.json`); `lib/operations/find_and_modify.js:86` retorna `result.value ?? null` quando `includeResultMetadata` é falso.

## Deviations from Assessment

Nenhum.

## Follow-ups

- Varredura de `findOneAndUpdate/Delete/Replace` no repo: nenhuma outra ocorrência de `.value` pendente. `lib/ratelimit.js`, `pages/api/pix/simulated/confirm.js`, `pages/api/admin/calendario.js`, `lib/ledger/saque.js` e `lib/rotinas/repositorio-mongo.js` já usam o documento direto. `withdraw/approve.js`/`reject.js` já estavam corrigidos. Nenhuma pendência em arquivos de outros agentes.
- Comportamento: com fatura inexistente, `markInvoiceRefunded` dentro do `extra` do ledger agora retorna `null` em vez de lançar `TypeError` (que abortava a transação). `refund.js` já valida a fatura antes (`getInvoiceById`), então é um caso raro; avaliar se deve lançar explicitamente.
- Itens do agente principal: remover a entrada `[Bug] B-06` de `.planning/backlog.md` e rodar `update-bug-status.ps1 -Slug b-06-leitura-value-findoneandupdate-driver-6x` (pulado por regra de paralelismo).
- Sugestão de commit: `fix(driver6): findOneAndUpdate sem .value em block.js e lib/invoices.js (B-06)`.
