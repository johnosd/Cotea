# Handoff — 001-rotinas-agendadas

## Contexto

- Repositório `J:\Cotea`, branch `feature/godfiles`. Next.js 14 (Pages Router) +
  MongoDB (driver 6.16) + NextAuth v4; JavaScript; testes com Vitest 5.1
  (instalado nesta sessão).
- Próximo comando: `/sdd-execute 001-rotinas-agendadas`.
- Backlog: `Planejada`, 0/43 tasks.
- Criados/alterados nesta sessão fora de `sdd/`: `.planning/memory/constitution.md`
  (nova, v1.0.0), `package.json` (+ `vitest`, scripts `test` e `test:contrato`),
  `package-lock.json`, `vitest.config.mjs`, stubs `lib/calendario.js` e
  `lib/rotinas/executor.js`, `tests/contract/…`, `tests/helpers/…`,
  `.planning/backlog.md` (B-06).

## O que a feature entrega

- **US1 (P1)**: rota `/api/rotinas/executar` (segredo) → executor processa cada
  item vencido uma única vez, com retentativa até 5 e alerta ao admin.
- **US2 (P1)**: `lib/calendario.js` puro — dias corridos (instante + N×24h) e
  úteis (23:59:59.999 Brasília do N-ésimo dia útil; o dia do evento não conta);
  feriados nacionais incluem 20/11 e a Sexta-feira Santa; Carnaval e Corpus
  Christi **não** são feriados nacionais (entram como data extra).
- **US3 (P2)**: aba "Rotinas" no `/admin`, **só para `admin`** (nem suporte nem
  financeiro), com reexecução manual que zera tentativas.
- **US4 (P3)**: datas extras mantidas pelo admin; prazos pendentes são
  recalculados com o calendário atual (nunca persistir o vencimento em dias úteis).
- Escopo é **só a base**: nenhuma regra de negócio (SLA, faturas, repasse…) entra
  aqui; só a rotina `saude`.

## Leitura obrigatória, em ordem

1. `spec.md` — FR-001..020, cenários e decisões do usuário (Clarifications).
2. `plan.md` — Decisões Invariantes D-01..D-10 e Riscos R-001..R-007.
3. `tasks.md` — 7 fases; contratos nas Fases 3 e 4.
4. `logic/executor.md` — algoritmo exato, `reivindicarItem` com upsert + E11000.
5. `logic/calendario.md` — dia local, Páscoa, fim do dia sem fixar -03:00, tabela de casos.
6. `data-model.md` — 4 coleções novas, índices, transições de `situacao`.
7. `contracts/api-rotinas.md` — rotas, status e auditorias.
8. `quickstart.md` — roteiro manual (passo 4 = concorrência real, gate da Fase 3).
9. `.planning/memory/constitution.md` — 4 princípios + definição de pronto.

## Testes de contrato

- `tests/contract/001-rotinas-agendadas.contract.test.js` — 5 testes (3 da Fase 3,
  2 da Fase 4), **travado**.
- `tests/helpers/repositorio-rotinas-memoria.js` — 0 testes, **travado**; é a
  interface que `repositorio-mongo.js` deve replicar.
- Rodar: `Set-Location J:\Cotea; npm run test:contrato` (vermelho atual: 5/5
  `Error: not implemented`).
- Integridade: `.\.planning\scripts\powershell\check-contract-tests.ps1 -Slug 001-rotinas-agendadas`.
- Não há travas de outras features.

## Stubs criados

- `lib/calendario.js` — exports finais com `throw new Error('not implemented')`;
  manter os nomes/assinaturas (o contrato importa `feriadosNacionais`,
  `ehDiaUtil`, `vencimentoDiasCorridos`, `vencimentoDiasUteis`, `prazoVencido`).
- `lib/rotinas/executor.js` — `executarRotina`, `reexecutarItem` lançam; `SITUACAO`,
  `MAX_TENTATIVAS = 5`, `LEASE_PADRAO_MS` já definitivos.
- `vitest.config.mjs` (alias `@`, `tests/**/*.test.{js,mjs}`) — definitivo.

## Armadilhas já mapeadas

- **Rodar Vitest de `J:\Cotea`** (maiúsculo): de `j:\…` a suíte quebra com
  `Cannot read properties of undefined (reading 'config')` — módulo carregado duas vezes (R-005).
- **Não importar `lib/mongodb.js`** em `lib/calendario.js`, `lib/rotinas/executor.js`
  nem em nada que os testes importem: ele valida env no import e derruba os testes.
- **Driver 6.16**: `findOneAndUpdate` retorna o documento, sem `.value`. Os handlers
  antigos usam `.value` (provável bug, B-06 no backlog) — não copie (R-007).
- **Middleware** redireciona qualquer rota não pública para login: sem T013 o
  agendador recebe 302, não 401.
- **Vercel Cron chama com GET**: a rota aceita GET e POST.
- **`dataLocalBrasilia` via `Intl`**: 23:59:59 de 10/11 em Brasília já é 11/11 em
  UTC (há um contrato exatamente sobre isso).
- `rotinaItens` **não pode ter TTL** (apagar item concluído permite reprocessar).
- `notificacoesUsuario.userId` é `ObjectId`; coleções novas usam `_id` string UUID.
- `processarItem` que movimenta dinheiro, em features futuras, deve ser
  idempotente pelo próprio evento (R-006).
- Não há Mongo em memória: a atomicidade real só é provada pelo quickstart passo 4.

## Pendências do Analyze

- A1 · HIGH · FR-002/SC-001 (até 1h) dependem de um agendador externo ainda não
  escolhido → validar localmente via curl e abrir `sdd-adr` do agendador antes
  do deploy (T030, R-001).
- A2 · MEDIUM · Atomicidade do repositório Mongo sem teste automatizado → o
  quickstart passo 4 é gate obrigatório da Fase 3 (R-003).
- A3 · MEDIUM · `limite` de 500 itens/execução pode exigir várias passadas para
  recuperar um atraso grande (SC-003) → aceitável; anotar no quickstart passo 6
  se passar de 500.
- A4 · LOW · Batimento horário da rotina `saude` cria ~8.760 `rotinaItens`/ano
  sem expiração → aceitável; reavaliar se incomodar.
- A5 · LOW · Spec diz "23:59:59", o plano usa 23:59:59.999 → equivalente; manter .999.
- A6 · LOW · FR-004, FR-015 e SC-001/002/003/005 sem ID citado nas tasks
  (cobertos por design + quickstart 2–6) → rastrear no Registro da Fase 3.

## Gate de pronto

- `npm run test:contrato` 5/5 + `check-contract-tests.ps1` íntegro.
- `npm test`, `npm run lint`, `npm run build` verdes.
- `quickstart.md` inteiro, com o passo 4 (concorrência) obrigatório.
- Docs no Polish: `CLAUDE.md`/`AGENTS.md` (Vitest, `ROTINAS_SECRET`, nota do drive)
  e `.docs/regras-negocio-v2.md` (definição de dia útil).
- Não há hardware real envolvido; validação manual contra Mongo local/Atlas é gate.
