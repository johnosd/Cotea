---
description: "Tasks da feature 001-rotinas-agendadas"
---

# Tasks: Rotinas agendadas idempotentes e calendário de dias úteis

**Input**: Documentos de design de `sdd/specs/001-rotinas-agendadas/`

**Prerequisites**: plan.md, spec.md, data-model.md, contracts/api-rotinas.md, logic/executor.md, logic/calendario.md, quickstart.md

**Organization**: Tasks agrupadas por user story pra permitir implementação e teste independentes de cada uma.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Pode rodar em paralelo (arquivos diferentes, sem dependência)
- **[Story]**: A qual user story esta task pertence (US1..US4)

## Path Conventions

- Lógica de servidor em `lib/` (domínio de rotinas em `lib/rotinas/`); código
  puro (`lib/calendario.js`, `lib/rotinas/executor.js`) NÃO importa `lib/mongodb.js`.
- APIs em `pages/api/` (Pages Router); telas em `pages/`; componentes do painel
  em `components/admin/`.
- Schemas em `database/schemas/<colecao>.schema.json`; coleções/índices em
  `database/setupDatabase.js` e `database/setup-indexes.js`.
- Testes Vitest em `tests/**/*.test.js`; contratos travados em `tests/contract/`
  e `tests/helpers/repositorio-rotinas-memoria.js` (NÃO editar).
- Comandos de teste a partir de `J:\Cotea` (R-005).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Persistência e permissão que todas as stories usam.

- [X] T001 [P] Criar `database/schemas/rotinaItens.schema.json`, `rotinaExecucoes.schema.json`, `calendarioDatasExtras.schema.json` e `rotinaSaudeSondas.schema.json` conforme `data-model.md` (`_id` string; datas `date`; `situacao` com enum)
- [X] T002 Registrar as 4 coleções em `database/setupDatabase.js` (`createCollection` + índices: único `{ rotinaId, chave }`, `{ rotinaId, situacao, atualizadoEm }`, `{ rotinaId, inicio }`, TTL 90 dias em `rotinaExecucoes.inicio`, TTL 7 dias em `rotinaSaudeSondas.criadoEm`)
- [X] T003 Espelhar os mesmos índices em `database/setup-indexes.js`, com comentário de propósito como os existentes
- [X] T004 [P] Adicionar `ROTINAS_TAB: ['admin']` a `PERMISSIONS` em `lib/authz.js`

**Checkpoint**: `node database/setupDatabase.js` cria as coleções sem erro.

**Registro da Fase**:

- Status: concluída (2026-11-20), com 1 pendência de validação no banco real
- Feito: 4 schemas em `database/schemas/` (`rotinaItens`, `rotinaExecucoes`, `calendarioDatasExtras`, `rotinaSaudeSondas`); coleções + índices (único `{ rotinaId, chave }`, TTL 90 d em `rotinaExecucoes.inicio`, TTL 7 d em sondas) em `database/setupDatabase.js` e espelhados em `database/setup-indexes.js`; `PERMISSIONS.ROTINAS_TAB = ['admin']` em `lib/authz.js`
- Contrato: sem contrato nesta fase
- Testes executados: `node --check database/setupDatabase.js` ok; `node --check database/setup-indexes.js` ok; `npx eslint lib/authz.js database/setup-indexes.js` sem achados; JSON dos 4 schemas validado com `JSON.parse`
- Pendências: `node database/setupDatabase.js` NÃO foi executado — grava no MongoDB do `.env.local` (cria coleções e reaplica `collMod` em todas as existentes); fica para o usuário rodar (pré-requisito do quickstart)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Repositório Mongo, registro de rotinas e leitura do calendário.

**⚠️ CRITICAL**: Nenhuma user story pode começar antes desta fase terminar.

- [X] T005 Implementar `criarRepositorioMongo(db)` em `lib/rotinas/repositorio-mongo.js` com os MESMOS métodos/retornos de `tests/helpers/repositorio-rotinas-memoria.js` (`reivindicarItem` com `findOneAndUpdate` + upsert + E11000, ver `logic/executor.md`; driver 6.16 retorna o documento, sem `.value` — R-007)
- [X] T006 Criar `lib/rotinas/registro.js` com `listarRotinas()` (só `ativa !== false` no disparo automático) e `obterRotina(id)`
- [X] T007 Criar a rotina `saude` em `lib/rotinas/saude.js`: `buscarVencidos` devolve o batimento da hora local (`chave: 'batimento:YYYY-MM-DDTHH'`) + sondas de `rotinaSaudeSondas` com `venceEm <= agora` (`chave: 'sonda:<_id>'`, `dados: { falhar }`); `processarItem` lança `Error('falha simulada pela sonda')` se `dados.falhar`, senão `'concluido'` (FR-009)
- [X] T008 [P] Criar `scripts/criar-sonda-rotina.js <minutosRelativos> [--falhar]` (padrão de `scripts/reset-wallet.js`; uso `node --env-file=.env.local scripts/criar-sonda-rotina.js -5`)
- [X] T009 [P] Criar `lib/calendario-dados.js` com `carregarDatasExtras(db)` (sem cache de módulo) e `validarDataExtra({ data, descricao })` (formato `YYYY-MM-DD`, data existente, descrição 1–100); arquivo recebe `db` por parâmetro e não importa `lib/mongodb.js`

**Checkpoint**: fundação pronta — user stories podem começar.

**Registro da Fase**:

- Status: concluída (2026-11-20)
- Feito: `lib/rotinas/repositorio-mongo.js` (mesma interface do fake travado; `reivindicarItem` com upsert + E11000; `registrarFalhaItem` com pipeline update atômico e `$literal` no erro); `lib/rotinas/registro.js`; `lib/rotinas/saude.js`; `scripts/criar-sonda-rotina.js` (aceita `--quantidade=N` para os passos 4 e 6 do quickstart); `lib/calendario-dados.js` (`carregarDatasExtras`, `ehDataValida`, `validarDataExtra`)
- Contrato: sem contrato nesta fase; `check-contract-tests.ps1` íntegro
- Testes executados: `npx eslint lib/rotinas lib/calendario-dados.js scripts/criar-sonda-rotina.js` sem achados; `node --check scripts/criar-sonda-rotina.js` ok; smoke com Node (sem banco): batimento `batimento:2026-11-20T13`, `processarItem` → `concluido`, `validarDataExtra` recusa `2026-02-30` e normaliza descrição
- Pendências: repositório Mongo sem teste automatizado (R-003) — validação no quickstart passos 2–6. Desvios: batimento usa a hora em UTC (só precisa ser única por hora, não é prazo de negócio); `processarItem` da sonda relê a sonda do banco (revalidação FR-007, permite o passo 8 do quickstart)

---

## Phase 3: User Story 1 - Prazos vencidos processados automaticamente e uma única vez (Priority: P1) 🎯 MVP

**Objetivo**: o agendador chama a rota; cada item vencido é processado com efeito uma única vez, com retentativa e alerta.

**Independent Test**: quickstart passos 1–6 com a rotina de saúde e sondas.

### Contrato da Fase

- `processa só os itens vencidos e não repete efeito ao rodar de novo` — US1-AC1/AC2 · FR-001/002/003/008
- `duas execuções simultâneas processam cada item com efeito uma única vez` — US1-AC3 · FR-003
- `isola falhas, retenta até 5 vezes, vira falha definitiva e alerta uma única vez` — US3-AC2/AC3 · FR-005/006/007 (o mecanismo de retentativa é do executor; fica nesta fase)
- Comando: `npm run test:contrato` (a partir de `J:\Cotea`)

### Implementation

- [X] T010 [US1] Implementar `executarRotina` em `lib/rotinas/executor.js` seguindo `logic/executor.md` (sequencial, `agora` fixo, falha isolada, `alertar` em melhor esforço, resultado `sucesso|parcial|erro`, erro de `buscarVencidos` não relança) → contrato: os 3 testes desta fase
- [X] T011 [P] [US1] Criar `criarAlertaAdmins(db)` em `lib/rotinas/alertas.js`: notificação em `notificacoesUsuario` para cada `users` com `systemRole: 'admin'` e não bloqueado (`userId` ObjectId, `tipo: 'sistema'`, `acao: '/admin?tab=rotinas'`, `importante: true`) + `logAudit({ action: 'rotina.item_falha_definitiva', actorId: 'sistema', ... })` (FR-006, FR-020, D-10)
- [X] T012 [US1] Criar `pages/api/rotinas/executar.js` conforme `contracts/api-rotinas.md`: GET/POST, `Bearer ROTINAS_SECRET` com `timingSafeEqual`, 503 sem env, `?rotina=`, monta `contexto = { db, datasExtras: await carregarDatasExtras(db) }`, `repo = criarRepositorioMongo(db)`, `alertar = criarAlertaAdmins(db)`; nunca logar o segredo
- [X] T013 [US1] Adicionar `/^\/api\/rotinas\/executar\/?$/i` a `PUBLIC_PATHS` em `middleware.js` (só essa rota)

### Testes da Fase

- [X] T014 [P] [US1] `tests/rotinas/executor.test.js`: lease expirado permite reassumir item `processando`; `buscarVencidos` que lança → execução finalizada com `resultado: 'erro'` e `erro` preenchido, sem relançar; `limite` respeitado; `alertar` que lança não altera contagens; retorno diferente de `'ignorado'` conta como concluído; `ultimoErro` truncado a 500

**Critério de Conclusão**: `npm run test:contrato` → os 3 testes do executor verdes e `check-contract-tests.ps1 -Slug 001-rotinas-agendadas` íntegro; `npm test` verde; quickstart passos 1–6 executados contra o Mongo real, **incluindo o passo 4 (concorrência real, R-003)**.

**Checkpoint**: User Story 1 funcional e testável isoladamente.

**Registro da Fase**:

- Status: concluída (2026-11-20) — quickstart 1–6 executado no banco de desenvolvimento do usuário
- Feito: `executarRotina` (e já o `reexecutarItem`, que reaproveita o laço `processarUmItem`) em `lib/rotinas/executor.js`; `lib/rotinas/alertas.js` (notificação a admins não bloqueados + auditoria `rotina.item_falha_definitiva`); `pages/api/rotinas/executar.js` (GET/POST, Bearer `ROTINAS_SECRET` com `timingSafeEqual`, 503/401/404/405); `/api/rotinas/executar` em `PUBLIC_PATHS` do `middleware.js`
- Contrato: `npm run test:contrato` → 3/3 verdes nos testes desta fase (2 restantes são da Fase 4, vermelhos por `not implemented`); trava íntegra
- Testes executados: `npx vitest run tests/rotinas tests/contract` (a partir de `J:\Cotea`) → 9 passed / 2 failed (os 2 do calendário); `tests/rotinas/executor.test.js` 6/6 (lease expirado, erro em `buscarVencidos`, limite, falha no `alertar`, retorno não-ignorado, `repo` obrigatório); `npx eslint lib/rotinas pages/api/rotinas middleware.js tests` sem achados; 1 iteração
- Pendências: nenhuma. Quickstart (dev server :3100, `ROTINAS_SECRET` local só no processo): passo 1 → 401 sem/errado, 404 rotina inexistente, 405 PUT (503 sem env verificado só por leitura de código); passo 2 → batimento `processados 1`, repetição via GET `pulados 1`; passo 3 → só a sonda vencida processada; passo 4 → 20 sondas + 2 chamadas simultâneas = 10 + 10 processados, 0 duplicatas (R-003 resolvido); passo 5 → 5× falha, 6ª pulada, item `falha_definitiva` (5 tentativas), 1 notificação para 1 admin, 1 auditoria; passo 6 → 10 sondas vencidas há 24 h processadas numa execução. Segredo ausente do log do servidor.

---

## Phase 4: User Story 2 - Cálculo de prazos em dias corridos e úteis (Priority: P1)

**Objetivo**: funções puras de vencimento no horário de Brasília para as features consumidoras.

**Independent Test**: casos de referência de `logic/calendario.md`.

### Contrato da Fase

- `calcula vencimentos em dias corridos e úteis no horário de Brasília` — US2-AC1..5 · FR-010..013 · SC-004
- `considera datas extras e o calendário atual ao verificar se o prazo venceu` — US4-AC1 · FR-012/014
- Comando: `npm run test:contrato`

### Implementation

- [X] T015 [US2] Implementar `lib/calendario.js` seguindo `logic/calendario.md` (`dataLocalBrasilia` via `Intl` `en-CA`, Páscoa, `fimDoDiaBrasilia` sem fixar -03:00, `vencimentoDiasCorridos`, `vencimentoDiasUteis`, `prazoVencido`, validações `RangeError`/`TypeError`) → contrato: os 2 testes desta fase

### Testes da Fase

- [X] T016 [P] [US2] `tests/calendario.test.js`: Sexta-feira Santa de 2024 (29/03), 2025 (18/04), 2027 (26/03), 2030 (19/04); `n` = 0, negativo ou fracionário → `RangeError`; `Date` inválido → `TypeError`; `ehDiaUtil` em sábado/domingo; resultado independente de `process.env.TZ` (rodar um caso com `TZ=UTC` e outro com `TZ=Asia/Tokyo`, ou comparar via `toISOString`)

**Critério de Conclusão**: `npm run test:contrato` → 5/5 verdes (com a Fase 3) e trava íntegra; `npm test` verde.

**Registro da Fase**:

- Status: concluída (2026-11-20)
- Feito: `lib/calendario.js` completo — `dataLocalBrasilia` (Intl `en-CA`), Páscoa (Meeus/Jones/Butcher) com cache por ano, `fimDoDiaBrasilia` pelo offset real do fuso (sem fixar -03:00), `vencimentoDiasCorridos`, `vencimentoDiasUteis`, `prazoVencido`, validações `RangeError`/`TypeError`
- Contrato: `npm run test:contrato` → 5/5 verdes (2/2 desta fase); trava íntegra
- Testes executados: `npx vitest run` (de `J:\Cotea`) → 3 arquivos, 17/17; `tests/calendario.test.js` 6/6 (Sexta-feira Santa 2024/2025/2027/2030, sem Carnaval/Corpus Christi, cópia defensiva, fim de semana, validações, independência de `process.env.TZ`); `npx eslint lib/calendario.js tests` sem achados; 1 iteração + refatoração do cache de feriados
- Pendências: nenhuma. Obs.: o teste de independência de fuso troca `process.env.TZ` em tempo de execução; o código só usa `Date.UTC`/`getUTC*` e `Intl` com fuso explícito, então a garantia vem do desenho, não só do teste

---

## Phase 5: User Story 3 - Admin acompanha e reexecuta rotinas (Priority: P2)

**Objetivo**: aba "Rotinas" no `/admin` com execuções, falhas, disparo manual e reexecução idempotente.

**Independent Test**: quickstart passos 7–9 e 11.

### Implementation

- [X] T017 [US3] Implementar `reexecutarItem` em `lib/rotinas/executor.js` (ver `logic/executor.md`; reaproveitar o laço interno do `executarRotina`; zera tentativas; concluído/ignorado → `reprocessado: false`) (FR-018)
- [X] T018 [P] [US3] `pages/api/admin/rotinas/index.js` — GET lista com última execução e contagem de itens em falha/falha definitiva (FR-016, FR-017)
- [X] T019 [P] [US3] `pages/api/admin/rotinas/[id]/index.js` — GET histórico (50) + itens com falha (100)
- [X] T020 [US3] `pages/api/admin/rotinas/[id]/executar.js` — POST manual (`origem: 'manual'`, `autorId`), auditoria `rotina.executada_manual` (FR-018, FR-020)
- [X] T021 [US3] `pages/api/admin/rotinas/[id]/reexecutar.js` — POST `{ chave }`, auditoria `rotina.item_reexecutado`
- [X] T022 [US3] `components/admin/RotinasTab.js` — tabela de rotinas (última execução, resultado, duração, contagens), detalhe com histórico e itens em falha (último erro, tentativas), botões "Executar agora" e "Reexecutar" com estado de carregamento e mensagem de erro em português (SC-006)
- [X] T023 [US3] Em `pages/admin/index.js`: adicionar `{ id: 'rotinas', label: 'Rotinas', roles: PERMISSIONS.ROTINAS_TAB }` a `TABS`, `case 'rotinas'` em `renderTab` e `...PERMISSIONS.ROTINAS_TAB` na checagem de acesso ao painel

### Testes da Fase

- [X] T024 [P] [US3] `tests/rotinas/reexecutar.test.js` (repositório em memória): falha definitiva → reexecução zera tentativas e processa com os `dados` gravados; item concluído → `reprocessado: false` sem chamar `processarItem`; item inexistente → erro; execução registrada com `origem: 'manual'`

**Critério de Conclusão**: `npm test` verde; quickstart 7–9 e 11 executados (inclusive 403 para support/finance/user nas rotas `/api/admin/rotinas*`).

**Registro da Fase**:

- Status: implementada (2026-11-20); validação manual (quickstart 7–9, 11) PENDENTE
- Feito: `reexecutarItem` (já entregue na Fase 3); APIs `pages/api/admin/rotinas/index.js`, `[id]/index.js`, `[id]/executar.js`, `[id]/reexecutar.js`; `components/admin/RotinasTab.js` (lista, detalhe, histórico, itens em falha, "Executar agora", "Reexecutar"); aba `rotinas` em `pages/admin/index.js`. Extras não previstos nas tasks: `lib/rotinas/autorizacao.js` (guarda única das rotas admin), `lib/rotinas/consultas.js` (agregações do painel) e `lib/rotinas/dependencias.js` (monta repo/alerta/contexto; o disparo automático passou a usá-lo)
- Contrato: sem contrato nesta fase; `npm run test:contrato` segue 5/5, trava íntegra
- Testes executados: `npx vitest run` (de `J:\Cotea`) → 4 arquivos, 21/21; `tests/rotinas/reexecutar.test.js` 4/4; `npx eslint …` sem erros (1 warning pré-existente em `pages/admin/index.js:262`, `useMemo` sem `isAllowed` — não introduzido aqui)
- Pendências: quickstart 7–9 e 11 (painel com sessão real e 403 para support/finance/user) não executados — exigem servidor com o banco do usuário. `RotinasTab` importa `CalendarioDatasExtras` (Fase 6); o build só fecha após T026

---

## Phase 6: User Story 4 - Admin mantém datas extras não úteis (Priority: P3)

**Objetivo**: incluir/remover datas extras com auditoria; prazos pendentes passam a considerá-las.

**Independent Test**: quickstart passo 10.

### Implementation

- [X] T025 [US4] `pages/api/admin/calendario.js` — GET (feriados nacionais do ano + datas extras), POST (`validarDataExtra`; 409 duplicada via E11000 ou feriado nacional), DELETE (`?data=`), auditoria `calendario.data_extra_incluida`/`_removida` (FR-019, FR-020)
- [X] T026 [US4] `components/admin/CalendarioDatasExtras.js` renderizado dentro de `RotinasTab`: seletor de ano, lista de feriados nacionais (só leitura) e datas extras com incluir/remover

### Testes da Fase

- [X] T027 [P] [US4] `tests/calendario-dados.test.js`: `validarDataExtra` aceita `2026-02-17`; recusa `2026-02-30`, `17/02/2026`, descrição vazia e > 100

**Critério de Conclusão**: `npm test` verde; quickstart passo 10 executado; uma data extra incluída dentro de um prazo pendente de sonda/rotina adia o vencimento na execução seguinte (US4-AC1 no ambiente real).

**Registro da Fase**:

- Status: implementada (2026-11-20); validação manual (quickstart 10 e US4-AC1 no ambiente real) PENDENTE
- Feito: `pages/api/admin/calendario.js` (GET por ano com feriados nacionais + datas extras; POST com `validarDataExtra`, 409 para feriado nacional e para duplicata via E11000; DELETE com `findOneAndDelete`; auditoria `calendario.data_extra_incluida`/`_removida`); `components/admin/CalendarioDatasExtras.js` renderizado no fim da `RotinasTab`
- Contrato: sem contrato nesta fase; 5/5 seguem verdes, trava íntegra
- Testes executados: `npx vitest run` (de `J:\Cotea`) → 5 arquivos, 25/25; `tests/calendario-dados.test.js` 4/4 (validação, bissexto, leitura com `db` fake); `npx eslint pages/api/admin/calendario.js components/admin tests` sem achados
- Pendências: quickstart passo 10 e verificação de que uma data extra adia um prazo pendente no ambiente real

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Documentação, regras de negócio e gates de entrega.

- [X] T028 [P] Atualizar `CLAUDE.md` e `AGENTS.md`: `ROTINAS_SECRET` (só o nome) na lista de variáveis; `npm test`/`npm run test:contrato` nos comandos; trocar "No test framework is configured"/"nao ha suite de testes" por Vitest; nota sobre rodar de `J:\Cotea` no Windows
- [X] T029 [P] Acrescentar a `.docs/regras-negocio-v2.md` a definição de dia útil e de contagem de prazos adotada (FR-010..013) — Constitution III
- [X] T030 Registrar no `plan.md` (Riscos) a recomendação de abrir `sdd-adr` para o agendador (R-001) e a frequência de 15 min
- [ ] T031 Rodar `quickstart.md` inteiro
- [X] T032 [desvio aprovado, descoberto em T031/gate de build] Corrigir import inexistente em `pages/api/admin/users/[id]/block.js` (`../../auth/` → `../../../auth/[...nextauth]`), que impedia o `npm run build` — bug pré-existente fora do escopo, corrigido por decisão do usuário
- [X] T033 [ADR-001] Rota `pages/api/rotinas/executar.js` aceita `CRON_SECRET` (padrão da Vercel) com `ROTINAS_SECRET` como alternativa; `vercel.json` com `regions: ["gru1"]` e o schedule `rotinas` (`*/15 * * * *` → `/api/rotinas/executar`); `.tools/start.sh`, `CLAUDE.md`, `AGENTS.md`, `contracts/api-rotinas.md` e `quickstart.md` atualizados. Verificado: `npx vitest run` 25/25, build ok, dev server só com `CRON_SECRET` → 401 sem segredo, 200 com `Bearer CRON_SECRET`

**Registro da Fase** (parcial, 2026-11-20):

- Status: em andamento — bloqueada por decisão do usuário (R-008)
- Feito: T028 (`CLAUDE.md`/`AGENTS.md`: Vitest, `npm test`, `test:contrato`, `ROTINAS_SECRET`, nota do drive), T029 (seção "Prazos e calendario" em `.docs/regras-negocio-v2.md`), T030 (R-001 encaminhado para `sdd-adr`)
- Contrato: `npm run test:contrato` → 5/5 verdes; trava íntegra
- Testes executados: `npx vitest run` (de `J:\Cotea`) → 25/25; `npx eslint .` → 22 erros, todos em `pages/admin/grupos/[id].js` e `novo.js` (não tocados); `npm run lint` → prompt interativo (config flat não suportada pelo `next lint` 14); `npm run build` → falha em `pages/api/admin/users/[id]/block.js` (import inexistente, pré-existente)
- Pendências: T031 parcial — quickstart 1–6 executado (ver Fase 3); passos 7–11 (painel com sessão real, reexecução pela UI, calendário, 403 para support/finance/user) dependem de login Google e ficam com o usuário; sem sessão, as rotas `/api/admin/rotinas*` e `/api/admin/calendario` já redirecionam (307) para o login. Lint do projeto bloqueado por B-07/B-08 (pré-existentes, registrados no backlog)
- Atualização 2026-11-20 (após decisão do usuário): T032 corrigiu o import de `block.js`; `npm run build` passa (rotas novas compiladas); `node database/setupDatabase.js` aplicado (4 coleções + índices confirmados no banco); `database/setup-indexes.js` aborta antes dos índices novos por conflito pré-existente em `walletTransactions` (B-09) — irrelevante aqui, pois `setupDatabase.js` já cria os mesmos índices

### Checklist de Release

- [X] Fase 1 (Setup) concluída
- [X] Fase 2 (Foundational) concluída
- [X] Fase 3 (US1) concluída, com quickstart passo 4 (concorrência real) aprovado
- [X] Fase 4 (US2) concluída
- [ ] Fase 5 (US3) concluída
- [ ] Fase 6 (US4) concluída
- [X] Testes de contrato 5/5 verdes na suíte completa e `check-contract-tests.ps1 -Slug 001-rotinas-agendadas` íntegro
- [X] `npm test` verde
- [ ] `npm run lint` e `npm run build` passando
- [X] Schemas e índices das 4 coleções novas documentados e criados (Constitution IV)
- [X] Nenhum log/resposta expõe `ROTINAS_SECRET` (Constitution I)
- [ ] `quickstart.md` executado com sucesso

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: sem dependências
- **Foundational (Phase 2)**: depende do Setup — BLOQUEIA todas as user stories
- **US1 (Phase 3)** e **US2 (Phase 4)**: dependem do Foundational; independentes entre si (podem ir em paralelo). US2 não precisa do Foundational para os contratos (`lib/calendario.js` é puro), só para T009 já pronto
- **US3 (Phase 5)**: depende de US1 (executor e disparo)
- **US4 (Phase 6)**: depende de US2 (calendário) e de US3 (tela onde o componente é renderizado)
- **Polish**: depende das stories desejadas

### Parallel Opportunities

- T001 ‖ T004; T008 ‖ T009; T011 ‖ T010; T018 ‖ T019; testes `[P]` de cada fase
- Fase 3 ‖ Fase 4

---

## Implementation Strategy

### MVP First

1. Fases 1 e 2
2. Fase 3 (US1) + Fase 4 (US2) — as duas P1 juntas destravam as features consumidoras
3. **PARAR E VALIDAR**: contratos 5/5 + quickstart 1–6

### Incremental Delivery

1. MVP acima
2. US3 (painel) → quickstart 7–9, 11
3. US4 (datas extras) → quickstart 10

## Notes

- `[P]` = arquivos diferentes, sem dependência
- Contratos e helper travados: se parecerem errados, PARAR e pedir emenda (sdd-plan), nunca editar
- Commitar após cada task ou grupo lógico coerente

<!-- sdd-converge anexa "## Phase N: Convergence" abaixo desta linha -->
