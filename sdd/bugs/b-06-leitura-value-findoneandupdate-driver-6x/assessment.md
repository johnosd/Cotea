# Bug Assessment: Leitura de `.value` em `findOneAndUpdate` com driver 6.x (B-06)

- **Slug**: b-06-leitura-value-findoneandupdate-driver-6x (slug sugerido pelo usuário: `b06-findoneandupdate-value`; o `resolve-bug.ps1 -Title` gerou o slug acima)
- **Criado**: 2026-11-24
- **Origem**: entrada `[Bug] B-06` de `.planning/backlog.md` (texto colado pelo usuário)
- **Veredito**: valid
- **Severidade**: high (P1)

## Report

No `mongodb` v6, `findOneAndUpdate` retorna o documento direto (sem `{ value }`), a menos que `includeResultMetadata: true`. Já resolvido em `withdraw/approve.js` e `withdraw/reject.js`. Restam `pages/api/admin/users/[id]/block.js` e `lib/invoices.js` (`markInvoicePaid`/`markInvoiceAwaitingTopUp`/`markInvoiceRefunded`).

## Symptom

`PUT /api/admin/users/[id]/block` grava `isBlocked` no banco mas responde 404 "Usuario nao encontrado" (e nunca chega ao `logAudit`). As funções `markInvoice*` devolvem sempre `undefined`; as rotas de assinatura caem nos fallbacks (`invoice._id`, status fixo), então o valor "atualizado" nunca é usado de verdade.

## Reproduction

Confirmado por leitura do código do driver instalado (não por execução contra banco real):

1. Versão: `package.json` `"mongodb": "^6.16.0"`; `package-lock.json` e `node_modules/mongodb/package.json` = **6.16.0**.
2. `node_modules/mongodb/lib/operations/find_and_modify.js:33,86`: `options.includeResultMetadata ??= false;` ... `return options.includeResultMetadata ? result : (result.value ?? null);` — ou seja, sem a opção, o retorno é o documento (ou `null`), nunca `{ value }`.
3. Logo, para documento encontrado, `.value` é `undefined` (o documento não tem campo `value`); para documento inexistente o retorno é `null` e `null.value` lança `TypeError`.

[NEEDS CLARIFICATION: reprodução em banco real não executada; o comportamento é determinado pelo código-fonte do driver e coberto por teste com fake fiel ao driver 6.]

## Suspected Code Paths

- `pages/api/admin/users/[id]/block.js:37,47,51` — `if (!updated.value)` é sempre verdadeiro para documento encontrado (documento de `users` não tem campo `value`) → 404 após gravar `isBlocked`; se o usuário não existe, `updated` é `null` e `null.value` lança `TypeError` → 500 em vez de 404. `logAudit` e a resposta 200 nunca executam.
- `lib/invoices.js:79` (`markInvoicePaid`), `:96` (`markInvoiceAwaitingTopUp`), `:114` (`markInvoiceRefunded`) — `return updateResult.value` → `undefined` para fatura existente; `TypeError` se `updateResult` for `null` (fatura inexistente).
- Consumidores (não editar; só dependem do retorno correto):
  - `pages/api/assinaturas/pay.js:131,138,145,157-164` — `operacao.resultadoExtra` (de `markInvoicePaid` via `extra`) e `awaitingInvoice?._id` caem no fallback `invoice._id`; equivalente, então sem efeito visível.
  - `pages/api/assinaturas/refund.js:76,91` — `refunded?.status || INVOICE_STATUS.ESTORNADA`; idem.
- Verificados e CORRETOS (usam o retorno como documento): `lib/ratelimit.js:28-37` (`doc?.count`), `pages/api/pix/simulated/confirm.js:62-67` (`if (atualizado) return atualizado`), `pages/api/admin/calendario.js:67-76` (`removida.descricao`; `findOneAndDelete`), `lib/ledger/saque.js:35`, `lib/rotinas/repositorio-mongo.js`. `withdraw/approve.js`/`reject.js` já corrigidos (fora do meu escopo).
- Varredura `\.value\b` em `pages/ lib/ components/ tests/ scripts/ database/`: demais ocorrências são `e.target.value`, `opt.value`, `r.value` (UI) e `x.value` de `formatToParts` — não relacionadas.

## Root Cause Hypothesis

Código escrito para o driver 4.x/5.x, onde `findOneAndUpdate` devolvia `ModifyResult { value, ok, lastErrorObject }`; ao subir para o driver 6.x o formato padrão mudou para o documento direto e esses call-sites não foram migrados. Confiança: high (código do driver lido + padrão já corrigido em withdraw).

## Proposed Remediation

**Preferida**: tratar o retorno como o documento (ou `null`):
- `block.js`: `const updated = ...; if (!updated) 404; usar updated.email / updated.isBlocked`.
- `invoices.js`: `return updateResult;` nas três funções (documento atualizado ou `null`, comportamento já esperado pelos consumidores via `?.`).

**Alternativas**:
- Passar `includeResultMetadata: true` e manter `.value` — rejeitada: diverge do padrão já adotado em `approve.js`/`reject.js`/ledger e mantém a API legada.

**Files likely to change**:
- `pages/api/admin/users/[id]/block.js`
- `lib/invoices.js`
- novo teste `tests/bugs/findoneandupdate-value-driver6.test.js`

**Tests to add or update**:
- `markInvoicePaid`/`markInvoiceAwaitingTopUp`/`markInvoiceRefunded` com o db em memória (`tests/helpers/db-grupos-memoria.js`, cujo `findOneAndUpdate` já é fiel ao driver 6 — retorna o doc/`null`): retorna o documento atualizado com o novo status; fatura inexistente → `null` (sem lançar).
- Handler `block.js` com sessão admin mockada: 200 com `isBlocked` correto e `logAudit` chamado; usuário inexistente → 404; guard de método/ID/body.

## Risks & Considerations

- `pay.js`/`refund.js` passam a receber o documento real em `resultadoExtra`; seus fallbacks produzem os mesmos valores, então o contrato de resposta não muda (`updatedInvoice._id` é o mesmo `invoice._id`; `refunded.status` = `'estornada'`).
- `markInvoiceRefunded` roda dentro de `extra` do ledger com `{ session }`; retornar `null` (fatura inexistente) em vez de lançar `TypeError` muda o comportamento nesse caso raro: antes a transação abortava com TypeError, agora comitaria sem fatura atualizada. `refund.js` já verifica a existência da fatura (`getInvoiceById`) antes — risco baixo. Registrar como observação; não mudar contrato (não lançar) para manter a mudança mínima.
- Fora do escopo (outros agentes): `pages/api/assinaturas/**`, `withdraw/**` — sem ocorrência de `.value` pendente neles além do que está listado.

## Open Questions

- Nenhuma decisão de produto pendente.
