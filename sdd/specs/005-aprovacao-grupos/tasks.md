---
description: "Tasks da feature 005-aprovacao-grupos"
---

# Tasks: Aprovação, moderação e visibilidade de grupos públicos

**Input**: Documentos de design de `sdd/specs/005-aprovacao-grupos/`

**Prerequisites**: plan.md, spec.md, data-model.md, contracts/api-moderacao.md, logic/moderacao.md, quickstart.md

**Organization**: Tasks agrupadas por user story pra permitir implementação e teste independentes de cada uma.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Pode rodar em paralelo (arquivos diferentes, sem dependência)
- **[Story]**: A qual user story esta task pertence (ex: US1, US2)
- Incluir caminhos de arquivo exatos nas descrições

## Path Conventions

- Lógica pura em `lib/moderacao.js` (sem `lib/mongodb.js`/`next-auth`); I/O em `lib/moderacao-servidor.js`; rotina em `lib/rotinas/`.
- APIs em `pages/api/` (Pages Router); telas em `pages/`; componentes de admin em `components/admin/`.
- Schemas em `database/schemas/`; índices em `database/setupDatabase.js` e `database/setup-indexes.js`; migrações em `scripts/`.
- Testes Vitest em `tests/moderacao/` (novos); contrato travado em `tests/contract/005-aprovacao-grupos.contract.test.js`; fake travado `tests/helpers/db-grupos-memoria.js`.
- Comando do contrato (de `J:\Cotea`): `npx vitest run tests/contract/005-aprovacao-grupos.contract.test.js`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Permissão e documentação de persistência.

- [X] T001 [P] Adicionar `MODERAR_GRUPOS: ['admin']` a `PERMISSIONS` em `lib/authz.js` (D-08)
- [X] T002 [P] Conferir que nenhum arquivo além dos stubs listados no plan foi criado e que `npm test` segue 280 verdes + 5 vermelhos do contrato 005

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Núcleo puro e de servidor usado por todas as stories.

**⚠️ CRITICAL**: Nenhuma user story pode começar antes desta fase terminar.

- [X] T003 Implementar `statusEfetivo`, `grupoEhPublico`, `podeVerGrupo`, `donoPodeEditar`, `moderacaoInicial`, `vencimentoAprovacao`, `planejarTransicao` (tabela completa, ordem de checagens, texto normalizado) em `lib/moderacao.js` — ver `logic/moderacao.md` §1-2 e `data-model.md`
- [X] T004 [P] Atualizar `database/schemas/grupos.schema.json` com o enum documental de `status` e o objeto `moderacao` (data-model.md)
- [X] T005 [P] Adicionar índice `grupos { status: 1, 'moderacao.enviadoEm': 1 }` em `database/setupDatabase.js` e `database/setup-indexes.js` (com comentário de uso)
- [X] T006 Implementar `executarTransicao` e `notificarEventoModeracao` em `lib/moderacao-servidor.js` (findOneAndUpdate condicional, `_id` determinístico com 11000 ignorado, `logAudit` `grupo.moderacao.<acao>` após gravar, `actorId: 'sistema'` na automática) — `logic/moderacao.md` §3

### Testes da Fase

- [X] T007 [P] Testes unitários da tabela de transições (todas as 9 ações × estados de origem válidos/inválidos), texto (vazio, espaços, 1000, 1001), `podeVerGrupo`, `statusEfetivo` legado e `vencimentoAprovacao` (sexta→terça 23:59; feriado nacional no meio; `datasExtras`) em `tests/moderacao/regras.test.js`
- [X] T008 [P] Testes de `executarTransicao` com o fake: conflito devolve 409 sem notificar/auditar; notificação repetida não duplica; histórico com `$slice` em `tests/moderacao/servidor.test.js`

**Critério de Conclusão**: T007/T008 verdes; `lib/moderacao.js` não importa `lib/mongodb.js` nem `next-auth`; suíte anterior intacta.

**Checkpoint**: Fundação pronta - user stories podem começar.

**Registro da Fase**:

- Status: concluída (2026-11-26)
- Feito: `lib/moderacao.js` completo (tabela de transições, texto, visibilidade, prazo, `adminPodeEditar`, `normalizarTexto` e o planejador de migração `planejarMigracaoModeracao` antecipado da T017); `lib/moderacao-servidor.js` (`executarTransicao`, `notificarEventoModeracao`, `donoDoGrupo`); schema `grupos.schema.json` (descrição de `status` sem `enum`, para não recusar legado; objeto `moderacao`); índice `{ status, moderacao.enviadoEm }` em `setupDatabase.js` e `setup-indexes.js`; `PERMISSIONS.MODERAR_GRUPOS` (Fase 1).
- Contrato: sem contrato nesta fase (os 5 de 005 seguem vermelhos; `check-contract-tests.ps1 -Slug 005-aprovacao-grupos` íntegro).
- Testes executados: `npx vitest run tests/moderacao tests/bugs/b09-setup-indexes-conflito.test.js` → 3 arquivos, 89/89 verdes na 1ª iteração (inclui feriado de Natal e `datasExtras`).
- Pendências: nenhuma.

---

## Phase 3: User Story 1 - Só grupos aprovados ficam públicos e aceitam entrada (Priority: P1) 🎯 MVP

**Objetivo**: Criação em `em_aprovacao`, status nunca vindo do cliente, listagem/home/detalhe só com públicos, migração dos atuais.

**Independent Test**: criar grupo com `status: 'ativo'` → fica em aprovação, fora da home, detalhe 404 para terceiros, `pay` 409; grupo legado continua listado.

### Contrato da Fase

- `criação ignora status/moderação do cliente, nasce em_aprovacao (inclusive por admin do sistema) e não aceita pagamento` — FR-002, FR-004, FR-007
- `detalhe de grupo não público responde 404 a terceiros e abre para dono, membro atual e staff` — FR-006
- Comando: `npx vitest run tests/contract/005-aprovacao-grupos.contract.test.js`

### Implementation

- [X] T009 [US1] `handleCreate` em `pages/api/grupos/index.js`: remover `status`/`statusDetalhado` do body, gravar `status: 'em_aprovacao'`, `statusDetalhado: 'em_formacao'`, `moderacao: moderacaoInicial(...)`; auditoria `grupo.created` inclui `status` → contrato: `criação ignora status…`
- [X] T010 [US1] `handleList` em `pages/api/grupos/index.js`: `$match: FILTRO_GRUPOS_PUBLICOS` como 1º estágio
- [X] T011 [P] [US1] SSR de `pages/index.js`: mesmo `$match: FILTRO_GRUPOS_PUBLICOS`
- [X] T012 [US1] `handleGet` em `pages/api/grupos/[id].js`: gate de visibilidade (`logic/moderacao.md` §5) antes de montar a resposta; reaproveitar `podeVerCamposInternos` para staff/dono e acrescentar membro atual não banido → contrato: `detalhe de grupo não público…`
- [X] T013 [US1] SSR de `pages/grupos/[id].js`: `getServerSideProps({ params, req, res })` com `getServerSession` e o mesmo gate → `{ notFound: true }`; não alterar o resto das props (R-003)
- [X] T014 [US1] `handleUpdate` em `pages/api/grupos/[id].js`: não ler `status`/`statusDetalhado` do body nem gravá-los no `$set`; checagem de estado (D-07) com `status` no filtro do `updateOne`; 409 `edicao_bloqueada_moderacao` (a regra completa do dono fecha na Fase 6)
- [X] T015 [P] [US1] `pages/admin/grupos/novo.js`: remover estados `statusGrupo`/`statusDetalhado` e seus campos do form/body; mensagem de sucesso "Grupo enviado para aprovação"
- [X] T016 [P] [US1] `pages/admin/grupos/[id].js`: remover envio de `status`/`statusDetalhado` no PUT (se houver campo na tela, retirar) e exibir o estado de moderação somente leitura
- [X] T017 [US1] Script `scripts/migrar-moderacao-grupos.js` (dry-run padrão, `--aplicar`, relatório, idempotente, auditoria `grupo.moderacao.migrado`) com planejador puro `planejarMigracaoModeracao(grupo, agora)` em `lib/moderacao.js` — tabela de `data-model.md` §Migração; cabeçalho no padrão de `scripts/migrar-precos-grupos.js`

- [X] T049 [US1] *(descoberta durante T016, R-008)* Ação `encerrar` do dono em `lib/moderacao.js`/`lib/moderacao-servidor.js` (destino `membros`) e botão "Cancelar grupo" de `pages/admin/grupos/[id].js` chamando `POST /api/grupos/[id]/moderacao` (`desistir` em aprovação/ajustes, `encerrar` em ativo); a rota em si é a T033

### Testes da Fase

- [X] T018 [P] [US1] Teste de `handleList` com `aggregate` mockado: 1º estágio é `{ $match: FILTRO_GRUPOS_PUBLICOS }`, em `tests/moderacao/listagem.test.js`
- [X] T019 [P] [US1] Teste do planejador de migração (ativo, sem status, cancelado, `inativo`, já migrado) em `tests/moderacao/migracao.test.js`
- [X] T020 [P] [US1] Teste de `PUT` por admin do sistema enviando `status: 'cancelado'` num grupo `ativo` → status permanece `ativo`, em `tests/moderacao/handlers-grupo.test.js`

**Critério de Conclusão**: os 2 contratos da fase verdes (`npx vitest run tests/contract/005-aprovacao-grupos.contract.test.js -t "criação ignora|detalhe de grupo"` → 2/2) e `check-contract-tests.ps1 -Slug 005-aprovacao-grupos` íntegro; testes de B-04 e `get-grupo-expoe-dados-internos` seguem verdes sem edição; migração em dry-run no banco de desenvolvimento lista 5 grupos aprovados e 0 não classificados. A fase pode ser concluída e commitada, mas não implantada sozinha em produção: a mudança de criação (T009) só vai ao ar junto com as Fases 4 e 5 (ver o gate no Checklist de Release da Phase 8).

**Checkpoint**: User Story 1 funcional e testável isoladamente.

**Registro da Fase**:

- Status: concluída (2026-11-26), exceto o fechamento da T049, que depende da rota do dono (T033, Fase 6).
- Feito: criação em `em_aprovacao` com `moderacao` inicial; `$match: FILTRO_GRUPOS_PUBLICOS` em `GET /api/grupos` e na SSR da home; gate de visibilidade na API (`handleGet` agora usa `identificarVisaoGrupo`, sem o `podeVerCamposInternos` duplicado; o fallback de e-mail no `adminNome` só vale na visão completa) e na SSR do detalhe (prop nova `estadoGrupo`; `visao` ficou igual por causa do teste do bug `ssr-grupo-…`); `PUT` sem `status`/`statusDetalhado`, com a regra completa do dono/admin e `status` no filtro do `updateOne` (409 `moderacao_conflito` se mudou); `DELETE` só em `ativo` (adiantado da T032); telas de criação e edição sem status; script `scripts/migrar-moderacao-grupos.js`. Desvios: R-007 (contrato emendado com aprovação) e R-008 (ação `encerrar`, T049).
- Contrato: `npx vitest run tests/contract/005-aprovacao-grupos.contract.test.js -t "criação ignora|detalhe de grupo"` → 2/2 verdes; trava íntegra (regravada após a emenda R-007).
- Testes executados: `npx vitest run` → 394 verdes, 3 vermelhos (contratos das Fases 4-6, esperado); `tests/moderacao` 99/99 (2 iterações no `handlers-grupo.test.js`: o `PUT` exige ser dono/admin do grupo, regra existente). B-04, `get-grupo-expoe-dados-internos` e `ssr-grupo-…` verdes sem edição. Dry-run da migração no banco: 5 aprovados (legado), 0 não classificados. `npx eslint` nos arquivos tocados: 0 erros (1 warning pré-existente em `pages/grupos/[id].js`).
- Pendências: a T019 foi coberta em `tests/moderacao/regras.test.js` (bloco `planejarMigracaoModeracao`), não num `migracao.test.js` separado.

---

## Phase 4: User Story 2 - Fila de moderação com aprovar, pedir ajuste e rejeitar (Priority: P1)

**Objetivo**: Admin decide na fila; suporte só lê; dono notificado.

**Independent Test**: aprovar/ajustar/rejeitar como admin pela fila; suporte recebe 403 ao decidir.

### Contrato da Fase

- `fila: suporte não decide; ajuste exige texto; admin aprova uma única vez e o dono é notificado uma vez` — FR-010, FR-011, FR-012, FR-014, FR-026
- Comando: `npx vitest run tests/contract/005-aprovacao-grupos.contract.test.js -t "fila"`

### Implementation

- [X] T021 [US2] `pages/api/admin/grupos/[id]/moderacao.js`: POST, sessão, `hasRole(MODERAR_GRUPOS)`, `ObjectId` válido, `acao ∈ ACOES_ADMIN`, delega a `executarTransicao`; respostas de `contracts/api-moderacao.md` → contrato: `fila…`
- [X] T022 [US2] `pages/api/admin/moderacao/index.js`: GET `visao=pendentes|revisao` com `GROUPS_TAB`, contagens, `podeDecidir`, `venceEm` via `vencimentoAprovacao` (com `carregarDatasExtras(db)`), dono via `users`, limite 200
- [X] T023 [US2] `components/admin/ModeracaoTab.js`: duas visões (Pendentes / Revisão posterior), cartão com os campos do FR-009 e histórico, prazo restante, botões só com `podeDecidir`, textarea obrigatória para ajuste/rejeição/cancelamento/reprovação, estado vazio, confirmação antes de decidir, mensagens de erro do `codigo`
- [X] T024 [US2] `pages/admin/index.js`: aba `{ id: 'moderacao', label: 'Moderação', roles: PERMISSIONS.GROUPS_TAB }` com contador `(pendentes + revisão)` (FR-027) e inclusão na checagem de acesso geral

### Testes da Fase

- [X] T025 [P] [US2] Testes do handler de decisão: rejeitar com motivo (final: aprovar depois → 409), pedir ajuste com texto > 1000 → 400 `texto_longo`, usuário comum → 403, grupo inexistente → 404, em `tests/moderacao/admin-moderacao.test.js`
- [X] T026 [P] [US2] Testes da fila: ordem por `enviadoEm`, `venceEm`, contagens, suporte com `podeDecidir: false`, usuário comum 403, em `tests/moderacao/fila.test.js`

**Critério de Conclusão**: contrato `fila…` verde e trava íntegra; T025/T026 verdes; aba visível para admin e suporte, ações só para admin (validação manual do quickstart passos 2-5).

**Registro da Fase**:

- Status: concluída (2026-11-26); validação manual no navegador fica para a T048.
- Feito: rota de decisões `pages/api/admin/grupos/[id]/moderacao.js` (MODERAR_GRUPOS, `ACOES_ADMIN`, IP via `getClientIp`); fila `pages/api/admin/moderacao/index.js` (contagens, `podeDecidir`, `venceEm` com `carregarDatasExtras`, dono via `users`, limite 200); `components/admin/ModeracaoTab.js` (duas visões, cartão com os campos do FR-009 e histórico, confirmação em 2 passos, texto obrigatório com contador, estado vazio; já traz as ações de revisão da T029); aba "Moderação" com contador em `pages/admin/index.js`.
- Contrato: `npx vitest run tests/contract/005-aprovacao-grupos.contract.test.js -t "fila"` → 1/1 verde (3/5 no total); trava íntegra.
- Testes executados: `npx vitest run tests/moderacao/admin-moderacao.test.js tests/contract/005-aprovacao-grupos.contract.test.js` → 11 verdes, 2 vermelhos (contratos das Fases 5 e 6, esperado), 1ª iteração. `npx eslint` nos arquivos da fase: 0 erros (warning `useMemo` pré-existente em `pages/admin/index.js`).
- Pendências: nenhuma.

---

## Phase 5: User Story 3 - Aprovação automática e revisão posterior (Priority: P1)

**Objetivo**: Rotina aprova após 2 dias úteis, uma vez, marcando revisão; admin confirma ou reprova.

**Independent Test**: grupo vencido + rotina → aprovado com `revisaoPendente: true`; repetir não muda; revisão confirma/reprova.

### Contrato da Fase

- `rotina aprova automaticamente só após o fim do 2º dia útil, uma única vez, com marca de revisão pendente` — FR-015, FR-016, FR-017, SC-003
- Comando: `npx vitest run tests/contract/005-aprovacao-grupos.contract.test.js -t "rotina"`

### Implementation

- [X] T027 [US3] Implementar `rotinaAprovacaoAutomatica` (`buscarVencidos`, `processarItem` com revalidação e renotificação idempotente) em `lib/rotinas/aprovacao-automatica.js` — `logic/moderacao.md` §4 → contrato: `rotina…`
- [X] T028 [US3] Registrar a rotina em `lib/rotinas/registro.js`
- [X] T029 [US3] Ações `confirmar_revisao` e `reprovar_revisao` disponíveis na visão "Revisão posterior" de `components/admin/ModeracaoTab.js` (a API já as aceita pela T021)

### Testes da Fase

- [X] T030 [P] [US3] Teste com `executarRotina` (001) + `tests/helpers/repositorio-rotinas-memoria.js`: duas execuções seguidas → 1 processado, depois pulado; grupo reenviado antes do vencimento do item antigo → item antigo `ignorado`, em `tests/moderacao/rotina.test.js`
- [X] T031 [P] [US3] Teste de revisão: confirmar limpa a marca; reprovar sem motivo → 400; reprovar com motivo → `cancelado` com `cancelamento.origem: 'cotea'` e notificação a dono e membros, em `tests/moderacao/revisao.test.js`

**Critério de Conclusão**: contrato `rotina…` verde e trava íntegra; contrato da 001 (`tests/contract/001-rotinas-agendadas.contract.test.js`) intacto; rotina listada no painel `/admin?tab=rotinas` e executável manualmente (quickstart passo 6).

**Registro da Fase**:

- Status: concluída (2026-11-26); execução manual pelo painel fica para a T048.
- Feito: `lib/rotinas/aprovacao-automatica.js` (`buscarVencidos` por `vencimentoAprovacao`, chave `grupo:<id>:envio:<n>`; `processarItem` via `executarTransicao` com `envioEsperado`, revalidação e renotificação idempotente); registrada em `lib/rotinas/registro.js`; ações de revisão já estavam na `ModeracaoTab` (T029, feita na Fase 4).
- Contrato: `npx vitest run tests/contract` → `rotina…` verde (4/5 de 005); contrato da 001 intacto; travas íntegras.
- Testes executados: `npx vitest run tests/contract tests/rotinas` → 54 verdes, 1 vermelho (contrato da Fase 6, esperado); `npx vitest run tests/moderacao/rotina-revisao.test.js` → 8/8, 1ª iteração.
- Pendências: nenhuma.

---

## Phase 6: User Story 4 - Ajustes, reenvio e desistência pelo dono (Priority: P2)

**Objetivo**: Dono vê estado/motivo, edita em ajustes, reenvia com novo prazo e desiste.

**Independent Test**: pedir ajuste → dono edita e reenvia (envio 2, novo prazo); editar em aprovação → 409; desistir → cancelado.

### Contrato da Fase

- `dono não edita em aprovação; em ajustes edita sem mudar status e o reenvio reinicia o prazo` — FR-003, FR-019, FR-020, US3/AC6
- Comando: `npx vitest run tests/contract/005-aprovacao-grupos.contract.test.js -t "dono não edita"`

### Implementation

- [X] T032 [US4] Fechar a regra do dono no `PUT` de `pages/api/grupos/[id].js` (`donoPodeEditar`; admin do sistema fora de finais) e restringir `DELETE` a status efetivo `ativo` (409 `edicao_bloqueada_moderacao`) → contrato: `dono não edita…`
- [X] T033 [US4] `pages/api/grupos/[id]/moderacao.js`: POST `reenviar` (conta validada, não bloqueado no banco e na sessão, `verificarCadastroFinanceiro` logo após essas checagens, como na criação) e `desistir` (só dono) via `executarTransicao` → contrato: `dono não edita…`
- [X] T034 [US4] `pages/api/meus-grupos.js`: projetar `moderacao.ultimaDecisao`, `moderacao.cancelamento`, `moderacao.revisaoPendente` (FR-022)
- [X] T035 [P] [US4] `pages/meus-grupos.js`: badge do estado (Em aprovação, Ajustes solicitados, Rejeitado, Cancelado) e texto do motivo
- [X] T036 [US4] `pages/grupos/[id].js`: banner para dono/staff quando não público (estado, texto, prazo); botões "Editar e reenviar" (ajustes; leva à edição e depois "Reenviar"), "Desistir" (em aprovação/ajustes) com confirmação; esconder "Participar" quando não público
- [X] T037 [P] [US4] `pages/admin/grupos/[id].js`: em `em_aprovacao` para o dono, formulário desabilitado com aviso; em `ajustes`, mostrar o texto do pedido e botão "Salvar e reenviar"

### Testes da Fase

- [X] T038 [P] [US4] Testes do handler do dono: desistir em ajustes → cancelado; desistir em `ativo` → 409; reenviar bloqueado → 403; reenviar com cadastro incompleto → 409 `cadastro_financeiro_incompleto`; não dono → 403; rejeitado não edita nem reenvia, em `tests/moderacao/dono-moderacao.test.js`
- [X] T039 [P] [US4] Teste de `DELETE` em `em_aprovacao`/`cancelado` → 409 e nada apagado, em `tests/moderacao/handlers-grupo.test.js`

**Critério de Conclusão**: contrato `dono não edita…` verde → com ele, os 5/5 contratos (`npx vitest run tests/contract/005-aprovacao-grupos.contract.test.js` → 5/5) e trava íntegra; T038/T039 verdes; quickstart passos 1, 3 e 9 validados.

**Registro da Fase**:

- Status: concluída (2026-11-26); passos 1, 3 e 9 do quickstart no navegador ficam para a T048.
- Feito: T032 (PUT/DELETE por estado, adiantado na Fase 3); rota do dono `pages/api/grupos/[id]/moderacao.js` (`reenviar` com conta validada, bloqueio no banco/sessão e `verificarCadastroFinanceiro`; `desistir`; `encerrar` da R-008) — fecha a T049; `GET /api/meus-grupos` projeta `moderacao` (dono: decisão, cancelamento, revisão; membro: só a origem do cancelamento); badge e motivo em `pages/meus-grupos.js`; `BannerModeracao` em `pages/grupos/[id].js` (estado, prazo, pendências/motivo, "Editar e reenviar", "Desistir do pedido"; aviso ao membro de grupo cancelado, sem motivo — adianta a T041) e CTAs de entrada ocultos quando não público (inclusive a barra móvel); tela de edição libera ao dono os campos de conteúdo em `ajustes` (imagem, subtítulo, descrição, benefícios, fidelidade, regras, link, FAQ) com "Salvar e reenviar para aprovacao", e avisa quando está em aprovação.
- Contrato: `npx vitest run tests/contract/005-aprovacao-grupos.contract.test.js` → 5/5 verdes; trava íntegra.
- Testes executados: `npx vitest run` → 52 arquivos, 423/423 verdes; `tests/moderacao/dono-moderacao.test.js` 9/9 na 1ª iteração. `npx eslint` nos arquivos da fase: 0 erros (warning pré-existente de `useMemo` em `pages/grupos/[id].js`).
- Pendências: nome do grupo continua travado na edição (comportamento existente; mudar o nome muda o slug).

---

## Phase 7: User Story 5 - Cancelamento pelo Cotea (Priority: P2)

**Objetivo**: Admin cancela grupo aprovado com motivo; grupo some, membros notificados, nada apagado.

**Independent Test**: cancelar grupo com membros → fora da home, `pay` 409, membro ainda vê o grupo cancelado, notificações, documentos preservados.

### Implementation

- [X] T040 [US5] Botão "Cancelar pelo Cotea" (motivo obrigatório, confirmação) para grupos `ativo`: na visão de revisão de `components/admin/ModeracaoTab.js` e na lista de grupos do admin (`GroupsTab` em `pages/admin/index.js` ou `pages/admin/grupos/index.js`), chamando `POST /api/admin/grupos/[id]/moderacao` com `acao: 'cancelar'`
- [X] T041 [US5] `pages/grupos/[id].js`: para membro atual de grupo cancelado, aviso "Grupo cancelado pelo Cotea. O suporte vai entrar em contato." com o motivo só para o dono

### Testes da Fase

- [X] T042 [P] [US5] Teste: cancelar `ativo` com 2 membros (1 banido) → `cancelado`, 1 notificação ao dono + 1 ao membro atual, 0 ao banido; `membrosGrupo` intacto; cancelar sem motivo → 400; cancelar `cancelado` → 409; `pay` depois → 409 `grupo_indisponivel`, em `tests/moderacao/cancelamento-cotea.test.js`

**Critério de Conclusão**: T042 verde; quickstart passo 8 validado; nenhuma escrita em `walletTransactions`/`invoices`.

**Registro da Fase**:

- Status: concluída (2026-11-26); passo 8 do quickstart no navegador fica para a T048.
- Feito: "Cancelar pelo Cotea" (motivo obrigatório, confirmação) na visão de revisão e numa visão nova "Aprovados" da `ModeracaoTab`/`GET /api/admin/moderacao?visao=aprovados` — a lista `/admin/grupos` só mostra os grupos de que o próprio staff é dono, então não servia para cancelar qualquer grupo; contrato de API atualizado. `/admin/grupos` passa a mostrar o estado de moderação e só oferece "Excluir" em grupo aprovado. T041 entregue no `BannerModeracao` (Fase 6).
- Contrato: sem contrato nesta fase (5/5 de 005 seguem verdes).
- Testes executados: `npx vitest run tests/moderacao` → 8 arquivos, 127/127 (`cancelamento-cotea.test.js` 4/4 na 1ª iteração: nada apagado, nenhum lançamento/fatura, `pay` → 409 `grupo_indisponivel`). `npx eslint` nos arquivos da fase: 0 erros.
- Pendências: nenhuma.

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Documentação, migração real e gates.

- [X] T043 Rodar `scripts/migrar-moderacao-grupos.js` em dry-run e `--aplicar` no banco (`usaComigo`), e de novo após o deploy; registrar o relatório em Execution Notes
- [X] T044 [P] Aplicar o índice novo no banco (`database/setupDatabase.js` ou `setup-indexes.js`)
- [X] T045 [P] `CLAUDE.md`: parágrafo curto sobre moderação (`status` = estado de moderação; transições só por `executarTransicao`; status nunca do cliente)
- [X] T046 `.docs/regras-negocio-v2.md`: remover "suspenso" (vira cancelamento pelo Cotea) nos estados de grupo, Fluxos 1, 4 e 5; rejeição definitiva; prazo no fim do 2º dia útil; "em aprovação/ajustes não aceita membros"; atualizar os "Gap de implementação" resolvidos; e registrar na spec (Clarifications) a decisão D-02 sobre status ausente (R-001)
- [X] T047 [P] `.planning/backlog.md`: revisar V2-14 e V2-15 (sem suspensão) e mencionar `moderacao.revisaoPendente` em V2-11
- [X] T048 Rodar a validação de `quickstart.md` completa — Playwright com a sessão logada (admin do sistema que também é o dono), `npm run dev` contra o banco `usaComigo`, grupos `[TESTE 005] A-E` apagados ao final pelo `_id` (com autorização do usuário). Passos 1-9 conferidos; não executáveis com uma sessão só, e cobertos por testes automatizados: dono não admin bloqueado em aprovação, suporte sem decidir, membro pagante e `pay` por terceiro após o cancelamento
- [X] T050 *(descoberta durante T048)* Corrida na `ModeracaoTab`: ao trocar de visão, a resposta antiga sobrescrevia a nova (itens de "Em aprovação" com ações de revisão). Só a resposta do pedido mais recente vale e os itens ficam presos à visão em `components/admin/ModeracaoTab.js`; reconferido no navegador
- [X] T051 *(descoberta durante T048)* Dono que também é admin do sistema não via "Salvar e reenviar" em `ajustes` (a condição exigia não ser admin) em `pages/admin/grupos/[id].js`; agora vale para o dono, e o reenvio foi exercitado no navegador

### Checklist de Release

- [X] Fase 2 (Foundational) concluída
- [X] Fase 3 (US1) concluída
- [X] Fase 4 (US2) concluída
- [X] Fase 5 (US3) concluída
- [X] Fase 6 (US4) concluída
- [X] Fase 7 (US5) concluída
- [ ] Gate de implantação conjunta: não implantar em produção a mudança de criação (`em_aprovacao`, T009) sem as Fases 4 (fila de moderação) e 5 (rotina de aprovação automática registrada em `lib/rotinas/registro.js`) na mesma implantação; caso contrário os grupos novos ficam presos para sempre
- [X] Testes de contrato todos verdes na suíte completa (`npm run test:contrato`, incluindo 001-004) e `check-contract-tests.ps1 -Slug 005-aprovacao-grupos` íntegro
- [X] `npm test` verde
- [X] `npm run lint` verde
- [X] `npm run build` verde
- [X] Consumidores de API atualizados na mesma mudança (home, detalhe, Meus Grupos, novo/edição de grupo, admin)
- [X] Schema e índice documentados (T004, T005) e aplicados (T044); nenhuma variável de ambiente nova
- [X] Migração aplicada e reexecutada sem alterações (T043)
- [X] `.docs/regras-negocio-v2.md` atualizado (T046)
- [X] `quickstart.md` executado com sucesso (T048)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)** → **Foundational (Phase 2)**: bloqueia todas as stories.
- **US1 (Phase 3)**: depende da Fase 2.
- **US2 (Phase 4)**: depende da Fase 2; sem US1 os grupos novos ainda nasceriam `ativo`, então entregar US1 antes.
- **US3 (Phase 5)**: depende da Fase 2 (T029 depende de T023).
- **US4 (Phase 6)**: depende de US1 (T014) e US2 (ajuste pela rota do admin, usado no contrato).
- **US5 (Phase 7)**: depende de US2 (T021, T023).
- **Polish (Phase 8)**: depende de todas.

### Parallel Opportunities

- T001/T002; T004/T005/T007/T008 (após T003/T006 para os testes); T011/T015/T016; T018-T020; T025/T026; T030/T031; T035/T037; T044/T045/T047.

---

## Parallel Example: User Story 1

```bash
Task: "T011 [P] [US1] SSR de pages/index.js com FILTRO_GRUPOS_PUBLICOS"
Task: "T015 [P] [US1] pages/admin/grupos/novo.js sem status"
Task: "T016 [P] [US1] pages/admin/grupos/[id].js sem status no PUT"
```

---

## Implementation Strategy

### MVP First (User Story 1 apenas)

1. Fases 1 e 2.
2. Fase 3 (US1): grupos novos param de ir ao ar sozinhos.
3. **PARAR E VALIDAR**: contratos de US1 verdes; até a US2 existir, o staff aprova
   manualmente no banco (não implantar US1 em produção sem US2 e US3).

### Incremental Delivery

1. US1 → US2 → US3 (as três P1 formam a entrega mínima implantável).
2. US4 → US5.
3. Polish (migração, RN, quickstart).

## Notes

- `[P]` = arquivos diferentes, sem dependência
- `[Story]` mapeia a task pra uma user story específica
- Commitar após cada task ou grupo lógico coerente
- Parar em qualquer checkpoint pra validar a story isoladamente

<!-- sdd-converge anexa "## Phase N: Convergence" abaixo desta linha -->
