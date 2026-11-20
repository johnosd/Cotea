# Quickstart / verificação manual: 001-rotinas-agendadas

## Pré-requisitos

- `.env.local` com as variáveis de sempre e **`ROTINAS_SECRET`** (só o nome é
  documentado; gere um valor longo aleatório localmente).
- Coleções e índices: `node database/setupDatabase.js` e
  `node --env-file=.env.local database/setup-indexes.js`.
- Um usuário com `systemRole: 'admin'` e outro com `support` para o teste de
  permissão.
- No Windows, rode testes a partir de `J:\Cotea` (drive em maiúscula) — ver
  Cuidados no `plan.md`.

## Checagens automatizadas

```powershell
Set-Location J:\Cotea
npm run test:contrato        # 5/5 verdes
npm test                     # suíte inteira
.\.planning\scripts\powershell\check-contract-tests.ps1 -Slug 001-rotinas-agendadas
npm run lint
npm run build
```

## Cenário ponta a ponta (servidor local: `npm run dev`)

Em outro terminal (`$s` = valor de `ROTINAS_SECRET`; não colar em logs/issues):

1. **Segredo obrigatório** — `curl.exe -i -X POST http://localhost:3000/api/rotinas/executar`
   → 401. Com header errado → 401. Sem `ROTINAS_SECRET` no env → 503.
2. **Batimento** — `curl.exe -i -X POST -H "Authorization: Bearer $s" http://localhost:3000/api/rotinas/executar`
   → 200, rotina `saude` com `processados: 1`. Repetir na mesma hora →
   `processados: 0, pulados: 1` (FR-003). `GET` com o mesmo header também
   funciona (formato da Vercel Cron).
3. **Sondas vencidas e não vencidas** —
   `node --env-file=.env.local scripts/criar-sonda-rotina.js -5` (venceu há 5
   min) e `... 60` (vence em 60 min). Disparar → só a vencida é processada.
4. **Concorrência real no Mongo (R-003)** — criar 20 sondas vencidas e disparar
   duas chamadas ao mesmo tempo:
   `1..2 | ForEach-Object -Parallel { curl.exe -s -X POST -H "Authorization: Bearer $using:s" http://localhost:3000/api/rotinas/executar }`.
   Somando as duas respostas: `processados` = 20 e `pulados` = 20. No banco,
   `rotinaItens` tem 20 itens de sonda, todos `concluido`.
5. **Retentativa e alerta** — `scripts/criar-sonda-rotina.js -1 --falhar`;
   disparar 5 vezes → item `falha` com tentativas 1..4, depois
   `falha_definitiva`; o admin recebe 1 notificação em `/notificacoes`; a 6ª
   chamada não tenta o item (aparece em `pulados`).
6. **Recuperação de atraso (FR-004)** — criar 10 sondas com `-1440` (vencidas há
   24h) sem disparar nada; disparar uma vez → todas processadas.

## Painel (`/admin?tab=rotinas`)

7. Como admin: aba "Rotinas" lista `saude` com última execução, resultado,
   duração e contagens; o detalhe mostra o histórico e o item em falha
   definitiva do passo 5 com o último erro (SC-006: achar isso em < 1 min).
8. "Reexecutar" no item em falha definitiva → como a sonda continua com
   `falhar: true`, volta a falhar com tentativas = 1 (contagem zerada). Mudar a
   sonda para `falhar: false` no banco e reexecutar → `concluido`; reexecutar de
   novo → resposta `reprocessado: false`.
9. "Executar agora" na rotina → execução com origem `manual` e autor no histórico.
10. Calendário: incluir `2026-02-17 / Carnaval` → aparece na lista; incluir de
    novo → erro "Data ja cadastrada"; incluir `2026-11-20` → "Data ja e
    feriado nacional"; remover → some. Conferir `auditLogs` com as ações
    `calendario.*`, `rotina.executada_manual`, `rotina.item_reexecutado`,
    `rotina.item_falha_definitiva`.
11. Como `support`, financeiro e usuário comum: a aba não aparece e
    `GET /api/admin/rotinas` → 403; `POST /api/admin/calendario` → 403.

## Itens cross-cutting da constitution

- Nenhum log ou resposta contém o valor de `ROTINAS_SECRET`.
- `database/schemas/` tem os 4 schemas novos; `setupDatabase.js` e
  `setup-indexes.js` criam os índices (o único de `rotinaItens` é o mais crítico).
- `CLAUDE.md` e `AGENTS.md` listam `ROTINAS_SECRET` e `npm test`.
