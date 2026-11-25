# Bug Verification: Usuario bloqueado consegue criar grupo (B-05)

- **Slug**: b05-bloqueado-cria-grupo
- **Testado**: 2026-11-24
- **Assessment**: ./assessment.md
- **Fix**: ./fix.md
- **Result**: verified

## Summary

O sintoma nao reproduz mais: bloqueado (por banco ou sessao) recebe 403 e nada e gravado; nao bloqueado e legado continuam com 201. Reproducao feita no handler real com banco/sessao em memoria (sem rede nem banco real).

## Checks Performed

| Checagem | Comando / Acao | Resultado | Notas |
| --- | --- | --- | --- |
| Reproducao (pos-fix) | `npx vitest run tests/bugs/b05-bloqueado-cria-grupo.test.js` (em `J:\Cotea`) | pass | 4/4; os 2 casos de bloqueio falham com a checagem desativada (mutacao) |
| Testes novos/atualizados | idem | pass | |
| Suite de regressao | `npx vitest run tests/preco/handlers-grupos.test.js` | pass | 5/5 (POST/PUT de grupos). Suite completa nao rodada por haver outros agentes alterando a arvore |
| Lint | `npx eslint pages/api/grupos/index.js tests/bugs/b05-bloqueado-cria-grupo.test.js` | pass | sem avisos |
| Verificacao E2E real (HTTP + Mongo) | — | not-run | requer banco/rede |

## Output Excerpts

`Tests 4 passed (4)`; sem a correcao: `Tests 2 failed | 2 passed (4)`.

## Residual Risks

- Nao validado contra Mongo real nem via navegador; o fake em memoria cobre o handler.
- Aviso proativo na tela de criacao nao implementado (fora de escopo); o usuario ve o erro 403 ao enviar.
- Contradicao nas regras (linha 545 vs 242) sobre bloqueado entrar em grupo permanece em aberto.

## Recommendation

Fechar B-05 como corrigido. Opcionalmente tratar o aviso na tela e esclarecer a regra da linha 545.
