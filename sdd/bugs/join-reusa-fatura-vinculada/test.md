# Bug Verification: join reusa fatura paga ja vinculada

- **Slug**: join-reusa-fatura-vinculada
- **Testado**: 2026-11-24
- **Assessment**: ./assessment.md
- **Fix**: ./fix.md
- **Result**: partial

## Summary

A reproducao automatizada (handler real `join` com sessao/Mongo em memoria: entrar, sair via DELETE, reentrar com a mesma fatura) nao reproduz mais o sintoma: 409 `fatura_ja_utilizada`, sem membro e sem estorno. `partial` porque nao houve execucao contra Mongo real/navegador (rede/banco nao autorizados).

## Checks Performed

| Checagem | Comando / Acao | Resultado | Notas |
| --- | --- | --- | --- |
| Reproducao (pos-fix), nivel handler | `npx vitest run tests/bugs/join-reusa-fatura-vinculada.test.js` (de `J:\Cotea`) | pass | 9 casos; 4 falham com o guard neutralizado |
| Regressao B-04 e B-02 | `npx vitest run tests/bugs` | pass | 10 arquivos, 94 testes (inclui b04 "ja e membro -> 200" e "vinculada + grupo cancelado -> 409 estornada:false", e b02) |
| Suite completa | `npx vitest run` | pass | 34 arquivos, 226 testes (inclui contratos travados) |
| Lint | `npx eslint` join.js + teste novo | pass | sem saida |
| Reproducao E2E real (Mongo + UI) | - | not-run | exige banco/rede |

## Output Excerpts

```
Test Files  34 passed (34)
     Tests  226 passed (226)
```

## Residual Risks

- Fake de DB nao exercita indices unicos de `membrosGrupo` nem concorrencia real.
- Corrida de duas chamadas simultaneas com a mesma fatura segue check-then-insert.

## Recommendation

Fechar apos uma checagem manual com Mongo real (entrar, sair, reentrar com a mesma fatura deve dar 409; pagar de novo deve permitir). Sem regressao detectada.
