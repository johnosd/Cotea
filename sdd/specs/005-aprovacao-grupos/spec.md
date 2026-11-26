# Feature Specification: Aprovação, moderação e visibilidade de grupos públicos

**Slug**: `005-aprovacao-grupos`

**Created**: 2026-11-26

**Status**: Convergida

**Input**: Backlog `V2-05 · P0 · Aprovação, moderação e visibilidade de grupos
públicos`: estados `em_aprovacao`, `ajustes`, `rejeitado`, `suspenso`,
`cancelado` e estados públicos; fila do admin do sistema com
aprovar/rejeitar/pedir ajuste e motivo; reenvio após ajuste; aprovação
automática após 2 dias úteis, marcada na auditoria e na fila para revisão
posterior, com repasse retido até a revisão (reprovado → suspensão e estorno);
suspensão pelo Cotea. Home, API pública e detalhe listam só grupos públicos
aprovados e não cancelados/suspensos. O cliente não define status. Grupos de
organização não passam por aprovação. Fonte: `.docs/regras-negocio-v2.md`
RN:255-268 (estados de grupo), 288-311 (Fluxo 1), 370-449 (Fluxos 4 e 5).
Evidência: a criação aceita `status = 'ativo'` do body
(`pages/api/grupos/index.js:61,115`), a listagem não filtra status
(`pages/api/grupos/index.js:18-51`), o `PUT` grava `status` livre
(`pages/api/grupos/[id].js:112,165`) e o detalhe abre qualquer grupo pelo id
(`pages/api/grupos/[id].js:44-73`). Depende de V2-01 (rotinas e dias úteis,
convergida); a retenção de repasse em si depende de V2-11 (ainda não
especificada).

**Mudança de regra decidida nesta entrevista**: não existe estado **suspenso**.
Um grupo é mantido ou é cancelado. O que a RN chamava de "suspensão pelo Cotea"
(fraude, denúncia, revisão reprovada) passa a ser **cancelamento pelo Cotea**.
A rejeição passa a ser **definitiva** (só "ajustes" volta para a fila). As duas
mudanças precisam ser refletidas em `.docs/regras-negocio-v2.md` e nas entradas
do backlog que citam suspensão (V2-14, V2-15).

## Escopo

### Incluído

- Ciclo de moderação de grupos públicos: **em aprovação**, **ajustes**,
  **rejeitado**, **aprovado** (público) e **cancelado**.
- Todo grupo novo, inclusive o criado por admin do sistema, nasce **em
  aprovação**. O cliente nunca define o estado de moderação nem o `status`
  (nem na criação, nem na edição).
- Fila de moderação no `/admin`: grupos em aprovação (mais antigos primeiro, com
  prazo restante) e grupos aprovados automaticamente aguardando revisão
  posterior.
- Decisões do admin do sistema na fila: **aprovar**, **pedir ajuste** (texto
  obrigatório) e **rejeitar** (texto obrigatório, definitivo). Suporte só
  consulta a fila.
- Edição e **reenvio** pelo dono quando o grupo está em ajustes; o reenvio abre
  novo prazo de 2 dias úteis.
- **Aprovação automática** por rotina agendada (V2-01) quando vencem 2 dias
  úteis sem decisão; o grupo entra no ar normalmente e fica marcado na
  auditoria e na fila como **revisão posterior pendente**.
- **Revisão posterior** pelo admin: confirmar (limpa a marca) ou reprovar
  (cancelamento pelo Cotea).
- **Cancelamento pelo Cotea** de grupo aprovado (fraude, denúncia, revisão
  reprovada), com motivo obrigatório e auditoria.
- **Desistência do dono**: cancelar o próprio pedido em aprovação ou em
  ajustes.
- Visibilidade: home, listagem pública e detalhe público mostram só grupos
  aprovados e não cancelados; grupo não público só é visto pelo dono, pelos
  membros atuais e pelo staff; os demais recebem "não encontrado".
- Bloqueio no servidor de pagamento e entrada em grupo que não esteja aprovado
  e não cancelado.
- Exibição ao dono do estado de moderação e do motivo (ajuste/rejeição/
  cancelamento pelo Cotea) no grupo e em Meus Grupos.
- Notificações internas ao dono (aprovação, ajuste, rejeição, aprovação
  automática, cancelamento pelo Cotea) e aos membros atuais (cancelamento pelo
  Cotea); contador de pendências da fila para admins.
- Migração dos grupos existentes: os `ativo` atuais passam a aprovados, sem
  revisão pendente; nada muda para os membros atuais.
- Auditoria de cada transição de moderação.
- Atualização de `.docs/regras-negocio-v2.md` (sem suspensão; rejeição
  definitiva; grupo em aprovação não aceita membros).

### Fora de Escopo

- Retenção efetiva do repasse ao dono enquanto a revisão posterior estiver
  pendente: esta feature só grava e expõe a marca; a V2-11 a consulta.
- Estorno automático de membros quando o Cotea cancela um grupo: os membros
  são notificados e tratados pelo suporte; a automação fica com V2-14/V2-15.
- Estados públicos detalhados (aguardando membros, aguardando assinatura,
  assinado com vaga, fila de espera, ativo completo): V2-07. Grupo aprovado
  mantém o `status`/`statusDetalhado` públicos que já existem hoje.
- Alterações sensíveis em grupo já aprovado (preço, capacidade, tipo de
  acesso, fidelidade) com pedido de aprovação: V2-13. Editar um grupo aprovado
  não o devolve para a fila.
- Encerramento de grupo aprovado pelo dono (reembolso proporcional,
  cancelamento lógico no lugar do `DELETE` físico): V2-14.
- Organizações e a regra "grupo de organização não passa por aprovação":
  V2-19. Nesta feature todo grupo é público e passa pela fila; o campo
  `tipoGrupo` enviado pelo cliente não dispensa a aprovação.
- E-mails dos eventos de moderação: V2-24.
- Grupo "pré-aprovado" (RN:443-445).
- Motivos fechados (lista padrão) para ajuste/rejeição.
- Regra de "quatro olhos" (outro admin aprovar o grupo que um admin criou).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Só grupos aprovados ficam públicos e aceitam entrada (Priority: P1)

Um visitante só vê na home, na listagem e no detalhe os grupos aprovados e não
cancelados. Um grupo criado agora nasce em aprovação, mesmo que o cliente envie
`status: 'ativo'`, e ninguém consegue pagar ou entrar nele até ser aprovado. Os
grupos que já existem continuam no ar.

**Why this priority**: fecha o buraco P0 (qualquer usuário publica um grupo
direto, sem análise) e é pré-requisito de todo o resto; sozinha já impede
publicação sem controle, mesmo que a aprovação ainda seja feita pelo staff
manualmente.

**Independent Test**: criar um grupo enviando `status: 'ativo'` e conferir que
ele fica em aprovação, não aparece na home nem na listagem, o detalhe responde
"não encontrado" para terceiros, e `pay`/`join` são recusados; conferir que um
grupo legado continua listado e aceitando entrada.

**Acceptance Scenarios**:

1. **Given** um usuário com cadastro completo, **When** ele cria um grupo
   enviando `status: 'ativo'` e `statusDetalhado` qualquer, **Then** o grupo é
   gravado em aprovação e os valores enviados são ignorados.
2. **Given** um grupo em aprovação, **When** um visitante abre a home, a
   listagem pública ou o detalhe pelo id/slug, **Then** o grupo não aparece e o
   detalhe responde "não encontrado".
3. **Given** um grupo em aprovação, **When** o dono ou um membro do staff abre
   o detalhe, **Then** o grupo é exibido com o estado de moderação.
4. **Given** um grupo em aprovação, ajustes, rejeitado ou cancelado, **When**
   alguém tenta pagar ou entrar nele, **Then** o servidor recusa antes de
   qualquer cobrança.
5. **Given** um grupo que existia antes da feature com `status: 'ativo'`,
   **When** a migração roda, **Then** ele fica aprovado, sem revisão pendente,
   continua listado e aceita entradas como antes.
6. **Given** um grupo aprovado, **When** o dono edita o grupo enviando
   `status`, **Then** o valor é ignorado e o estado não muda.

---

### User Story 2 - Fila de moderação com aprovar, pedir ajuste e rejeitar (Priority: P1)

O admin do sistema abre a fila no `/admin`, vê os grupos em aprovação com dados
públicos, preço, capacidade, dono, link oficial, sinalizações de risco e
observações internas, e decide. Aprovado, o grupo vai ao ar e o dono é
notificado. Ajuste devolve o grupo ao dono com o texto das pendências.
Rejeição é definitiva, com motivo. Suporte vê a fila, mas não decide.

**Why this priority**: sem decisão manual a US1 deixaria todo grupo novo preso
para sempre (até a US3 existir).

**Independent Test**: com um grupo em aprovação, aprovar como admin e ver o
grupo aparecer na home; repetir com "pedir ajuste" e "rejeitar" e conferir
estado, motivo, notificação ao dono e auditoria; tentar decidir como suporte e
ser recusado.

**Acceptance Scenarios**:

1. **Given** grupos em aprovação, **When** o admin abre a fila, **Then** eles
   aparecem do envio mais antigo ao mais novo, com o prazo restante até a
   aprovação automática.
2. **Given** um grupo em aprovação, **When** o admin aprova, **Then** o grupo
   fica aprovado e público, aceita entradas, o dono recebe notificação interna
   e a decisão é auditada com o autor.
3. **Given** um grupo em aprovação, **When** o admin pede ajuste com texto,
   **Then** o grupo vai para ajustes, sai da fila de pendentes e o dono vê o
   texto no grupo e recebe notificação.
4. **Given** um grupo em aprovação, **When** o admin rejeita com motivo,
   **Then** o grupo fica rejeitado de forma definitiva, o dono vê o motivo e
   recebe notificação, e o grupo não pode mais ser editado nem reenviado.
5. **Given** o admin tenta pedir ajuste ou rejeitar sem texto (ou só com
   espaços), **When** confirma, **Then** a ação é recusada.
6. **Given** um usuário com papel `support`, **When** abre a fila, **Then**
   vê os grupos, mas não tem as ações de decisão, e a API recusa a decisão.
7. **Given** um grupo criado por um admin do sistema, **When** ele é criado,
   **Then** também entra em aprovação e o próprio admin pode aprová-lo na fila,
   com auditoria.

---

### User Story 3 - Aprovação automática e revisão posterior (Priority: P1)

Se o admin não decidir em 2 dias úteis contados do envio, uma rotina agendada
aprova o grupo automaticamente. O grupo vai ao ar e aceita membros
normalmente, mas fica marcado como "revisão posterior pendente" na auditoria e
numa aba da fila. Na revisão, o admin confirma (a marca sai) ou reprova (o
grupo é cancelado pelo Cotea).

**Why this priority**: é a garantia ao dono de que o grupo não fica preso na
fila; a marca de revisão é o que a V2-11 vai usar para reter o repasse.

**Independent Test**: com o calendário de dias úteis da V2-01, deixar um grupo
vencer o prazo e executar a rotina; conferir aprovação, marca, auditoria e
notificação; rodar a rotina de novo e conferir que nada muda; revisar
confirmando e reprovando.

**Acceptance Scenarios**:

1. **Given** um grupo enviado numa sexta às 10h (sem feriado na semana
   seguinte), **When** a rotina roda até terça às 23:59:59 (horário de
   Brasília), **Then** o grupo continua em aprovação; **When** roda depois,
   **Then** é aprovado automaticamente (o dia do envio não conta; o prazo vence
   no fim do 2º dia útil seguinte).
2. **Given** um grupo aprovado automaticamente, **When** o admin abre a fila,
   **Then** ele aparece em "revisão posterior pendente" e a auditoria registra
   a aprovação como automática (sem autor humano).
3. **Given** a rotina rodou e aprovou um grupo, **When** ela roda de novo ou
   duas execuções concorrem, **Then** o grupo é aprovado uma única vez, com um
   único evento de auditoria e uma única notificação.
4. **Given** um grupo em revisão posterior pendente, **When** o admin confirma,
   **Then** a marca sai, o grupo segue aprovado e a revisão é auditada.
5. **Given** um grupo em revisão posterior pendente e com membros, **When** o
   admin reprova com motivo, **Then** o grupo é cancelado pelo Cotea (ver US5).
6. **Given** um grupo em ajustes, **When** o prazo original venceria, **Then**
   a rotina não o aprova (o tempo em ajustes não conta).

---

### User Story 4 - Ajustes, reenvio e desistência pelo dono (Priority: P2)

O dono vê em Meus Grupos e no próprio grupo em que estado está o pedido. Em
ajustes, ele lê as pendências, edita e reenvia; o reenvio volta para a fila
com novo prazo de 2 dias úteis. Enquanto está em aprovação, não pode editar.
Em aprovação ou em ajustes, pode desistir, e o grupo fica cancelado.

**Why this priority**: completa o ciclo do dono; sem ela, ajuste equivale a
rejeição (o dono teria de criar outro grupo).

**Independent Test**: pedir ajuste num grupo, editar e reenviar como dono e
conferir novo prazo e volta à fila; tentar editar em aprovação e ser recusado;
desistir em ajustes e conferir o cancelamento.

**Acceptance Scenarios**:

1. **Given** um grupo em ajustes, **When** o dono abre o grupo, **Then** vê o
   texto do pedido de ajuste e a opção de editar e reenviar.
2. **Given** um grupo em ajustes, **When** o dono edita (com as mesmas
   validações da criação) e reenvia, **Then** o grupo volta para em aprovação,
   com novo prazo de 2 dias úteis contado do reenvio, e o histórico guarda o
   ciclo anterior.
3. **Given** um grupo em aprovação, **When** o dono tenta editá-lo, **Then** a
   edição é recusada com mensagem clara.
4. **Given** um grupo rejeitado, **When** o dono tenta editar ou reenviar,
   **Then** é recusado; o grupo segue visível para ele como rejeitado, com o
   motivo.
5. **Given** um grupo em aprovação ou em ajustes, **When** o dono confirma a
   desistência, **Then** o grupo fica cancelado, sai da fila e o evento é
   auditado.
6. **Given** um dono bloqueado com grupo em ajustes, **When** tenta reenviar,
   **Then** é recusado (bloqueado não cria grupos, e reenviar equivale a criar).

---

### User Story 5 - Cancelamento pelo Cotea (Priority: P2)

O admin do sistema cancela um grupo aprovado por fraude, denúncia ou revisão
reprovada, com motivo obrigatório. O grupo sai da listagem, não aceita novas
entradas nem cobranças, continua visível para dono e membros atuais como
cancelado, e dono e membros são notificados. Estornos ficam com o suporte.

**Why this priority**: substitui a "suspensão" e dá ao Cotea o poder de tirar
do ar um grupo problemático; depende do restante para ter grupos aprovados.

**Independent Test**: cancelar como admin um grupo aprovado com membros e
conferir saída da home, recusa de `pay`/`join`, visão para membros, notificação
e auditoria; conferir que nenhum dado do grupo ou dos membros é apagado.

**Acceptance Scenarios**:

1. **Given** um grupo aprovado com membros, **When** o admin cancela com
   motivo, **Then** o grupo fica cancelado (cancelamento lógico, sem apagar
   grupo ou membros), sai da home e da listagem e o evento é auditado.
2. **Given** um grupo cancelado pelo Cotea, **When** um membro atual abre o
   grupo, **Then** o vê como cancelado, com aviso de que o suporte vai
   tratar o caso.
3. **Given** um grupo cancelado pelo Cotea, **When** o dono e os membros
   consultam as notificações, **Then** cada um tem uma notificação interna do
   cancelamento.
4. **Given** o admin tenta cancelar sem motivo, **When** confirma, **Then** a
   ação é recusada.
5. **Given** um grupo cancelado, **When** qualquer pessoa tenta reabri-lo pela
   API (editar `status`, aprovar, reenviar), **Then** é recusado: cancelado é
   final.

### Edge Cases

- Duas decisões concorrentes no mesmo grupo (admin aprova enquanto a rotina
  aprova automaticamente; admin decide enquanto o dono desiste; dois admins
  decidem): só a primeira transição válida vale; a outra recebe conflito e
  nenhum efeito duplicado (auditoria/notificação) é gerado.
- Feriado nacional ou fim de semana dentro do prazo: o prazo usa o calendário
  de dias úteis da V2-01, no horário de Brasília.
- Grupo legado sem `status`: tratado como `ativo` legado (aprovado e público);
  a migração grava `status: 'ativo'` explicitamente e o lista no relatório.
  Grupo com `status` de valor desconhecido (ex.: `inativo`): a migração não o
  altera, ele fica fora do ar e aparece no relatório como "não classificado".
- Grupo legado `cancelado`: continua cancelado.
- Slug de grupo rejeitado ou cancelado continua ocupado (o dono cria outro
  grupo com outro nome).
- Dono que vira bloqueado com grupo já em aprovação: o grupo segue na fila; o
  bloqueio impede só criar e reenviar.
- Rotina de aprovação automática falha no meio: a próxima execução retoma sem
  aprovar duas vezes.
- Fila vazia: mensagem de estado vazio nas duas abas.
- Link direto antigo para um grupo que deixou de ser público: "não encontrado"
  para quem não é dono, membro atual ou staff.
- Admin tenta aprovar grupo que não está em aprovação (já em ajustes,
  rejeitado ou cancelado): recusado.
- Membro removido/banido de um grupo cancelado não vê mais o grupo.

## Requirements *(mandatory)*

### Functional Requirements

**Estado e criação**

- **FR-001**: Todo grupo DEVE ter um estado de moderação entre: em aprovação,
  ajustes, rejeitado, aprovado e cancelado. Não existe estado suspenso.
- **FR-002**: A criação de grupo DEVE gravar o estado em aprovação e a data de
  envio, ignorando `status`, `statusDetalhado` e qualquer campo de moderação
  enviados pelo cliente, inclusive quando quem cria é admin do sistema.
- **FR-003**: A edição de grupo DEVE ignorar `status`, `statusDetalhado` e
  campos de moderação enviados pelo cliente, para qualquer papel; o estado só
  muda pelas ações desta feature (decisões da fila, aprovação automática,
  reenvio, desistência, cancelamento pelo Cotea).
- **FR-004**: O campo `tipoGrupo` enviado pelo cliente NÃO DEVE dispensar a
  aprovação.

**Visibilidade e elegibilidade**

- **FR-005**: A home e a listagem pública de grupos DEVEM retornar só grupos
  aprovados e não cancelados.
- **FR-006**: O detalhe de grupo (por id ou slug, página e API) DEVE responder
  como "não encontrado" quando o grupo não estiver aprovado e não cancelado,
  exceto para o dono, membros atuais (não removidos/banidos) e staff com acesso
  à aba de grupos.
- **FR-007**: Pagamento de assinatura e entrada em grupo DEVEM ser recusados no
  servidor, antes de qualquer cobrança ou débito, quando o grupo não estiver
  aprovado ou estiver cancelado.

**Fila e decisões**

- **FR-008**: O `/admin` DEVE ter uma fila de moderação com duas visões: grupos
  em aprovação (ordem de envio, mais antigo primeiro, com prazo restante até a
  aprovação automática) e grupos aprovados automaticamente com revisão
  posterior pendente.
- **FR-009**: Cada item da fila DEVE exibir dados públicos, preço por vaga,
  valor total, capacidade, dono, link oficial, sinalização de risco
  (`necessitaAnalise`), observações internas e o histórico de moderação do
  grupo (envios, ajustes pedidos e respostas).
- **FR-010**: Apenas `systemRole: admin` DEVE poder decidir (aprovar, pedir
  ajuste, rejeitar, confirmar revisão, reprovar revisão, cancelar pelo Cotea);
  `support` DEVE poder consultar a fila sem decidir; os demais papéis não
  acessam a fila. A verificação DEVE ocorrer no servidor.
- **FR-011**: Aprovar DEVE levar o grupo de em aprovação para aprovado, com os
  estados públicos atuais de grupo recém-publicado, e registrar autor e data.
- **FR-012**: Pedir ajuste DEVE exigir texto não vazio, levar o grupo para
  ajustes e mostrar o texto ao dono.
- **FR-013**: Rejeitar DEVE exigir motivo não vazio e levar o grupo para
  rejeitado, estado final: o grupo não pode ser editado, reenviado nem
  aprovado depois.
- **FR-014**: Cada decisão DEVE valer só a partir do estado esperado
  (transição condicional); uma decisão sobre grupo que já mudou de estado DEVE
  ser recusada como conflito, sem efeitos.

**Aprovação automática e revisão**

- **FR-015**: Uma rotina agendada (mecanismo da V2-01, idempotente) DEVE
  aprovar automaticamente todo grupo em aprovação cujo envio mais recente tenha
  completado 2 dias úteis (calendário da V2-01, horário de Brasília) sem
  decisão.
- **FR-016**: A aprovação automática DEVE ter o mesmo efeito público da
  aprovação manual e marcar o grupo como "revisão posterior pendente",
  consultável por outras features (V2-11).
- **FR-017**: A auditoria DEVE distinguir a aprovação automática (sem autor
  humano) da manual.
- **FR-018**: Confirmar a revisão DEVE limpar a marca de revisão pendente e
  registrar autor e data; reprovar DEVE exigir motivo e executar o
  cancelamento pelo Cotea (FR-023 a FR-025).

**Dono: ajustes, reenvio e desistência**

- **FR-019**: O dono NÃO DEVE poder editar o grupo em aprovação, rejeitado ou
  cancelado; em ajustes, DEVE poder editar com as mesmas validações da
  criação.
- **FR-020**: Reenviar DEVE levar o grupo de ajustes para em aprovação com nova
  data de envio (novo prazo de 2 dias úteis), exigindo as mesmas condições da
  criação (conta validada, não bloqueado, cadastro financeiro completo).
- **FR-021**: O dono DEVE poder desistir de um grupo em aprovação ou em
  ajustes; o grupo vai para cancelado e sai da fila.
- **FR-022**: O dono DEVE ver, no grupo e em Meus Grupos, o estado de moderação
  e, quando houver, o texto do ajuste, o motivo da rejeição ou do cancelamento
  pelo Cotea.

**Cancelamento pelo Cotea**

- **FR-023**: O admin do sistema DEVE poder cancelar um grupo aprovado
  informando motivo obrigatório.
- **FR-024**: O cancelamento DEVE ser lógico: grupo, membros, faturas e
  histórico permanecem; o grupo sai da listagem e para de aceitar entradas e
  cobranças.
- **FR-025**: Cancelado é estado final: nenhuma ação desta feature nem a edição
  podem reabrir o grupo. Esta feature NÃO DEVE estornar membros
  automaticamente.

**Notificação, auditoria e migração**

- **FR-026**: O dono DEVE receber notificação interna em: aprovação, pedido de
  ajuste, rejeição, aprovação automática e cancelamento pelo Cotea. Os membros
  atuais DEVEM receber notificação interna no cancelamento pelo Cotea. Cada
  notificação DEVE ser gerada uma única vez por evento.
- **FR-027**: O `/admin` DEVE exibir aos admins e ao suporte a contagem de
  grupos em aprovação e de revisões pendentes.
- **FR-028**: Cada transição de moderação DEVE gerar evento de auditoria com
  grupo, estado anterior e novo, autor (ou "automático"), motivo/texto quando
  houver e data, registrado só depois de a transição ser efetivada.
- **FR-029**: Uma migração DEVE classificar os grupos existentes: `ativo` →
  aprovado sem revisão pendente; sem `status` → tratado como `ativo` legado
  (mesmo critério de `lib/grupo-entrada.js`), gravado explicitamente como
  `ativo` e listado no relatório; `cancelado` → cancelado; valor desconhecido
  (ex.: `inativo`) → não alterado, fora do ar e listado no relatório como "não
  classificado". A migração DEVE ter modo de simulação e ser reexecutável sem
  efeito duplicado.
- **FR-030**: `.docs/regras-negocio-v2.md` DEVE ser atualizado: remoção do
  estado suspenso (vira cancelamento pelo Cotea), rejeição definitiva, grupo em
  aprovação/ajustes sem entrada de membros e eliminação da descrição "Hoje a
  criação salva grupo como ativo" dos gaps.

### Key Entities *(include if feature involves data)*

- **Grupo (moderação)**: além dos dados atuais, carrega o estado de moderação,
  a data do envio mais recente (base do prazo), a marca de revisão posterior
  pendente, o último texto de ajuste/motivo e quem/quando decidiu.
- **Histórico de moderação**: sequência de eventos de um grupo (envio,
  ajuste pedido, reenvio, aprovação manual/automática, rejeição, revisão,
  desistência, cancelamento pelo Cotea), com autor, data e texto; serve à fila
  e ao dono.
- **Notificação interna**: já existe (`notificacoesUsuario`); recebe os novos
  tipos de evento de moderação.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% dos grupos criados depois da entrega começam em aprovação,
  qualquer que seja o `status` enviado pelo cliente (verificado por teste com
  payloads `ativo`, `cancelado` e campos de moderação).
- **SC-002**: Nenhum grupo fora de aprovado-e-não-cancelado aparece na home, na
  listagem pública ou no detalhe para terceiros, e nenhum aceita pagamento ou
  entrada (verificado por teste em cada estado).
- **SC-003**: Todo grupo em aprovação há mais de 2 dias úteis é aprovado
  automaticamente na primeira execução da rotina após o vencimento, uma única
  vez, mesmo com execuções repetidas ou concorrentes.
- **SC-004**: Toda transição de moderação tem exatamente um evento de auditoria
  e, quando previsto, uma notificação por destinatário.
- **SC-005**: Depois da migração, todos os grupos que eram `ativo` (ou sem
  `status`, tratados como `ativo` legado) continuam listados e aceitando
  entrada; o relatório lista 0 grupos não classificados ou explica cada um.
- **SC-006**: O admin decide um grupo da fila (aprovar, ajustar ou rejeitar) em
  até 3 ações a partir do `/admin`.

## Assumptions

- O calendário de dias úteis e o mecanismo de rotinas da V2-01
  (`001-rotinas-agendadas`, convergida) estão disponíveis; o prazo vence no fim
  (23:59:59, Brasília) do 2º dia útil após o dia do envio, a mesma regra de
  `vencimentoDiasUteis`.
- "Staff com acesso à aba de grupos" é o critério que o detalhe já usa hoje
  (`PERMISSIONS.GROUPS_TAB`).
- Os estados públicos de um grupo aprovado continuam os atuais (`status`
  público e `statusDetalhado` `em_formacao`/`ativo`) até a V2-07.
- O fluxo atual de encerramento/exclusão de grupo aprovado pelo dono não muda
  nesta feature (V2-14).
- A edição de grupo aprovado segue as regras atuais de quem pode editar o quê
  (exceto `status`, FR-003) até a V2-13.
- O admin do sistema mantém a edição de conteúdo pela tela atual em qualquer
  estado não final; editar não muda o estado de moderação nem o prazo.
- O banco hoje tem poucos grupos, todos criados como `ativo`; os estados reais
  devem ser conferidos no MongoDB no `sdd-plan` antes de fixar a migração.
- Não há organizações no sistema; a dispensa de aprovação para grupos de
  organização será adicionada pela V2-19.

## Clarifications

### Sessão 2026-11-26

- Q: Como tratar "repasse retido até a revisão" sem a V2-11? → A: Esta feature
  só grava a marca "revisão posterior pendente"; a V2-11 a consulta para reter
  o repasse. Nenhum movimento financeiro aqui.
- Q: O que acontece com os membros quando o grupo é suspenso? → A: Não existe
  suspensão: o grupo é mantido ou cancelado. "Em revisão" (em aprovação)
  significa que o grupo ainda não aceita entrada de membros.
- Q: Como ficam os grupos `ativo` já existentes? → A: Aprovados, sem revisão
  pendente.
- Q: Diferença entre rejeitado e ajustes? → A: Rejeição é definitiva; só
  ajustes permite editar e reenviar (corrigir a RN).
- Q: A aprovação automática após 2 dias úteis continua? → A: Sim; o grupo entra
  no ar normalmente e fica marcado para revisão posterior. "Sem entrada" vale
  só para a fila inicial.
- Q: Reprovação na revisão posterior, com membros? → A: Cancelado pelo Cotea,
  com motivo; membros notificados e tratados pelo suporte; estornos
  automáticos ficam para a V2-14.
- Q: O admin pode cancelar grupo aprovado por fraude/denúncia nesta feature? →
  A: Sim, com motivo obrigatório e auditoria.
- Q: Quem decide na fila? → A: Só `systemRole: admin`; suporte só consulta.
- Q: Como conta o prazo após reenvio? → A: Reinicia no reenvio; o tempo em
  ajustes não conta.
- Q: O dono edita em aprovação? → A: Não; só em ajustes.
- Q: Quem vê o detalhe de grupo não público? → A: Dono, membros atuais e
  staff; os demais recebem "não encontrado".
- Q: Notificações? → A: Notificação interna ao dono (e aos membros no
  cancelamento pelo Cotea); contador na fila; e-mails na V2-24.
- Q: Grupo criado por admin do sistema passa pela fila? → A: Sim; o próprio
  admin pode aprová-lo na fila, com auditoria.
- Q: Formato do pedido de ajuste e da rejeição? → A: Texto livre obrigatório.
- Q: O dono pode desistir do pedido? → A: Sim, em aprovação ou ajustes; o
  grupo vira cancelado.

### Sessão 2026-11-26 (sdd-plan)

- Q: O prazo de 2 dias úteis vence no mesmo horário do envio ou no fim do 2º dia
  útil? → A: No fim do 2º dia útil após o dia do envio (calendário da V2-01,
  `vencimentoDiasUteis`); US3/AC1 e Assumptions corrigidos.
- Q: Como tratar na migração um grupo sem o campo `status`? → A: Como `ativo`
  legado (aprovado e público), por coerência com o critério já usado em
  `lib/grupo-entrada.js` (`motivoGrupoIndisponivel`) e nos testes de B-04 e
  `get-grupo-expoe-dados-internos`; a migração grava `status: 'ativo'`
  explicitamente e o lista no relatório. Valor desconhecido (ex.: `inativo`)
  não é alterado: fica fora do ar e aparece como "não classificado". Nenhum
  caso no banco (5 grupos, todos `ativo`, conferido em 2026-11-26); decisão
  D-02 do plan (R-001), substituindo o texto anterior do FR-029.

### Sessão 2026-11-26 (sdd-execute)

- Q: O botão "Cancelar grupo" do dono na tela de edição enviava `PUT` com`n  `status: 'cancelado'`, que o FR-003 passa a ignorar. Como manter o encerramento
  atual do dono? → A: Nova ação do dono `encerrar` (`ativo` → `cancelado`,
  `cancelamento.origem: 'dono'`, motivo opcional, auditada, membros atuais
  notificados, sem estorno, como hoje) pela rota `POST /api/grupos/[id]/moderacao`;
  em aprovação/ajustes o botão usa `desistir`. Reembolsos continuam na V2-14.
- Q: O contrato travado do detalhe semeava o "grupo legado" como `em_aprovacao`
  (default do destructuring)? → A: Sim, defeito do teste; emendado só na semeadura
  e trava regravada (R-007).
