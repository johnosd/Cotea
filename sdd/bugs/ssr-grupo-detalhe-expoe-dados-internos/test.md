# Bug Verification: SSR de /grupos/[id] expõe dados internos e e-mails a qualquer visitante

- **Slug**: ssr-grupo-detalhe-expoe-dados-internos
- **Testado**: 2026-11-26
- **Assessment**: ./assessment.md
- **Fix**: ./fix.md
- **Result**: verified

## Summary

A reprodução (chamar o `getServerSideProps` real da página como anônimo e como usuário comum
com banco em memória) deixou de devolver campos internos, e-mails e IDs; dono e staff continuam
com a visão completa. Suíte completa sem regressão (só os 5 testes vermelhos de propósito da
feature 005), lint e build verdes, travas de contrato íntegras.

## Checks Performed

| Checagem | Comando / Ação | Resultado | Notas |
| --- | --- | --- | --- |
| Reprodução (pós-fix) | `npx vitest run tests/bugs/ssr-grupo-detalhe-expoe-dados-internos.test.js` | pass | 15/15, `getServerSideProps` real com sessão/Mongo mockados |
| Reprodução no código antigo | mesmo teste contra a página de `HEAD` (arquivo restaurado depois) | pass (falha esperada) | 13 de 15 falharam; os 2 verdes são `notFound` |
| Suite de regressão | `npx vitest run` (de `J:\Cotea`) | pass | 44 arquivos verdes; 295 testes verdes e 5 vermelhos, todos em `tests/contract/005-aprovacao-grupos.contract.test.js` (feature não implementada: `expected 200 to be 404`, `not implemented` x2, `expected 200 to be 409`, criação ainda aceita status do cliente) |
| Lint | `npx eslint "pages/grupos/[id].js" lib/grupo-visao-servidor.js tests/bugs/ssr-grupo-detalhe-expoe-dados-internos.test.js vitest.config.mjs` e `npm run lint` | pass | 0 erros; 1 warning pré-existente em `pages/grupos/[id].js` (`dados` em `useMemo`) |
| Build | `npm run build` | pass | `/grupos/[id]` compila como rota dinâmica |
| Travas de contrato | `check-contract-tests.ps1 -Slug 005-aprovacao-grupos / 001-rotinas-agendadas / 002-ledger-segmentado / 003-preco-por-vaga / 004-cadastro-financeiro` | pass | 5 testes cada, travas íntegras |
| Navegação real (fluxo participar/pagar, área do dono) | não executado | not-run | sem navegador/dev server nesta execução; coberto por leitura do componente e pelos testes de `visao` |

## Output Excerpts

`Test Files 1 failed | 44 passed (45) / Tests 5 failed | 295 passed (300)` (os 5 falhos: contrato 005).

## Residual Risks

- Sem validação manual no navegador do fluxo "Assinar"/"Enviar acessos"; a UI agora lê `visao`
  (`jaMembro`, `souAdmin`) em vez de e-mail/IDs, e a conferência de membro via
  `GET /api/grupos/[id]/join` foi mantida.
- Regra de dono/staff duplicada entre `lib/grupo-visao-servidor.js` e `podeVerCamposInternos` da API
  (a API não foi tocada por estar em edição pela feature 005).
- `vitest.config.mjs` ganhou `oxc` para JSX em `pages/`/`components/`; os demais testes passaram.

## Recommendation

Fechar. Verificado por teste automatizado do `getServerSideProps` real, com prova de falha no
código antigo. Ao implementar T012/T013 da 005, reusar `identificarVisaoGrupo` e manter `moderacao`
fora das props públicas.
