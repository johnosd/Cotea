# Feature Specification: Cadastro financeiro completo sob demanda e permissões de conta

**Slug**: `004-cadastro-financeiro`

**Created**: 2026-11-25

**Status**: Convergida

**Input**: Backlog `V2-04 · P1 · Cadastro financeiro sob demanda e permissões de
conta` — especificar o estado "cadastro financeiro completo", separado de
`contaValidada`, exigido só ao concluir o primeiro pagamento/depósito, saque ou
criação de grupo (formulário pode ser preenchido antes); validar CPF com dígito
verificador também no perfil; definir se o CPF do PIX é salvo no perfil;
usuário bloqueado não cria grupo, mas paga, participa e saca. Fonte:
`.docs/regras-negocio-v2.md` linhas 161-176 (Usuário validado), 236-242
(estados do usuário), 345-368 (Fluxo 3) e 1005 (bloqueio). Evidência: o perfil
só confere 11 dígitos (`pages/api/atualizarPerfil.js:69-72`), enquanto o PIX
valida o algoritmo (`pages/api/pix/simulated/create.js:35-53`); a criação de
grupo exige só conta validada (`pages/api/grupos/index.js:66-74`).

Achados adicionais no levantamento (2026-11-25):

- Salvar o perfil sem CPF grava CPF vazio e **apaga o CPF existente**
  (`pages/api/atualizarPerfil.js`, `cpf: encryptCPF(cpfDigitos)` incondicional).
- A API do perfil devolve o CPF completo descriptografado ao próprio usuário.
- No banco, 1 de 4 usuários tem CPF, e ele está salvo em texto puro (legado,
  `decryptCPF` aceita com aviso); os outros 3 não têm CPF nem endereço.
- O saque aceita qualquer CPF de 11 dígitos como chave
  (`pages/api/withdraw/create.js:31-37`) e o depósito/checkout PIX pede CPF a
  cada pagamento, sem relação com o perfil.
- A consulta de CEP do perfil (serviço público ViaCEP) roda só no navegador; o
  servidor não confere o endereço.

## Escopo

### Incluído

- Definição do estado derivado **cadastro financeiro completo**: CPF válido
  (com dígito verificador) e único entre contas + endereço válido.
- Validação e proteção do CPF e do endereço no perfil: dígito verificador,
  unicidade, armazenamento sempre criptografado, CPF travado após salvo,
  exibição mascarada, endereço editável mas nunca de volta a incompleto.
- Exigência do cadastro completo, verificada no servidor, para **concluir**:
  pagamento de assinatura (por qualquer meio, inclusive saldo), uso de saldo da
  carteira, depósito PIX
  (inclusive a recarga feita dentro do checkout), solicitação de saque e criação
  de grupo.
- Conclusão do cadastro **dentro do próprio fluxo** (checkout, recarga, saque,
  criação de grupo), pedindo só o que falta e preservando o que já foi
  preenchido.
- PIX (checkout e recarga) e saque passam a usar o CPF do perfil: nenhum desses
  fluxos pede CPF ao usuário; a chave PIX do saque é sempre o CPF do perfil.
- Correção de CPF apenas por admin do sistema, com motivo e auditoria.
- Migração dos usuários existentes: CPF em texto puro passa a ser
  criptografado; CPF salvo inválido passa a contar como ausente; conflitos de
  duplicidade são reportados.
- Manutenção da regra de bloqueio: bloqueado não cria grupo, mas completa
  cadastro, paga, entra em grupo, deposita e saca.

### Fora de Escopo

- Valor mínimo de saque, taxa do provedor, prazo e fluxo do financeiro
  (V2-17); valor mínimo e taxa de depósito (V2-18).
- Organizações e criação de grupo de organização (V2-19 em diante) — quando
  existirem, seguem a mesma exigência de cadastro completo do dono.
- Repasse ao dono (V2-11) — deve reutilizar este estado quando for
  especificado; aqui não há repasse a bloquear.
- Telefone como campo obrigatório.
- Verificação de CPF ou endereço em fonte oficial (Receita Federal, bureaus).
- Mudanças no fluxo de validação de e-mail (`contaValidada`).
- Exclusão de conta e anonimização (V2-25).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Perfil com CPF e endereço validados e protegidos (Priority: P1)

O usuário informa CPF e endereço no perfil. O sistema só aceita CPF válido pelo
dígito verificador e ainda não usado por outra conta, guarda o CPF sempre
criptografado e, depois de salvo, trava o campo e o exibe mascarado. O endereço
precisa estar completo e com CEP existente; pode ser trocado depois, mas não
apagado. Salvar o perfil sem mexer no CPF nunca o apaga.

**Why this priority**: É a base de todas as outras histórias e fecha dois
riscos atuais: CPF inválido aceito no perfil e CPF apagado ao salvar.

**Independent Test**: Pela API e pela tela do perfil, salvar CPF inválido,
duplicado, válido; tentar trocá-lo; salvar sem CPF; salvar endereço com CEP
inexistente, com CEP geral e apagar um campo do endereço de um cadastro
completo.

**Acceptance Scenarios**:

1. **Given** um usuário sem CPF, **When** salva o perfil com CPF de 11 dígitos
   e dígito verificador errado, **Then** o salvamento é recusado com mensagem
   de CPF inválido e nada é gravado.
2. **Given** um CPF já salvo em outra conta, **When** outro usuário tenta
   salvá-lo, **Then** o salvamento é recusado com mensagem genérica de CPF
   indisponível, sem revelar qual conta o usa.
3. **Given** um usuário sem CPF, **When** salva um CPF válido e livre, **Then** o
   CPF é gravado criptografado, a tela passa a exibi-lo mascarado
   (`***.456.789-**`) em campo travado com o aviso "para corrigir, fale com o
   suporte", e a API do perfil não devolve mais o CPF completo.
4. **Given** um usuário com CPF salvo, **When** envia o perfil com outro CPF ou
   sem CPF, **Then** o CPF salvo permanece inalterado.
5. **Given** um endereço com CEP inexistente na consulta de CEP, **When** o
   usuário salva, **Then** o salvamento é recusado com "CEP não encontrado".
6. **Given** um CEP geral de cidade (a consulta traz só cidade e UF), **When**
   o usuário salva, **Then** cidade e UF vêm do CEP e ficam travadas, e rua e
   bairro digitados são obrigatórios.
7. **Given** um cadastro completo, **When** o usuário apaga a rua e salva,
   **Then** o salvamento é recusado e o endereço anterior continua valendo.

---

### User Story 2 - Exigência do cadastro completo na conclusão de ações financeiras (Priority: P1)

Ao concluir um pagamento de assinatura (qualquer meio), um uso de saldo da
carteira, um depósito PIX, um pedido de saque ou a criação de um grupo, o
servidor confere o cadastro
financeiro completo. Se faltar algo, a ação é recusada antes de qualquer
cobrança, débito, crédito ou gravação, com um código estável e a lista do que
falta. O usuário pode navegar e preencher formulários antes; só a conclusão é
bloqueada.

**Why this priority**: É a regra de negócio central da feature (RN:172) e a
proteção que vale mesmo se a interface for contornada.

**Independent Test**: Com um usuário sem CPF e outro sem endereço, chamar as
quatro ações diretamente na API e conferir a recusa, a lista de pendências e a
ausência de efeitos (saldo, faturas, saques, grupos inalterados); repetir com
cadastro completo e conferir que seguem como hoje.

**Acceptance Scenarios**:

1. **Given** um usuário validado sem CPF, **When** tenta pagar uma assinatura
   com saldo, **Then** recebe recusa com o código de cadastro incompleto e a
   pendência "CPF", e nenhuma fatura é criada nem saldo debitado.
2. **Given** um usuário sem endereço, **When** tenta iniciar um depósito PIX,
   **Then** recebe a recusa com a pendência "endereço" e nenhum pagamento é
   criado.
3. **Given** um usuário com cadastro incompleto, **When** pede um saque, **Then**
   recebe a recusa e nenhum saque nem reserva de saldo é criado.
4. **Given** um usuário com cadastro incompleto que preencheu o formulário de
   criação de grupo, **When** envia, **Then** o grupo não é criado e a resposta
   lista as pendências.
5. **Given** um usuário bloqueado com cadastro completo, **When** paga, entra
   em grupo, deposita ou saca, **Then** a ação segue normalmente; **When** tenta
   criar grupo, **Then** recebe a recusa de conta bloqueada.
6. **Given** um usuário com cadastro completo, **When** realiza qualquer das
   quatro ações, **Then** o comportamento é o mesmo de antes desta feature.

---

### User Story 3 - Completar o cadastro sem sair do fluxo (Priority: P2)

Quando a ação é recusada por cadastro incompleto, a própria tela (checkout,
recarga da carteira, saque, criação de grupo) abre um formulário só com os
campos que faltam. Ao salvar, a ação continua de onde parou, sem perder o que o
usuário já tinha preenchido.

**Why this priority**: Reduz o atrito que a regra cria; sem ela a regra
funciona (US2), mas obriga o usuário a sair e refazer o fluxo.

**Independent Test**: Com usuário sem CPF/endereço, iniciar cada um dos quatro
fluxos, completar no formulário embutido e confirmar que a ação conclui sem
redigitar os dados do fluxo.

**Acceptance Scenarios**:

1. **Given** um usuário sem CPF no checkout, **When** clica em finalizar,
   **Then** vê o formulário com o campo de CPF (e endereço, se faltar) e, ao
   salvar, o pagamento prossegue com o grupo e o meio já escolhidos.
2. **Given** um usuário que preencheu nome, preço, capacidade e textos de um
   grupo, **When** completa o cadastro no formulário embutido, **Then** o grupo
   é criado com todos os dados preenchidos antes.
3. **Given** um erro de validação no formulário embutido (CPF inválido,
   duplicado, CEP inexistente), **When** o usuário salva, **Then** vê a mesma
   mensagem do perfil e continua no fluxo.

---

### User Story 4 - PIX e saque usam o CPF do perfil (Priority: P2)

O checkout PIX e a recarga da carteira deixam de pedir CPF: usam o CPF do
perfil. O saque deixa de pedir chave: a chave PIX é sempre o CPF do perfil,
exibido mascarado na confirmação.

**Why this priority**: Garante um único CPF por conta em todo o dinheiro que
entra e sai (base do saque com chave = CPF próprio, RN:368) e elimina a
digitação repetida.

**Independent Test**: Fazer um depósito, um checkout via PIX e um saque com
cadastro completo e conferir que nenhum pede CPF, que o pagamento/saque
registra o CPF do perfil e que um CPF enviado pelo cliente é ignorado.

**Acceptance Scenarios**:

1. **Given** cadastro completo, **When** o usuário abre o checkout com PIX ou a
   recarga, **Then** não há campo de CPF e o pagamento usa o CPF do perfil.
2. **Given** cadastro completo, **When** o usuário pede saque, **Then** a tela
   mostra a chave PIX como o CPF do perfil mascarado, sem campo de chave, e o
   saque é registrado com esse CPF.
3. **Given** uma requisição que envia um CPF diferente no corpo, **When** o PIX
   ou o saque é criado, **Then** o valor enviado é ignorado e vale o CPF do
   perfil.

---

### User Story 5 - Correção de CPF pelo admin do sistema (Priority: P3)

Um admin do sistema corrige o CPF de um usuário pelo painel de usuários,
informando o novo CPF e o motivo. A correção passa pelas mesmas validações
(dígito verificador, unicidade) e fica registrada na auditoria, sem o CPF no
registro.

**Why this priority**: É a única saída para erro de digitação depois que o CPF
trava; ocorre raramente.

**Independent Test**: Como admin, corrigir o CPF de um usuário com e sem
motivo, com CPF duplicado e válido; como suporte e financeiro, tentar a mesma
ação.

**Acceptance Scenarios**:

1. **Given** um admin, **When** corrige o CPF de outro usuário com motivo e CPF
   válido e livre, **Then** o CPF é trocado (criptografado) e a auditoria
   registra autor, usuário, data e motivo, sem o CPF.
2. **Given** um admin, **When** omite o motivo ou informa CPF inválido ou já
   usado, **Then** a correção é recusada.
3. **Given** um usuário `support` ou `finance`, **When** tenta corrigir um CPF,
   **Then** recebe acesso negado.

---

### User Story 6 - Migração dos cadastros existentes (Priority: P3)

Os usuários existentes passam a seguir a regra sem exceção: completam o
cadastro na próxima ação financeira. Uma migração criptografa CPFs gravados em
texto puro, trata CPFs inválidos como ausentes e reporta CPFs repetidos entre
contas, sem apagar dados.

**Why this priority**: Necessária para o estado ser confiável na base atual,
mas a base é pequena (4 usuários) e a regra de US2 já protege as ações.

**Independent Test**: Rodar a migração numa base com CPF em texto puro, CPF
inválido, CPF duplicado e CPF já criptografado; rodar de novo e conferir que a
segunda execução não altera nada.

**Acceptance Scenarios**:

1. **Given** um CPF salvo em texto puro e válido, **When** a migração roda,
   **Then** ele passa a ser armazenado criptografado e continua o mesmo CPF.
2. **Given** um CPF salvo inválido, **When** a migração roda, **Then** ele
   deixa de contar para o cadastro completo, e o usuário pode informar um novo
   CPF no perfil (o campo não fica travado).
3. **Given** duas contas com o mesmo CPF, **When** a migração roda, **Then** o
   conflito é reportado para tratamento manual e nenhuma das contas tem dados
   apagados.
4. **Given** a migração já executada, **When** roda de novo, **Then** nada muda.

---

### Edge Cases

- Duas contas tentando salvar o mesmo CPF ao mesmo tempo: só uma conclui; a
  outra recebe "CPF indisponível".
- Consulta de CEP fora do ar ou lenta ao salvar: aceita com a validação básica
  (CEP de 8 dígitos, UF válida, campos preenchidos) e marca o endereço como
  "CEP não confirmado"; o cadastro conta como completo.
- CEP confirmado com cidade/UF diferentes das enviadas: valem cidade e UF do
  CEP.
- Número do endereço inexistente: aceita "S/N".
- Usuário com CPF legado inválido: o campo aparece vazio e editável até salvar
  um CPF válido.
- Pagamento iniciado com cadastro completo e CPF corrigido pelo admin no meio:
  o pagamento usa o CPF vigente no momento da criação; registros anteriores
  (pagamentos, saques já pedidos) não são alterados.
- Saque já solicitado antes desta feature com chave diferente do CPF do perfil:
  segue o fluxo atual de aprovação/rejeição sem alteração.
- Checkout em que o saldo é insuficiente e a recarga PIX acontece no meio: a
  exigência é avaliada uma vez no início da conclusão, antes de qualquer
  cobrança.
- Admin tentando corrigir o próprio CPF: recusado (precisa de outro admin).
- Usuário bloqueado completando o cadastro: permitido.
- Usuário com `contaValidada: false`: continua barrado antes, pela validação de
  e-mail, sem mudança.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: O sistema DEVE considerar o **cadastro financeiro completo**
  quando, e somente quando, o usuário tem CPF válido (11 dígitos, dígito
  verificador correto, não composto de um único dígito repetido) e endereço
  válido (FR-006).
- **FR-002**: O perfil DEVE recusar CPF com dígito verificador inválido, com a
  mesma regra de validação usada nos demais fluxos.
- **FR-003**: O sistema DEVE garantir que um CPF esteja associado a no máximo
  uma conta, inclusive sob gravações simultâneas, e a recusa NÃO DEVE revelar
  qual conta o usa.
- **FR-004**: O CPF DEVE ser armazenado sempre criptografado; nenhum caminho de
  gravação pode salvá-lo em texto puro.
- **FR-005**: Depois de salvo um CPF válido, o usuário NÃO DEVE conseguir
  alterá-lo nem removê-lo; envios do perfil com CPF diferente ou vazio DEVEM
  manter o CPF salvo.
- **FR-006**: O endereço é válido quando: CEP com 8 dígitos e encontrado na
  consulta de CEP; UF entre as 27 siglas; cidade, bairro e rua preenchidos;
  número preenchido (aceita "S/N"); complemento opcional. Com o CEP
  confirmado, cidade e UF DEVEM ser as do CEP.
- **FR-007**: Com a consulta de CEP indisponível no momento do salvamento, o
  sistema DEVE aceitar o endereço que passe nas demais regras de FR-006 e
  registrá-lo como "CEP não confirmado"; CEP retornado como inexistente DEVE
  ser recusado.
- **FR-008**: A validação de CPF e endereço DEVE ser feita no servidor; a
  validação na tela é só auxílio.
- **FR-009**: Em um cadastro completo, o usuário PODE alterar o endereço, mas o
  salvamento DEVE ser recusado se deixar o endereço inválido.
- **FR-010**: A exibição do CPF ao próprio usuário DEVE ser mascarada
  (`***.ddd.ddd-**`); a API do perfil NÃO DEVE devolver o CPF completo.
- **FR-011**: O servidor DEVE recusar, antes de qualquer cobrança, débito,
  crédito, reserva ou gravação, a conclusão de: pagamento de assinatura (por
  qualquer meio), uso de saldo da carteira, criação de depósito PIX,
  solicitação de saque e criação de grupo, quando o cadastro financeiro não
  estiver completo.
- **FR-012**: A recusa de FR-011 DEVE trazer um código estável (o mesmo nas
  quatro ações) e a lista do que falta (`cpf`, `endereco`), em mensagem
  compreensível ao usuário.
- **FR-013**: Navegar, abrir e preencher os formulários dessas ações NÃO DEVE
  exigir cadastro completo; só a conclusão.
- **FR-014**: Nas telas de checkout, recarga da carteira, saque e criação de
  grupo, a recusa por cadastro incompleto DEVE abrir um formulário embutido só
  com os campos pendentes, com as mesmas regras e mensagens do perfil, e, após
  salvar, DEVE permitir concluir a ação sem perder os dados já preenchidos no
  fluxo.
- **FR-015**: O checkout PIX e a recarga da carteira NÃO DEVEM pedir CPF; o
  pagamento PIX DEVE usar o CPF do perfil e ignorar qualquer CPF enviado pelo
  cliente.
- **FR-016**: A solicitação de saque NÃO DEVE pedir chave PIX; a chave DEVE ser
  o CPF do perfil, exibido mascarado na confirmação, ignorando qualquer chave
  enviada pelo cliente.
- **FR-017**: Usuário bloqueado DEVE continuar impedido de criar grupo e
  DEVE continuar podendo completar o cadastro, pagar assinatura, entrar em
  grupo, depositar e sacar.
- **FR-018**: Apenas admin do sistema DEVE poder corrigir o CPF de outro
  usuário, informando motivo obrigatório; a correção DEVE passar por FR-002,
  FR-003 e FR-004, e o admin NÃO DEVE poder corrigir o próprio CPF.
- **FR-019**: Cada correção de CPF DEVE gerar registro de auditoria com autor,
  usuário afetado, data e motivo, sem o CPF (nem mascarado).
- **FR-020**: A migração DEVE: criptografar CPFs em texto puro válidos; tratar
  CPFs inválidos como ausentes (sem apagá-los do histórico); reportar CPFs
  repetidos entre contas sem alterar nenhuma delas; e ser idempotente.
- **FR-021**: Usuários existentes NÃO DEVEM ter exceção: a exigência de FR-011
  vale na próxima ação financeira de qualquer conta.
- **FR-022**: Registros já existentes (pagamentos, saques, faturas) NÃO DEVEM
  ser alterados por esta feature nem pela correção de CPF.

### Key Entities

- **Usuário**: passa a ter CPF (criptografado, único, travado após salvo),
  endereço (CEP, UF, cidade, bairro, rua, número, complemento) com a marca
  "CEP confirmado / não confirmado", e o estado derivado "cadastro financeiro
  completo" (não é um campo editável).
- **Correção de CPF**: registro de auditoria com autor (admin), usuário
  afetado, data e motivo.
- **Relatório de migração**: contagem de CPFs criptografados, inválidos e
  conflitos de duplicidade (com as contas envolvidas, sem o CPF).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% das tentativas de pagar, depositar, sacar ou criar grupo com
  cadastro incompleto são recusadas sem nenhum efeito financeiro ou gravação,
  inclusive quando feitas direto na API.
- **SC-002**: Após a migração, 0 CPFs armazenados em texto puro e 0 pares de
  contas ativas com o mesmo CPF sem conflito reportado.
- **SC-003**: 0 casos de CPF apagado ou alterado por salvamento do perfil pelo
  próprio usuário.
- **SC-004**: Um usuário sem cadastro conclui a primeira compra completando o
  cadastro no próprio checkout, sem redigitar nenhum dado do fluxo.
- **SC-005**: Nenhuma resposta de API voltada ao próprio usuário contém o CPF
  completo após salvo.
- **SC-006**: 100% das correções de CPF têm registro de auditoria com motivo.

## Assumptions

- "Primeiro pagamento/saque/criação" (RN:172) é atendido verificando o estado
  em toda conclusão: como o CPF trava e o endereço não volta a incompleto,
  depois de completo a verificação sempre passa.
- O serviço público de CEP já usado pelo perfil continua sendo a fonte de
  confirmação; a escolha técnica (consulta no servidor, cache, tempo limite)
  fica para o `sdd-plan`.
- Contas internas (admin, suporte, financeiro) seguem a mesma regra quando
  pagam, sacam ou criam grupo em nome próprio; não há exceção por papel.
- O pagamento de assinatura com saldo também exige o cadastro completo, mesmo
  que o saldo tenha vindo de um depósito anterior.
- O CPF usado no PIX é o do titular da conta; pagamento PIX por terceiro não é
  suportado.
- Há pelo menos dois admins para que a correção do CPF de um admin seja
  possível; se houver só um, a correção do próprio CPF fica fora do produto.

## Clarifications

### Sessão 2026-11-25

- Q: O que compõe o "cadastro financeiro completo"? → A: CPF válido (dígito
  verificador) + endereço (CEP, UF, cidade, bairro, rua e número; complemento
  opcional).
- Q: Quais ações exigem o cadastro completo para concluir? → A: Pagamento de
  assinatura por qualquer meio (inclusive saldo), depósito PIX, saque e
  criação de grupo.
- Q: O CPF informado no checkout PIX deve ir para o perfil? → A: Não há mais
  CPF no checkout: o PIX sempre usa o CPF do perfil (o cadastro completo é
  exigido antes).
- Q: Depois de salvo, o usuário pode alterar o próprio CPF? → A: Não; a
  correção é pedida ao atendimento e feita por admin do sistema (ver pergunta
  sobre correção). Endereço segue editável.
- Q: Com cadastro incompleto, o que acontece ao concluir a ação? → A: O
  usuário completa no próprio fluxo, com formulário só dos campos pendentes,
  sem perder o que já preencheu.
- Q: Um mesmo CPF pode estar em mais de uma conta? → A: Não, CPF único.
- Q: Quem pode corrigir o CPF de um usuário? → A: Só admin do sistema, com
  motivo e auditoria.
- Q: Como tratar usuários existentes? → A: Sem exceção: completam na próxima
  ação financeira; CPF em texto puro é criptografado por migração; CPF salvo
  inválido conta como ausente.
- Q: Quais regras valem para o endereço? → A: Validação básica + CEP
  existente na consulta de CEP.
- Q: Depois de completo, o usuário pode apagar campos do endereço? → A: Não;
  só trocar por um endereço válido.
- Q: No saque, a chave PIX passa a vir do CPF do perfil nesta feature? → A:
  Sim; mínimo, taxa e prazo ficam no V2-17.
- Q: Como o próprio usuário vê o CPF no perfil depois de salvo? → A:
  Mascarado, em campo travado, com aviso para falar com o suporte; a API do
  perfil deixa de devolver o CPF completo.
- Q: Se a consulta de CEP estiver fora do ar ao salvar? → A: Aceita com
  formato válido e marca "CEP não confirmado"; não bloqueia a ação financeira.
- Q: CEP geral de cidade (sem rua e bairro)? → A: Cidade e UF vêm do CEP e
  ficam travadas; rua e bairro são digitados e obrigatórios.
- Q: O uso genérico de saldo da carteira (`POST /api/wallet/pay`) também exige o
  cadastro completo? → A: Sim. Decidido no `sdd-plan` (D-11) por ser
  pagamento com saldo — deixá-lo aberto seria uma brecha — e registrado aqui
  pelo `sdd-converge` (C-04); FR-011 e US2 ajustados. Reflete também o Fluxo 16
  de `.docs/regras-negocio-v2.md`.
