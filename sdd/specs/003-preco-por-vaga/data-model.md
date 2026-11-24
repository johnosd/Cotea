# Data Model: Regra única de preço por vaga

Base real conferida em 2026-11-24 (dev, banco `usaComigo`): 5 grupos, todos
com `valorTotal` double > 0, `capacidadeTotal` int ≥ 2 e
`vagasReservadasAdmin = 1`; 1 membro não-dono ativo; 5 faturas (4 `paga`,
1 `estornada`). Nenhum grupo cairia em "inválido" hoje.

## `grupos` (alterado)

| Campo | Tipo | Antes | Depois |
| --- | --- | --- | --- |
| `valorTotal` | double (reais) | do body | do body, validado (> 0, até 2 casas); gravado normalizado |
| `capacidadeTotal` | int | do body, ≥ 1 | do body, inteiro ≥ 2 |
| `valorPorVaga` | double (reais) | **do body** | calculado: `round((T/C)·1,05)` — preço pago pelo membro |
| `repassePorVaga` | double (reais) | — | **novo**: `round(T/C)` — repasse ao dono por membro (= parte do dono) |
| `taxaPorVaga` | double (reais) | — | **novo**: `valorPorVaga − repassePorVaga` — taxa Cotea por membro |
| `precoValido` | bool | — | **novo**: `true` quando o trio foi calculado pela regra; `false` em legado que a migração não pôde calcular |
| `vagasReservadasAdmin` | int | do body (0…C) | sempre `1` (vaga do dono) |
| `vagasDisponiveis` | int | do body ou `C − reservadas` | criação: `C − 1`; edição: `max(C − participantes, 0)`; body ignorado |

Invariantes: `precoValido === true` ⇒ `repassePorVaga + taxaPorVaga ===
valorPorVaga` (em centavos) e `repassePorVaga ≥ 0,01`. Grupo com
`precoValido !== true` não é cobrado nem exibe preço.

Campos legados não usados para preço: `preco` (fallback antigo em
`pages/index.js` e `pages/grupos/[id].js`) — deixa de ser lido; não é apagado.

`database/schemas/grupos.schema.json`: acrescentar `repassePorVaga`
(number), `taxaPorVaga` (number), `precoValido` (bool). Nenhum campo vira
`required` (o validator está ativo em `setupDatabase.js`; não exigir nada novo
evita quebrar grupos antigos durante a janela de implantação). Sem índice novo.

## `invoices` (alterado)

| Campo | Tipo | Depois |
| --- | --- | --- |
| `amount` | number (reais) | = `valorPorVaga` vigente no momento da emissão (como hoje, sem fallback) |
| `composicao` | object | **novo**, só em faturas emitidas após esta feature: `{ repasseDono: number, taxaCotea: number }` em reais, congelados na emissão; `repasseDono + taxaCotea === amount` |

Faturas antigas ficam sem `composicao` e não são alteradas (FR-016).
Fatura existente (paga via `invoiceId`) é cobrada pelo próprio `amount`, não
pelo preço atual do grupo.

`database/schemas/invoices.schema.json`: acrescentar `composicao` com
`repasseDono` e `taxaCotea` (number).

## `auditLogs` (só conteúdo)

- `grupo.created.details`: `{ nome, categoria, valorTotal, capacidade,
  valorPorVaga, repassePorVaga, taxaPorVaga }`.
- `grupo.updated.details`: `{ nome, status, categoria, preco: { antes:
  {valorTotal, capacidade, valorPorVaga, repassePorVaga, taxaPorVaga},
  depois: {…} } }`.
- Migração: uma entrada `grupo.preco_migrado` por grupo alterado
  (`details: { antes, depois, acao }`), `actorId:
  'script:migrar-precos-grupos'`, inserida direto em `auditLogs` no mesmo
  formato de `lib/audit.js` (`_id: randomUUID()`, `createdAt`) — o script usa
  `MongoClient` próprio e não importa `lib/mongodb.js`, como
  `scripts/migrar-ledger-categorias.js`.

## Migração (`scripts/migrar-precos-grupos.js`)

- Lê todos os `grupos` (projeção: `_id, nome, valorTotal, capacidadeTotal,
  valorPorVaga, repassePorVaga, taxaPorVaga, precoValido,
  vagasReservadasAdmin`).
- `planejarMigracaoPrecos` → aplica `$set` só onde `set !== null`.
- Dry-run por padrão; `--aplicar` grava. Relatório: atualizados (antes →
  depois), inalterados (contagem), inválidos (nome + motivo).
- Não toca `invoices`, `payments`, `membrosGrupo`, `walletTransactions`.
- `vagasDisponiveis` não é recalculado pela migração (é derivado no ingresso
  e na próxima edição).
