# Bug Verification: `pay` aceita invoiceId de fatura estornada

- **Slug**: pay-aceita-fatura-estornada
- **Testado**: 2026-11-24
- **Assessment**: ./assessment.md
- **Fix**: ./fix.md
- **Result**: partial

## Summary

A reproducao automatizada (handler real `pay`, sessao/Mongo em memoria, ledger mockado com semantica de idempotencia do real) nao reproduz mais: fatura estornada ou de status desconhecido recebe 409 sem lancamento, sem audit e sem mudar de status. `partial` porque nao houve execucao contra Mongo/ledger reais nem navegador (exigem rede/banco).

## Checks Performed

| Checagem | Comando / Acao | Resultado | Notas |
| --- | --- | --- | --- |
| Reproducao (pos-fix), nivel handler | `npx vitest run tests/bugs/pay-aceita-fatura-estornada.test.js` (de `J:\Cotea`) | pass | 11 casos; 7 falham sem o fix |
| Reproducao E2E real (Mongo + UI) | - | not-run | Requer banco/rede; fora do autorizado |
| Suite de regressao | `npx vitest run` | pass | 34 arquivos, 226 testes (inclui preco/handler-pay e bugs b01-b09) |
| Lint | `npx eslint pages/api/assinaturas/pay.js tests/bugs/pay-aceita-fatura-estornada.test.js` | pass | sem saida |
| Contratos travados | incluidos na suite completa | pass | nenhum `contract-tests.lock` tocado |

## Output Excerpts

```
Test Files  34 passed (34)
     Tests  226 passed (226)
```

## Residual Risks

- Ledger mockado: a semantica `criada:false` sem `extra` foi lida de `lib/ledger/ledger.js:209-214`, nao exercitada contra o Mongo real.
- Front mantem `invoiceId` estornado no estado: retry mostra o 409 ate recarregar (follow-up em `pagamento.js`).
- `markInvoicePaid`/`markInvoiceAwaitingTopUp` continuam sem guarda propria.

## Recommendation

Segurar o fechamento ate checagem manual com Mongo real (reenviar `invoiceId` estornado e confirmar 409 sem novo debito) e decisao do usuario sobre recusar vs. emitir fatura nova no retry. Codigo e testes automatizados estao completos, sem regressao detectada.
