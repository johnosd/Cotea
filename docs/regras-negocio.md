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
  3. user com cadastro completo:  
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

## Status de grupo
  1. Aguardando membros:  grupo está em formação. Somente quando todas as vagas estiverem preenchidas é que o administrador irá ativar o grupo e compartilhar o acesso.
  2. Fila de espera: O grupo já está assinado, mas tem alguém com saída agendada. Ao entrar para fila, você terá que aguardar a data informada no processo de inscrição para receber o acesso. Fica ligado na data que não tem erro.

  3. Assinado com vaga:O grupo já está ativo, e o acesso pode ser liberado imediatamente pelo administrador após a inscrição. Você poderá entrar em contato com ele para agilizar ainda mais o envio após se inscrever.

  Lembrando que, o administrador tem um prazo máximo de até 5 dias corridos após a ativação da inscrição, ou seja, pode variar em cada status. Não se preocupe, caso optar por cancelar a inscrição antes de receber o acesso, você terá seu pagamento estornado integralmente.

## fluxo criação de grupo
  1. usuario precisa estar no minimo validado
  2. acesso o botao criar grupo
  3. preeche as informações
  4. na hora de criar, validamos se o cadastro está completo, se não estiver, solicita para completar o cadastro
  5. se estiver com cadastro completo o grupo é criado
  6. o grupo é aprovado pelo admin do sistema que notifica o owner do grupo
  7. o dono do grupo ativa o grupo para receber membros


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
  6. o usuario paga duas faturas, a do primeiro mes e o caução
  6. apos o pagamento ele entra no grupo
  7. owner do grupo recebe notificação por email para liberar acesso ao usuario novo
  8. owner do grupo envia dados entrando no grupo clicando no usuario novo e mandando nova mensagem
  9. apos envio da mensagem novo usuario do grupo fica marcado que recebeu os dados

## Fluxo canelamento membership


# Payments

## Adicionar Saldo
  1. usuario com sessao ativa e castro completo
  2. acessar a opção Minha Carteria no menu lateral;
  3. Clique em Adicionar;
  4. Preencha o valor (mínimo R$5) e a forma de pagamento. 
  5. Assim que o pagamento for realizado e confirmado, os créditos estarão disponíveis em sua conta para pagar suas assinaturas.
  6. O prazo de confirmação do pagamento varia conforme a forma de pagamento escolhida:
  - Cartão de crédito/Pix: até 10 minutos - geralmente imediato

## Retirar Saldo
  1. usuario com sessao ativa e castro completo

## credito caucao
Créditos de assinatura ou (caução) é a forma de inibir a inadimplência antecipando o pagamento da última mensalidade para participar de um grupo. Caso algum pagamento não seja realizado, o valor será utilizado para quita-lo e o usuário terá a participação encerrada. É exigidos pelos administradores de grupos como garantia, mas fica em posse do Kotas e é devolvido pra você no final de sua assinatura.

### Como funciona? 
Quando você participa de um grupo, você paga a primeira e a última mensalidade de uma vez. Esse valor é usado quando você for cancelar pagando sua última mensalidade, ou estornado pra você se solicitado no prazo (15 dias antes do vencimento de sua fatura). 

Esse mecanismo permite que o administrador se planeje para reposição do membro e não tenha prejuízos com a assinatura. Caso você solicite o cancelamento com menos de 15 dias do vencimento, o sistema pagará sua próxima fatura e você ainda permanecerá no grupo pelo outro mês. 

Exemplo: 

Você quer participar de um serviço em que a mensalidade custa R$ 10,00

Digamos que você entra no grupo dia 01 de janeiro e ele é ativado no mesmo dia.

Seus pagamentos ficam da seguinte maneira: 
01 de Janeiro	20 reais (10 mensalidade + 10 caução na inscrição)
01 de Fevereiro	10 reais mensalidade
01 de Março	10 reais mensalidade

Suas faturas vencem todo dia 01.  Se dia 14 de março você solicitar o cancelamento veja o que acontece: 

01 de Março	10 reais mensalidade
14 de Março (solicitou cancelamento)	Sistema agenda sua saída para 01 de Abril.
01 Abril	Você é retirado do grupo e seu pagamento caução de R$10 devolvidos na sua conta do Kotas.
E se você solicitasse o cancelamento após 15 de março?

01 de Março	10 reais
16 de Março (solicitou cancelamento)	 Sistema agenda sua saída para 01 Maio.
01 Abril	Você não paga este mês, seu crédito caução é usado para pagamento.
01 Maio	Você é retirado do grupo.