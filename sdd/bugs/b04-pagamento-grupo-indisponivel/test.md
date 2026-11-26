# Bug Verification: Pagamento de grupo indisponivel sem compensacao no servidor (B-04)

- **Slug**: b04-pagamento-grupo-indisponivel
- **Testado**: 2026-11-24
- **Assessment**: ./assessment.md
- **Fix**: ./fix.md
- **Result**: verified

## Summary

A reproducao automatizada (handlers reais `pay` e `join` com sessao/Mongo/ledger em memoria) nao reproduz mais o sintoma: nada e cobrado para grupo inativo/cancelado/cheio, dono, ja membro ou banido; `join` estorna no servidor quando a fatura paga nao vira vaga. Marcado `partial` porque nao houve execucao contra banco/ledger Mongo real nem fluxo de navegador (exigem rede/banco).

## Checks Performed

| Checagem | Comando / Acao | Resultado | Notas |
| --- | --- | --- | --- |
| Reproducao (pos-fix), nivel handler | `npx vitest run tests/bugs/b04-pagamento-grupo-indisponivel.test.js` (de `J:\Cotea`) | pass | 17 casos cobrindo os cenarios do assessment |
| Reproducao E2E real (Mongo + UI) | - | not-run | Requer banco/rede; fora do que foi autorizado |
| Testes de cobranca/preco existentes | `npx vitest run tests/preco` | pass | `handler-pay.test.js` continua verde |
| Suite de regressao | `npx vitest run` | pass | 32 arquivos, 206 testes |
| Lint | `npx eslint pay.js join.js lib/grupo-entrada.js` | pass | sem saida |
| Testes de contrato travados | incluidos na suite completa | pass | nenhum arquivo `contract-tests.lock` foi editado |

## Output Excerpts

```
Test Files  32 passed (32)
     Tests  206 passed (206)
```

## Residual Risks

- Mongo real: o ledger foi mockado nos testes; a atomicidade estorno + `markInvoiceRefunded` depende do `registrarOperacao` real (mesmo padrao do `refund.js`).
- Corrida da ultima vaga (check-then-insert) segue nao transacional ate a V2-06; mitigada por estorno server-side.
- Fake de DB nao exercita indices unicos de `membrosGrupo`.

## Recommendation

Segurar o fechamento do item ate uma checagem manual em ambiente com Mongo real (pagar grupo cancelado/cheio e confirmar que nao ha debito, e que o `join` forcado estorna). Codigo e testes automatizados estao completos; sem regressao detectada.

## Verificação E2E (2026-11-25)

Executada com Playwright contra `next dev` local (porta 3000), sessão Google real
(`admin`) e o banco de produção `usaComigo`, com autorização do usuário. Dados de
teste com prefixo `E2E` (2 usuários, 4 grupos, recarga PIX simulada de R$ 50),
removidos ao final; saldo da carteira conferido igual ao de antes.

- `pay` em grupo cancelado → 409 `grupo_indisponivel`; grupo cheio → 409 `grupo_cheio`; grupo próprio → 409 `dono_do_grupo`; já membro → 409 `ja_membro`. Saldo e faturas inalterados (nenhuma fatura criada).
- Pagar grupo ativo, cancelar o grupo no banco e chamar `join` → 409 `grupo_indisponivel` com `estornada: true`; saldo restaurado; 1 lançamento `estorno_assinatura`.
- Pela tela `/assinatura/pagamento` (join retido 25 s e grupo cancelado no intervalo): mensagem "Grupo indisponivel para novas entradas. O pagamento foi estornado para o seu saldo."

O sintoma original não reproduz mais no ambiente real; resultado elevado de `partial` para `verified`.
