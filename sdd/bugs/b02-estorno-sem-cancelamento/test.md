# Bug Verification: Estorno sem cancelamento (B-02)

- **Slug**: b02-estorno-sem-cancelamento
- **Testado**: 2026-11-24
- **Assessment**: ./assessment.md
- **Fix**: ./fix.md
- **Result**: partial

## Summary

A reprodução foi executada de forma automatizada (handler com sessão/Mongo/ledger mockados): o estorno por membro e por quem entrou e saiu agora retorna 409 sem lançamento, e o caminho legítimo de compensação continua estornando. Fica `partial` apenas porque não houve validação ponta a ponta com banco real e servidor de desenvolvimento (fora do escopo: sem rede/banco).

## Checks Performed

| Checagem | Comando / Ação | Resultado | Notas |
| --- | --- | --- | --- |
| Reprodução (pós-fix), handler em memória | `npx vitest run tests/bugs/b02-estorno-sem-cancelamento.test.js` | pass | 11/11; 3 casos do bug falham no código original (verificado) |
| Reprodução ponta a ponta (dev server + Mongo + sessão real) | — | not-run | requer banco/rede; não executado |
| Suite de regressão | `npx vitest run` (de `J:\Cotea`) | pass | 29 arquivos, 171 testes |
| Trava de contratos | `check-contract-tests.ps1` 001/002/003 | pass | trava íntegra |
| Lint | `npx eslint lib/estorno.js pages/api/assinaturas/refund.js tests/bugs/b02-estorno-sem-cancelamento.test.js` | pass | sem erros |

## Output Excerpts

```
Test Files  29 passed (29)
Tests  171 passed (171)
```

## Residual Risks

- Corrida join x refund sem transação conjunta (ver Follow-ups em fix.md).
- Regra "entrou e saiu" depende de `join` manter `membroId`/`vinculadoEm` na fatura.
- Fluxo de checkout (pagamento.js → refund após falha de join) coberto só por teste de handler, não por teste de UI/E2E.

## Recommendation

Fechar o bug no código (fix aplicado e travado por teste de regressão); validar manualmente o checkout com falha de join em ambiente com banco antes de liberar V2-12/V2-15 e tratar a corrida em B-04.
