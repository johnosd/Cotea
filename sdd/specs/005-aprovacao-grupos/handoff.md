# Handoff: 005-aprovacao-grupos (sdd-plan → sdd-execute)

## Contexto

- Repositório `J:\Cotea`, branch `feature/godfiles`. Next.js 14 Pages Router + MongoDB (driver v6) + NextAuth v4 (JWT) + Vitest, deploy Vercel `gru1`.
- Próximo comando: `/sdd-execute 005-aprovacao-grupos`. Backlog: **Planejada** (o script conta 63 caixas porque inclui o Checklist de Release; são 48 tasks).
- Nada foi commitado. Também está pendente de commit o bugfix `ssr-grupo-detalhe-expoe-dados-internos` (`pages/grupos/[id].js`, `lib/grupo-visao-servidor.js`, `vitest.config.mjs`, `tests/bugs/ssr-grupo-…`, `sdd/bugs/ssr-grupo-…`). Arquivos novos/alterados da feature: `lib/moderacao.js`, `lib/moderacao-servidor.js`, `lib/rotinas/aprovacao-automatica.js`, as 3 rotas stub, `tests/contract/005-…`, `tests/helpers/db-grupos-memoria.js` (estendido), `sdd/specs/005-aprovacao-grupos/*`, `.planning/backlog.md`. A spec teve US3/AC1 e Assumptions corrigidos no plan (prazo no fim do dia útil): releia-a.
- Rode tudo de `J:\Cotea` (maiúsculo); de `j:\` o Vitest falha.

## O que a feature entrega

- **US1 (P1)**: grupo nasce `em_aprovacao`; `status`/`statusDetalhado`/`moderacao`/`tipoGrupo` do cliente não dispensam nada; home, `GET /api/grupos`, detalhe (API e SSR) só mostram status efetivo `ativo`; migração dos 5 grupos atuais para aprovado (legado).
- **US2 (P1)**: fila no `/admin` (aba nova "Moderação"); só `systemRole: admin` decide (aprovar / pedir ajuste / rejeitar, texto obrigatório); suporte **só lê**.
- **US3 (P1)**: rotina da 001 aprova automaticamente no fim do 2º dia útil; grupo vai ao ar e aceita membros, com `moderacao.revisaoPendente: true`; revisão confirma ou reprova (= cancelamento pelo Cotea).
- **US4 (P2)**: dono **não edita em aprovação**, edita em ajustes, reenvia (envio+1, prazo reinicia) e desiste (→ cancelado).
- **US5 (P2)**: cancelamento pelo Cotea com motivo; **sem estorno automático** (suporte trata); nada apagado.
- Decisões do usuário que contrariam a RN: **não existe estado suspenso**; **rejeição é definitiva**; nenhum movimento financeiro nesta feature (V2-11 lê `revisaoPendente`).

## Leitura obrigatória, em ordem

1. `spec.md` — FRs 001-030 e as clarificações (duas sessões).
2. `plan.md` — Decisões Invariantes D-01…D-12, Riscos R-001…R-006, tabela de contratos.
3. `tasks.md` — 8 fases, T001-T048.
4. `data-model.md` — valores de `status`, formato de `moderacao`, migração, `_id` das notificações, auditoria.
5. `contracts/api-moderacao.md` — 3 rotas novas e mudanças nas existentes, códigos de erro.
6. `logic/moderacao.md` — tabela de transições, ordem das checagens, `executarTransicao`, rotina, visibilidade.
7. `quickstart.md` — migração e roteiro manual.
8. `.planning/memory/constitution.md`.

## Testes de contrato

- `tests/contract/005-aprovacao-grupos.contract.test.js` — 5 testes: 2 na Fase 3, 1 na Fase 4, 1 na Fase 5, 1 na Fase 6 (o da Fase 6 também usa a rota do admin e a rotina).
- `tests/helpers/db-grupos-memoria.js` — helper **travado** (0 testes). Agora suporta caminho pontuado, `$nin/$lt/$lte/$gt/$gte`, `$unset/$inc/$push($each,$slice)`, `insertMany`, `find().sort().limit()`, `_id` duplicado → `{ code: 11000 }`. **Não edite**: os testes de B-04, `get-grupo-expoe-dados-internos`, 003 e 004 também o usam.
- Rodar: `npx vitest run tests/contract/005-aprovacao-grupos.contract.test.js` (vermelho confirmado: 5/5 pelas asserções do plan; o resto da suíte, 295/295, verde após o bugfix).
- Integridade: `.\.planning\scripts\powershell\check-contract-tests.ps1 -Slug 005-aprovacao-grupos`.
- Travas de outras features que esta pode quebrar: 001 (executor/rotinas, ao registrar a rotina), 003 e 004 (criam grupo por `POST /api/grupos`; não checam `status`, devem seguir verdes). Rode `npm run test:contrato`.

## Stubs criados

- `lib/moderacao.js` — constantes **definitivas** (`STATUS_GRUPO`, `ACOES_*`, `CODIGOS_MODERACAO`, `FILTRO_GRUPOS_PUBLICOS`, limites); funções com `not implemented`. Acrescente `planejarMigracaoModeracao` (T017) e um `normalizarTexto` se quiser.
- `lib/moderacao-servidor.js` — `executarTransicao`, `notificarEventoModeracao` (stub).
- `lib/rotinas/aprovacao-automatica.js` — objeto da rotina com id `aprovacao-automatica-grupos` (stub); **ainda não registrado** em `lib/rotinas/registro.js` (T028).
- `pages/api/admin/grupos/[id]/moderacao.js`, `pages/api/grupos/[id]/moderacao.js`, `pages/api/admin/moderacao/index.js` — handlers que lançam `not implemented`.

## Armadilhas já mapeadas

- `status` ausente = `ativo` (D-02): `lib/grupo-entrada.js` e os testes de B-04/`get-grupo-…` dependem disso; o `$match` público é `FILTRO_GRUPOS_PUBLICOS` (`$or` com `$exists: false`), não `{ status: 'ativo' }`.
- `pay`/`join` **já** recusam status ≠ `ativo` (`motivoGrupoIndisponivel`, B-04): não mexa neles.
- Contrato espera códigos e nomes exatos: `moderacao_conflito`, `texto_obrigatorio`, `edicao_bloqueada_moderacao`, auditoria `grupo.moderacao.<acao>` com `actorId: 'sistema'` na automática, chave `grupo:<id>:envio:<n>`, campos `moderacao.envio/enviadoEm/revisaoPendente/aprovacao.{tipo,porId}`.
- Concorrência: o contrato chama `processarItem` duas vezes com `Promise.all`; só o `findOneAndUpdate` condicional resolve. Não faça "ler e depois `updateOne` sem filtro de status".
- Notificação com `_id` string determinístico; o fake e o Mongo lançam 11000 no repetido — capture e ignore.
- `findOneAndUpdate` no driver v6 devolve o documento direto (sem `.value`, B-06).
- O contrato do dono usa `vi.useFakeTimers({ toFake: ['Date'] })`: use `new Date()` nas rotas (não `Date.now()` de outra fonte nem horário do banco); na rotina, use o `agora` recebido.
- Prazo = `vencimentoDiasUteis(enviadoEm, 2)` de `lib/calendario.js`; não crie função nova (decisão do usuário).
- Visibilidade: não público → 404 para terceiros, sem distinguir de inexistente. Sessão que lança erro = anônimo (padrão de `podeVerCamposInternos`).
- `PUT` não pode mais ler `status`/`statusDetalhado` do body; hoje o default `status = 'ativo'` do destructuring regravaria `ativo` em qualquer edição.
- `GET /api/grupos` e as SSR usam `aggregate`, que o fake não suporta: teste o `$match` com `aggregate` mockado (T018).
- **SSR do detalhe já foi corrigido** (bug `ssr-grupo-detalhe-expoe-dados-internos`, verified 2026-11-26, R-003): `pages/grupos/[id].js` usa `identificarVisaoGrupo` de `lib/grupo-visao-servidor.js` (`{ completa, staff, dono, userId }`) e devolve ao público só `CAMPOS_PUBLICOS_GRUPO`, participantes com `nome`/`avatar` e `visao: { jaMembro, souAdmin }`. Na T013, aplique o gate de status reaproveitando esse helper (há um comentário no ponto exato, logo após calcular `visao`) e acrescente "membro atual não banido" (os membros ativos já são carregados no SSR). Na T012, prefira fazer a API usar `identificarVisaoGrupo` em vez de manter `podeVerCamposInternos` duplicado.
- T036/T041: `moderacao` não está em `CAMPOS_PUBLICOS_GRUPO` e só vai na visão completa (dono/staff). Para o aviso de cancelado ao membro, mande um campo derivado em `visao` (ex.: `visao.cancelado`), nunca o objeto `moderacao`; o motivo só vai ao dono.
- `vitest.config.mjs` ganhou um bloco `oxc` (JSX em `.js` de `pages/` e `components/`) para testes importarem `getServerSideProps` de páginas; não remova (o teste `tests/bugs/ssr-grupo-detalhe-expoe-dados-internos.test.js` depende dele).
- Vazamento residual fora de escopo: em `GET /api/grupos/[id]`, a visão pública usa `adminUser.email` como fallback de `adminNome`; remova esse fallback ao mexer no `handleGet` (T012).
- `lib/moderacao.js` não pode importar `lib/mongodb.js` (valida env na importação).
- Mensagens de API sem acento, como as atuais.

## Pendências do Analyze

- A-01, A-02 e A-03 (HIGH/MEDIUM) **resolvidos em 2026-11-26**: FR-029, edge case e SC-005 da spec alinhados a D-02 (com Clarification); SSR do detalhe corrigido pelo bug `ssr-grupo-detalhe-expoe-dados-internos`; gate de implantação conjunta (Fases 3+4+5) no Checklist de Release e no critério da Phase 3.
- A-04 · LOW · FR-006 cita "por id ou slug", mas o detalhe só aceita id · tratar como id; ajustar o texto da spec se quiser.
- A-05 · LOW · SC-006 (decidir em ≤ 3 ações) só verificado no quickstart · conferir na T048.

## Gate de pronto

- `npx vitest run tests/contract/005-aprovacao-grupos.contract.test.js` → 5/5 e `check-contract-tests.ps1 -Slug 005-aprovacao-grupos` íntegro; `npm run test:contrato` (001-005) verde.
- `npm test`, `npm run lint`, `npm run build` verdes.
- Migração em dry-run → `--aplicar` → reexecução sem alterações (T043); índice aplicado (T044).
- `quickstart.md` completo (T048), incluindo a rotina pelo painel `/admin?tab=rotinas`.
- Docs no Polish: `.docs/regras-negocio-v2.md` (T046), `CLAUDE.md` (T045), backlog V2-11/14/15 (T047), schema/índices (T004/T005).
- Validação manual no navegador é gate (constitution, item 4); não há hardware específico.
