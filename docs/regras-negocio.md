# Regras de Negocio

Este documento define regras e fluxos internos da aplicacao de compartilhamento
---

## Usuarios
1. Admin: Tem acesso a todos sistema de forma irretrita
2. User: Pode ser membro de grupo e dono de grupo

### Estado do Usuarios
aqui nao obrigamos o usuario fazer todo cadastro log no inicio, o cadastro acaba acontecendo em fases.
1. usuario autenticado: 
  acessos: 
    - listar grupos
2. usario validado
  - acessos: 
    - listar grupos
    - Tornar membro de grupo (mas na hora do pagamento será solicitado o cpf e restante do cadastro)
3.user com cadastro completo:  
  - acessos:
    - listar grupo
    - se tornar membro
    - cancelar participacao de grupo
    - criar grupos novos
    - fazer depositos
    - solicitar saque
    - pagar faturas

## Fluxo criacao de usuarios
1. usuario entra na plataforma como visitante
2. efetura cadastro usando conta google
3. valida cadastro
4. completa cadastro com cpf e dados bancarios

# Grupos
## pre-requisitos
    - usuario precisa estar com cadastro completo, ele consegue acessar a pagina e preencher mas na hora de salvar ele será obrigado a completar o cadstro
## regras
- Grupos devem ser aprovados pelo admin do sistema antes de ficar liberado
- O usuario criador do grupo é o admin ele podera gerenciar o grupo:
  - encerrar grupo
  - mandar mensagens para participantes
  - remover membros
  - alter valor do grupo

## fluxo criação de grupo
1. usuario precisa estar no minimo validado
2. acesso o botao criar grupo
3. preeche as informações
4. na hora de criar, validamos se o cadastro está completo, se não estiver, solicita para completar o cadastro
5. se estiver com cadastro completo o grupo é criado

## fluxo de alteracao do valor do grupo
1. usuario dono do grupo acessa o grupo
2. clica no botão alterar valor do grupo
3. o valor vai para aprovacao do admin do sistema
4. se aprovado o valor é atualizado
5. os membros recebem a notificao de alteracao de valor
6. as proximas faturas virao com o novo valor

## Fluxo de cancelamento de grupo
1. usuario dono do grupo clica no botao encerrar grupo
2. tela de exclusao perguntando motivo da exclusao do grupo aparece, ele seleciona o motivo. é também informando sobre o reembolso dos participantes. O reembolso deve ser proporcional aos dias utilizados, então os valores são devolvidos aos participantes e o owner do grupo recebe os valores proporcionais
3. o grupo é cancelado logicamente

# Membership
define regras para um usuario se tornar membro de um grupo
## pre-requisitos
    - usuario validado
## regras

## fluxo de membership
1. usuario validado com sessao ativa seleciona grupo
2. clica em assinar 
3. na tela de relacionamento marca o tipo de relacionamento no grupo
4. na tela de pagamento ele precisa colocar o cpf e dados que tornará ele ter um cadastro completo caso não tenha. 
5. escolhe forma de pagamento que é por pix ou saldo disponivel na conta
6. apos o pagamento ele entra no grupo
7. owner do grupo recebe notificação por email para liberar acesso ao usuario novo
8. owner do grupo envia dados entrando no grupo clicando no usuario novo e mandando nova mensagem
9. apos envio da mensagem novo usuario do grupo fica marcado que recebeu os dados




