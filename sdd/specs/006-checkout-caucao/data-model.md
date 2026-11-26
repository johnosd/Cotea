# Data Model: Checkout v2 com caução

Valores em reais com 2 casas (`normalizeAmount`); toda aritmética em centavos
inteiros. Campo ausente = documento anterior à feature: **nunca** inventar valor
nem migrar membros antigos (FR-024).

## `membrosGrupo` (participação)

Continua sendo **apagada fisicamente** na saída (índice único
`{ grupoId, userId }` permanece). O histórico fica na fatura (abaixo).

Campos existentes que a entrada continua gravando: `_id`, `grupoId`, `userId`
(ObjectId), `papel: 'membro'`, `status: 'ativo'`, `aguardandoEnvioAcesso: true`,
`dataEntrada`, `createdAt`, `invoiceId` (string, `_id` da fatura),
`valorPago` (total pago), `pagamentoStatus: 'paga'`, `pagamentoData`,
`temCaucao`.

Campos novos:

| Campo | Formato | Observação |
| --- | --- | --- |
| `mensalidade` | number | valor por vaga cobrado |
| `fidelidade` | `{ periodoMeses }` | cópia da fidelidade do grupo na entrada; omitido se o grupo não tem |
| `vinculo` | `'amigo' \| 'familia' \| 'conhecido' \| 'desconhecido'` | FR-010 |
| `aceiteRegras` | `{ versao: string, em: Date }` | FR-009 |
| `caucao` | `{ valor, situacao, devolvidaEm? }` | `situacao`: `bloqueada` → `devolvida` |
| `retencao` | `{ valor, situacao, em? }` | só em grupo `apos_completar` não lotado; `valor` = mensalidade + taxa |

`temCaucao` = `true` enquanto `caucao.situacao === 'bloqueada'`.

`retencao.situacao`:

| Situação | Significado |
| --- | --- |
| `retida` | lançamento em `retido_entrada` ainda existe |
| `a_liberar` | o grupo lotado está sendo excluído: já tem direito à liberação, lançamento ainda não feito |
| `liberada` | consumida (débito em `retido_entrada`, sem crédito) |
| `devolvida` | voltou ao saldo `pessoal` |

Uma retenção `retida` **já conta como liberada** quando
`aguardandoEnvioAcesso === false` ou o grupo já lotou (logic §6): o campo é
atualizado depois, junto com o lançamento.

## `grupos`

| Campo novo | Formato | Observação |
| --- | --- | --- |
| `versaoParticipacao` | number | trava de concorrência: `$inc` em toda entrada e liquidação; usada como condição no `PUT` |
| `lotadoEm` | Date | só `apos_completar`; gravado uma única vez, quando lota (FR-028) |

Grupo lotado = `lotadoEm` presente, **ou** (`acesso === 'apos_completar'` e
`statusDetalhado === 'ativo'`) — formato legado já existente no banco.
Ao lotar grava também `statusDetalhado: 'ativo'`. Nunca grava `status` (é o
estado de moderação da 005).

## `invoices` (fatura de entrada e histórico da participação)

```js
{
  _id: '<uuid>', userId: '<string>', grupoId: '<string>',
  amount: 21,                       // total cobrado
  composicao: { repasseDono: 10, taxaCotea: 0.5, caucao: 10.5, taxaPagamento: 0 }, // soma = amount
  status: 'paga',
  description: 'Entrada no grupo <nome>',
  metadata: { grupoNome, origem: 'checkout_v2' },
  walletId, ledgerId, paidAt, createdAt, updatedAt,
  entrada: {
    chave,                          // chave de idempotência do cliente
    participacaoId: '<string>',     // = membrosGrupo._id
    mensalidade: 10.5, caucao: 10.5, taxaPagamento: 0,
    retida: false, fidelidadeMeses: 3, vinculo: 'amigo',
    aceite: { versao, em },
  },
  encerramento: {                   // gravado na liquidação ou na saída
    em, motivo,                     // saida_membro | removido_staff | grupo_encerrado | grupo_cancelado | grupo_excluido | banido
    porId,                          // string ou null (rotina)
    caucaoDevolvida: 10.5, mensalidadeDevolvida: 0,
  },
}
```

- `composicao.caucao` e `composicao.taxaPagamento` são opcionais em
  `createInvoice` (faturas antigas só têm repasse e taxa).
- `encerramento` é gravado uma vez; uma saída posterior sem movimento não o
  sobrescreve.
- Novo status: `cancelada` (faturas abertas do checkout antigo, migração).
- `aguardando_pagamento` e `aguardando_recarga` deixam de ser produzidos.
- Consulta de idempotência: `{ userId, 'entrada.chave': chave }` (usa o índice
  `userId_…` existente; sem índice novo).

## `walletTransactions` (ledger)

Sem campo novo. Todas as pernas com `organizacaoId: null`, `grupoId` e
`participacaoId` (strings). `referenceId`: id da fatura na entrada; id da
participação na liquidação e na liberação.

| `source` | `operacaoId` | Pernas |
| --- | --- | --- |
| `entrada_grupo` | `entrada_grupo:<userId>:<chave>` | débito `pessoal` (total); crédito `caucao`; crédito `retido_entrada` se retida |
| `liquidacao_participacao` | `liquidacao_participacao:<participacaoId>` | débito `caucao`; débito `retido_entrada` se pendente; crédito `pessoal` (o que volta, uma perna só) |
| `liberacao_retida` | `liberacao_retida:<participacaoId>` | débito `retido_entrada` |
| `estorno_assinatura` | `estorno_assinatura:<invoiceId>` | já existente; usado pela migração |

**Mudança de índice (D-08)**: `{ referenceId: 1, type: 1, source: 1 }` passa de
único parcial para **parcial não único** (`partialFilterExpression:
{ referenceId: { $type: 'string' } }`). A idempotência continua garantida pelo
índice único `{ operacaoId, walletId, categoria, type }`. Hoje o banco tem o
índice único: sem a troca, a entrada com retenção e a liquidação com retenção
falham com E11000.

## `notificacoesUsuario`

`_id` string determinístico (repetir não duplica), `userId` ObjectId,
`tipo: 'grupo'`, `acao: '/grupos/<id>'`, `lido: false`, `data`, `importante`.

| Evento | `_id` | Destinatário |
| --- | --- | --- |
| Entrada | `checkout:entrada:<participacaoId>:dono` / `:membro` | dono e membro |
| Grupo lotado | `checkout:lotado:<grupoId>:<userId>` | dono e membros atuais |
| Devolução (total > 0) | `checkout:devolucao:<participacaoId>` | membro |

## Auditoria (`logAudit`, sempre depois do commit)

| `action` | `targetCollection` | `details` |
| --- | --- | --- |
| `assinatura.paid` | `invoices` | `grupoId`, `participacaoId`, `amount`, `caucao`, `retida`, `ledgerId` |
| `caucao.devolvida` | `invoices` | `grupoId`, `participacaoId`, `caucao`, `mensalidade`, `motivo` |
| `mensalidade.liberada` | `invoices` | `grupoId`, `participacaoId`, `valor` |
| `grupo.saida` | `membrosGrupo` | `grupoId`, `userId`, `motivo` |

## Arquivos de schema e índice a atualizar (Constitution IV)

`database/schemas/membrosGrupo.schema.json`, `invoices.schema.json`,
`grupos.schema.json`, `database/setupDatabase.js`, `database/setup-indexes.js`.
Os validadores **estão aplicados** no banco (`validationLevel: moderate`): os
campos novos entram como opcionais e sem `additionalProperties: false`.

## Dados reais em 2026-11-26 (`usaComigo`, leitura)

- 5 grupos aprovados: 4 `imediato`, 1 `apos_completar` já lotado
  (`statusDetalhado: 'ativo'`, 2/2). Um grupo não tem o documento de membro do
  dono.
- 1 membro não dono, ativo, **sem caução e sem fatura** vinculada.
- Faturas: 3 pagas sem participação (dez/2025, R$ 42,50 cada, mesmo usuário e
  grupo, débito no ledger), 1 paga já vinculada a uma participação encerrada,
  1 estornada. Nenhuma aberta.
