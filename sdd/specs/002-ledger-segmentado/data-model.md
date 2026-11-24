# Data Model: Ledger segmentado e saldo sacável

**Slug**: `002-ledger-segmentado` | Coleções reais no banco `usaComigo` (MongoDB Atlas).

Estado real conferido em 2026-11-24: 13 lançamentos em 3 carteiras, todos com
`walletId` string e nenhum com categoria. Combinações existentes:

| type | status | source | n |
| --- | --- | --- | --- |
| debit | confirmed | assinatura_grupo | 5 |
| credit | confirmed | pix | 5 |
| credit | confirmed | estorno_assinatura | 1 |
| debit | confirmed | uso_saldo | 1 |
| debit | blocked | saque | 1 |

Uma carteira soma hoje `0.6799999999999997` (centavos fantasmas): o novo
cálculo em centavos inteiros devolve `0.68`.

## `walletTransactions` (alterada)

| Campo | Tipo | Regra |
| --- | --- | --- |
| `_id` | string (UUID) | como hoje |
| `walletId` | string | como hoje; `'plataforma'` para a conta do Cotea |
| `type` | `'credit'` \| `'debit'` | como hoje |
| `amount` | number > 0, 2 casas | como hoje (normalizado) |
| `status` | `'confirmed'` \| `'blocked'` \| `'pending'` \| `'cancelled'` | como hoje |
| `source` | string | como hoje (`pix`, `uso_saldo`, `assinatura_grupo`, `estorno_assinatura`, `saque`, novos: `liberacao_recebivel`, `movimentacao`, ...) |
| `referenceId` | string \| null | como hoje |
| **`categoria`** | enum | **novo, obrigatório**: `pessoal`, `caucao`, `retido_entrada`, `recebivel_retido`, `disputa`, `receita_taxa` |
| **`organizacaoId`** | string \| null | **novo, obrigatório** (campo presente); `null` = público. Sempre `null` nesta feature |
| **`grupoId`** | string \| null | **novo**; obrigatório em `caucao`, `retido_entrada`, `recebivel_retido`, `disputa`. String do `_id` (ObjectId) do grupo |
| **`participacaoId`** | string \| null | **novo**; id do documento de `membrosGrupo`, quando houver |
| **`operacaoId`** | string | **novo, obrigatório em lançamentos novos**: chave de idempotência da operação. Convenção: `<source>:<referenceId>` (ex.: `pix:<paymentId>`, `saque:<withdrawalId>`, `assinatura_grupo:<invoiceId>`, `estorno_assinatura:<invoiceId>`); sem referência: `uso_saldo:<uuid>`; movimentações: definidas pela feature que move (ex.: `liberacao:<participacaoId>:<ciclo>`) |
| **`pernasTotal`** | int ≥ 1 | **novo**: quantos lançamentos a operação gravou (conferência de operação incompleta, FR-019) |
| `description` | string | opcional, como hoje |
| `createdAt` | date | como hoje |

### Semântica dos saldos (derivados, nunca armazenados)

Por carteira, com valores em centavos inteiros:

- `net(cat)` = Σ créditos `confirmed` − Σ débitos `confirmed` da categoria.
- `saqueEmAndamento` = Σ débitos `blocked` (só existem em `pessoal`).
- `disponivel` = `sacavel` = `net(pessoal)` − `saqueEmAndamento`.
- `total` = Σ `net(cat)` de todas as categorias (débitos `blocked` não reduzem o total, como hoje).
- `categorias[c].valor` = `net(c)` para `c` ∈ {caucao, retido_entrada, recebivel_retido, disputa}, com `porGrupo` por (`grupoId`, `participacaoId`), omitindo grupos zerados.
- `receitaTaxa` = `net(receita_taxa)` (só não nulo na conta da plataforma).
- `pending` e `cancelled` não entram em nada.

"Saque em andamento" é a categoria **de apresentação** exigida pela spec
(FR-001/FR-004/FR-014); no armazenamento ele é o débito `blocked` de `pessoal`,
mantendo a máquina de estados atual do saque (`blocked` → `confirmed` na
aprovação, → `cancelled` na rejeição). Ver D-01.

### Índices

- Mantidos: `{ walletId: 1, createdAt: -1 }`, `{ status: 1 }`,
  `{ referenceId: 1, type: 1, source: 1 }` único parcial (`referenceId` string).
- **Novo**: `{ operacaoId: 1, walletId: 1, categoria: 1, type: 1 }` único parcial
  (`operacaoId` string) — rede de segurança da idempotência (D-05).
- **Novo**: `{ walletId: 1, categoria: 1, status: 1 }` (cálculo de saldo por categoria
  e rotina de consistência). Substitui na prática o `{ walletId, type, status }`
  de `setup-indexes.js`, que pode ficar.

### Migração dos legados (D-10)

Para todo documento sem `categoria`:

- `categoria = 'pessoal'`, `organizacaoId = null`, `grupoId = null`, `participacaoId = null`, `pernasTotal = 1`;
- `operacaoId = '<source>:<referenceId>'` se `referenceId` for string, senão `'legado:<_id>'`.

O débito `blocked` de saque legado fica `pessoal`/`blocked` com
`operacaoId = 'saque:<withdrawalId>'`, então aprovar/rejeitar funciona pelo
núcleo. Resumo por carteira antes = depois (SC-001), conferido pelo próprio
script.

## `wallets` (alterada)

| Campo | Tipo | Regra |
| --- | --- | --- |
| `_id`, `userId`, `status`, `createdAt` | — | como hoje |
| **`versaoLedger`** | int | **novo, opcional**: incrementado dentro da transação por toda operação que debita a carteira; é a trava por carteira (D-04). Ausente = 0 |
| **`tipo`** | `'usuario'` \| `'plataforma'` | **novo, opcional**; ausente = usuário |

### Conta da plataforma (D-07)

Documento fixo: `{ _id: 'plataforma', userId: 'cotea:plataforma', tipo: 'plataforma', status: 'active' }`.
O `userId` sintético existe porque `wallets.userId` tem índice único não
esparso. Criado por upsert em `database/setupDatabase.js` e garantido em
código (`garantirContaPlataforma`). Só aceita a categoria `receita_taxa`, e
`receita_taxa` só existe nela.

## Coleções reutilizadas

- `withdrawals`: sem mudança de formato; aprovação/rejeição passam a mudar o
  status na mesma transação do lançamento.
- `rotinaItens`/`rotinaExecucoes` (001): rotina nova `ledger-consistencia`.
- `notificacoesUsuario` + `auditLogs`: alerta de inconsistência.
