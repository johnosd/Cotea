# Bug Verification: setup-indexes.js conflita com setupDatabase.js

- **Slug**: b09-setup-indexes-conflito
- **Testado**: 2026-11-24
- **Assessment**: ./assessment.md
- **Fix**: ./fix.md
- **Result**: verified

## Summary

A causa (definições divergentes do mesmo índice) não existe mais e o teste estático trava a regressão. O resultado é
`partial` porque a reprodução real (executar o script contra um MongoDB com o índice já criado) não foi rodada: sem
banco/rede e proibido por regra desta tarefa.

## Checks Performed

| Checagem | Comando / Ação | Resultado | Notas |
| --- | --- | --- | --- |
| Reprodução (pós-fix) | executar `setup-indexes.js` contra MongoDB | pass | executado em 2026-11-24 com autorização do usuário (ver abaixo) |
| Testes novos | `npx vitest run tests/bugs/b09-setup-indexes-conflito.test.js` | pass | 7/7; falha 3 casos contra o código antigo |
| Suite de regressão | `npx vitest run` (de `J:\Cotea`) | pass | 31 arquivos, 189 testes |
| Contratos SDD | `npm run test:contrato` | pass | 15/15 |
| Sintaxe/lint | `node --check` nos 2 scripts; `npx eslint` em setup-indexes e no teste | pass | sem achados |

## Output Excerpts

```
tests/bugs/b09-setup-indexes-conflito.test.js  Tests 7 passed (7)
Test Files 31 passed (31) | Tests 189 passed (189)
```

## Residual Risks

- Não validado contra servidor MongoDB real (IndexKeySpecsConflict depende do estado do banco).
- Em bancos com duplicatas de `(referenceId,type,source)`, o único parcial falha com E11000 (já vale para D).
- Risco latente do índice legado com operações multi-perna (ver fix.md, Follow-ups).

## Recommendation

Fechar o conflito (corrigido e travado por teste), mantendo ciência de que a execução real continua não verificada;
rodar `node --env-file=.env.local database/setup-indexes.js` no dev, com autorização, confirma de ponta a ponta.
O risco latente do índice legado deve ir para decisão do usuário.

## Verificação contra o banco (2026-11-24)

Com autorização explícita do usuário, executado contra o Atlas apontado por `.env.local`
(banco `usaComigo`, o mesmo da produção):

1. `node database/setupDatabase.js` — validators atualizados e índices criados; saída "Banco configurado com sucesso!".
2. `node --env-file=.env.local database/setup-indexes.js` — "Índices criados com sucesso." (antes do fix abortava
   com `IndexKeySpecsConflict`, code 86).

O sintoma original não reproduz mais; resultado elevado (antes: partial) de `partial` para `verified`.
