# Bug Verification: Página de edição de grupo abre para qualquer usuário logado

- **Slug**: admin-editar-grupo-sem-permissao
- **Testado**: 2026-11-24
- **Assessment**: ./assessment.md
- **Fix**: ./fix.md
- **Result**: verified

## Summary

A reprodução foi coberta de forma automatizada (usuário comum que não é dono recebe `notFound` sem dados; sem sessão recebe redirect) e a suíte inteira passa. A reprodução manual no navegador foi feita depois, no dev server (2026-11-24): staff abre a tela com os dados, usuário comum não dono recebe 404 sem dados e quem está sem login é redirecionado para o login. Resultado: `verified`.

## Checks Performed

| Checagem | Comando / Ação | Resultado | Notas |
| --- | --- | --- | --- |
| Reprodução (pós-fix) | `tests/bugs/admin-editar-grupo-sem-permissao.test.js` (equivalente automatizado com banco em memória) | pass | Não vaza `observacoesInternas` nem e-mails. |
| Reprodução manual no navegador — usuário comum | sessão `user` não dona abrindo `/admin/grupos/6931fe0a120abf2c56b606ab` | pass | 404; `__NEXT_DATA__` sem e-mail nem `observacoesInternas`. |
| Reprodução manual no navegador — staff | sessão `admin` abrindo a mesma URL | pass | Tela de edição carrega com grupo, dono e prévia de preço (R$ 44,63 / 42,50 / 2,13). |
| Reprodução manual no navegador — sem login | `fetch` sem cookies da mesma URL | pass | Redireciona para `/auth/signin?callbackUrl=%2Fadmin%2Fgrupos%2F...`; HTML sem e-mail nem campos internos. |
| Reprodução manual no navegador — dono comum | — | not-run | Nenhuma conta de teste dona de grupo sem ser staff; coberto pelo teste automatizado. |
| Testes novos/atualizados | `npx vitest run tests/bugs` | pass | |
| Suite de regressão | `npx vitest run` | pass | 25 arquivos, 146 testes. |
| Lint | `npx eslint "pages/admin/grupos/[id].js" lib/grupos-acesso.js tests/bugs/admin-editar-grupo-sem-permissao.test.js` | pass | exit 0 |
| Travas de contrato | `check-contract-tests.ps1 -Slug 001-rotinas-agendadas / 002-ledger-segmentado / 003-preco-por-vaga` | pass | Íntegras. |
| Build | `npm run build` | skipped | Há dev server usando `.next`. |

## Output Excerpts

```
Test Files  25 passed (25)
Tests  146 passed (146)
```

## Residual Risks

- O caso "dono que não é staff" só foi exercitado no teste automatizado.
- O teste de regressão não foi executado contra o código antigo (a página tem JSX e não é importável pelo Vitest).

## Recommendation

Fechar. Checagem manual feita para usuário comum, staff e sem login.
