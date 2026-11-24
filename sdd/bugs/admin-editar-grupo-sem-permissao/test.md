# Bug Verification: Página de edição de grupo abre para qualquer usuário logado

- **Slug**: admin-editar-grupo-sem-permissao
- **Testado**: 2026-11-24
- **Assessment**: ./assessment.md
- **Fix**: ./fix.md
- **Result**: partial

## Summary

A reprodução foi coberta de forma automatizada (usuário comum que não é dono recebe `notFound` sem dados; sem sessão recebe redirect) e a suíte inteira passa. A reprodução manual no navegador com sessões reais não foi executada, por isso o resultado é `partial`.

## Checks Performed

| Checagem | Comando / Ação | Resultado | Notas |
| --- | --- | --- | --- |
| Reprodução (pós-fix) | `tests/bugs/admin-editar-grupo-sem-permissao.test.js` (equivalente automatizado com banco em memória) | pass | Não vaza `observacoesInternas` nem e-mails. |
| Reprodução manual no navegador | sessão `user` não dona abrindo `/admin/grupos/<id>` | not-run | Exige dev server, sessões reais e leitura do banco. |
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

- O `getServerSideProps` em si (com `getServerSession`) é verificado por inspeção de fonte e pela função de resolução; não foi exercitado em um servidor Next real.
- O teste de regressão não foi executado contra o código antigo (a página tem JSX e não é importável pelo Vitest).

## Recommendation

Segurar até uma checagem manual rápida no dev server (dono, usuário estranho, staff e sem login); depois fechar.
