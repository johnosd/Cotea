# Data Model: 001-rotinas-agendadas

Coleções novas. Todas com `_id` string (UUID via `randomUUID()`, padrão de
`auditLogs`/`wallets`/`walletTransactions`), exceto `calendarioDatasExtras`, cujo
`_id` é a própria data (unicidade natural). Cada coleção ganha
`database/schemas/<nome>.schema.json` e entrada em `database/setupDatabase.js`;
índices também em `database/setup-indexes.js` (Constitution IV).

## `rotinaItens` — chave da idempotência

Um documento por par rotina + item/evento de negócio. **Nunca expira**: apagar
um item concluído permitiria reprocessar o evento.

| Campo | Tipo | Notas |
| --- | --- | --- |
| `_id` | string (UUID) | gerado no insert (`$setOnInsert`) |
| `rotinaId` | string | ex.: `saude`, futuramente `sla-acesso` |
| `chave` | string | identidade do evento, definida pela rotina (ex.: `membro:<id>:ciclo:<n>`) |
| `dados` | object | snapshot entregue por `buscarVencidos`; usado na reexecução manual. NÃO guardar CPF/segredos |
| `situacao` | string | `processando` \| `concluido` \| `ignorado` \| `falha` \| `falha_definitiva` |
| `tentativas` | int | falhas acumuladas; zera na reexecução manual |
| `ultimoErro` | string \| null | `error.message` truncado a 500 chars, sem stack |
| `travadoAte` | date \| null | fim do lease enquanto `processando`; `null` fora disso |
| `concluidoEm` | date \| null | quando virou `concluido`/`ignorado` |
| `criadoEm` | date | |
| `atualizadoEm` | date | |

Índices:
- `{ rotinaId: 1, chave: 1 }` **unique** — garante FR-003.
- `{ rotinaId: 1, situacao: 1, atualizadoEm: -1 }` — painel (itens em falha).

Transições:

```
(novo) ──reivindicar──▶ processando ──ok──▶ concluido        (final)
                              │      └─ignorado─▶ ignorado   (final)
                              └─erro─▶ falha ──reivindicar──▶ processando ...
                                       (tentativas >= 5) ──▶ falha_definitiva (final)
falha_definitiva ──reexecução manual (zera tentativas)──▶ falha ──▶ processando
processando com travadoAte <= agora ──reivindicar──▶ processando (lease expirado)
```

## `rotinaExecucoes` — registro de cada passada (FR-008)

| Campo | Tipo | Notas |
| --- | --- | --- |
| `_id` | string (UUID) | |
| `rotinaId` | string | |
| `origem` | string | `automatica` \| `manual` |
| `autorId` | string \| null | admin que disparou (manual) |
| `inicio` | date | |
| `fim` | date \| null | `null` enquanto em andamento |
| `resultado` | string \| null | `sucesso` \| `parcial` \| `erro`; `null` em andamento |
| `processados`, `ignorados`, `falhas`, `pulados` | int | |
| `erro` | string \| null | erro de `buscarVencidos` (rotina inteira falhou) |

Índices:
- `{ rotinaId: 1, inicio: -1 }` — última execução / histórico.
- `{ inicio: 1 }` TTL `expireAfterSeconds: 7776000` (90 dias).

## `calendarioDatasExtras` — datas extras não úteis (FR-019)

| Campo | Tipo | Notas |
| --- | --- | --- |
| `_id` | string `YYYY-MM-DD` | a própria data (duplicata → E11000 → 409) |
| `descricao` | string | 1–100 chars, obrigatória |
| `criadoPor` | string | id do admin |
| `criadoEm` | date | |

Remoção é física; o histórico fica na auditoria (`calendario.data_extra_removida`).

## `rotinaSaudeSondas` — itens de teste da rotina de saúde (FR-009)

| Campo | Tipo | Notas |
| --- | --- | --- |
| `_id` | string (UUID) | |
| `venceEm` | date | quando a sonda fica vencida |
| `falhar` | bool | `true` → `processarItem` lança erro (testa retentativa/alerta) |
| `criadoEm` | date | |

Índice: `{ criadoEm: 1 }` TTL 7 dias (604800). Criadas por
`scripts/criar-sonda-rotina.js`.

## Coleções existentes reutilizadas (sem mudança de formato)

- `notificacoesUsuario`: alerta de falha definitiva — `userId` (ObjectId do
  admin), `titulo`, `mensagem`, `tipo: 'sistema'`, `acao: '/admin?tab=rotinas'`,
  `lido: false`, `data`, `importante: true`.
- `auditLogs` via `logAudit()`: ações `rotina.executada_manual`,
  `rotina.item_reexecutado`, `rotina.item_falha_definitiva` (actorId `sistema`),
  `calendario.data_extra_incluida`, `calendario.data_extra_removida`.
