# Feature Specification: Ledger segmentado e saldo sacável

**Slug**: `002-ledger-segmentado`

**Created**: 2026-11-24

**Status**: Convergência Pendente

**Input**: Backlog `V2-02 · P0 · Ledger segmentado e saldo sacável` —
especificar categorias de lançamento e saldos derivados: saldo pessoal
disponível, caução bloqueada (por membro/grupo), valor retido de entrada/fila,
recebível do dono retido/liberado, valor bloqueado por disputa e taxa do Cotea;
cada lançamento guarda `organizacaoId` (nulo no público). Saque só consome
saldo disponível. Fonte: `.docs/regras-negocio-v2.md` linhas 46-47, 836-840,
896-897, 919-928 e "Regras financeiras consolidadas" (citadas no backlog como
1083-1095; hoje em 1090-1115). Evidência: `calculateBalances` agrega só por `type`/`status`
(`lib/wallet.js:27-67`); não há `organizacaoId` nem categorias em
`walletTransactions`.

## Escopo

### Incluído

- Modelo de categorias de saldo para todo lançamento da carteira: saldo
  pessoal, caução, retido de entrada/fila, recebível do dono (retido),
  bloqueado por disputa e saque em andamento.
- Vínculo de cada lançamento à sua origem: contexto (`organizacaoId`, nulo no
  público) e, quando aplicável, grupo e participação.
- Cálculo único dos saldos derivados por usuário: total, disponível (= sacável)
  e cada valor não disponível por categoria; caução e retenções também por
  grupo/participação.
- Movimentação entre categorias (ex.: liberar recebível retido para o saldo
  pessoal, devolver caução, bloquear por disputa) como operação registrada no
  ledger, sem apagar nem reescrever lançamentos anteriores.
- Conta da plataforma (Cotea) para registrar a receita de taxa, separada das
  carteiras dos usuários, consultável por admin e financeiro.
- Migração única dos lançamentos existentes para a categoria saldo pessoal,
  sem alterar nenhum saldo atual.
- Adaptação dos fluxos que já gravam no ledger (depósito PIX, uso de saldo,
  pagamento de assinatura, estorno de assinatura, solicitação/aprovação/
  rejeição de saque) para gravar categoria e contexto.
- Regra de que saque e uso de saldo só consomem o disponível, inclusive com
  requisições simultâneas.
- Resumo segmentado na tela da carteira do usuário.
- Na aprovação/rejeição de saque, financeiro e admin veem o disponível atual
  do usuário e os valores não disponíveis por categoria.
- Visão do total da conta da plataforma para admin e financeiro.
- Rotina agendada diária (mecanismo da `001-rotinas-agendadas`) que confere a
  consistência do ledger e alerta o admin do sistema.

### Fora de Escopo

- Gerar caução no checkout, retenção de entrada/fila, recebíveis por
  membro/ciclo e bloqueio por disputa a partir de fluxos de negócio — vêm em
  V2-06, V2-07, V2-11, V2-15 e V2-16. Esta feature só deixa as categorias e
  movimentações prontas para elas.
- Regra de preço com taxa de 5% e o primeiro lançamento real de receita do
  Cotea (V2-03/V2-11). O pagamento de assinatura atual continua debitando só o
  membro, sem separar taxa.
- Mínimo de R$ 5,00, taxa do provedor, CPF do próprio usuário e prazo de 2
  dias úteis no saque (V2-17) e no depósito (V2-18).
- Extrato completo por categoria e separação de faturas/pagamentos (V2-23).
- Entidade organização e alternância de contexto (V2-19); aqui `organizacaoId`
  é sempre nulo, mas o campo existe e é obrigatório no modelo.
- Mascaramento de CPF nas listagens (B-03/V2-26).
- Correção do bug B-02 (estorno sem cancelamento): o fluxo de estorno é só
  adaptado às categorias, sem mudar quem pode chamá-lo.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Saldo calculado por categoria e saque só do disponível (Priority: P1)

O usuário tem um único saldo total, mas só parte dele é disponível. Valores em
caução, retidos de entrada/fila, recebíveis ainda retidos, bloqueados por
disputa ou reservados por saque em andamento não podem ser sacados nem usados
para pagar. Os lançamentos já existentes passam a contar como saldo pessoal,
sem mudança de valor.

**Why this priority**: É a fundação de todo o ciclo financeiro v2 (checkout
com caução, recebíveis, disputas, fila, saque v2). Sem ela, qualquer valor
retido seria sacável.

**Independent Test**: Montar uma carteira com lançamentos em várias categorias
(inclusive via a operação de movimentação), consultar o saldo e tentar sacar e
usar saldo acima e abaixo do disponível; conferir que um ambiente com dados
legados mantém exatamente os mesmos saldos após a migração.

**Acceptance Scenarios**:

1. **Given** um usuário com R$ 100,00 de saldo pessoal e R$ 30,00 em caução,
   **When** consulta o saldo, **Then** vê total R$ 130,00 e disponível
   R$ 100,00, com R$ 30,00 em caução.
2. **Given** o mesmo usuário, **When** solicita saque de R$ 120,00, **Then** a
   solicitação é recusada por saldo disponível insuficiente e nada é gravado.
3. **Given** disponível de R$ 100,00, **When** duas solicitações de saque de
   R$ 80,00 chegam ao mesmo tempo, **Then** só uma é aceita e o disponível
   nunca fica negativo.
4. **Given** um saque de R$ 40,00 solicitado, **When** consulta o saldo,
   **Then** o disponível cai R$ 40,00 e o valor aparece como saque em
   andamento; ao rejeitar, volta ao disponível; ao aprovar, sai do total.
5. **Given** a base com lançamentos legados sem categoria, **When** a migração
   roda (uma ou mais vezes), **Then** todos ficam como saldo pessoal, no
   contexto público, e o total e o disponível de cada usuário são idênticos
   aos de antes.
6. **Given** R$ 50,00 em recebível retido de um grupo, **When** o recebível é
   liberado, **Then** o valor sai de "a receber" e entra no disponível,
   podendo ser sacado ou usado para pagar, e o histórico mostra a origem.

---

### User Story 2 - Resumo segmentado na carteira (Priority: P2)

Na tela da carteira, o usuário vê quanto pode sacar/usar agora e, quando
houver, quanto está em caução, retido, a receber e em disputa, com o grupo de
origem quando aplicável.

**Why this priority**: Transparência obrigatória antes de as features de
caução e recebível entrarem em produção; sem ela o usuário não entende por que
não consegue sacar todo o total.

**Independent Test**: Com uma carteira com valores em várias categorias,
abrir a tela da carteira e conferir os valores e rótulos contra o cálculo da
US1.

**Acceptance Scenarios**:

1. **Given** um usuário só com saldo pessoal, **When** abre a carteira,
   **Then** vê o disponível em destaque e nenhuma linha de valor bloqueado.
2. **Given** um usuário com caução em dois grupos, **When** abre a carteira,
   **Then** vê o total em caução e o valor de cada grupo.
3. **Given** valores não disponíveis, **When** abre a carteira, **Then** cada
   categoria tem uma explicação curta de por que não está disponível.

---

### User Story 3 - Visões do financeiro e conta da plataforma (Priority: P3)

Ao aprovar ou rejeitar um saque, financeiro e admin veem o disponível atual do
usuário e os valores não disponíveis por categoria. Admin e financeiro
consultam o total da conta da plataforma (receita de taxa do Cotea).

**Why this priority**: Apoia a decisão do financeiro e prepara a contabilidade
da taxa, mas o saque já é protegido pela US1.

**Independent Test**: Abrir um saque pendente como financeiro e conferir o
resumo do usuário; consultar a conta da plataforma com lançamentos de receita
de teste; confirmar que suporte e usuário comum não acessam essas visões.

**Acceptance Scenarios**:

1. **Given** um saque pendente, **When** o financeiro abre o pedido, **Then**
   vê o disponível atual do usuário e o resumo por categoria.
2. **Given** lançamentos de receita na conta da plataforma, **When** admin ou
   financeiro consultam, **Then** veem o total e os lançamentos com a
   referência de origem.
3. **Given** um usuário com papel suporte ou comum, **When** tenta acessar
   essas visões, **Then** o acesso é negado.

---

### User Story 4 - Conferência diária de consistência (Priority: P3)

Uma rotina diária confere todas as carteiras e a conta da plataforma e alerta
o admin do sistema se encontrar inconsistência.

**Why this priority**: Rede de segurança; a proteção principal já está na
gravação (US1).

**Independent Test**: Inserir diretamente uma inconsistência de teste, rodar
a rotina e verificar o alerta e o registro da execução no painel de rotinas.

**Acceptance Scenarios**:

1. **Given** um ledger consistente, **When** a rotina roda, **Then** registra
   execução sem alertas.
2. **Given** uma carteira com categoria negativa ou lançamento sem categoria,
   **When** a rotina roda, **Then** o admin do sistema recebe alerta com a
   carteira e a categoria afetadas, e nada é corrigido automaticamente.

### Edge Cases

- Movimentação de categoria que deixaria a origem negativa (ex.: devolver mais
  caução do que existe) é recusada por inteiro.
- Operação composta (ex.: débito no membro e receita na plataforma, ou saída de
  uma categoria e entrada em outra) grava tudo ou nada.
- Reprocessar a mesma operação com a mesma referência (retentativa, clique
  duplo, rotina) não duplica lançamentos.
- Lançamento de saque legado em `blocked`: após a migração, conta como saque
  em andamento e a aprovação/rejeição continua funcionando.
- Lançamentos `pending` e `cancelled` não entram em nenhum saldo, como hoje.
- Usuário sem carteira: saldo zero em todas as categorias.
- Valores sempre com duas casas decimais; somas não geram centavos fantasmas.
- Usuário bloqueado (`isBlocked`) continua podendo sacar o disponível.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Sistema DEVE registrar em todo lançamento da carteira uma
  categoria de saldo entre: saldo pessoal, caução, retido de entrada/fila,
  recebível retido, bloqueado por disputa e saque em andamento.
- **FR-002**: Sistema DEVE registrar em todo lançamento o contexto de origem
  (`organizacaoId`, nulo para o público) e, quando aplicável, o grupo e a
  participação a que se refere; caução, retido de entrada/fila, recebível e
  disputa DEVEM ter grupo.
- **FR-003**: Sistema DEVE calcular, por usuário, o saldo total, o saldo
  disponível e o valor em cada categoria não disponível, a partir apenas dos
  lançamentos confirmados e bloqueados, como hoje; `pending` e `cancelled` não
  contam.
- **FR-004**: Saldo disponível DEVE ser igual ao saldo pessoal menos os saques
  em andamento; o saldo sacável DEVE ser igual ao disponível.
- **FR-005**: Sistema DEVE calcular caução, retido de entrada/fila, recebível
  retido e bloqueado por disputa também por grupo e por participação.
- **FR-006**: Sistema DEVE oferecer uma operação única de movimentação entre
  categorias de uma mesma carteira, registrada como lançamentos ligados pela
  mesma referência, sem alterar nem apagar lançamentos anteriores.
- **FR-007**: Liberar um recebível retido DEVE movê-lo para o saldo pessoal,
  mantendo no histórico a origem (grupo/participação).
- **FR-008**: Toda operação que reduz uma categoria (saque, uso de saldo,
  pagamento, movimentação) DEVE ser recusada sem efeito se deixasse essa
  categoria negativa, inclusive sob requisições simultâneas da mesma carteira.
- **FR-009**: Operações que gravam mais de um lançamento (em uma ou mais
  carteiras, incluindo a da plataforma) DEVEM gravar todos ou nenhum.
- **FR-010**: Operações DEVEM ser idempotentes pela referência de origem:
  repetir a mesma operação não cria lançamentos duplicados.
- **FR-011**: Sistema DEVE manter uma conta da plataforma (Cotea), separada
  das carteiras de usuário, com a categoria receita de taxa, e permitir
  registrar a receita ligada à mesma referência do pagamento de origem.
- **FR-012**: Uma migração única e reexecutável DEVE classificar todos os
  lançamentos existentes sem categoria como saldo pessoal (ou saque em
  andamento, para débitos de saque bloqueados) no contexto público, sem mudar
  o total nem o disponível de nenhum usuário.
- **FR-013**: Depósito PIX, uso de saldo, pagamento de assinatura, estorno de
  assinatura e solicitação/aprovação/rejeição de saque DEVEM gravar categoria
  e contexto e consumir só o disponível.
- **FR-014**: Solicitação de saque DEVE mover o valor do saldo pessoal para
  saque em andamento; aprovação DEVE baixá-lo do total; rejeição DEVE
  devolvê-lo ao disponível.
- **FR-015**: Respostas de saldo ao usuário DEVEM expor total, disponível e
  cada categoria não disponível, com detalhe por grupo quando aplicável.
- **FR-016**: A tela da carteira DEVE mostrar o disponível em destaque e, só
  quando houver valor, cada categoria não disponível com explicação curta e
  grupo de origem.
- **FR-017**: Na aprovação/rejeição de saque, financeiro e admin DEVEM ver o
  disponível atual do usuário e o resumo por categoria; suporte e usuário
  comum NÃO DEVEM ver.
- **FR-018**: Admin e financeiro DEVEM poder consultar o total e os
  lançamentos da conta da plataforma; demais papéis NÃO DEVEM.
- **FR-019**: Uma rotina agendada diária DEVE conferir todas as carteiras e a
  conta da plataforma (categoria negativa, disponível negativo, lançamento sem
  categoria/contexto, operação composta incompleta) e alertar o admin do
  sistema, sem corrigir nada automaticamente.
- **FR-020**: Valores DEVEM ser normalizados para duas casas decimais em toda
  gravação e em todo saldo derivado.
- **FR-021**: Novos lançamentos sem categoria ou sem contexto DEVEM ser
  recusados.

### Key Entities *(include if feature involves data)*

- **Lançamento do ledger**: movimento de valor em uma carteira — tipo
  (crédito/débito), valor, status, origem (`source`), referência, categoria,
  contexto (`organizacaoId`), grupo e participação opcionais, data.
- **Carteira**: única por usuário; seus saldos são sempre derivados dos
  lançamentos, nunca armazenados como fonte de verdade.
- **Conta da plataforma**: carteira do Cotea, sem usuário dono, que recebe a
  receita de taxa.
- **Resumo de saldo**: visão derivada — total, disponível/sacável, e valores
  por categoria não disponível, com detalhe por grupo/participação.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Após a migração, 100% dos usuários têm total e disponível
  idênticos aos de antes, e 0 lançamentos ficam sem categoria ou contexto.
- **SC-002**: Em teste com requisições simultâneas, nenhuma carteira termina
  com disponível ou categoria negativa.
- **SC-003**: Nenhum valor em caução, retido, recebível retido, disputa ou
  saque em andamento pode ser sacado ou usado para pagar (verificado por
  testes de todas as categorias).
- **SC-004**: O usuário identifica na carteira quanto pode sacar e por que o
  restante não está disponível, sem consultar suporte.
- **SC-005**: Uma inconsistência injetada é alertada ao admin do sistema na
  execução diária seguinte.

## Assumptions

- Categorias de caução, retenção, recebível e disputa só recebem lançamentos
  reais a partir de V2-06/V2-07/V2-11/V2-15/V2-16; até lá, são exercitadas por
  testes e pela operação de movimentação.
- O débito do membro por pagamento de grupo continua saindo do saldo pessoal;
  o crédito correspondente ao dono (recebível) e à plataforma (taxa) nasce em
  V2-03/V2-11.
- A conta da plataforma começa vazia nesta feature.
- O mecanismo de rotinas e alertas da `001-rotinas-agendadas` está disponível
  para a conferência diária.
- Ambiente ainda pré-lançamento, mas o histórico existente é preservado.
- Validar estados e documentos reais de `walletTransactions` no MongoDB antes
  de planejar a migração.

## Clarifications

### Sessão 2026-11-24

- Q: O que a V2-02 entrega, dado que caução/recebível/disputa nascem em outras
  features? → A: Fundação (categorias, saldos derivados, movimentação) +
  adaptação dos fluxos atuais + saque só do disponível; fluxos geradores ficam
  nas features próprias.
- Q: Como tratar lançamentos existentes sem categoria? → A: Migração única
  para saldo pessoal; nenhum saldo muda.
- Q: Onde fica a taxa do Cotea? → A: Conta da plataforma separada, consultável
  por admin/financeiro, ligada ao pagamento pela referência.
- Q: O que o usuário vê? → A: Resumo segmentado na carteira; extrato completo
  na V2-23.
- Q: Recebível liberado entra como? → A: Vira saldo pessoal disponível
  (sacável e usável para pagar); histórico mantém a origem.
- Q: Quem mais vê saldos segmentados? → A: Financeiro/admin na aprovação de
  saque e na conta da plataforma; suporte não vê valores.
- Q: Consistência do ledger? → A: Bloqueio na gravação (sem negativo, mesmo
  concorrente) + rotina diária que alerta o admin, sem autocorreção.
- Q: O pagamento atual já grava a receita do Cotea? → A: Não; só a partir da
  regra de preço (V2-03) e recebíveis (V2-11).
