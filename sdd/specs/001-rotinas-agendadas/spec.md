# Feature Specification: Rotinas agendadas idempotentes e calendário de dias úteis

**Slug**: `001-rotinas-agendadas`

**Created**: 2026-11-20

**Status**: Em Execução

**Input**: Backlog `V2-01 · P0 · Rotinas agendadas idempotentes e calendário de
dias úteis` — especificar o mecanismo de rotinas (gatilho, idempotência por
evento, reexecução segura, registro de execução) e o cálculo de dias
corridos/dias úteis (feriados nacionais). Base para: SLA de acesso de 5 dias,
estorno de grupo `apos_completar` em 30 dias, aprovação automática em 2 dias
úteis, faturas mensais e avisos D0/D2/D3, liberação de repasse em 30 dias,
prazos de disputa (3 e 7 dias), expiração de convite (30 dias) e prazo de saque
(2 dias úteis). Fonte: `.docs/regras-negocio-v2.md` linhas 437-441, 526,
568-570, 778, 855-856, 893, 911. Evidência: não há rotina recorrente em
`pages/api/`, `lib/` ou `scripts/` (só `scripts/reset-wallet.js`).

## Escopo

### Incluído

- Mecanismo para executar rotinas automaticamente, sem ação de usuário, que
  encontram itens com prazo vencido e os processam.
- Garantia de que cada item/evento é processado no máximo uma vez com efeito,
  mesmo com execuções repetidas, simultâneas ou reexecuções manuais.
- Retentativa automática de itens com falha, com limite, e alerta ao admin do
  sistema quando o limite se esgota.
- Recuperação de atraso: depois de um período sem execução, todos os itens
  vencidos no intervalo são processados.
- Registro de cada execução e de cada item processado (início, fim, resultado,
  quantidade, erro).
- Cálculo de prazos em dias corridos e em dias úteis, no horário de Brasília.
- Calendário de dias não úteis: fins de semana, feriados nacionais oficiais
  (fixos e móveis) e datas extras mantidas pelo admin do sistema.
- Painel em `/admin`, só para o admin do sistema, com rotinas, execuções,
  falhas, reexecução manual e manutenção das datas extras.
- Uma rotina de verificação de funcionamento ("saúde"), sem efeito de negócio,
  para validar o mecanismo de ponta a ponta.

### Fora de Escopo

- As regras de negócio de cada prazo (estorno por SLA de acesso, estorno de
  `apos_completar`, aprovação automática, faturas e avisos D0/D2/D3, liberação
  de repasse, prazos de disputa, expiração de convite, prazo de saque). Cada
  uma é especificada e registrada como rotina na própria feature (V2-05 a
  V2-20).
- Feriados estaduais e municipais calculados automaticamente (podem ser
  cadastrados como datas extras).
- Notificações a usuários finais sobre as rotinas; o único alerta desta feature
  vai ao admin do sistema.
- Acesso ao painel por suporte, financeiro ou admin de organização.
- A escolha de onde e como as rotinas rodam (infraestrutura) — decisão do
  `sdd-plan`, possivelmente via `sdd-adr`.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Prazos vencidos são processados automaticamente e uma única vez (Priority: P1)

Uma feature de negócio registra uma rotina ("quais itens venceram e o que fazer
com cada um"). O sistema executa essa rotina periodicamente, sem intervenção, e
cada item vencido é processado uma única vez, mesmo que a rotina rode de novo,
rode em paralelo ou seja reexecutada.

**Why this priority**: É o que destrava todas as regras de prazo da v2 (estorno
automático, aprovação automática, faturas, repasse). Sem isso, nenhuma delas
pode ser implementada de forma confiável. Processamento duplicado em rotinas
financeiras gera estorno ou crédito em dobro.

**Independent Test**: Registrar a rotina de saúde com itens de teste vencidos e
não vencidos; verificar que só os vencidos são processados, cada um exatamente
uma vez, mesmo disparando duas execuções simultâneas e uma reexecução.

**Acceptance Scenarios**:

1. **Given** uma rotina registrada com 3 itens vencidos e 2 não vencidos, **When**
   a execução periódica ocorre, **Then** os 3 vencidos são processados e os 2
   não vencidos ficam intactos.
2. **Given** um item já processado com sucesso, **When** a rotina roda de novo,
   **Then** o item não é processado outra vez e nenhum efeito se repete.
3. **Given** duas execuções da mesma rotina iniciadas ao mesmo tempo, **When**
   ambas terminam, **Then** cada item vencido foi processado com efeito uma
   única vez.
4. **Given** que nenhuma execução ocorreu durante 6 horas, **When** a execução
   seguinte ocorre, **Then** todos os itens vencidos nesse intervalo são
   processados.
5. **Given** um prazo que vence às 10:00, **When** o tempo passa, **Then** o
   item é processado até as 11:00.

---

### User Story 2 - Cálculo de prazos em dias corridos e dias úteis (Priority: P1)

As features de negócio perguntam ao sistema "quando vence um prazo de N dias
corridos/úteis a partir deste momento?" e "este prazo já venceu?". A resposta
segue uma regra única, no horário de Brasília, considerando fins de semana,
feriados nacionais e datas extras.

**Why this priority**: Aprovação automática (2 dias úteis), prazo de saque
(2 dias úteis), SLA de acesso (5 dias corridos), disputas (3 e 7 dias),
`apos_completar` (30 dias), convites (30 dias) e repasse (30 dias) dependem da
mesma regra. Se cada feature contar de um jeito, os prazos divergem.

**Independent Test**: Pode ser testado isoladamente com datas de exemplo
(véspera de feriado, sexta-feira à noite, Sexta-feira Santa, virada de ano),
comparando com os vencimentos esperados.

**Acceptance Scenarios**:

1. **Given** um evento em 03/11/2026 às 14:30 (Brasília), **When** se calcula o
   prazo de 5 dias corridos, **Then** ele vence em 08/11/2026 às 14:30.
2. **Given** um evento na sexta-feira 13/11/2026 às 18:00, **When** se calcula o
   prazo de 2 dias úteis, **Then** ele vence na terça-feira 17/11/2026 às
   23:59:59 (o dia do evento não conta; 14 e 15/11 são fim de semana; o dia útil
   1 é 16/11 e o dia útil 2 é 17/11).
3. **Given** um evento na quarta-feira 18/11/2026 às 10:00, **When** se calcula o
   prazo de 2 dias úteis, **Then** ele vence na segunda-feira 23/11/2026 às
   23:59:59 (19/11 é o dia útil 1; 20/11 é feriado nacional; 21 e 22/11 são fim
   de semana).
4. **Given** um evento na quinta-feira anterior à Sexta-feira Santa, **When** se
   calcula 1 dia útil, **Then** a Sexta-feira Santa e o fim de semana são
   pulados e o prazo vence na segunda-feira seguinte às 23:59:59.
5. **Given** um evento em dia não útil (sábado), **When** se calcula 2 dias
   úteis, **Then** a contagem começa no primeiro dia útil seguinte ao evento.

---

### User Story 3 - Admin do sistema acompanha e reexecuta rotinas (Priority: P2)

O admin do sistema abre uma aba no painel `/admin` e vê cada rotina registrada,
a última execução, o resultado, quantos itens foram processados e quais itens
falharam. Ele pode reexecutar uma rotina ou um item com falha, sem risco de
efeito duplicado. Quando um item esgota as retentativas, o admin recebe um
alerta.

**Why this priority**: Rotinas que movimentam dinheiro precisam de
observabilidade e de um caminho de recuperação. A automação (P1) já entrega
valor sem o painel, mas falhas silenciosas seriam um risco operacional.

**Independent Test**: Forçar falha em um item da rotina de saúde; verificar que
ele é retentado, que após o limite aparece como falha definitiva no painel e
gera alerta, e que a reexecução manual o processa uma única vez.

**Acceptance Scenarios**:

1. **Given** uma rotina com execuções registradas, **When** o admin do sistema
   abre a aba de rotinas, **Then** vê para cada rotina a última execução, seu
   resultado, a duração, o total de itens processados e o total com falha.
2. **Given** um item que falhou, **When** as execuções seguintes ocorrem, **Then**
   o item é retentado até 5 vezes; os demais itens da rotina continuam sendo
   processados normalmente.
3. **Given** um item que falhou 5 vezes, **When** a 5ª falha ocorre, **Then** o
   item é marcado como falha definitiva, deixa de ser retentado automaticamente
   e o admin do sistema recebe uma notificação interna.
4. **Given** um item em falha definitiva, **When** o admin clica em reexecutar,
   **Then** o item é processado uma vez; se já tiver sido processado com
   sucesso por outro caminho, nenhum efeito se repete.
5. **Given** um usuário de suporte, financeiro ou comum, **When** tenta abrir a
   aba de rotinas ou acionar uma reexecução, **Then** o acesso é negado.

---

### User Story 4 - Admin do sistema mantém datas extras não úteis (Priority: P3)

O admin do sistema cadastra e remove datas extras não úteis (ex.: Carnaval,
Corpus Christi, pontes), com descrição. Os prazos em dias úteis ainda não
vencidos passam a considerar o calendário atualizado.

**Why this priority**: Os feriados nacionais já cobrem a maior parte dos casos;
datas extras refinam o cálculo e podem ser acrescentadas depois do mecanismo
principal.

**Independent Test**: Cadastrar uma data extra que cai dentro de um prazo
pendente de 2 dias úteis e verificar que o vencimento é adiado em um dia útil;
remover a data e verificar que volta ao original.

**Acceptance Scenarios**:

1. **Given** um prazo pendente de 2 dias úteis que venceria em 17/02/2026,
   **When** o admin cadastra 17/02/2026 (Carnaval) como data extra, **Then** o
   vencimento passa ao dia útil seguinte.
2. **Given** um prazo que já venceu e foi processado, **When** o admin cadastra
   uma data extra dentro desse período, **Then** nada é reprocessado nem
   revertido.
3. **Given** uma data já cadastrada (como extra ou feriado nacional), **When** o
   admin tenta cadastrá-la de novo, **Then** o sistema recusa com mensagem
   clara.
4. **Given** qualquer inclusão ou remoção de data extra, **When** ela é salva,
   **Then** fica registrada na auditoria com autor, data e descrição.

### Edge Cases

- Sistema fora do ar por horas ou dias: ao voltar, todos os itens vencidos no
  intervalo são processados (FR-004), sem duplicar os já processados.
- Execução interrompida no meio (queda, timeout): itens sem conclusão
  registrada voltam a ser elegíveis na próxima execução; os já concluídos não se
  repetem.
- Execuções simultâneas da mesma rotina (duas instâncias, disparo manual durante
  a execução automática): nenhum item é processado com efeito duas vezes.
- Item que deixa de ser elegível entre a seleção e o processamento (ex.: o dono
  enviou o acesso segundos antes do estorno por SLA): a rotina da feature de
  negócio revalida a condição no momento de processar; o mecanismo deve
  permitir essa revalidação e registrar o item como "ignorado" sem erro.
- Grande volume de itens vencidos de uma vez: processamento em lotes, sem
  impedir que a rotina termine e registre o resultado.
- Evento que ocorre em dia não útil: a contagem em dias úteis começa no primeiro
  dia útil seguinte.
- Evento às 23:59:59 de um dia útil: esse dia não conta; o dia útil 1 é o
  seguinte.
- Virada de ano e anos sem cadastro de datas extras: feriados nacionais fixos e
  móveis são calculados para qualquer ano, sem cadastro prévio.
- Data extra removida que já tinha adiado um prazo pendente: o prazo volta a ser
  calculado sem ela (pode vencer imediatamente na próxima execução).
- Brasil sem horário de verão atualmente: o cálculo usa o fuso oficial de
  Brasília vigente na data, sem supor deslocamento fixo.

## Requirements *(mandatory)*

### Functional Requirements

**Rotinas**

- **FR-001**: Sistema DEVE permitir que uma feature registre uma rotina com
  identificador único, descrição, forma de encontrar itens vencidos e ação a
  executar por item.
- **FR-002**: Sistema DEVE executar cada rotina registrada automaticamente, sem
  ação de usuário, de modo que um item vencido seja processado em até 1 hora
  após o vencimento, em operação normal.
- **FR-003**: Sistema DEVE garantir idempotência por item/evento: cada
  combinação rotina + item é concluída com efeito no máximo uma vez, inclusive
  com execuções repetidas, simultâneas ou manuais.
- **FR-004**: Sistema DEVE, após um período sem execuções, processar todos os
  itens vencidos no intervalo na execução seguinte.
- **FR-005**: Sistema DEVE isolar falhas por item: a falha de um item não impede
  o processamento dos demais itens da mesma execução.
- **FR-006**: Sistema DEVE retentar automaticamente um item com falha nas
  execuções seguintes, até 5 tentativas no total; ao esgotar, DEVE marcá-lo como
  falha definitiva, parar as retentativas automáticas e criar uma notificação
  interna para os usuários com papel de admin do sistema.
- **FR-007**: Sistema DEVE permitir que a ação da rotina registre um item como
  "ignorado" (condição não mais válida no momento do processamento), sem contar
  como falha.
- **FR-008**: Sistema DEVE registrar cada execução (rotina, origem automática ou
  manual, autor quando manual, início, fim, resultado, itens processados,
  ignorados e com falha) e cada item processado (rotina, item, tentativas,
  situação, último erro, data de conclusão).
- **FR-009**: Sistema DEVE oferecer a rotina de saúde, sem efeito de negócio, que
  permita verificar de ponta a ponta execução, idempotência, retentativa e
  alerta.

**Calendário e prazos**

- **FR-010**: Sistema DEVE calcular prazos em dias corridos como o instante
  exato do evento somado de N × 24 horas.
- **FR-011**: Sistema DEVE calcular prazos em dias úteis como o fim do dia
  (23:59:59, horário de Brasília) do N-ésimo dia útil posterior ao dia do
  evento; o dia do evento nunca conta, seja útil ou não.
- **FR-012**: Sistema DEVE considerar não úteis: sábados, domingos, feriados
  nacionais oficiais fixos (01/01, 21/04, 01/05, 07/09, 12/10, 02/11, 15/11,
  20/11 e 25/12), a Sexta-feira Santa calculada para cada ano e as datas extras
  cadastradas.
- **FR-013**: Sistema DEVE usar o fuso horário oficial de Brasília para definir
  limites de dia, independentemente do fuso do servidor ou do usuário.
- **FR-014**: Sistema DEVE oferecer às features as operações "calcular
  vencimento a partir de um evento" e "verificar se um prazo venceu", de modo
  que prazos em dias úteis ainda não vencidos reflitam o calendário vigente no
  momento da verificação.
- **FR-015**: Sistema NÃO DEVE reprocessar nem reverter itens já processados
  quando o calendário mudar.

**Painel do admin do sistema**

- **FR-016**: Sistema DEVE disponibilizar em `/admin` uma aba de rotinas
  acessível apenas ao papel admin do sistema; a verificação de permissão DEVE
  ocorrer no servidor, com sessão real.
- **FR-017**: A aba DEVE listar cada rotina com última execução, resultado,
  duração, itens processados/ignorados/com falha, e permitir ver o histórico de
  execuções e os itens em falha (com último erro e tentativas).
- **FR-018**: O admin do sistema DEVE poder disparar manualmente uma rotina
  inteira ou reexecutar um item em falha definitiva; a reexecução DEVE respeitar
  FR-003 e reiniciar a contagem de tentativas daquele item.
- **FR-019**: O admin do sistema DEVE poder listar, incluir (data + descrição) e
  remover datas extras não úteis; datas duplicadas ou já feriado nacional DEVEM
  ser recusadas com mensagem clara.
- **FR-020**: Sistema DEVE registrar na auditoria: disparo manual de rotina,
  reexecução de item, inclusão e remoção de data extra e marcação de falha
  definitiva.

### Key Entities

- **Rotina**: tarefa automática registrada por uma feature; identificador,
  descrição, situação (ativa/pausada), última execução.
- **Execução de rotina**: uma passada da rotina; origem (automática/manual),
  autor, início, fim, resultado e contagens.
- **Processamento de item**: vínculo único entre rotina e item/evento de
  negócio; situação (pendente, concluído, ignorado, falha, falha definitiva),
  tentativas, último erro, data de conclusão. É a chave da idempotência.
- **Data extra não útil**: data, descrição, autor, data de cadastro.
- **Feriado nacional**: derivado por regra (fixos e Sexta-feira Santa), não
  cadastrado.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% dos itens vencidos da rotina de saúde são processados em até
  1 hora após o vencimento, em operação normal.
- **SC-002**: Em teste com execuções simultâneas e reexecuções manuais, 0 itens
  são processados com efeito mais de uma vez.
- **SC-003**: Após uma interrupção simulada de 24 horas, 100% dos itens vencidos
  no período são processados na primeira execução seguinte.
- **SC-004**: Os cálculos de prazo batem com os valores esperados em 100% de um
  conjunto de casos de referência que inclua fim de semana, feriados nacionais
  fixos, Sexta-feira Santa, data extra, evento em dia não útil, evento às
  23:59:59 e virada de ano.
- **SC-005**: Um item com 5 falhas consecutivas aparece como falha definitiva no
  painel e gera alerta ao admin do sistema em até 1 hora após a 5ª falha.
- **SC-006**: O admin do sistema identifica, no painel, a última execução e as
  falhas de qualquer rotina em menos de 1 minuto, sem consultar o banco.

## Assumptions

- O escopo é só a base; as rotinas de negócio listadas no Input são
  registradas pelas features que as especificam e usam FR-014 para prazos.
- "Horário de Brasília" é o fuso oficial `America/Sao_Paulo`.
- A lista de feriados nacionais fixos segue a legislação federal vigente,
  inclusive 20/11 (Dia Nacional de Zumbi e da Consciência Negra, Lei
  14.759/2023). Carnaval e Corpus Christi não são feriados nacionais por lei e
  entram, quando desejado, como datas extras.
- Alertas ao admin do sistema usam as notificações internas já existentes
  (`notificacoesUsuario`); não há e-mail nesta feature.
- Retentativas acontecem nas execuções periódicas seguintes; não há intervalo
  de espera próprio além disso.
- O registro de execuções pode ter retenção limitada (ex.: 90 dias); o valor
  exato fica para o `sdd-plan`.
- A infraestrutura de execução (onde e como as rotinas são disparadas) é
  decidida no `sdd-plan`, provavelmente com uma `sdd-adr`.

## Clarifications

### Sessão 2026-11-20

- Q: Escopo da V2-01 — só a base ou incluir regras de negócio? → A: Mecanismo
  de rotinas (gatilho, idempotência por evento, reexecução segura, registro de
  execução) e cálculo de dias corridos/úteis como base para as demais features;
  as regras de cada prazo ficam nas próprias features.
- Q: Quais dias não são úteis? → A: Sábado, domingo, feriados nacionais
  oficiais (fixos e Sexta-feira Santa calculada) e lista de datas extras mantida
  pelo admin do sistema.
- Q: Atraso aceitável entre o vencimento e a ação? → A: Até 1 hora.
- Q: Como contar o fim de um prazo? → A: Dias corridos: instante exato do evento
  + N × 24h. Dias úteis: 23:59:59 (Brasília) do N-ésimo dia útil seguinte ao
  evento.
- Q: Visibilidade operacional? → A: Aba no `/admin` com rotinas, execuções,
  falhas e reexecução manual idempotente.
- Q: Tratamento de falhas? → A: Retentativas automáticas nas execuções
  seguintes, até 5; depois, falha definitiva e alerta ao admin do sistema; uma
  falha não trava os demais itens.
- Q: Quem mantém as datas extras? → A: Admin do sistema, no painel, com
  auditoria.
- Q: Data extra cadastrada depois de um prazo já calculado? → A: Prazos em dias
  úteis ainda não vencidos são recalculados com o calendário vigente; prazos
  vencidos/processados não mudam.
- Q: Quem acessa o painel de rotinas? → A: Só o admin do sistema.
