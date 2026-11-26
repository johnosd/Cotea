# Bug Fix: setup-indexes.js conflita com setupDatabase.js

- **Slug**: b09-setup-indexes-conflito
- **Corrigido**: 2026-11-24
- **Assessment**: ./assessment.md
- **Status**: applied

## Summary

Fonte de verdade definida como `database/setupDatabase.js`. `setup-indexes.js` passou a pedir
`walletTransactions { referenceId, type, source }` como único parcial (igual a D), eliminando o
`IndexKeySpecsConflict`; os índices que só existiam em `setup-indexes.js` foram incorporados a
`setupDatabase.js` para que ele seja superconjunto (constituição IV).

## Changes

| Arquivo | Mudança | Notas |
| --- | --- | --- |
| `database/setup-indexes.js` | modified | índice `{referenceId,type,source}` único parcial; cabeçalho aponta a fonte de verdade e o teste |
| `database/setupDatabase.js` | modified | +9 índices: grupos `{categoria,status}`; membrosGrupo `{userId,status}`, `{grupoId,papel}`, `{grupoId,userId,papel}`; invoices `{userId,grupoId}`; walletTransactions `{walletId,type,status}`; rateLimits TTL; notificacoesUsuario `{userId,lido}`; auditLogs `{createdAt:-1}` (seção 17) |
| `tests/bugs/b09-setup-indexes-conflito.test.js` | added | regressão estática (sem banco) |

## Tests Added or Updated

- `tests/bugs/b09-setup-indexes-conflito.test.js` (7 casos): extrai todos os `createIndex` dos dois scripts e trava
  (a) `{referenceId,type,source}` único parcial nos dois, (b) mesma chave => mesmas opções, (c) todo índice de S existe
  em D, (d) índices do ledger segmentado (`operacaoId` único parcial, `{walletId,categoria,status}`) idênticos,
  (e) TTLs iguais. Contra o código antigo, 3 dos casos de comparação falham (verificado revertendo temporariamente
  os dois arquivos para `HEAD`; restaurados em seguida).

## Local Verification

- `npx vitest run tests/bugs/b09-setup-indexes-conflito.test.js` (de `J:\Cotea`) → 7/7.
- `node --check` nos dois scripts → ok; `npx eslint database/setup-indexes.js tests/bugs/b09-...test.js` → sem achados.
- Nenhum script foi executado contra banco.

## Deviations from Assessment

Nenhuma.

## Follow-ups

- Decisão do usuário (risco latente, não alterado): o único legado `{referenceId,type,source}` colide em operações
  multi-perna futuras do ledger que repitam `type` com o mesmo `referenceId`/`source` (ex.: crédito ao dono + crédito
  `receita_taxa`). A idempotência hoje é garantida por `operacaoId`; avaliar trocá-lo por índice não único.
- Melhoria futura: extrair a lista de índices para um módulo único consumido pelos dois scripts.
- Rodar `setupDatabase.js` (ou `setup-indexes.js`) no dev só com autorização do usuário para materializar os 9 índices novos.
- `setup-indexes.js` usa ESM sem `"type": "module"`; funciona no Node 22, não em versões antigas.
