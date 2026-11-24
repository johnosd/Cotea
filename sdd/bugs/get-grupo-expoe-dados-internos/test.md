# Bug Verification: GET /api/grupos/[id] expõe dados internos sem sessão

- **Slug**: get-grupo-expoe-dados-internos
- **Testado**: 2026-11-24
- **Assessment**: ./assessment.md
- **Fix**: ./fix.md
- **Result**: verified

## Summary

A reprodução (GET anônimo contra o handler real, banco em memória) deixou de devolver
`observacoesInternas`, `necessitaAnalise`, e-mails, `participantesIds` e `imageKey`; os campos de preço
usados por `pagamento.js` continuam presentes. Suíte completa e travas íntegras.

## Checks Performed

| Checagem | Comando / Ação | Resultado | Notas |
| --- | --- | --- | --- |
| Reprodução (pós-fix) | `npx vitest run tests/bugs` | pass | 13 testes, handler real com sessão/Mongo mockados |
| Suite de regressão | `npx vitest run` (de `J:\Cotea`) | pass | 25 arquivos, 146 testes |
| Lint | `npx eslint "pages/api/grupos/[id].js" lib/grupo-publico.js tests/bugs/get-grupo-expoe-dados-internos.test.js` | pass | exit 0 |
| Travas de contrato | `check-contract-tests.ps1 -Slug 001-rotinas-agendadas / 002-ledger-segmentado / 003-preco-por-vaga` | pass | 5 testes cada, travas íntegras |
| Falha do teste no código antigo | não executado | not-run | evitado mexer no arquivo em uso por outro agente; o código antigo devolvia `...grupo`, o que as asserções de ausência cobrem por leitura |
| Chamada real HTTP / build | não executado | skipped | há dev server usando `.next`; build proibido pela tarefa |

## Output Excerpts

`Test Files 25 passed (25) / Tests 146 passed (146)`

## Residual Risks

- Sem validação manual em navegador contra o dev server.
- Acesso staff baseado na sessão JWT (sem recarregar o usuário do banco).

## Recommendation

Fechar. Verificado por testes automatizados do handler real; sem prova de falha no código antigo
(not-run), o que não muda o veredito pois a ausência dos campos é asserida diretamente.
