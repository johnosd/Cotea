# Bug Verification: Leitura de `.value` em `findOneAndUpdate` com driver 6.x (B-06)

- **Slug**: b-06-leitura-value-findoneandupdate-driver-6x
- **Testado**: 2026-11-24
- **Assessment**: ./assessment.md
- **Fix**: ./fix.md
- **Result**: partial

## Summary

A reprodução automatizada (fake em memória fiel ao contrato do driver 6) falha no código original e passa com o fix; nenhuma regressão atribuível ao fix. Fica `partial` porque a reprodução não foi executada contra MongoDB/handlers reais (sem rede/banco, por regra), e a suíte completa tem 1 falha de outro agente (B-09).

## Checks Performed

| Checagem | Comando / Ação | Resultado | Notas |
| --- | --- | --- | --- |
| Reprodução (pré-fix) | reverter temporariamente `lib/invoices.js` e `block.js` ao HEAD e rodar o teste novo | fail (7/7) | confirma que o teste trava o bug |
| Reprodução (pós-fix) | `npx vitest run tests/bugs/findoneandupdate-value-driver6.test.js` | pass (7/7) | fake de `db-grupos-memoria.js` devolve doc/null como o driver 6 |
| Contrato do driver | leitura de `node_modules/mongodb/lib/operations/find_and_modify.js:86` (v6.16.0) | pass | `includeResultMetadata ? result : (result.value ?? null)` |
| Contra Mongo real / servidor Next | - | not-run | exige banco/rede |
| Regressão relevante | `npx vitest run tests/preco tests/ledger tests/bugs/findoneandupdate-value-driver6.test.js` | pass | 13 arquivos / 70 testes |
| Suite completa | `npx vitest run` (de `J:\Cotea`) | partial | 188/189; falha só em `tests/bugs/b09-setup-indexes-conflito.test.js` ("TTLs ... iguais nos dois"), de outro agente, arquivo `database/setup-indexes.js` fora do escopo |
| Lint | `npx eslint lib/invoices.js "pages/api/admin/users/[id]/block.js" tests/bugs/findoneandupdate-value-driver6.test.js` | pass | exit 0 |

## Output Excerpts

```
Test Files  13 passed (13)
Tests  70 passed (70)
```
Suíte completa: `Test Files 1 failed | 30 passed (31)`, falha em b09 (não relacionada).

## Residual Risks

- Sem verificação ponta a ponta com MongoDB Atlas (PUT real em `/api/admin/users/:id/block`, fluxo real de assinatura).
- `markInvoiceRefunded` retorna `null` em vez de lançar para fatura inexistente (ver fix.md, Follow-ups).

## Recommendation

Fechar após o agente principal confirmar que a falha de B-09 é independente (já deve ser resolvida pelo outro agente), idealmente com um teste manual rápido do bloqueio de usuário no ambiente de desenvolvimento. Backlog/painel de status pendentes (agente principal).
