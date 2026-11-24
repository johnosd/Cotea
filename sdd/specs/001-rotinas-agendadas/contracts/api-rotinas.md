# Contrato de API: rotinas e calendário

Respostas de erro no padrão novo do projeto: `{ error: string }`. Mensagens em
português. IDs de usuário comparados como string.

## Disparo pelo agendador

### `GET|POST /api/rotinas/executar[?rotina=<id>]`

- **Auth**: header `Authorization: Bearer <segredo>`, onde o segredo é `CRON_SECRET` (injetado pela Vercel, ADR-001) ou, se ausente, `ROTINAS_SECRET`; comparado com
  `crypto.timingSafeEqual` (tamanhos diferentes → 401 sem comparar). Sem sessão.
- Rota liberada em `PUBLIC_PATHS` do `middleware.js` (senão o middleware
  redireciona o agendador para o login). A proteção é só o segredo.
- Disparada pelo Vercel Schedules (`vercel.json`, schedule `rotinas`, a cada 15 min, `POST`), conforme ADR-001. `GET` continua aceito para agendadores que só fazem GET.
- Executa, em sequência, todas as rotinas registradas (ou só `?rotina=`), com
  `origem: 'automatica'`.

| Status | Corpo |
| --- | --- |
| 200 | `{ execucoes: [{ rotinaId, execucaoId, resultado, processados, ignorados, falhas, pulados, cortada?, restantes? }] }` — `cortada: true` e `restantes` só aparecem quando o orçamento de tempo (45 s) interrompeu a passada; os itens restantes saem na próxima execução |
| 401 | `{ error: 'Nao autorizado' }` (segredo ausente/errado) |
| 404 | `{ error: 'Rotina nao encontrada' }` (`?rotina=` inválido) |
| 405 | método diferente de GET/POST |
| 503 | `{ error: 'Rotinas nao configuradas' }` (nem `CRON_SECRET` nem `ROTINAS_SECRET` definidos) |

Nunca logar o header nem o valor do segredo.

## Painel (somente admin do sistema)

Todas: `getServerSession(req, res, authOptions)`; 401 sem sessão; 403 se
`!hasRole(session, PERMISSIONS.ROTINAS_TAB)` (`['admin']`, bloqueado → false).

### `GET /api/admin/rotinas`

200 → `[{ id, descricao, ultimaExecucao: { execucaoId, origem, inicio, fim, duracaoMs, resultado, processados, ignorados, falhas, pulados } | null, itensEmFalha, itensFalhaDefinitiva }]`

### `GET /api/admin/rotinas/[id]`

200 → `{ id, descricao, execucoes: [... últimas 50, inicio desc], itensComFalha: [{ chave, situacao, tentativas, ultimoErro, atualizadoEm }] (falha|falha_definitiva, até 100) }`
404 → rotina não registrada.

### `POST /api/admin/rotinas/[id]/executar`

Disparo manual da rotina inteira (`origem: 'manual'`, `autorId`). Auditoria
`rotina.executada_manual`. 200 → resultado de `executarRotina`. 404 rotina.

### `POST /api/admin/rotinas/[id]/reexecutar` — body `{ chave }`

Reexecuta um item (FR-018) via `reexecutarItem`. Auditoria
`rotina.item_reexecutado`.
200 → `{ chave, situacao, reprocessado: boolean }` (item já concluído/ignorado →
`reprocessado: false`, sem efeito). 400 `chave` vazia. 404 rotina ou item.

### `GET /api/admin/calendario?ano=YYYY`

`ano` padrão = ano atual em Brasília. 200 →
`{ ano, feriadosNacionais: ['YYYY-MM-DD', ...], datasExtras: [{ data, descricao, criadoPor, criadoEm }] }`
(datas extras do ano, ordenadas).

### `POST /api/admin/calendario` — body `{ data: 'YYYY-MM-DD', descricao }`

201 → `{ data, descricao }`. Auditoria `calendario.data_extra_incluida`.
400 data inválida (formato ou data inexistente) / descrição vazia ou > 100.
409 `{ error: 'Data ja cadastrada' }` ou `{ error: 'Data ja e feriado nacional' }`.

### `DELETE /api/admin/calendario?data=YYYY-MM-DD`

200 → `{ data }`. Auditoria `calendario.data_extra_removida`. 404 não cadastrada.
