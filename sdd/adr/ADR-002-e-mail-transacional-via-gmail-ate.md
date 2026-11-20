# ADR-002: E-mail transacional via Gmail (Nodemailer) até o lançamento

## Status

Aceita (decisão provisória com gatilho de revisão explícito)

## Data

2026-11-20

## Contexto

O Cotea envia e-mails que fazem parte do produto, não só avisos:

- código de verificação de conta (`pages/api/sendVerificationCode.js`);
- **mensagem de acesso** ao serviço compartilhado (`pages/api/grupos/[id]/acessos.js`),
  cuja entrega é prova em disputas e conta para o SLA de 5 dias;
- mensagens do dono aos membros (`pages/api/grupos/[id]/mensagens.js`);
- na v2, e-mails em eventos financeiros e de acesso (regras de negócio, Fluxo 21).

Hoje o envio usa Nodemailer com `service: 'gmail'` e senha de app (`EMAIL_USER`,
`EMAIL_PASS`). O transporter é montado separadamente em cada rota.

Na discussão da ADR-001 avaliou-se trocar por um provedor transacional. Pesaram:

- **Não há domínio próprio ainda.** Resend, SES e SendGrid exigem domínio com
  SPF/DKIM para enviar em produção com boa entrega.
- O produto está em desenvolvimento e beta fechado, com volume baixo.
- Uma conta Gmail comum tem limite diário de envio baixo (centenas por dia),
  entrega pior (remetente `@gmail.com`, risco de spam) e risco de bloqueio da
  conta por volume ou padrão de envio automatizado.

## Decisão

1. **Manter Gmail via Nodemailer** para desenvolvimento e beta fechado.
2. **Gatilho de troca obrigatório**: antes do lançamento (o mesmo marco da
   migração para Vercel Pro na ADR-001) ou ao ultrapassar ~200 e-mails por dia, o
   que vier primeiro, migrar para um provedor transacional com domínio próprio.
   O candidato preferido é o **Resend** (API simples, SDK Node, integração com a
   Vercel, plano gratuito de 3.000 e-mails por mês).
3. **Pré-requisito da troca**: comprar o domínio do Cotea e configurar SPF, DKIM e
   DMARC. O mesmo domínio vira o endereço de produção na Vercel (ADR-001).
4. **Preparação recomendada** (não bloqueante): centralizar o envio num único
   módulo, por exemplo `lib/email.js` com `enviarEmail({ para, assunto, texto })`,
   para que a troca de provedor mexa em um arquivo só. Código novo de envio deve
   usar esse módulo assim que ele existir.

## Alternativas Consideradas

### Resend já agora

- Melhor entrega e painel de envios; gratuito no volume atual.
- **Rejeitada (por enquanto):** exige domínio próprio verificado, que ainda não
  existe. Sem domínio, só envia a partir do domínio de teste do Resend e para o
  próprio e-mail da conta, o que não serve para usuários reais.

### Amazon SES

- O mais barato em volume (~US$ 0,10 por 1.000 e-mails).
- **Rejeitada:** começa em sandbox, exigindo pedido de liberação de produção à
  AWS, além de domínio próprio e mais configuração (IAM, região, bounces). É
  esforço desproporcional para o volume atual.

### SendGrid

- Provedor maduro, com bom painel.
- **Rejeitada:** plano gratuito reduzido e preço maior que Resend ou SES para o
  mesmo volume, sem vantagem que compense.

## Consequências

### Positivas

- Zero custo e zero mudança de código agora; o foco fica nas features da v2.
- A decisão de provedor fica para quando houver domínio e volume reais, com
  candidato e gatilho já definidos.

### Negativas

- **Risco de entrega**: e-mails de acesso e de verificação podem cair em spam ou
  falhar se a conta Gmail atingir o limite diário ou for bloqueada. Como a
  mensagem de acesso conta para o SLA de 5 dias e para disputas, uma falha de
  envio vira falha de produto. Aceito durante o beta fechado.
- O remetente `@gmail.com` passa menos confiança num produto que movimenta
  dinheiro.
- Enquanto o envio não for centralizado, a migração toca pelo menos três rotas
  (`sendVerificationCode`, `acessos`, `mensagens`).
- Gmail via SMTP a partir de funções serverless (ADR-001) pode sofrer bloqueio por
  login de IP desconhecido. Validar no primeiro deploy na Vercel.

### Caminho de Migração / Evolução Futura

1. Comprar o domínio e configurar SPF, DKIM e DMARC (e domínio de produção na
   Vercel, ADR-001).
2. Criar `lib/email.js` com a interface única e migrar as três rotas para ela,
   ainda com Gmail por baixo.
3. Trocar a implementação de `lib/email.js` para o Resend (`RESEND_API_KEY`) e
   mudar o remetente para o domínio próprio (ex.: `nao-responda@<dominio>`).
4. Registrar a troca como emenda a esta ADR (nota inline `**Atualização (ADR-0XX):**`),
   com uma ADR nova se o provedor final não for o Resend.
