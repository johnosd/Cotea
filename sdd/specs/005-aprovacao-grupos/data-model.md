# Data Model: 005-aprovacao-grupos

Estado real conferido no MongoDB (banco `usaComigo`, 2026-11-26): 5 grupos, todos
`status: 'ativo'`, `tipoGrupo: 'publico'`, `statusDetalhado` `em_formacao` (4) ou
`ativo` (1), nenhum com `moderacao`.

## `grupos.status` (D-01)

| Valor | Significado | Público? | Aceita entrada/cobrança? | Dono edita? |
| --- | --- | --- | --- | --- |
| `em_aprovacao` | aguardando decisão do admin (prazo correndo) | não | não | não |
| `ajustes` | admin pediu ajuste; dono corrige e reenvia | não | não | sim |
| `rejeitado` | final; não volta para a fila | não | não | não |
| `ativo` | aprovado (manual, automático ou legado) | sim | sim (regras atuais) | sim (regras atuais) |
| `cancelado` | final; cancelamento lógico (desistência ou Cotea) | não | não | não |
| *(ausente)* | legado: conta como `ativo` (D-02) | sim | sim | sim |
| outro valor (ex.: `inativo`) | desconhecido: fora do ar | não | não | — |

`statusDetalhado` não muda nesta feature (V2-07). A criação grava
`em_formacao`, ignorando o cliente.

## `grupos.moderacao` (subdocumento novo, D-03)

```js
moderacao: {
  envio: 1,                       // Int: nº do envio atual (1 na criação, +1 a cada reenvio; 0 = legado migrado)
  enviadoEm: Date,                // instante do envio atual — base do prazo (null no legado)
  revisaoPendente: false,         // true só após aprovação automática, até confirmar/reprovar a revisão
                                  // → a V2-11 retém o repasse enquanto for true
  aprovacao: null | {             // última aprovação
    tipo: 'manual' | 'automatica' | 'legado',
    em: Date,
    porId: string | null,         // null quando automatica/legado
  },
  revisao: null | { porId: string, em: Date, resultado: 'confirmada' | 'reprovada' },
  ultimaDecisao: null | {         // o que o dono vê (FR-022)
    acao: string,                 // ACOES_MODERACAO
    texto: string | null,         // ajuste/motivo (trim, 1..1000)
    porId: string | null,
    em: Date,
  },
  cancelamento: null | {          // só quando status = 'cancelado'
    origem: 'dono' | 'cotea',
    motivo: string | null,
    porId: string | null,
    em: Date,
  },
  historico: [                    // append-only, $push com $slice: -100 (HISTORICO_MODERACAO_MAX)
    { acao, de, para, texto, porId, automatico, envio, em },
  ],
}
```

`acao` do histórico: `enviado` (criação), `migrado`, e os valores de
`ACOES_MODERACAO` (`aprovar`, `pedir_ajuste`, `rejeitar`, `aprovar_automatico`,
`confirmar_revisao`, `reprovar_revisao`, `cancelar`, `reenviar`, `desistir`).

Os campos ficam **fora** de `CAMPOS_PUBLICOS_GRUPO` (`lib/grupo-publico.js`),
exceto `status`, que já é público. O dono e o staff recebem `moderacao` pela
visão completa (que já existe para eles).

## Grupo recém-criado

```js
{ status: 'em_aprovacao', statusDetalhado: 'em_formacao',
  moderacao: { envio: 1, enviadoEm: agora, revisaoPendente: false, aprovacao: null,
               revisao: null, ultimaDecisao: null, cancelamento: null,
               historico: [{ acao: 'enviado', de: null, para: 'em_aprovacao', texto: null,
                             porId: <dono>, automatico: false, envio: 1, em: agora }] } }
```

## Migração (`scripts/migrar-moderacao-grupos.js`, D-13)

Só grupos **sem** `moderacao` (idempotente):

| Antes | Depois |
| --- | --- |
| `status: 'ativo'` | mantém; `moderacao` com `envio: 0`, `enviadoEm: null`, `aprovacao: { tipo: 'legado', em: agora, porId: null }`, `revisaoPendente: false`, histórico `[migrado]` |
| sem `status` | `status: 'ativo'` + o mesmo acima (D-02) — listado no relatório |
| `status: 'cancelado'` | mantém; `moderacao` com `aprovacao: null`, `cancelamento: { origem: 'dono', motivo: null, porId: null, em: agora }`, histórico `[migrado]` |
| outro valor | **não altera**; listado no relatório como "não classificado" (fica fora do ar) |

Uma auditoria `grupo.moderacao.migrado` por grupo alterado.

## `notificacoesUsuario` (coleção existente)

Novos documentos com `_id` **string determinístico** (D-04):
`moderacao:<grupoId>:<envio>:<acao>:<userId>`. Inserção repetida colide em
`_id` (11000) e é ignorada → no máximo uma notificação por evento e
destinatário. Demais campos no padrão atual: `{ userId: ObjectId, titulo,
mensagem, tipo: 'grupo', acao: '/grupos/<id>', lido: false, data, importante }`.

## Índices (`database/setupDatabase.js`)

- Novo: `grupos { status: 1, 'moderacao.enviadoEm': 1 }` (fila de pendentes e rotina).
- Existentes mantidos: `{ status: 1 }`, `{ categoria: 1, status: 1 }`.

## Auditoria (`auditLogs`, via `logAudit`)

`action: 'grupo.moderacao.<acao>'`, `actorId` = id do autor ou `'sistema'`
(automática), `targetCollection: 'grupos'`, `details: { de, para, envio, texto,
automatico }`. Gravada só depois do `findOneAndUpdate` vencedor.

## Atualização do execute (2026-11-26)

- `acao` do histórico também pode ser `encerrar` (dono encerra grupo aprovado: `ativo` → `cancelado`, `cancelamento.origem: 'dono'`, `motivo` opcional; R-008).
- `cancelamento.origem: 'dono'` cobre a desistência (`desistir`, `motivo: null`) e o encerramento (`encerrar`, motivo opcional); `'cotea'` cobre `cancelar` e `reprovar_revisao`.
- O subdocumento `moderacao` não sai para membros nem visitantes: a SSR do detalhe usa a allowlist pública, a de `/grupos/[id]/cancelar` envia só `_id`, `nome`, `descricao` e `subtitulo` (C-01), e `GET /api/meus-grupos` dá ao membro só `cancelamento.origem`.
- Fila de moderação: visão `aprovados` (`status: 'ativo'`) além de `pendentes` e `revisao` (R-009).
- O validador `$jsonSchema` está aplicado de fato na coleção `grupos` no banco (R-010); o `moderacao` passa porque o validador não tem `additionalProperties: false`.
