# Bug Verification: CPF aberto em listagens administrativas (B-03)

- **Slug**: b03-cpf-aberto-listagens
- **Testado**: 2026-11-24
- **Assessment**: ./assessment.md
- **Fix**: ./fix.md
- **Result**: partial

## Summary

A reprodução original foi reexecutada de forma automatizada contra os handlers reais (sessão, Mongo e auditoria mockados): CPF não sai mais em claro nem cifrado nas listagens, e só `finance`/`admin` obtêm o completo, em saque aberto. Fica `partial` porque a tela (`withdrawals.js`) e a decriptação com `ENCRYPTION_KEY`/banco reais não foram exercitadas em navegador/ambiente real.

## Checks Performed

| Checagem | Comando / Ação | Resultado | Notas |
| --- | --- | --- | --- |
| Reprodução (pós-fix), handlers | `npx vitest run tests/bugs/b03-cpf-aberto-listagens.test.js` | pass | 11 testes; chave de teste aleatória |
| Reprodução na UI | abrir `/admin/withdrawals` e `/admin` | not-run | exige banco/sessão reais |
| Regressão ledger/contratos | `npx vitest run tests/ledger tests/contract` | pass | 54 testes |
| Suite `tests/bugs` | `npx vitest run tests/bugs` | fail (não relacionado) | `b09-setup-indexes-conflito` — bug de outro agente em andamento; os demais passaram |
| Lint | `npx eslint <arquivos alterados>` | pass | sem saída |

## Output Excerpts

`Test Files 1 passed (1) · Tests 11 passed (11)`

## Residual Risks

- UI de "Ver CPF completo" não testada em navegador.
- Dados legados em plaintext são mascarados corretamente (testado), mas geram o `console.warn` do `decryptCPF`.
- Pendente decisão sobre `admin` ver CPF completo.

## Recommendation

Segurar até uma verificação manual rápida da tela de saques (finance clica em "Ver CPF completo"; support/admin de usuários vê `***.xxx.xxx-**`); depois fechar. Código e testes automatizados estão OK.
