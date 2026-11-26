# Bug Fix: `pay` aceita invoiceId de fatura estornada

- **Slug**: pay-aceita-fatura-estornada
- **Corrigido**: 2026-11-24
- **Assessment**: ./assessment.md
- **Status**: applied

## Summary

`POST /api/assinaturas/pay` passou a aplicar uma allow-list de status na fatura existente: `paga` reconcilia (200, como antes), `aguardando_pagamento`/`aguardando_recarga` cobram, `estornada` devolve 409 `fatura_estornada` e qualquer outro status 409 `fatura_indisponivel`, antes de qualquer ledger/audit. Defesa extra: se o ledger devolve `criada:false` (debito ja existia) e a fatura nao esta paga, responde 409 `fatura_inconsistente` em vez do falso `paga` + audit `assinatura.paid`.

## Changes

| Arquivo | Mudança | Notas |
| --- | --- | --- |
| `pages/api/assinaturas/pay.js` | modified | constante `STATUS_FATURA_COBRAVEL`; gate de status logo apos carregar a fatura; tratamento de `operacao.criada === false` (relê fatura; paga -> 200 sem audit, senao 409). Ledger continua via `obterLedger().registrarOperacao` (`assinatura_grupo:<invoiceId>`) |
| `tests/bugs/pay-aceita-fatura-estornada.test.js` | added | regressão (ledger mockado fiel: repetição de operacaoId = `criada:false` sem `extra`) |

`lib/invoices.js` nao precisou mudar.

## Tests Added or Updated

- `tests/bugs/pay-aceita-fatura-estornada.test.js` — estornada com e sem debito previo -> 409 sem lancamento/audit e fatura segue `estornada`; status desconhecido (`cancelada`, `pending`, ausente) -> 409; estornada de outro usuario -> 404; `paga` -> 200 sem lancamento; `aguardando_*` cobram e viram `paga`; clique duplo/debito pre-existente -> 409 `fatura_inconsistente` ou 200 se ja paga, nunca audit falso. Confirmado: 7 dos 11 casos falham sem o fix.

## Local Verification

- `npx vitest run tests/bugs/pay-aceita-fatura-estornada.test.js` (de `J:\Cotea`) -> 11/11.
- Com o gate e a guarda desativados temporariamente: 7 falhas (arquivo restaurado depois).
- `npx vitest run` -> 34 arquivos, 226 testes passando (inclui `tests/preco/handler-pay` e `tests/bugs/b04-*`).
- `npx eslint pages/api/assinaturas/pay.js tests/bugs/pay-aceita-fatura-estornada.test.js` -> sem erros.

## Deviations from Assessment

Nenhuma. (A guarda `criada:false` foi a "defesa em profundidade" prevista; a guarda de status em `lib/invoices.js` ficou fora, nao foi necessaria.)

## Follow-ups

- Front (`pages/assinatura/pagamento.js`, fora do escopo): apos falha de join + estorno o `invoiceId` estornado fica no estado; o retry vai receber 409 `fatura_estornada` ate recarregar. Limpar `invoiceId` apos estorno ou ao receber esse codigo (hoje o retry ja falhava, via `join` 402).
- Decisao de produto pendente: recusar (implementado) vs. emitir fatura nova automaticamente quando o cliente reenvia fatura estornada.
- `markInvoicePaid`/`markInvoiceAwaitingTopUp` seguem sem guarda de status propria; o gate no `pay` cobre o unico chamador atual.
