# Backlog

Painel único de ideias futuras e status de features/bugs geridas pelo
sistema sdd-*. Mantido automaticamente por update-feature-status.ps1 e
update-bug-status.ps1.

## Ideias Futuras

### Regras de Negócio v2 (revisadas) — candidatas para `sdd-specify` (2026-11-20)

Levantamento estático de `.docs/regras-negocio-v2.md` (versão revisada, com
organizações, taxa de 5%, aprovação automática, SLA com estorno automático e
exclusão de conta) contra o código local da branch `feature/godfiles`. Substitui
o levantamento de 2026-10-31. Cada item ainda precisa de `spec.md`; a tabela
`## Features` fica reservada para o que já passou por `sdd-specify`. A
prioridade indica a ordem sugerida de especificação, não autorização para
implementar. Validar estados e schemas reais no MongoDB antes de planejar
alterações de persistência. Referências `RN:<linha>` apontam para
`.docs/regras-negocio-v2.md`.

Ordem sugerida: fundações (V2-01 a V2-03) → bugs P0 → entrada/checkout (V2-04
a V2-07) → ciclo financeiro (V2-08 a V2-13) → disputas e fila (V2-14, V2-15)
→ saque/depósito (V2-16, V2-17) → organizações (V2-18 a V2-21) → visões,
notificações, conta e auditoria (V2-22 a V2-26).

#### Fundações

- **V2-01** — especificada em `sdd/specs/001-rotinas-agendadas/spec.md` (ver
  `## Features`).

- **V2-02** — especificada em `sdd/specs/002-ledger-segmentado/spec.md` (ver
  `## Features`).

- **V2-03** — especificada em `sdd/specs/003-preco-por-vaga/spec.md` (ver
  `## Features`).

#### Cadastro, aprovação e entrada

- **V2-04 · P1 · Cadastro financeiro sob demanda e permissões de conta** —
  Especificar o estado "cadastro financeiro completo" separado de
  `contaValidada`, exigido só ao concluir o primeiro pagamento/depósito, saque
  ou criação de grupo (formulário pode ser preenchido antes). Validar CPF com
  dígito verificador também no perfil; definir se o CPF do PIX é salvo no
  perfil. Usuário bloqueado não cria grupo, mas paga, participa e saca.
  Fonte: RN:161-176, 242, 345-368, 1005. Evidência: perfil só confere 11
  dígitos (`pages/api/atualizarPerfil.js:69-72`), enquanto o PIX valida o
  algoritmo (`pages/api/pix/simulated/create.js:35-53`); a criação de grupo
  exige só conta validada (`pages/api/grupos/index.js:66-74`).

- **V2-05 · P0 · Aprovação, moderação e visibilidade de grupos públicos** —
  Estados `em_aprovacao`, `ajustes`, `rejeitado`, `suspenso`, `cancelado` e
  estados públicos; fila do admin do sistema com aprovar/rejeitar/pedir ajuste
  e motivo; reenvio após ajuste; aprovação automática após 2 dias úteis,
  marcada na auditoria e na fila para revisão posterior, com repasse retido até
  a revisão (reprovado → suspensão e estorno); suspensão pelo Cotea. Home, API
  pública e detalhe listam só grupos públicos aprovados e não
  cancelados/suspensos. O cliente não define `status`. Grupos de organização
  não passam por aprovação (ver V2-18). Fonte: RN:255-268, 288-311, 370-449.
  Evidência: a criação aceita `status = 'ativo'` do body
  (`pages/api/grupos/index.js:61,115`) e a listagem não filtra status
  (`pages/api/grupos/index.js:18-51`). Depende de V2-01 e V2-11.

- **V2-06 · P0 · Checkout v2 com caução e elegibilidade no servidor** — Antes de
  pagar: mensalidade, caução de 1 mensalidade (ambas com 5%), taxa do meio de
  pagamento, total de hoje, próximo vencimento e prazo de acesso. Validar no
  servidor, antes de cobrar: grupo aprovado, vaga (ou fila), não ser dono, não
  ser membro, pertencer à organização, trava de saldo (V2-20). Pagamento,
  criação da participação e caução bloqueada em operação atômica, com estorno
  automático no servidor se a entrada falhar. Persistir a declaração de
  relacionamento (amigo, família, conhecido, desconhecido). Fonte: RN:485-545,
  1075-1089. Evidência: `pay` cobra só `valorPorVaga` e não checa
  status/capacidade (`pages/api/assinaturas/pay.js:15-20,46-62`); `join` grava
  `temCaucao: false` (`pages/api/grupos/[id]/join.js:166`); a UI diz
  "mensalidade + caução" com o preço simples e taxa PIX fixa de R$ 0,68
  (`pages/assinatura/pagamento.js:40-49,293`); a etapa de relacionamento só
  exibe um rádio fixo, sem gravar (`pages/assinatura/relacionamento.js:39-41`).
  Depende de V2-02 e V2-03. Absorve os bugs B-01 e B-04.

- **V2-07 · P1 · Estados de grupo/participação e grupos `apos_completar`** —
  Modelar estados de grupo (aguardando membros, aguardando assinatura com 5 dias
  para o dono, assinado com vaga, fila de espera, ativo completo) e de membro
  (na fila, aguardando acesso, ativo, cancelamento agendado, em disputa,
  cancelado/removido). Em `apos_completar`, o pagamento fica retido; sem
  completar em 30 dias, estorno integral automático de todos e encerramento do
  grupo; ao completar, notificar dono e membros. Fonte: RN:244-286, 524-530,
  1082. Evidência: hoje só existem `ativo`/`banido` e
  `statusDetalhado` `em_formacao`/`ativo`, alterado só ao completar
  (`pages/api/grupos/[id]/join.js:160-194`); sem prazo de 30 dias. Depende de
  V2-01, V2-02 e V2-06.

- **V2-08 · P1 · SLA de envio de acesso com estorno automático e prova de
  entrega** — Prazo de 5 dias corridos após pagamento/ativação aplicável;
  vencido, estorno integral automático (mensalidade + caução), remoção do
  membro, cancelamento do recebível, liberação da vaga ou avanço da fila e
  notificação ao dono. Texto da mensagem de acesso criptografado em repouso,
  legível por suporte/admin em disputa, com auditoria de cada leitura;
  notificação interna aos membros. Fonte: RN:547-576, 1090. Evidência: o envio
  grava `dataEnvioAcesso` (`pages/api/grupos/[id]/acessos.js:136-146`), mas o
  texto vai em claro para `mensagens` (`:149-162`), não há notificação interna
  nem medição de SLA. Depende de V2-01, V2-02 e V2-07.

#### Ciclo financeiro

- **V2-09 · P1 · Faturas mensais recorrentes e inadimplência** — Gerar fatura
  por participação ativa e ciclo (idempotente por grupo/membro/ciclo); avisos no
  vencimento (D0) e D2; no D3 sem pagamento, a caução quita a fatura e a saída é
  agendada para o fim do ciclo coberto. Faturas usam o preço vigente no ciclo
  (V2-13). Fonte: RN:842-861, 1092. Evidência: `createInvoice` cria fatura
  pontual (`lib/invoices.js:12-35`) acionada só pelo checkout
  (`pages/api/assinaturas/pay.js:81-90`). Depende de V2-01, V2-02 e V2-06.

- **V2-10 · P1 · Cancelamento agendado pelo membro e fidelidade** — Resumo antes
  de confirmar (próximo vencimento, dias, caução, valor a devolver, data
  efetiva); janela de 15 dias; acesso até a data efetiva; caução devolvida ao
  concluir ou usada no último ciclo fora da janela; desistência antes da data
  efetiva (estorno integral ao usuário da fila). Fidelidade conta da data de
  envio do acesso; cancelar antes dela faz a caução virar multa a favor do dono,
  e o membro paga as faturas até a saída. Fonte: RN:622-673, 1081. Evidência:
  `DELETE` apaga o membro na hora (`pages/api/grupos/[id]/join.js:30-80`), sem
  ciclo, caução ou fidelidade; `fidelidade` só é gravada no membro admin
  (`pages/api/grupos/index.js:129-143`). Depende de V2-02 e V2-09; alimenta V2-15.

- **V2-11 · P1 · Recebíveis e repasse ao dono** — Recebível por membro/ciclo
  (`T / C`), retido 30 dias a partir do envio do acesso (1º pagamento) ou do
  pagamento da fatura (demais); bloqueio automático por disputa; retenção
  estendida em grupo aprovado automaticamente até a revisão; repasse de fila só
  conta após a entrada efetiva; taxa do Cotea destacada. Fonte: RN:905-928,
  949, 1093. Evidência: não há entidade nem rotina de repasse em `lib/`,
  `pages/api/` ou `database/`; o pagamento só debita a carteira do membro
  (`pages/api/assinaturas/pay.js:99-107`). Depende de V2-01, V2-02 e V2-09.

- **V2-12 · P1 · Cancelamento antes do acesso com estorno integral** — Com
  `aguardandoEnvioAcesso: true`, mostrar estorno integral; confirmar retira a
  participação, estorna mensalidade e caução, marca a fatura como estornada,
  libera a vaga/avança a fila e notifica o dono, numa operação atômica no
  servidor (exceção: fraude comprovada). Fonte: RN:675-700, 663. Evidência:
  `DELETE` de membro não consulta pagamento (`pages/api/grupos/[id]/join.js:30-80`);
  o estorno é uma API separada, chamada pelo cliente
  (`pages/api/assinaturas/refund.js:21-105`). Depende de V2-06. Absorve B-02.

- **V2-13 · P1 · Alterações sensíveis com aprovação e vigência no próximo
  ciclo** — Dono edita conteúdo não sensível direto; preço, capacidade, status
  público, tipo de acesso e fidelidade viram pedido aprovado pelo admin do
  sistema (inclusive em grupos de organização), com cálculo de impacto por
  membro, vigência no próximo ciclo, nunca retroativa, e notificação aos
  membros. Encerramento fica fora (V2-14). Fonte: RN:200-204, 451-483.
  Evidência: `PUT` grava preço, capacidade e `status` direto
  (`pages/api/grupos/[id].js:83-152`). Depende de V2-03 e V2-09.

- **V2-14 · P1 · Encerramento direto do grupo e suspensão pelo Cotea** — Dono
  encerra sem aprovação nem aviso prévio, com motivo obrigatório; prévia do
  impacto por membro; reembolso proporcional automático
  (`mensalidade / dias do ciclo × dias não utilizados`, taxa de 5% devolvida
  proporcionalmente), caução devolvida e valor proporcional aos dias usados ao
  dono; cancelamento lógico com auditoria, sem remoção física; notificação e
  encerramento de acessos. Admin do sistema suspende grupos (fraude, denúncia,
  revisão reprovada). Falha ao remover imagem do R2 deve ser registrada.
  Fonte: RN:702-740, 262, 782, 1030-1033. Evidência: `DELETE` remove grupo e
  membros fisicamente (`pages/api/grupos/[id].js:55-80`), o `PUT` aceita
  `status` livre (`:90,143`) e a falha do R2 vira só `console.warn` (`:67-69`).
  Depende de V2-02 e V2-11.

#### Disputas e fila

- **V2-15 · P1 · Reclamações e disputas** — Abertura só por membro atual
  (inclusive com cancelamento agendado), motivos fechados, descrição e
  evidências; participação `em_disputa` e bloqueio automático do recebível;
  dono tem 3 dias para responder; suporte investiga e registra recomendação;
  admin do sistema decide (improcedente, parcial, integral, risco alto com
  suspensão) e executa o estorno em até 7 dias; o Cotea julga também as de
  organização. Encerramento pelo dono não gera disputa. Fonte: RN:742-788,
  231, 215. Evidência: não há rotas, telas nem coleções de reclamação/disputa.
  Depende de V2-01, V2-02 e V2-11.

- **V2-16 · P2 · Fila de espera por vaga futura** — Grupo ativo e cheio com
  saída agendada abre exatamente 1 vaga futura; o usuário paga na entrada
  (mensalidade + caução) e o valor fica retido; ordem de pagamento; data
  prevista exibida antes da confirmação; saída da fila ou desistência do membro
  que sairia → estorno integral; na saída efetiva, ativação e prazo de 5 dias
  para o acesso. Fonte: RN:930-954, 281, 655. Evidência: a home só deriva uma
  indicação de `pedidosSaida` (`pages/index.js:26-35`) e `join` recusa grupo
  cheio (`pages/api/grupos/[id]/join.js:154-158`). Depende de V2-06, V2-08 e V2-10.

#### Carteira

- **V2-17 · P1 · Saque v2** — Mínimo R$ 5,00; chave PIX sempre igual ao CPF do
  próprio usuário (conferido com o perfil); taxa do Mercado Pago repassada e
  exibida com prazo e destino antes da confirmação; só saldo disponível (sem
  caução, disputa, retenção); usuário bloqueado pode sacar; prazo de 2 dias
  úteis medido para o financeiro; CPF completo só para o financeiro na
  aprovação/rejeição; auditoria da solicitação. Fonte: RN:863-903, 1006, 1079-1080.
  Evidência: `create` aceita qualquer valor > 0 e qualquer CPF de 11 dígitos,
  sem comparar com o perfil e sem auditoria (`pages/api/withdraw/create.js:25-37`);
  a listagem devolve o documento cru, inclusive para suporte
  (`pages/api/withdraw/list.js:22-34`), e a tela mostra `pixKeyCpf` cifrado
  (`pages/admin/withdrawals.js:104`). Depende de V2-02 e V2-04.

- **V2-18 · P2 · Depósito PIX v2** — Mínimo R$ 5,00; taxa do provedor repassada
  e exibida antes de criar o pagamento; cadastro financeiro completo no 1º
  depósito; manter a confirmação idempotente e preparar a troca do botão
  simulado por webhook quando houver gateway real. Fonte: RN:790-819, 1079-1080.
  Evidência: `create` só exige valor > 0 e não calcula taxa
  (`pages/api/pix/simulated/create.js:48-62`). Depende de V2-04.

#### Organizações (modo corporativo)

- **V2-19 · P1 · Modelo de organização e contexto** — Entidade `organizacoes`
  criada só pelo Cotea (admin do sistema cadastra a organização e o primeiro
  admin; domínio de e-mail informativo); `organizacaoId` fixo em grupos e no
  ledger; grupos de organização publicados sem aprovação prévia e visíveis só
  aos membros; categorias iguais às do público; alternância de contexto com
  conta e carteira únicas; admin da organização não modera grupos. Fonte:
  RN:31-58, 93-105, 122-125. Evidência: não há `organizacoes` nem
  `organizacaoId` em `database/schemas/` ou nas APIs. Depende de V2-02 e V2-05.
  Provável candidata a `sdd-adr` (multi-tenant no mesmo banco).

- **V2-20 · P1 · Papéis, ingresso e aceite de transparência** — Papéis admin da
  organização, funcionário e convidado externo (só leitura: vê e entra, não
  cria); convite por e-mail ou link (login → cadastro → aceite), com expiração
  em 30 dias; solicitação de ingresso com qualquer e-mail validado e aprovação
  do admin; aceite obrigatório do que o admin vê, registrado com data (LGPD);
  sem reverificação periódica. Fonte: RN:60-77, 107-120. Evidência: nenhuma
  estrutura de convite/solicitação/aceite no código. Depende de V2-01 e V2-19.

- **V2-21 · P1 · Remoção/saída da organização e trava de saldo** — Participações
  na organização seguem o cancelamento agendado (V2-10); a conta continua;
  com saldo ≥ R$ 5,00 o usuário fica impedido de entrar em qualquer grupo até
  sacar; grupos em que é dono continuam com ele, que só entrega acesso, envia
  mensagens, recebe repasse e encerra; sem transferência de posse. Fonte:
  RN:79-91, 531. Depende de V2-10 e V2-19; a trava entra na elegibilidade de
  V2-06.

- **V2-22 · P2 · Painel do admin da organização** — Lista de membros, grupos da
  organização de cada membro e valores pagos/histórico dentro da organização;
  nunca saldo da carteira nem atividade pública ou de outras organizações;
  gestão de convites, solicitações e remoções. Fonte: RN:60-63, 107-116.
  Depende de V2-19 e V2-20.

#### Visões, notificações, conta e auditoria

- **V2-23 · P2 · Meus Grupos e extrato financeiro compreensíveis** — Meus Grupos
  com estado real da participação, separação por contexto (público e cada
  organização) e ações pendentes (pagar fatura, confirmar acesso, cancelar,
  reclamar); extrato separado de faturas, pagamentos PIX, ledger, caução,
  recebíveis e saldo sacável. Fonte: RN:598-620, 853, 1108. Evidência: "Faturas /
  Pagamentos" busca só `payments` (`pages/wallet/invoices.js:20-29`); Meus
  Grupos filtra só `status != banido` (`pages/api/meus-grupos.js:47`); o perfil
  lê um `saldoCaucao` inexistente no ledger (`pages/perfil.js:18,82`). Depende
  de V2-02, V2-07, V2-09 e V2-11.

- **V2-24 · P2 · Notificações e e-mails dos eventos v2** — Notificação interna
  sempre e e-mail nos eventos financeiros e de acesso, para a lista do fluxo 21
  (cadastro pendente, aprovação/rejeição/aprovação automática e revisão, novo
  membro, acesso, cancelamento, preço, fatura, pagamento, caução, saque,
  disputa, organização), com destinatários e idempotência por evento; sem
  WhatsApp/push. Fonte: RN:956-986, 596. Evidência: notificações só na
  entrada/saída de membro (`pages/api/grupos/[id]/join.js:60-78,202-233`); o
  envio de acesso e as mensagens não geram notificação interna
  (`pages/api/grupos/[id]/acessos.js`, `pages/api/grupos/[id]/mensagens.js`).
  Especificar junto aos eventos das features anteriores.

- **V2-25 · P2 · Exclusão de conta com anonimização** — Autoexclusão bloqueada
  enquanto houver saldo, participação ativa/agendada (membro ou dono), disputa
  aberta ou fatura pendente, listando os impedimentos; anonimiza nome, e-mail,
  telefone, CPF e endereço, mantém histórico financeiro e de auditoria e sai de
  todas as organizações. Fonte: RN:1035-1055. Evidência: não existe fluxo de
  exclusão de conta. Depende de V2-02, V2-14 e V2-15.

- **V2-26 · P2 · Cobertura de auditoria v2 e mascaramento de CPF** — Auditar
  estorno, débito, solicitação/aprovação/rejeição de saque, eventos de
  organização, aprovação automática e revisão, decisão de disputa e leitura da
  mensagem de acesso; CPF sempre mascarado (`***.123.456-**`) nas telas
  administrativas. Fonte: RN:1006-1012, 1057-1068. Evidência:
  `withdraw/create` não chama `logAudit` (`pages/api/withdraw/create.js`); a
  listagem de usuários devolve CPF integral (ver B-03). Os eventos novos ficam
  nas specs de cada feature; esta entrada cobre o que já existe hoje.

### Bugs atuais separados das features v2

Revalidados em 2026-11-20 contra o código atual. Tratar via `sdd-bugfix`; os
P0 devem ser corrigidos antes de depender do checkout v2.

- **[Bug] B-01 · P0 · Entrada sem pagamento** — `POST /api/grupos/[id]/participar`
  insere membro sem fatura paga para qualquer usuário validado
  (`pages/api/grupos/[id]/participar.js:11-82`), contrariando o fluxo 7
  (RN:485-545). Remover ou restringir a rota; a correção definitiva vem em V2-06.
- **[Bug] B-02 · P0 · Estorno sem cancelamento** — o usuário pode chamar
  `POST /api/assinaturas/refund` para qualquer fatura própria paga e receber o
  crédito sem sair do grupo nem passar por cancelamento/disputa
  (`pages/api/assinaturas/refund.js:21-105`). Corrigir antes de liberar V2-12 e
  V2-15.
- **[Bug] B-03 · P1 · CPF aberto em listagens internas** — a API de usuários
  permite `support` e devolve o CPF descriptografado integral
  (`lib/authz.js:12`, `pages/api/admin/users/index.js:24,35`), exibido em
  `pages/admin/index.js:134`; a listagem de saques devolve o documento cru,
  inclusive a `support` (`pages/api/withdraw/list.js:22-34`). Regra: CPF sempre
  mascarado; completo só para o financeiro na aprovação de saque (RN:1006).
- **[Bug] B-04 · P0 · Pagamento de grupo indisponível sem compensação no servidor**
  — `pay` consulta só nome e preço, sem status/capacidade
  (`pages/api/assinaturas/pay.js:46-62`); `join` só bloqueia grupo cheio depois
  da fatura paga (`pages/api/grupos/[id]/join.js:124-158`) e não verifica status;
  o estorno da falha depende da UI. Preservar a reconciliação de pagamentos já
  feitos.
- **[Bug] B-05 · P1 · Usuário bloqueado consegue criar grupo** — a criação checa
  só `contaValidada` (`pages/api/grupos/index.js:66-68`), mas a regra proíbe
  criação de grupos por usuário com `isBlocked` (RN:242, 1005). Cuidar para não
  bloquear pagamento, participação e saque, que continuam permitidos.

- **[Bug] B-06 · P1 · Suspeita: leitura de `.value` em `findOneAndUpdate` com
  driver 6.16** — no `mongodb` v6, `findOneAndUpdate` retorna o documento
  direto (sem `{ value }`), mas `pages/api/admin/users/[id]/block.js:37-51`,
  `pages/api/withdraw/approve.js:58,82`, `pages/api/withdraw/reject.js:55,79` e
  `lib/invoices.js:60,77,95` leem `.value`. Efeito provável: bloqueio responde
  404 após gravar e aprovar/rejeitar saque responde 400 após confirmar o
  lançamento. Não reproduzido — achado no `sdd-plan` da 001 (2026-11-20).
  **Parcial (002-ledger-segmentado, 2026-11-24)**: resolvido em
  `withdraw/approve.js` e `withdraw/reject.js` (agora via `liquidarReserva` em
  `lib/ledger/saque.js`, sem `.value`). Restam `pages/api/admin/users/[id]/block.js`
  e `lib/invoices.js` (`markInvoicePaid`/`AwaitingTopUp`/`Refunded`; as rotas
  caem no fallback `invoice._id`/status fixo na resposta).

- **[Bug] B-07 · P1 · Hooks React chamados condicionalmente nas telas de grupo
  do admin** — `npx eslint .` acusa 21 erros em `pages/admin/grupos/[id].js`
  (`useState`/`useMemo`/`useEffect` depois de retorno antecipado, além de prop
  duplicada na linha 381) e 1 em `pages/admin/grupos/novo.js:80` (`useEffect`
  condicional). Pode causar erro de render ao alternar estados de sessão.
  Achado no `sdd-execute` da 001 (2026-11-20); tratar via `sdd-bugfix`.
  **Resolvido em 2026-11-24** (desvio T034 da 001, aprovado pelo usuário):
  retornos antecipados movidos para depois dos hooks em `[id].js` e `novo.js`,
  `className` duplicada removida; regressão confirmada em navegador (antes:
  "Rendered more hooks" nas duas telas; depois: sem erro).
- **[Bug] B-08 · P2 · `npm run lint` não roda** — `next lint` (Next 14) não
  reconhece o `eslint.config.mjs` em formato flat e abre um prompt interativo;
  usar `npx eslint .` até migrar o script. Achado no `sdd-execute` da 001
  (2026-11-20). **Resolvido em 2026-11-24** (T034): `lint` → `eslint .` e
  `ignores` de `.next/` no `eslint.config.mjs`.

- **[Bug] B-09 · P3 · `database/setup-indexes.js` conflita com `setupDatabase.js`**
  — cria `walletTransactions { referenceId, type, source }` sem `unique`/parcial,
  mas `setupDatabase.js` já cria o mesmo índice como único parcial; o script
  aborta com `IndexKeySpecsConflict` (code 86) e não cria os índices seguintes.
  Achado no `sdd-execute` da 001 (2026-11-20).

### Decisões a esclarecer em `sdd-specify`

- Data-base do ciclo (vencimento, início, dias do ciclo e arredondamento),
  necessária antes de V2-09, V2-10, V2-12, V2-14 e V2-15.
- Como o dono "paga `T / C`" pela própria vaga (RN:397, 1074): cobrança real
  pelo Cotea ou apenas desconto do repasse? Afeta V2-03 e V2-11.
- Destino de `vagasReservadasAdmin` e `filaEsperaAtiva` frente à regra de 1 vaga
  do dono e à fila formal (V2-03, V2-16).
- Valor/fórmula da taxa do Mercado Pago no depósito, no saque e no checkout PIX
  (hoje R$ 0,68 fixo na UI, `pages/assinatura/pagamento.js:48-49`).
- Calendário de feriados para "dias úteis" (aprovação automática e saque) —
  decidir em V2-01.
- O que "membros ativos são tratados pelo suporte" significa financeiramente
  quando o grupo é suspenso (RN:262, 440).
- Corrigir a descrição do comportamento atual em RN:631-634: o `DELETE` apaga o
  documento do membro, não o marca como `banido`
  (`pages/api/grupos/[id]/join.js:56`).
- Grupo "pré-aprovado" (RN:443-445) e gateway PIX real com webhook (RN:817-819)
  são possibilidades futuras, não features v2 confirmadas.

### Ajustes pequenos candidatos a `sdd-adhoc`

- **AH-01 · Limite de 500 caracteres nas mensagens do dono** — a API aceita até
  1000 (`pages/api/grupos/[id]/mensagens.js:10`); a regra é 500, sem limite
  diário (RN:588). Ajustar API e tela `pages/grupos/[id]/admin/mensagem.js`.
- **AH-02 · Limite de tamanho nos itens do FAQ** — benefícios e regras têm
  limite de quantidade e tamanho, mas o FAQ só tem limite de quantidade
  (`pages/api/grupos/index.js:92-96`, `pages/api/grupos/[id].js:122-126`); a
  regra pede limites de quantidade e tamanho (RN:400).

### Qualidade de codigo — triagem de `.docs/code-quality-checklist.md` (2026-10-31)

- **CQ-01 · Ideia · Limite de login tambem por IP** — Especificar politica de
  limite por conta e por origem, identificacao confiavel do IP atras de proxy,
  respostas a bloqueio e verificacao de que nao prejudica usuarios da mesma
  rede. O callback de login limita apenas por e-mail
  (`pages/api/auth/[...nextauth].js:32-40`); o projeto ja tem helper de IP e
  limite para envio de codigo (`lib/ratelimit.js:44-52`,
  `pages/api/sendVerificationCode.js:16-35`). Encaminhar a `sdd-specify`.
- **CQ-02 · Ideia · Padronizar erros das APIs** — Especificar contrato unico
  (`error` para falha, `message` para sucesso) e migracao coordenada dos
  consumidores antes de alterar respostas. As APIs de perfil, cadastro,
  verificacao e notificacoes ainda devolvem erros em `message`, lidos por
  `pages/perfil.js`, `pages/cadastro.js`, `pages/verificacao.js` e
  `pages/notificacoes.js`. Fonte: `.docs/code-quality-checklist.md:79`.
  Encaminhar a `sdd-specify` por afetar varios contratos de API.
- **CQ-03 · Ad-hoc · Corrigir configuracao/documentacao de `updateAge`** —
  Remover ou esclarecer o comentario e a configuracao que sugerem refresh a
  cada `SESSION_UPDATE_AGE_SECONDS` em `pages/api/auth/[...nextauth].js:7-12,92,129-133`.
  A sessao usa JWT e o NextAuth ignora `session.updateAge` nessa estrategia;
  o callback JWT consulta o usuario quando a sessao e acessada. Tratar como
  limpeza pontual via `sdd-adhoc`, sem mudar a politica de sessao.


## Features

| Slug | Título | Status | Progresso | Última Atualização |
| --- | --- | --- | --- | --- |
| 001-rotinas-agendadas | Rotinas agendadas idempotentes e calendário de dias úteis | Convergida | 49/49 tasks | 2026-11-24 |
| 002-ledger-segmentado | Ledger segmentado e saldo sacável | Convergência Pendente | 50/51 tasks | 2026-11-24 |
| 003-preco-por-vaga | Regra única de preço por vaga (taxa Cotea 5%) e capacidade mínima | Convergida | 38/38 tasks | 2026-11-24 |

## Melhorias Ad-hoc

| Data | Área | Resumo |
| --- | --- | --- |
| 2026-11-20 | Auth/login | `/admin` não abria logado em produção: middleware passa `secureCookie` pelo protocolo (cookie `__Secure-` em HTTPS) e `/auth/signin` respeita `callbackUrl` só com caminhos internos (`lib/redirecionamento.js`, teste em `tests/redirecionamento.test.js`) |
| 2026-11-24 | Auth/login | Logout não permitia trocar de usuário (Google reaproveitava a conta logada): `GoogleProvider` com `authorization.params.prompt = "select_account"` em `pages/api/auth/[...nextauth].js`; sem teste automatizado (fluxo OAuth), validar manualmente |

## Bugs

| Slug | Título | Fase Atual | Veredito/Status | Próximo Passo | Última Atualização |
| --- | --- | --- | --- | --- | --- |
| get-grupo-expoe-dados-internos | GET /api/grupos/[id] expõe dados internos sem sessão | Test | verified | Concluído | 2026-11-24 |
| admin-editar-grupo-sem-permissao | Página de edição de grupo abre para qualquer usuário logado | Test | verified | Concluído | 2026-11-24 |
