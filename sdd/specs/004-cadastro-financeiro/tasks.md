---
description: "Lista de tasks da feature 004-cadastro-financeiro"
---

# Tasks: Cadastro financeiro completo sob demanda e permissões de conta

**Input**: Documentos de design de `sdd/specs/004-cadastro-financeiro/`

**Prerequisites**: plan.md, spec.md, data-model.md, contracts/api-cadastro-financeiro.md, logic/cadastro.md, quickstart.md

**Organization**: Tasks agrupadas por user story pra permitir implementação e teste independentes de cada uma.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Pode rodar em paralelo (arquivos diferentes, sem dependência)
- **[Story]**: A qual user story esta task pertence (ex: US1, US2)
- Incluir caminhos de arquivo exatos nas descrições

## Path Conventions

- Regras puras em `lib/cadastro-financeiro.js`; acesso a banco em `lib/cadastro-financeiro-servidor.js`; consulta de CEP em `lib/cep.js`; hash em `lib/encryption.js`
- APIs em `pages/api/` (Pages Router); telas em `pages/`; componente novo em `components/`
- Schema em `database/schemas/users.schema.json`; índices em `database/setupDatabase.js` **e** `database/setup-indexes.js`
- Script de migração em `scripts/migrar-cpf-usuarios.js`
- Testes adicionais em `tests/cadastro/`; contrato travado em `tests/contract/004-cadastro-financeiro.contract.test.js`
- Rodar testes de `J:\Cotea` (drive maiúsculo)

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Nada a configurar — os stubs e o contrato já foram criados pelo `sdd-plan`
(`lib/cadastro-financeiro.js`, `lib/cadastro-financeiro-servidor.js`, `lib/cep.js`,
`hashCPF` em `lib/encryption.js`, `pages/api/perfil/cadastro-financeiro.js`).

---

## Phase 2: Foundational (Blocking Prerequisites)

**Objetivo**: Regras puras, hash, consulta de CEP, gate e salvamento no servidor, schema e índice.

**⚠️ CRITICAL**: Nenhuma user story pode começar antes desta fase terminar.

### Contrato da Fase

- `valida CPF pelo dígito verificador, trava o CPF salvo e deriva o cadastro completo` — US1-AC1/AC3/AC4 · FR-001/002/005
- `valida o endereço com a consulta de CEP: confirma, recusa inexistente, aceita indisponível e não deixa voltar a incompleto` — US1-AC5/AC6/AC7 · FR-006/007/009
- Comando: `npx vitest run tests/contract/004-cadastro-financeiro.contract.test.js -t "valida"`

### Implementation

- [X] T001 [US1] Implementar `somenteDigitosCpf`, `validarCpf`, `avaliarCadastroFinanceiro` e `planejarCadastroFinanceiro` em `lib/cadastro-financeiro.js` exatamente como `logic/cadastro.md` (rua/bairro nunca vêm do CEP no servidor) → contrato: `valida CPF…`, `valida o endereço…`
- [X] T002 [P] Implementar `hashCPF` em `lib/encryption.js` conforme D-02 (HMAC-SHA256, chave derivada de `ENCRYPTION_KEY` com o rótulo `cotea:cpf-hash:v1`; entrada normalizada para dígitos; `''` para vazio)
- [X] T003 [P] Implementar `consultarCep(cep, { timeoutMs = 3000, fetchImpl = fetch })` em `lib/cep.js` conforme D-06 (nunca lança; `erro: true` → `nao_encontrado`; timeout/rede/status≠200/JSON inválido → `indisponivel`; mapeia `localidade`→`cidade`, `logradouro`→`rua`)
- [X] T004 Implementar em `lib/cadastro-financeiro-servidor.js`: `verificarCadastroFinanceiro(userId)` (D-03; recarrega por `_id` normalizado para `ObjectId`, decifra com `decryptCPF`, `null` de decifração = sem CPF), `salvarCadastroFinanceiro({ userId, enviado })` (D-05; retorna `{ ok: true, resumo }` | `{ ok: false, http, codigo, error, campos? }`) e `resumoCadastroFinanceiro(usuario)` (corpo do GET em `contracts/api-cadastro-financeiro.md`, com `mascararCPF`)
- [X] T005 [P] Atualizar `database/schemas/users.schema.json` (`cpfHash`, `cpfLegadoInvalido`, `endereco.cepConfirmado`) e criar o índice único parcial `cpfHash_unico` com **as mesmas opções** em `database/setupDatabase.js` e `database/setup-indexes.js` (data-model.md)

### Testes da Fase

- [X] T006 [P] Casos adicionais das regras puras em `tests/cadastro/regras.test.js` (variações de S/N, UF minúscula, endereço parcialmente preenchido com atual incompleto, todos vazios com atual incompleto = sem mudança, CPF com pontuação, mensagens por campo)
- [X] T007 [P] `consultarCep` com `fetchImpl` falso em `tests/cadastro/cep.test.js` (encontrado, `erro: true`, 500, JSON inválido, rejeição de rede, timeout com `timeoutMs` curto)
- [X] T008 Gate e salvamento com banco em memória em `tests/cadastro/servidor.test.js` (sem CPF, CPF legado em texto puro válido = completo, CPF cifrado inválido, endereço incompleto, completo; duplicidade por pré-checagem; erro E11000 simulado → `cpf_indisponivel`; com erro nada é gravado; `hashCPF` estável e diferente entre CPFs) e teste do B-09 continuando verde (`tests/bugs/b09-setup-indexes-conflito.test.js`)

**Critério de Conclusão**: `npx vitest run tests/contract/004-cadastro-financeiro.contract.test.js -t "valida"` → 2/2 verdes e `check-contract-tests.ps1 -Slug 004-cadastro-financeiro` íntegro; `npx vitest run tests/cadastro tests/bugs/b09-setup-indexes-conflito.test.js` verde.

**Checkpoint**: Fundação pronta - user stories podem começar.

**Registro da Fase**:

- Status: concluída (2026-11-25)
- Feito: regras puras (`validarCpf`, `enderecoValido`, `avaliarCadastroFinanceiro`, `planejarCadastroFinanceiro`) em `lib/cadastro-financeiro.js`; `hashCPF` (HMAC com chave derivada) em `lib/encryption.js`; `consultarCep` (ViaCEP, timeout 3 s, nunca lança) em `lib/cep.js`; `verificarCadastroFinanceiro`, `salvarCadastroFinanceiro`, `resumoCadastroFinanceiro`, `carregarUsuario`, `cpfClaroDoUsuario` em `lib/cadastro-financeiro-servidor.js`; schema `users.schema.json` (`cpfHash`, `cpfLegadoInvalido`, `endereco.cepConfirmado`) e índice `cpfHash_unico` idêntico em `setupDatabase.js` e `setup-indexes.js`.
- Contrato: `npx vitest run tests/contract/004-cadastro-financeiro.contract.test.js -t "valida"` → 2/2 verdes; trava íntegra.
- Testes executados: `npx vitest run tests/cadastro tests/bugs/b09-setup-indexes-conflito.test.js` → 4 arquivos, 34/34 (1 iteração); `npx eslint` nos arquivos tocados → limpo.
- Pendências: nenhuma. Obs.: rodar o Vitest pelo PowerShell a partir de `J:\Cotea` (do Bash em `/j/Cotea` falha com `reading 'config'`).

---

## Phase 3: User Story 1 - Perfil com CPF e endereço validados e protegidos (Priority: P1) 🎯 MVP

**Objetivo**: O perfil valida CPF (DV, único) e endereço (CEP), grava o CPF só cifrado com hash, trava e mascara o CPF e nunca o apaga.

**Independent Test**: Pela API e pela tela do perfil: CPF inválido, duplicado e válido; trocar/esvaziar CPF salvo; CEP inexistente, CEP geral; apagar rua de cadastro completo.

### Contrato da Fase

- `PUT/GET do cadastro: CPF único sem revelar a outra conta, gravado cifrado com hash, travado e nunca devolvido completo` — US1-AC2/AC3/AC4 · FR-003/004/005/010
- Comando: `npx vitest run tests/contract/004-cadastro-financeiro.contract.test.js -t "PUT/GET"`

### Implementation

- [X] T009 [US1] Implementar `GET/PUT` em `pages/api/perfil/cadastro-financeiro.js` usando `resumoCadastroFinanceiro` e `salvarCadastroFinanceiro` (contrato em `contracts/api-cadastro-financeiro.md`; sessão por `getServerSession` de `next-auth`) → contrato: `PUT/GET do cadastro…`
- [X] T010 [US1] Em `pages/api/atualizarPerfil.js`: GET sem `cpf`, com `cpfMascarado`/`cpfTravado` (inclusive admin consultando outro e-mail); POST delega `cpf`/`endereco` a `salvarCadastroFinanceiro` e só depois grava os demais campos; remover o `cpf: encryptCPF(cpfDigitos)` incondicional; erros com `message` + `codigo` (+ `campos`)
- [X] T011 [US1] Em `pages/perfil.js`: CPF travado exibido mascarado, só leitura, com o aviso "para corrigir, fale com o suporte"; CPF editável só quando `cpfTravado` é falso; validação auxiliar com `validarCpf` de `lib/cadastro-financeiro.js`; CEP geral → cidade/UF travadas e rua/bairro editáveis e obrigatórios; exibir mensagens/`campos` do servidor

- [X] T011a [US1] (descoberta em T011) Criar `pages/api/cep/[cep].js` (GET, sessão obrigatória, usa `lib/cep.js`) e fazer `components/EnderecoCampos.js` consultar o CEP por ele: a CSP do site (`connect-src 'self'` em `next.config.mjs`) bloqueia o ViaCEP direto do navegador (R-010)
- [X] T011b [US1] (descoberta em T011) Extrair os campos de endereço para `components/EnderecoCampos.js` (reusado no formulário embutido, T021), consultando o CEP só quando o usuário o altera — a versão antiga consultava ao abrir e, com a CSP, apagava UF/cidade/bairro/rua salvos

### Testes da Fase

- [X] T012 [US1] `tests/cadastro/atualizar-perfil.test.js`: POST sem CPF não apaga o CPF salvo; POST com CPF diferente mantém o salvo; GET (próprio e admin) sem CPF completo; CPF duplicado → 409 com `message`

**Critério de Conclusão**: `npx vitest run tests/contract/004-cadastro-financeiro.contract.test.js -t "PUT/GET"` → 1/1 verde e trava íntegra; `npx vitest run tests/cadastro` verde; passo 3 do `quickstart.md` validado na tela do perfil.

**Checkpoint**: User Story 1 funcional e testável isoladamente.

**Registro da Fase**:

- Status: concluída (2026-11-25)
- Feito: `GET/PUT /api/perfil/cadastro-financeiro`; `atualizarPerfil` com GET sem CPF completo (também para admin; sem `cpfHash`/`cpfLegadoInvalido`) e POST delegando CPF/endereço a `salvarCadastroFinanceiro` (não apaga mais o CPF; sem `endereco` no corpo não mexe no endereço); `pages/perfil.js` com CPF travado/mascarado e validação auxiliar; `components/EnderecoCampos.js`; proxy `GET /api/cep/[cep]`. Leitura/gravação do cadastro movidas para `lib/cadastro-financeiro-perfil.js` (R-009).
- Contrato: `npx vitest run tests/contract/004-cadastro-financeiro.contract.test.js -t "PUT/GET"` → 1/1 verde; trava íntegra.
- Testes executados: `npx vitest run tests/cadastro` → 5 arquivos, 33/33 (inclui `atualizar-perfil.test.js`, 6 casos); `npx eslint` nos arquivos tocados → limpo. Navegador (Playwright, só leitura, sessão admin): perfil abre preservando a rua salva; CEP 01001000 preenche e trava cidade/UF via proxy; CPF com DV errado barrado na tela sem POST. 2 iterações no endpoint (mock do contrato expõe só o gate → R-009).
- Pendências: salvar CPF/endereço pela tela contra o banco não foi exercitado (grava no banco de produção) — fica para o `quickstart.md` em T043 com usuário de teste. O CPF legado do usuário admin não passa no DV (R-011): a tela o trata como ausente, conforme a spec.

---

## Phase 4: User Story 2 - Exigência do cadastro completo na conclusão de ações financeiras (Priority: P1)

**Objetivo**: As cinco ações financeiras recusam cadastro incompleto no servidor, antes de qualquer efeito, com o código e as pendências.

**Independent Test**: Chamar as cinco APIs com usuário incompleto e conferir 409 + pendências e ausência de efeitos; com cadastro completo, comportamento igual ao de antes.

### Contrato da Fase

- `pagamento, depósito PIX, saque, uso de saldo e criação de grupo recusam cadastro incompleto sem nenhum efeito` — US2-AC1..AC4 · FR-011/012/013 · SC-001
- Comando: `npx vitest run tests/contract/004-cadastro-financeiro.contract.test.js -t "recusam cadastro incompleto"`

### Implementation

- [X] T013 [P] [US2] Gate em `pages/api/assinaturas/pay.js` logo após a checagem de `contaValidada`, antes de ler `grupoId`/grupo (D-03) → contrato: `…recusam cadastro incompleto…`
- [X] T014 [P] [US2] Gate em `pages/api/pix/simulated/create.js` logo após `contaValidada`, antes do rate limit e da validação de `amount` → contrato: `…recusam cadastro incompleto…`
- [X] T015 [P] [US2] Gate em `pages/api/withdraw/create.js` logo após `contaValidada`, antes de validar corpo e de `ensureWallet` → contrato: `…recusam cadastro incompleto…`
- [X] T016 [P] [US2] Gate em `pages/api/wallet/pay.js` logo após a sessão, antes de validar `amount` e de `ensureWallet` (D-11) → contrato: `…recusam cadastro incompleto…`
- [X] T017 [P] [US2] Gate em `handleCreate` de `pages/api/grupos/index.js` logo após a checagem de bloqueio (B-05), antes de validar o corpo → contrato: `…recusam cadastro incompleto…`
- [X] T018 [US2] Em todos os cinco handlers, responder `res.status(verificacao.http).json(verificacao.body)` sem alterar o corpo; o bloqueado continua barrado só na criação de grupo (FR-017)

### Testes da Fase

- [X] T019 [US2] `tests/cadastro/gate-handlers.test.js`: com o gate real e banco em memória, usuário bloqueado com cadastro completo passa do gate em `pay`, `pix` e `saque`; criação de grupo por bloqueado completo → 403 de conta bloqueada (não 409)
- [X] T020 [US2] Ajustar os testes existentes que chamam esses handlers para mockar `lib/cadastro-financeiro-servidor` com `{ ok: true, cpf: '52998224725', usuario }`: `tests/bugs/b04-pagamento-grupo-indisponivel.test.js`, `tests/bugs/b05-bloqueado-cria-grupo.test.js`, `tests/bugs/pay-aceita-fatura-estornada.test.js`, `tests/preco/handler-pay.test.js`, `tests/preco/handlers-grupos.test.js` (nenhum é contrato travado; não alterar as asserções)

**Critério de Conclusão**: `npx vitest run tests/contract/004-cadastro-financeiro.contract.test.js -t "recusam cadastro incompleto"` → 1/1 verde e trava íntegra; `npm test` inteiro verde (inclui os contratos 001-003 e os testes ajustados em T020).

**Checkpoint**: User Story 2 funcional e testável isoladamente.

**Registro da Fase**:

- Status: concluída (2026-11-25)
- Feito: gate `verificarCadastroFinanceiro` (de `lib/cadastro-financeiro-servidor`) logo após sessão/`contaValidada` em `assinaturas/pay.js`, `pix/simulated/create.js`, `withdraw/create.js`, após a sessão em `wallet/pay.js` e após o bloqueio (B-05) no POST de `grupos/index.js`; resposta `res.status(verificacao.http).json(verificacao.body)` sem alterações. Testes existentes de handlers (b04, b05, pay-aceita-fatura-estornada, preco/handler-pay, preco/handlers-grupos) passam a simular o gate aprovado (só o `vi.mock`, asserções intactas).
- Contrato: `npx vitest run tests/contract/004-cadastro-financeiro.contract.test.js -t "recusam cadastro incompleto"` → 1/1 verde; travas 001-004 íntegras; `npx vitest run tests/contract` → 19/20 (o restante é o contrato da Fase 6).
- Testes executados: `npx vitest run` → 38/39 arquivos, 263/264 (única falha: contrato da Fase 6, esperado); `npx vitest run tests/cadastro/gate-handlers.test.js` → 4/4 (gate real: incompleto 409 nas cinco ações; bloqueado completo passa em pagar/depositar/sacar/usar saldo e recebe 403 ao criar grupo); `npx eslint` nos handlers e testes → limpo. 1 iteração.
- Pendências: nenhuma.

---

## Phase 5: User Story 3 - Completar o cadastro sem sair do fluxo (Priority: P2)

**Objetivo**: As telas financeiras abrem um formulário só com as pendências e continuam a ação depois de salvar, sem perder o que foi preenchido.

**Independent Test**: Com usuário sem CPF/endereço, iniciar cada fluxo, completar no formulário embutido e concluir sem redigitar.

### Implementation

- [X] T021 [US3] Criar `components/CadastroFinanceiroForm.js` (D-08): props `pendencias`, `onSalvo`, `onCancelar`; carrega `GET /api/perfil/cadastro-financeiro`; mostra só os campos pendentes; pré-preenche endereço pelo ViaCEP no navegador (mesma lógica de `pages/perfil.js`, CEP geral libera rua/bairro); salva via `PUT`; mostra `campos`/`error` do servidor; validação auxiliar com `lib/cadastro-financeiro.js`
- [X] T022 [US3] `pages/assinatura/pagamento.js`: preservar `codigo`/`pendencias` em `erroDaApi`; em `cadastro_financeiro_incompleto` abrir o formulário e, em `onSalvo`, chamar `handleFinalizar` de novo com o mesmo grupo/meio
- [X] T023 [P] [US3] `pages/wallet/add.js`: mesmo tratamento para a recarga
- [X] T024 [P] [US3] `pages/wallet/withdraw.js`: mesmo tratamento para o saque, mantendo o valor digitado
- [X] T025 [P] [US3] `pages/admin/grupos/novo.js`: mesmo tratamento na criação, reenviando o grupo com todos os campos e a imagem já escolhidos
- [X] T026 [P] [US3] `pages/wallet/pay.js`: mesmo tratamento no uso de saldo

### Testes da Fase

- [X] T027 [US3] Validar o passo 2 do `quickstart.md` nas cinco telas (sem infraestrutura de teste de UI no projeto; registrar como validado no Registro da Fase)

**Critério de Conclusão**: passo 2 do `quickstart.md` executado nas cinco telas, com cada ação concluída após completar o cadastro e sem perda de dados; `npm run lint` limpo nos arquivos tocados.

**Registro da Fase**:

- Status: concluída (2026-11-25)
- Feito: `components/CadastroFinanceiroForm.js` (lê `GET /api/perfil/cadastro-financeiro`, mostra só as pendências, reusa `EnderecoCampos`, salva via `PUT`, chama `onSalvo` só com o cadastro completo; exporta `ehCadastroIncompleto`). Formulário embutido em `pages/assinatura/pagamento.js` (erro de `pay` e de `pix/create` carrega `cadastroIncompleto`/`pendencias`; `onSalvo` repete `handleFinalizar`), `pages/wallet/add.js`, `pages/wallet/withdraw.js`, `pages/wallet/pay.js` (envio extraído para função reexecutável) e `pages/admin/grupos/novo.js` (`criarGrupo` reenvia o mesmo payload; estado `pendenciasCadastro` declarado antes do retorno antecipado).
- Contrato: sem contrato nesta fase; travas 001-004 íntegras.
- Testes executados: `npx eslint` nas cinco telas e nos componentes → limpo (1 iteração: `useState` após retorno antecipado em `novo.js`). Navegador (Playwright, sessão admin cujo CPF legado é inválido): nas cinco telas a ação real devolveu 409, o formulário abriu pedindo só o CPF (endereço já válido) e, com o `PUT` interceptado como completo, a ação foi reenviada com o corpo idêntico ao primeiro (recarga, saque, uso de saldo, checkout PIX e criação de grupo). Banco conferido depois: nenhum grupo, pagamento, saque, fatura ou lançamento criado; usuário sem alteração.
- Pendências: o salvamento real pelo formulário (sem interceptação) fica para T043 com usuário de teste (gravaria CPF fictício travado na conta do admin).

---

## Phase 6: User Story 4 - PIX e saque usam o CPF do perfil (Priority: P2)

**Objetivo**: Checkout PIX, recarga e saque deixam de pedir CPF/chave e usam o CPF do perfil.

**Independent Test**: Depósito, checkout PIX e saque com cadastro completo, sem campo de CPF; no banco, o CPF gravado é o do perfil mesmo com outro CPF no corpo.

### Contrato da Fase

- `depósito PIX e saque gravam o CPF do perfil, ignorando o CPF/chave enviados, e o saque dispensa a chave` — US4-AC1..AC3 · FR-015/016
- Comando: `npx vitest run tests/contract/004-cadastro-financeiro.contract.test.js -t "CPF do perfil"`

### Implementation

- [X] T028 [US4] `pages/api/pix/simulated/create.js`: `pixCpf = encryptCPF(verificacao.cpf)`; remover a leitura de `req.body.cpf` e a cópia local de `validarCpf` (D-01/D-07) → contrato: `…CPF do perfil…`
- [X] T029 [US4] `pages/api/withdraw/create.js`: `pixKeyCpf = encryptCPF(verificacao.cpf)`; remover `cpfPixKey` e `CPF_REGEX` (D-07) → contrato: `…CPF do perfil…`
- [X] T030 [P] [US4] `pages/assinatura/pagamento.js` e `pages/wallet/add.js`: remover campo, estado e validação de CPF; `confirmarPix`/criação enviam só `amount`
- [X] T031 [P] [US4] `pages/wallet/withdraw.js`: remover o campo de chave; mostrar "Chave PIX: CPF `***.ddd.ddd-**`" a partir de `GET /api/perfil/cadastro-financeiro`

### Testes da Fase

- [X] T032 [US4] Em `tests/cadastro/gate-handlers.test.js`: PIX sem `cpf` no corpo → 201 (antes era 400 "CPF invalido")

**Critério de Conclusão**: `npx vitest run tests/contract/004-cadastro-financeiro.contract.test.js -t "CPF do perfil"` → 1/1 verde e trava íntegra; passo 4 do `quickstart.md` validado.

**Registro da Fase**:

- Status: concluída (2026-11-25)
- Feito: `pix/simulated/create.js` grava `pixCpf = encryptCPF(verificacao.cpf)` e não lê mais `req.body.cpf` (cópia local de `validarCpf` removida); `withdraw/create.js` grava `pixKeyCpf = encryptCPF(verificacao.cpf)`, sem `cpfPixKey`/`CPF_REGEX`. Telas: checkout e recarga sem campo/estado/validação de CPF (aviso "O Pix sera gerado com o CPF do seu cadastro financeiro"); saque sem campo de chave, mostrando "CPF ***.ddd.ddd-**" a partir de `GET /api/perfil/cadastro-financeiro` (atualizado após o formulário embutido); imports sem uso removidos de `wallet/add.js`.
- Contrato: `npx vitest run tests/contract` → 20/20 verdes (inclui "…gravam o CPF do perfil…"); travas 001-004 íntegras.
- Testes executados: `npx vitest run` → 40 arquivos, 269/269; `tests/cadastro/gate-handlers.test.js` ganhou o caso de PIX sem `cpf` (201 com o CPF do perfil); `npx eslint pages/wallet pages/assinatura/pagamento.js tests/cadastro` → limpo. Navegador (só leitura): recarga, saque e checkout sem nenhum campo de CPF; saque mostra o aviso de CPF do titular; botão do checkout habilita após carregar o preço. 1 iteração.
- Pendências: nenhuma.

---

## Phase 7: User Story 5 - Correção de CPF pelo admin do sistema (Priority: P3)

**Objetivo**: Admin corrige CPF de outro usuário, com motivo e auditoria sem CPF.

**Independent Test**: Como admin, corrigir com/sem motivo, CPF duplicado/válido, o próprio CPF; como support/finance, tentar.

### Implementation

- [X] T033 [P] [US5] `lib/authz.js`: `PERMISSIONS.CORRIGIR_CPF = ['admin']` (D-09)
- [X] T034 [US5] Criar `pages/api/admin/users/[id]/cpf.js` (PUT) conforme `contracts/api-cadastro-financeiro.md`, reusando `validarCpf`, `hashCPF`, `encryptCPF` e a mesma checagem de duplicidade de `salvarCadastroFinanceiro`; `logAudit` após gravar
- [X] T035 [US5] `pages/admin/index.js`: ação "Corrigir CPF" na lista de usuários (só para quem tem `CORRIGIR_CPF`), com campos CPF e motivo e exibição do resultado mascarado

### Testes da Fase

- [X] T036 [US5] `tests/cadastro/admin-corrigir-cpf.test.js`: sucesso com auditoria `user.cpf_corrected` cujo `details` não contém o CPF (nem mascarado); motivo vazio → 400; CPF inválido → 400; duplicado → 409; próprio id → 403; `support`/`finance` → 403

**Critério de Conclusão**: `npx vitest run tests/cadastro/admin-corrigir-cpf.test.js` verde; passo 5 do `quickstart.md` validado.

**Registro da Fase**:

- Status: concluída (2026-11-25)
- Feito: `PERMISSIONS.CORRIGIR_CPF = ['admin']` em `lib/authz.js`; `PUT /api/admin/users/[id]/cpf` (motivo obrigatório até 500 caracteres, `validarCpf`, duplicidade por `cpfEmUsoPorOutraConta` + captura de E11000, `encryptCPF` + `hashCPF`, recusa o próprio id, `logAudit('user.cpf_corrected', { motivo })` sem CPF); ação "Corrigir CPF" na aba Usuarios de `pages/admin/index.js` (só com a permissão e nunca na própria linha; "Salvar CPF" desabilitado sem motivo; lista atualiza com o CPF mascarado).
- Contrato: sem contrato nesta fase; trava 004 íntegra.
- Testes executados: `npx vitest run tests/cadastro/admin-corrigir-cpf.test.js` → 5/5; `npx vitest run` → 41 arquivos, 274/274; `npx eslint` nos arquivos da fase → sem erros (1 aviso pré-existente de `useMemo` em `admin/index.js`). Navegador (sessão admin, sem gravar): 4 usuários, 3 botões "Corrigir CPF" e nenhum na própria linha; formulário abre, "Salvar CPF" desabilitado sem motivo, cancelar fecha; CPFs da lista mascarados. 1 iteração (a sessão do navegador expirou no meio e o usuário fez login de novo).
- Pendências: nenhuma.

---

## Phase 8: User Story 6 - Migração dos cadastros existentes (Priority: P3)

**Objetivo**: CPFs legados cifrados e com hash, inválidos tratados como ausentes, conflitos reportados; idempotente.

**Independent Test**: Planejar a migração sobre lista com CPF em texto puro, inválido, duplicado e já cifrado; reexecutar → 0 ações.

### Implementation

- [X] T037 [US6] Implementar `planejarMigracaoCpf` em `lib/cadastro-financeiro.js` conforme `logic/cadastro.md`
- [X] T038 [US6] Criar `scripts/migrar-cpf-usuarios.js` no padrão de `scripts/migrar-precos-grupos.js` (dry-run padrão, `--aplicar`, relatório sem CPF, `logAudit`/`auditLogs` `user.cpf_migrado` por usuário alterado, sai com código ≠ 0 se houver conflito; `marcar_invalido` move o valor cifrado para `cpfLegadoInvalido` e remove `cpf`/`cpfHash`)

### Testes da Fase

- [X] T039 [US6] `tests/cadastro/migracao-cpf.test.js`: texto puro válido → `criptografar`; cifrado sem hash → `definir_hash`; inválido → `marcar_invalido`; duplicados → conflito sem ação para nenhum deles; segunda passada sobre o resultado → 0 ações

**Critério de Conclusão**: `npx vitest run tests/cadastro/migracao-cpf.test.js` verde; dry-run do script roda sem gravar.

**Registro da Fase**:

- Status: concluída (2026-11-25)
- Feito: `planejarMigracaoCpf` em `lib/cadastro-financeiro.js` (texto puro válido → `criptografar`; cifrado sem hash ou com hash divergente → `definir_hash`; inválido → `marcar_invalido`; CPF repetido → conflito sem ação para nenhuma das contas; resumo por tipo). `scripts/migrar-cpf-usuarios.js`: dry-run padrão, `--aplicar` grava; `marcar_invalido` move o valor (cifrado) para `cpfLegadoInvalido` e remove `cpf`/`cpfHash`; auditoria `user.cpf_migrado` com `{ tipo }`; com conflito sai com código 2 e não grava nada; não imprime CPF.
- Contrato: sem contrato nesta fase; trava 004 íntegra.
- Testes executados: `npx vitest run tests/cadastro/migracao-cpf.test.js` → 3/3 (classificação, conflito, idempotência); `npx eslint` → limpo; `node --check` do script → ok. Dry-run contra o banco (só leitura): `node --env-file=.env.local scripts/migrar-cpf-usuarios.js` → 4 usuários, 1 `marcar_invalido` (admin, CPF legado inválido — R-011), 3 sem CPF, 0 conflitos, exit 0.
- Pendências: aplicar a migração e criar o índice é T042 (precisa de autorização do usuário — banco de produção).

---

## Phase 9: Polish & Cross-Cutting Concerns

**Purpose**: Documentação, migração real e validação final.

- [X] T040 Atualizar `.docs/regras-negocio-v2.md`: Fluxo 3 (CPF com dígito verificador, único, travado, mascarado; PIX e saque usam o CPF do perfil), "Usuário validado" (gap resolvido) e a inclusão do uso de saldo (`wallet/pay`) no cadastro exigido (D-11)
- [X] T041 [P] Atualizar `CLAUDE.md` (toda ação financeira nova chama `verificarCadastroFinanceiro`; CPF só via `encryptCPF` + `hashCPF`) e, em `.planning/backlog.md`, anotar na V2-17 que a chave = CPF do perfil já foi entregue pela 004
- [X] T042 **Com autorização do usuário** (banco de produção): rodar a migração conforme `quickstart.md` (dry-run → `--aplicar` → dry-run com 0 ações) e só então `node database/setupDatabase.js` para criar o índice; parar e reportar se houver conflito
  - **Feito em 2026-11-25** (autorizado pelo usuário): dry-run → 1 `marcar_invalido` (admin), 0 conflitos; `--aplicar` → 1 alterado + auditoria `user.cpf_migrado`; dry-run de novo → 0 ações; `node database/setupDatabase.js` → índice `cpfHash_unico` (único, parcial `cpfHash: { $type: 'string' }`) criado.
- [X] T043 Executar o `quickstart.md` ponta a ponta (passos 1-6), com usuários de teste `@example.invalid` limpos ao final
  - **Parcial (2026-11-25)**: executado no servidor real (sessão admin): CPF de outra conta → 409 `cpf_indisponivel` sem vazar id/e-mail; CPF com DV errado → 400; CEP inexistente → 400 "CEP nao encontrado" (consulta ViaCEP pelo servidor funcionando); correção pelo admin sem motivo → 400, do próprio CPF → 403, com motivo → 200 + `user.cpf_corrected` só com o motivo; gate barra o admin (CPF inválido) com 409 `pendencias: ['cpf']`; conta do admin intacta; usuário de teste e auditoria removidos. Telas validadas nas Fases 3, 5, 6 e 7. **Falta**: salvamento real pelo formulário e PIX/saque de ponta a ponta com uma conta de cadastro completo logada (só há login Google; a única conta acessível é a do admin, cujo CPF real o usuário precisa informar) — fazer após o deploy/T042.
  - **Concluído em 2026-11-25** (após T042, autorizado pelo usuário): o usuário salvou o CPF real no perfil → banco com `cpf` cifrado + `cpfHash`, `cpfLegadoInvalido` preservado; `GET /api/perfil/cadastro-financeiro` → completo, travado, mascarado, CEP confirmado. Recarga PIX de R$ 5 pela tela (sem campo de CPF) → 201/200; saque de R$ 5 pela tela (chave exibida `CPF ***.ddd.ddd-**`, corpo sem CPF) → 201. No banco, `payments.pixCpf` e `withdrawals.pixKeyCpf` cifrados e iguais ao CPF do perfil. Registros do teste apagados (1 pagamento, 1 saque, 2 lançamentos, 2 auditorias); saldo de volta ao estado anterior.
- [X] T044 Gates: `npm test`, `npm run lint`, `npm run build` (com o `next dev` parado; depois apagar `.next` e subir o dev de novo)

### Checklist de Release

- [X] Fase 2 (Fundação) concluída
- [X] Fase 3 (User Story 1) concluída
- [X] Fase 4 (User Story 2) concluída
- [X] Fase 5 (User Story 3) concluída
- [X] Fase 6 (User Story 4) concluída
- [X] Fase 7 (User Story 5) concluída
- [X] Fase 8 (User Story 6) concluída
- [X] Testes de contrato 5/5 verdes na suíte completa e `check-contract-tests.ps1 -Slug 004-cadastro-financeiro` íntegro (e os locks 001-003 íntegros)
- [X] `npm test` e `npm run lint` passando
- [X] `npm run build` passando (dev server parado durante o build)
- [X] Schema `users.schema.json` e índice `cpfHash_unico` em `setupDatabase.js` e `setup-indexes.js`, com o teste do B-09 verde
- [X] Migração aplicada e índice criado no banco (T042), com 0 conflitos
- [X] Consumidores das APIs alteradas atualizados (`contracts/api-cadastro-financeiro.md`)
- [X] `quickstart.md` executado com sucesso

---

## Dependencies & Execution Order

### Phase Dependencies

- **Foundational (Phase 2)**: bloqueia todas as user stories
- **US1 (Phase 3)** e **US2 (Phase 4)**: dependem só da Fase 2; podem ir em paralelo
- **US3 (Phase 5)**: depende de US1 (endpoint `PUT` usado pelo formulário) e US2 (resposta 409 que abre o formulário)
- **US4 (Phase 6)**: depende de US2 (o `cpf` vem do gate); T030/T031 tocam as mesmas telas da Fase 5 — fazer depois dela
- **US5 (Phase 7)**: depende da Fase 2
- **US6 (Phase 8)**: depende da Fase 2; T042 (migração real) depende de US6 e precede o deploy
- **Polish**: depende de todas

### Parallel Opportunities

- T002, T003 e T005 em paralelo com T001
- T013-T017 (handlers diferentes)
- T023-T026 (telas diferentes)

---

## Parallel Example: User Story 2

```bash
Task: "T013 [P] [US2] Gate em pages/api/assinaturas/pay.js"
Task: "T014 [P] [US2] Gate em pages/api/pix/simulated/create.js"
Task: "T015 [P] [US2] Gate em pages/api/withdraw/create.js"
Task: "T016 [P] [US2] Gate em pages/api/wallet/pay.js"
Task: "T017 [P] [US2] Gate em pages/api/grupos/index.js"
```

---

## Implementation Strategy

### MVP First (P1)

1. Fase 2: Fundação
2. Fases 3 e 4: US1 + US2 (perfil protegido + gate no servidor)
3. **PARAR E VALIDAR**: contratos 1-4 verdes, `npm test` verde

### Incremental Delivery

1. MVP (US1 + US2) → a regra vale, mesmo que a UI ainda mande o usuário ao perfil
2. US3 (formulário embutido) → US4 (CPF do perfil no PIX/saque)
3. US5 (correção pelo admin) e US6 (migração) → Polish e migração real antes do deploy

## Notes

- `[P]` = arquivos diferentes, sem dependência
- Contrato travado: nunca editar `tests/contract/004-cadastro-financeiro.contract.test.js`; os helpers em `tests/helpers/` podem ser estendidos se faltar operador no banco em memória
- Commitar após cada fase coerente

<!-- sdd-converge anexa "## Phase N: Convergence" abaixo desta linha -->

---

## Phase 10: Convergence

**Purpose**: Lacunas encontradas pelo `sdd-converge` em 2026-11-25. As pendências C-02 (migração e índice no banco) e C-03 (validação com conta de cadastro completo) continuam nas tasks **T042** e **T043**, ainda abertas — não foram duplicadas aqui.

- [X] T045 [US1] (C-01 · HIGH · FR-010, SC-005, Constitution I) Em `pages/api/usuario.js`, parar de devolver o CPF completo: remover `cpf` da resposta e devolver `cpfMascarado`/`cpfTravado` via `resumoCadastroFinanceiro` de `lib/cadastro-financeiro-perfil.js` (a rota não tem consumidores em `pages/`/`components/`; alternativa aceitável é removê-la, registrando a decisão em `plan.md`); teste em `tests/cadastro/` garantindo que a resposta não contém o CPF
- [X] T046 (C-04 · LOW · FR-011, US2, plan D-11) Emendar `spec.md` para incluir o uso de saldo (`POST /api/wallet/pay`) entre as ações que exigem cadastro completo: acrescentar a decisão em `## Clarifications` (sessão 2026-11-25) e ajustar FR-011/US2 — mudança só de documentação, já refletida em `.docs/regras-negocio-v2.md` (Fluxo 16)

**Critério de Conclusão**: T045 com teste verde e `npm test` íntegro; T046 com a spec consistente com D-11; depois, `sdd-converge` de novo (que só fecha limpo com T042 e T043 também concluídas).

**Registro da Fase**:

- Status: concluída (2026-11-25)
- Feito: `pages/api/usuario.js` deixa de devolver `cpf` e passa a devolver `cpfMascarado`/`cpfTravado` via `resumoCadastroFinanceiro` (rota mantida, só sem o CPF completo). `spec.md`: FR-011, US2 e Escopo incluem o uso de saldo da carteira; nova entrada em `## Clarifications` registrando a decisão D-11 (a resposta original da sessão fica como histórico).
- Contrato: sem contrato nesta fase; trava 004 íntegra.
- Testes executados: `npx vitest run tests/cadastro/usuario-sem-cpf.test.js` → 3/3 (cifrado, texto puro legado e sem CPF — nenhum vaza); `npx vitest run` → 43 arquivos, 280/280; `npx eslint` nos arquivos tocados → limpo.
- Pendências: T042 e T043 (abertas, dependem do deploy) — necessárias para o `sdd-converge` fechar limpo.
