# Bug Verification: Entrada em grupo sem pagamento via /participar

- **Slug**: b01-entrada-sem-pagamento
- **Testado**: 2026-11-24
- **Assessment**: ./assessment.md
- **Fix**: ./fix.md
- **Result**: verified

## Summary

A rota não insere mais membro: responde 410 para usuário comum, staff e anônimo. O teste de regressão falha contra o código
original e passa com o fix; a suite completa passa. Verificação em handler com banco em memória, sem banco/rede reais.

## Checks Performed

| Checagem | Comando / Ação | Resultado | Notas |
| --- | --- | --- | --- |
| Reprodução (pós-fix) | handler chamado com sessão validada (POST) em db em memória | pass | 410, `membrosGrupo` vazio |
| Reprodução (pré-fix, controle) | mesmo teste contra `git show HEAD:pages/api/grupos/[id]/participar.js` | fail (esperado) | 200 com membro criado; arquivo restaurado depois |
| Testes novos | `npx vitest run tests/bugs/b01-entrada-sem-pagamento.test.js` | pass | 3/3 |
| Suite de regressão | `npx vitest run` | pass | 27 arquivos, 153 testes |
| Consumidores no front | grep `participar` em pages/components/lib/tests | pass | só texto de UI; nenhum fetch |
| Lint | `npx eslint` nos 2 arquivos | pass | exit 0, sem avisos |

## Output Excerpts

```
Test Files  27 passed (27)
Tests  153 passed (153)
```

## Residual Risks

- Não testado contra servidor Next real nem banco real (fora das regras desta execução).
- Clientes externos que usassem a rota passam a receber 410.

## Recommendation

Fechar o B-01 (atualizar o painel/backlog pelo agente principal). A entrada definitiva com caução permanece para V2-06.
