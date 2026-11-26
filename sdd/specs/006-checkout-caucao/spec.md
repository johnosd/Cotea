# Feature Specification: Checkout v2 com caução e elegibilidade no servidor

**Slug**: `006-checkout-caucao`

**Created**: 2026-11-26

**Status**: Especificada

**Input**: Backlog `V2-06 · P0 · Checkout v2 com caução e elegibilidade no
servidor`: antes de pagar, mostrar mensalidade, caução de 1 mensalidade (ambas
com 5%), taxa do meio de pagamento, total de hoje, próximo vencimento e prazo
de acesso; validar elegibilidade no servidor antes de cobrar; pagamento,
participação e caução bloqueada em operação atômica; persistir a declaração de
relacionamento. Fonte: `.docs/regras-negocio-v2.md`, Fluxo 7 (entrada em
grupo), Fluxos 15 e 16 (carteira) e "Regras financeiras consolidadas". Depende
de V2-02 (`002-ledger-segmentado`) e V2-03 (`003-preco-por-vaga`).

**Estado do código em 2026-11-26** (a evidência do backlog, de 2026-11-20,
estava desatualizada):

- A elegibilidade (grupo disponível, vaga, dono, membro atual, banido) já é
  checada antes da cobrança (`lib/grupo-entrada.js`,
  `pages/api/assinaturas/pay.js:97-106`), desde a correção dos bugs B-01 e B-04.
- Cobra-se só o valor da vaga; nenhuma caução (`pay.js:85-92`;
  `pages/api/grupos/[id]/join.js:250` grava `temCaucao: false`).
- Pagamento e entrada são duas chamadas separadas (`pay` e depois `join`): se a
  tela fecha entre elas, o usuário paga sem entrar, e duas entradas simultâneas
  podem passar da capacidade.
- A "taxa" PIX de R$ 0,68 (`pages/assinatura/pagamento.js:52-57,223`) não é
  cobrada: o valor é creditado no saldo do próprio usuário.
- A etapa de relacionamento mostra uma única opção fixa e não grava nada
  (`pages/assinatura/relacionamento.js:38-46`).
- Sair do grupo apaga a participação na hora (`join.js:115`).

**Regras implementadas e divergências decididas nesta entrevista** (o documento
de regras é atualizado na mesma entrega):

- A **caução volta integralmente em toda saída** enquanto o cancelamento
  agendado, a multa de fidelidade, o último ciclo e a inadimplência
  (V2-09/V2-10) não existirem. É uma regra transitória.
- O **ciclo mensal conta a partir do envio do acesso** (a regra v2 não definia
  a data-base).
- A **taxa do meio de pagamento é R$ 0,00** enquanto o PIX for simulado; o
  repasse da taxa do provedor ao usuário continua sendo a regra para quando
  houver gateway real.
- Em grupo "após completar", a **mensalidade fica retida** até o grupo lotar e
  volta se a participação terminar antes (o estorno automático em 30 dias
  continua na V2-07).
- O **registro do repasse ao dono e da taxa de 5%** no ledger fica para a V2-11.

## Escopo

### Incluído

- Entrada em grupo como **uma única operação**: cobrança de mensalidade +
  caução, criação da participação e bloqueio da caução valem juntos ou não
  valem.
- Elegibilidade avaliada no servidor na confirmação, antes de qualquer cobrança.
- Resumo antes de pagar: mensalidade, caução, taxa do meio de pagamento (quando
  houver), total de hoje, parte paga com saldo, parte paga no PIX, regra do
  próximo vencimento, prazo de envio de acesso, fidelidade do grupo e regras da
  caução.
- Pagamento com **saldo primeiro e PIX só pela diferença**.
- Aceite obrigatório das regras v2 da caução, registrado com data e versão.
- Declaração obrigatória de vínculo com o dono (amigo, família, conhecido,
  desconhecido), registrada na participação e visível ao dono e à equipe do
  Cotea.
- Devolução automática e integral da caução em toda saída: saída do membro,
  remoção pelo staff, encerramento pelo dono, cancelamento pelo Cotea e
  exclusão do grupo.
- Grupos "após completar": mensalidade retida até o grupo lotar (ou até o envio
  do acesso ao membro) e devolvida, junto com a caução, se a participação
  terminar antes.
- Tela de saída informando, antes da confirmação, quanto volta para o saldo.
- Notificações internas de entrada, grupo completo e devolução, e auditoria.
- Remoção da taxa fixa de R$ 0,68 e do campo de cupom sem função.
- Tratamento das faturas do checkout antigo.
- Atualização de `.docs/regras-negocio-v2.md`.

### Fora de Escopo

- Estados detalhados de grupo e de participação, e o estorno automático quando o
  grupo "após completar" não lota em 30 dias: V2-07.
- SLA de 5 dias com estorno automático e prova de entrega do acesso: V2-08.
- Faturas mensais recorrentes, inadimplência e uso da caução em atraso: V2-09.
- Cancelamento agendado, janela de 15 dias, multa de fidelidade e uso da caução
  no último ciclo: V2-10.
- Lançamento do repasse ao dono (recebível) e da taxa de 5% na conta da
  plataforma: V2-11.
- **Estorno da mensalidade de quem sai antes de receber o acesso** em grupo que
  não retém a mensalidade: V2-12. Até lá, nesses casos só a caução volta.
- Alterações sensíveis com aprovação (V2-13); encerramento com reembolso
  proporcional e cancelamento lógico no lugar da exclusão física (V2-14);
  disputas (V2-15).
- Fila de espera (V2-16): grupo cheio continua recusando a entrada.
- Mínimo e taxa de depósito PIX (V2-18) e gateway PIX real.
- Organizações e trava de saldo (V2-19 a V2-21).
- E-mails dos eventos (V2-24) e a correção das telas de perfil, extrato e Meus
  Grupos (V2-23).
- Cobrança de caução retroativa a membros que já estão nos grupos.

## User Scenarios & Testing *(mandatory)*

As stories 1, 2 e 3 são P1 e **devem ser publicadas juntas**: cobrar caução sem
devolvê-la, ou sem mostrá-la antes, não pode ir para produção.

### User Story 1 - Entrar pagando mensalidade e caução numa única operação (Priority: P1)

O usuário elegível confirma a entrada e, de uma só vez, o total é debitado, ele
vira membro e a caução fica bloqueada em seu nome. Se algo impedir a entrada,
nada é cobrado.

**Why this priority**: é o núcleo do P0: hoje a caução não é cobrada e é
possível pagar sem entrar ou ultrapassar a capacidade.

**Independent Test**: Entrar em um grupo aprovado com vaga e saldo suficiente e
conferir um débito do total, uma participação aguardando acesso e a caução
bloqueada; repetir com grupo cheio e conferir que nada foi cobrado.

**Acceptance Scenarios**:

1. **Given** grupo aprovado com mensalidade de R$ 10,50, vaga livre e usuário
   com R$ 30,00 disponíveis, **When** confirma a entrada, **Then** são debitados
   R$ 21,00, ele fica como membro aguardando acesso, R$ 10,50 ficam bloqueados
   como caução e o disponível passa a R$ 9,00.
2. **Given** a última vaga e dois usuários confirmando ao mesmo tempo, **When**
   as duas confirmações são processadas, **Then** só um entra e o outro não é
   cobrado.
3. **Given** um usuário que é dono, já é membro, está banido no grupo, ou um
   grupo não aprovado, cancelado, cheio ou sem preço válido, **When** tenta
   confirmar (inclusive chamando o sistema direto, sem a tela), **Then** a
   entrada é recusada com o motivo e nada é cobrado.
4. **Given** uma entrada concluída, **When** a mesma confirmação é repetida
   (duplo clique, nova tentativa), **Then** não há nova cobrança nem nova
   participação, e o usuário vê o sucesso.
5. **Given** um usuário bloqueado (`isBlocked`) e elegível, **When** confirma,
   **Then** entra normalmente.

---

### User Story 2 - Receber a caução de volta ao sair (Priority: P1)

Sempre que a participação termina, por iniciativa do membro, do staff, do dono
ou do Cotea, a caução volta integralmente ao saldo disponível.

**Why this priority**: sem isso o dinheiro ficaria bloqueado sem nenhuma forma
de liberação.

**Independent Test**: Entrar em grupos, encerrar a participação por cada um dos
caminhos (saída, remoção, encerramento, cancelamento, exclusão) e conferir uma
única devolução da caução em cada.

**Acceptance Scenarios**:

1. **Given** um membro com R$ 10,50 de caução, **When** cancela a participação,
   **Then** vê antes o valor que volta e que a mensalidade não é devolvida, e,
   após confirmar, a caução volta ao disponível.
2. **Given** um grupo com três membros com caução, **When** o dono o encerra ou
   o Cotea o cancela (inclusive por reprovação na revisão), **Then** os três
   recebem a caução de volta e são notificados.
3. **Given** um membro com caução, **When** o staff o remove ou o grupo é
   excluído, **Then** a caução volta ao saldo dele.
4. **Given** um grupo cancelado cuja caução já foi devolvida, **When** o membro
   depois sai pela tela, **Then** não há segunda devolução.
5. **Given** um membro anterior a esta feature (sem caução), **When** sai,
   **Then** nada é creditado e a saída funciona como antes.

---

### User Story 3 - Saber o que vai pagar e aceitar as regras antes (Priority: P1)

Antes de confirmar, o usuário vê o detalhamento do que paga hoje, quanto sai do
saldo, quanto vai no PIX, quando vence o próximo ciclo e o que acontece com a
caução, e aceita essas regras.

**Why this priority**: a entrada passa a custar o dobro; cobrar sem mostrar e
sem aceite não é aceitável, e o uso futuro da caução depende de regra exibida
antes.

**Independent Test**: Abrir o checkout com saldo zero, parcial e total e
conferir o detalhamento, a divisão saldo/PIX, o aceite obrigatório e que o
valor cobrado é o exibido.

**Acceptance Scenarios**:

1. **Given** mensalidade de R$ 10,50 e saldo de R$ 5,00, **When** abre o
   checkout, **Then** vê mensalidade R$ 10,50, caução R$ 10,50, total R$ 21,00,
   R$ 5,00 do saldo e R$ 16,00 no PIX, sem linha de taxa.
2. **Given** saldo igual ou maior que o total, **When** abre o checkout, **Then**
   vê que o pagamento sai do saldo e nenhum PIX é gerado.
3. **Given** o resumo aberto sem o aceite das regras da caução, **When** tenta
   confirmar, **Then** a confirmação é recusada, sem cobrança.
4. **Given** o preço do grupo (ou o saldo do usuário) mudou depois de o resumo
   ser exibido, **When** confirma, **Then** nada é debitado e o resumo
   atualizado é mostrado para nova confirmação.
5. **Given** o PIX confirmado e a entrada recusada em seguida (a vaga acabou),
   **When** o usuário recebe a resposta, **Then** o valor do PIX está no saldo
   disponível, a mensagem diz isso e não há participação.
6. **Given** cadastro financeiro incompleto, **When** confirma, **Then** conclui
   o cadastro na própria tela (feature 004) e volta ao resumo sem perder o que
   preencheu.

---

### User Story 4 - Não perder dinheiro em grupo que não lotou (Priority: P2)

Em grupo que só libera acesso depois de lotar, a mensalidade fica retida em nome
do membro. Se ele sair, ou o grupo acabar, antes de lotar, recebe tudo de volta.

**Why this priority**: protege quem paga por um serviço que ainda não começou;
sem ela o comportamento é igual ao dos demais grupos.

**Independent Test**: Entrar em um grupo "após completar" com vagas sobrando,
sair e conferir a devolução de mensalidade + caução; depois lotar outro grupo e
conferir que a saída devolve só a caução.

**Acceptance Scenarios**:

1. **Given** grupo "após completar" não lotado, **When** o usuário entra,
   **Then** o resumo avisa que o acesso vem depois de lotar, a mensalidade
   aparece como retida e a caução como bloqueada.
2. **Given** um membro com mensalidade retida, **When** a participação termina
   por qualquer caminho da story 2, **Then** voltam ao disponível a mensalidade
   e a caução (R$ 21,00 no exemplo).
3. **Given** um grupo a uma vaga de lotar, **When** o último membro entra,
   **Then** deixam de estar retidas todas as mensalidades (inclusive a dele), o
   dono e os membros são notificados e, a partir daí, a saída devolve só a
   caução.
4. **Given** o dono envia o acesso a um membro antes de o grupo lotar, **When**
   o envio é registrado, **Then** a mensalidade daquele membro deixa de estar
   retida.
5. **Given** um grupo que já lotou e depois perdeu um membro, **When** alguém
   novo entra, **Then** a mensalidade dele não fica retida.

---

### User Story 5 - Declarar o vínculo com o dono (Priority: P2)

Antes de pagar, o usuário informa se é amigo, família, conhecido ou
desconhecido do dono. A resposta fica registrada e o dono a vê.

**Why this priority**: regra v2 e transparência para o dono; não impede a
entrada nem o fluxo financeiro.

**Independent Test**: Entrar escolhendo cada opção e conferir a gravação e a
exibição na lista de membros do dono.

**Acceptance Scenarios**:

1. **Given** a etapa de relacionamento, **When** abre, **Then** vê as quatro
   opções, nenhuma pré-selecionada, e não avança sem escolher.
2. **Given** uma confirmação sem vínculo ou com valor fora das quatro opções,
   **When** o servidor a recebe, **Then** recusa sem cobrar.
3. **Given** uma entrada concluída, **When** o dono ou a equipe do Cotea
   consulta os membros, **Then** vê o vínculo declarado; outros membros e
   visitantes não veem.

### Edge Cases

- Saldo cobre a mensalidade, mas não a caução: o PIX cobre a diferença; nunca há
  entrada com caução parcial.
- Saque pendente reduz o saldo disponível: só o disponível entra no pagamento.
- Tela fechada depois do PIX confirmado e antes da entrada: o valor fica no
  saldo disponível; não há participação nem outra cobrança.
- Quem sai e volta paga de novo mensalidade e caução, com novo vínculo e novo
  aceite.
- Grupo lota ao mesmo tempo em que um membro sai: vale um único resultado — ou
  ele sai antes e recebe tudo, ou sai depois e recebe a caução. Nunca os dois,
  nunca nada.
- Grupo "após completar" que lota por redução de capacidade: as retenções são
  liberadas como na lotação por entrada.
- Cancelamento de grupo com muitos membros interrompido no meio: as devoluções
  restantes são concluídas depois, sem duplicar as já feitas.
- Devolução que falha não pode deixar o membro removido sem o dinheiro nem
  creditar duas vezes.
- Membro anterior a esta feature em grupo "após completar": sem caução e sem
  retenção; nada retroativo.
- Fatura aberta do checkout antigo: não serve para entrar; o usuário refaz o
  checkout.
- Fatura paga no checkout antigo sem participação: o valor volta ao saldo.
- Banido no grupo não reentra; usuário bloqueado na conta entra normalmente.

## Requirements *(mandatory)*

### Functional Requirements

**Elegibilidade**

- **FR-001**: Na confirmação, o sistema DEVE verificar no servidor, antes de
  qualquer débito: sessão, conta validada, cadastro financeiro completo, grupo
  existente, aprovado e não cancelado, preço válido, vaga disponível, usuário
  que não é dono, não é membro atual e não está banido no grupo. A recusa DEVE
  informar o motivo e não gerar cobrança.
- **FR-002**: Fora a participação do dono criada com o grupo, o sistema NÃO DEVE
  permitir que alguém vire membro por outro caminho que não a entrada com
  mensalidade e caução cobradas.

**Resumo, valores e aceite**

- **FR-003**: Antes da confirmação, o sistema DEVE exibir mensalidade, caução,
  taxa do meio de pagamento (somente se maior que zero), total de hoje, valor
  pago com saldo, valor pago no PIX, regra do próximo vencimento, prazo de envio
  do acesso, fidelidade do grupo (se houver), aviso de grupo "após completar"
  (quando for o caso) e regras da caução.
- **FR-004**: Todos os valores DEVEM ser calculados pelo servidor. A mensalidade
  é o valor por vaga vigente (feature 003, com os 5%); a caução é igual à
  mensalidade; o total é mensalidade + caução + taxa. Valores enviados pelo
  cliente nunca são usados para cobrar.
- **FR-005**: A taxa do meio de pagamento é R$ 0,00; a taxa fixa de R$ 0,68 DEVE
  deixar de existir nas telas e nos valores gerados no PIX.
- **FR-006**: Se valores ou condições mudarem entre o resumo exibido e a
  confirmação, o sistema DEVE recusar sem debitar e mostrar o resumo atualizado.
- **FR-007**: O resumo DEVE informar que o ciclo é mensal e conta a partir do
  envio do acesso: o próximo vencimento é no mesmo dia do mês seguinte ao envio
  (se o dia não existir, no último dia do mês), no horário de Brasília. Nenhuma
  data fechada é prometida antes do envio.
- **FR-008**: O resumo DEVE informar que o dono tem até 5 dias corridos para
  enviar o acesso, contados da entrada ou, em grupo "após completar" não lotado,
  da lotação. NÃO DEVE prometer estorno automático por atraso (V2-08).
- **FR-009**: O sistema DEVE exigir o aceite das regras v2 da caução e registrar
  data, hora e versão do texto aceito. O texto DEVE cobrir: caução de 1
  mensalidade, do membro e bloqueada como garantia; devolução na saída regular;
  perda como multa, em favor do dono, na saída antes da fidelidade, com
  pagamento das faturas até a saída; uso no último ciclo quando o pedido de
  saída ocorre fora da janela de 15 dias antes do vencimento; e quitação de
  fatura com 3 dias de atraso, com saída agendada.

**Vínculo e participação**

- **FR-010**: O sistema DEVE exigir um vínculo entre amigo, família, conhecido e
  desconhecido, sem opção pré-selecionada; todas permitem a entrada.
- **FR-011**: O vínculo DEVE ser visível ao dono do grupo e à equipe do Cotea, e
  não a outros membros nem a visitantes.
- **FR-012**: A participação DEVE registrar mensalidade paga, caução, fidelidade
  do grupo no momento da entrada, vínculo e aceite. Esse histórico DEVE
  permanecer consultável para auditoria depois que a participação terminar.

**Pagamento e entrada**

- **FR-013**: O pagamento DEVE usar primeiro o saldo disponível e gerar PIX
  somente pela diferença. A tela não oferece escolha que o sistema ignore.
- **FR-014**: O valor pago no PIX DEVE ser creditado no saldo do usuário antes
  da entrada; se a entrada falhar, permanece disponível e o usuário é informado.
- **FR-015**: Débito do total, bloqueio da caução, retenção da mensalidade
  (quando aplicável), criação da participação e quitação da fatura DEVEM valer
  todos juntos ou nenhum. NÃO DEVE existir estado "pago sem participação" que
  dependa de o cliente pedir estorno.
- **FR-016**: Repetir a mesma confirmação NÃO DEVE gerar segunda cobrança nem
  segunda participação.
- **FR-017**: Confirmações simultâneas NÃO DEVEM ultrapassar a capacidade do
  grupo nem deixar saldo negativo.
- **FR-018**: A caução DEVE ficar identificada como caução daquele grupo e
  participação, visível na carteira e fora do saldo disponível e sacável.
- **FR-019**: A fatura de entrada DEVE registrar separadamente a mensalidade
  (com repasse ao dono e taxa do Cotea, feature 003) e a caução.
- **FR-020**: A participação criada DEVE ficar aguardando envio de acesso; o
  sistema DEVE notificar o dono (novo membro) e o membro (confirmação, com os
  valores e o prazo de acesso) e, quando o grupo lotar, o dono e os membros.

**Devolução**

- **FR-021**: O sistema DEVE devolver ao saldo disponível 100% da caução quando
  a participação terminar por qualquer motivo: saída do membro, remoção pelo
  staff, encerramento pelo dono, cancelamento pelo Cotea ou exclusão do grupo.
- **FR-022**: Cada caução (e mensalidade retida) DEVE ser devolvida exatamente
  uma vez. Em saída individual, saída e devolução valem juntas; em encerramento,
  cancelamento ou exclusão do grupo, todas as devoluções DEVEM ser concluídas em
  até 1 hora, mesmo com falha no meio.
- **FR-023**: Antes de confirmar a saída, o membro DEVE ver o que volta ao saldo
  e o que não é devolvido.
- **FR-024**: Participação sem caução (anterior a esta feature) NÃO DEVE gerar
  cobrança retroativa nem crédito na saída.

**Grupos "após completar"**

- **FR-025**: Enquanto o grupo "após completar" não tiver lotado, a mensalidade
  de quem entra DEVE ficar retida em nome do membro, visível na carteira e fora
  do disponível.
- **FR-026**: A retenção termina quando o grupo lota (dono + membros ocupando
  todas as vagas) ou quando o dono envia o acesso àquele membro, o que vier
  primeiro; depois disso a mensalidade conta como paga.
- **FR-027**: Participação encerrada com a mensalidade ainda retida DEVE
  devolver tudo o que foi pago (mensalidade + caução + taxa).
- **FR-028**: Depois que um grupo lota pela primeira vez, novas entradas não têm
  mensalidade retida, mesmo que vagas reabram.

**Rastro, transição e documentação**

- **FR-029**: Entrada, cobrança, bloqueio, retenção, liberação e devolução DEVEM
  ser lançamentos no ledger e gerar auditoria.
- **FR-030**: Faturas abertas do checkout antigo NÃO DEVEM ser cobradas; faturas
  antigas pagas que não geraram participação DEVEM ter o valor devolvido ao
  saldo.
- **FR-031**: O sistema DEVE notificar o membro de cada devolução, com o valor.
- **FR-032**: `.docs/regras-negocio-v2.md` DEVE ser atualizado com a data-base
  do ciclo, a taxa zero do PIX simulado, a devolução transitória da caução, a
  retenção em grupos "após completar" e os trechos de "gap de implementação" do
  Fluxo 7.

### Key Entities *(include if feature involves data)*

- **Participação**: vínculo do usuário com o grupo; passa a guardar mensalidade
  paga, caução, retenção (se houver), fidelidade na entrada, vínculo declarado e
  aceite.
- **Fatura de entrada**: cobrança da entrada, com composição de mensalidade
  (repasse + taxa), caução e taxa do meio de pagamento.
- **Caução**: valor de 1 mensalidade, do membro, bloqueado por grupo e
  participação até ser devolvido.
- **Mensalidade retida**: mensalidade de grupo "após completar" ainda não
  lotado, reservada em nome do membro.
- **Declaração de vínculo**: amigo, família, conhecido ou desconhecido.
- **Aceite das regras da caução**: data, hora e versão do texto.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% das novas entradas têm exatamente um débito do total exibido e
  uma caução bloqueada igual à mensalidade.
- **SC-002**: 0 casos de dinheiro debitado sem participação correspondente,
  inclusive com falhas e repetições forçadas.
- **SC-003**: Em testes de disputa pela última vaga, 0 grupos acima da
  capacidade e 0 cobranças de quem não entrou.
- **SC-004**: 100% das participações com caução encerradas resultam em
  exatamente uma devolução integral; em encerramento de grupo, em até 1 hora.
- **SC-005**: Em grupo não lotado, 100% de quem sai recebe de volta tudo o que
  pagou.
- **SC-006**: 100% das entradas têm vínculo e aceite registrados.
- **SC-007**: A verificação diária de consistência do ledger não aponta
  inconsistência causada por entrada, retenção ou devolução.

## Assumptions

- PIX continua simulado; o valor mínimo de depósito (V2-18) não se aplica à
  diferença paga no checkout.
- Grupo sem tipo de acesso "após completar" cobra e consome a mensalidade na
  entrada, como hoje; ela não é creditada a ninguém até a V2-11.
- A V2-11 gerará os recebíveis das mensalidades pagas (ou liberadas) antes dela,
  a partir da composição registrada nas faturas.
- V2-09, V2-10, V2-12 e V2-14 substituirão a devolução transitória da caução
  pelas regras que o membro aceitou.
- A fidelidade é apenas exibida e registrada; não tem efeito nesta feature.
- O campo de cupom não tem função e é removido.
- A data de envio do acesso já registrada hoje é a data-base do ciclo.
- Quantos documentos reais existem (participações sem caução, faturas antigas
  abertas ou pagas sem participação) deve ser conferido no banco no
  `sdd-plan`.
- Ponto de atenção para o `sdd-plan`: as operações desta feature têm mais de um
  lançamento por referência, e o índice único de `walletTransactions` por
  referência, tipo e origem pode colidir (ver "Decisões a esclarecer" no
  backlog).

## Clarifications

### Sessão 2026-11-26

- Q: O que acontece com a caução enquanto não existem os fluxos de
  cancelamento e encerramento? → A: Volta integral em toda saída; multa de
  fidelidade e último ciclo ficam para a V2-10.
- Q: O V2-06 registra o repasse ao dono e a taxa de 5%? → A: Não; fica para a
  V2-11, a partir da composição das faturas.
- Q: De que data o ciclo mensal começa a contar? → A: Do envio do acesso.
- Q: Como tratar a taxa de R$ 0,68 do PIX? → A: Zerar enquanto o PIX for
  simulado.
- Q: Em grupo "após completar", o que volta se a participação terminar antes de
  lotar? → A: Tudo (mensalidade + caução); a mensalidade fica retida até lotar.
- Q: Qual o efeito da declaração de vínculo? → A: Informativa e obrigatória;
  todas as opções permitem entrar; o dono e a equipe do Cotea a veem.
- Q: O checkout exige aceite das regras da caução? → A: Sim, das regras v2
  completas, com registro.
- Q: Como saldo e PIX se combinam? → A: Saldo primeiro; PIX só pela diferença.
