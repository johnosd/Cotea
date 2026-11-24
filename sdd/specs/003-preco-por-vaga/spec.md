# Feature Specification: Regra única de preço por vaga (taxa Cotea 5%) e capacidade mínima

**Slug**: `003-preco-por-vaga`

**Created**: 2026-11-24

**Status**: Convergida

**Input**: Backlog `V2-03 · P0 · Regra única de preço por vaga (taxa Cotea 5%)
e capacidade mínima` — calcular no servidor
`valorPorVaga = round((T / C) × 1,05, 2)`, com repasse `T / C` ao dono e 5% ao
Cotea; dono ocupa 1 vaga sem taxa; capacidade mínima 2; não confiar em
`valorPorVaga` vindo do cliente. Mesma regra na criação, edição, cobrança e
exibição. Fonte: `.docs/regras-negocio-v2.md` linhas 394-398, 409 e
"Regras financeiras consolidadas" (citadas no backlog como 1072-1074; hoje em
1097-1098). Evidência: criação calcula `T / C` sem taxa
(`pages/admin/grupos/novo.js:92`), edição calcula `T / (C − vagasReservadasAdmin)`
(`pages/admin/grupos/[id].js:142-147`), as APIs gravam o `valorPorVaga` do body
(`pages/api/grupos/index.js:77,109`, `pages/api/grupos/[id].js:107,139`) e
aceitam capacidade 1 (`pages/api/grupos/index.js:83`). Definir o destino de
`vagasReservadasAdmin`. Pré-requisito de V2-05 e V2-13.

## Escopo

### Incluído

- Uma única regra de preço, calculada pelo servidor a partir do valor total
  `T` e da capacidade `C`, que produz três valores em centavos: valor por vaga
  pago pelo membro, repasse ao dono por membro e taxa do Cotea por membro.
- Aplicação dessa regra na criação e na edição de grupo; o servidor ignora
  qualquer valor por vaga, repasse ou taxa enviados pelo cliente.
- Capacidade mínima 2 (1 vaga do dono + ao menos 1 vaga de membro) validada
  no servidor na criação e na edição.
- `vagasReservadasAdmin` passa a valer sempre 1 (a vaga do dono): não
  editável, ignorado se enviado, e normalizado nos grupos existentes.
- Recusa de edição que deixe a capacidade abaixo do número atual de
  participantes (dono + membros ativos).
- Cobrança de assinatura usando somente o valor por vaga vigente do grupo,
  sem fallback para valor total ou campos legados; a fatura/pagamento guarda a
  decomposição (repasse + taxa) do valor cobrado.
- Exibição consistente: pré-visualização da decomposição para o dono nos
  formulários de criação/edição; valor final com a nota "inclui taxa Cotea de
  5%" para o membro na listagem, na página do grupo e no checkout.
- Migração única que recalcula o preço de todos os grupos existentes pela
  regra nova e relata os que não permitem aplicá-la.

### Fora de Escopo

- Lançar a taxa em `receita_taxa` ou o repasse ao dono no ledger (V2-06 /
  V2-11).
- Aprovação de alterações sensíveis e vigência no próximo ciclo (V2-13): até
  lá, a edição grava o preço novo direto e ele vale para as próximas
  cobranças.
- Caução, checkout v2 e elegibilidade (V2-06); estados de aprovação do grupo
  (V2-05).
- Cobrar a parte do dono: ela é só informativa.
- Teto de capacidade, teto de valor ou piso de valor por vaga.
- Reembolso proporcional, taxa do provedor de pagamento (Mercado Pago).
- Alterar faturas ou pagamentos já emitidos.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Preço calculado e validado no servidor (Priority: P1)

O dono informa valor total e capacidade ao criar ou editar um grupo. O
servidor valida capacidade ≥ 2 e valor total > 0, calcula valor por vaga,
repasse e taxa pela regra única e grava esses valores, independentemente do
que o cliente enviar.

**Why this priority**: É a fundação financeira: sem ela o membro paga o valor
errado e o Cotea não tem taxa. V2-05, V2-06 e V2-13 dependem dela.

**Independent Test**: Criar/editar grupos pela API com combinações de `T`/`C`
(inclusive enviando um `valorPorVaga` adulterado) e conferir os valores
gravados contra a tabela de referência.

**Acceptance Scenarios**:

1. **Given** dono com conta validada, **When** cria grupo com `T = 40,00` e
   `C = 4`, **Then** o grupo grava valor por vaga 10,50, repasse 10,00 e taxa
   0,50.
2. **Given** dono, **When** cria grupo com `T = 10,00`, `C = 3` e envia
   `valorPorVaga = 1,00`, **Then** o servidor ignora o valor enviado e grava
   3,50 / 3,33 / 0,17.
3. **Given** dono, **When** cria ou edita grupo com `C = 1` (ou 0, negativo,
   não inteiro), **Then** a operação é recusada com mensagem de capacidade
   mínima 2.
4. **Given** grupo com dono + 3 membros ativos, **When** o dono edita a
   capacidade para 3, **Then** a edição é recusada informando que a capacidade
   não pode ficar abaixo de 4 participantes.
5. **Given** grupo existente, **When** o dono edita `T` ou `C`, **Then** o
   preço é recalculado e gravado; faturas já emitidas não mudam.
6. **Given** qualquer criação/edição, **When** o cliente envia
   `vagasReservadasAdmin` diferente de 1, **Then** o grupo grava 1.

---

### User Story 2 - Cobrança pelo preço único com decomposição (Priority: P1)

Quando um membro paga a mensalidade, o sistema cobra exatamente o valor por
vaga vigente do grupo e registra, junto da fatura/pagamento, quanto é repasse
ao dono e quanto é taxa do Cotea.

**Why this priority**: Fecha a brecha de hoje, em que a cobrança cai para o
valor total quando falta valor por vaga, e deixa pronta a base que V2-06/V2-11
usarão para lançar repasse e taxa.

**Independent Test**: Pagar a assinatura de um grupo e conferir valor cobrado
e decomposição gravada; tentar pagar grupo sem preço válido e ver a recusa.

**Acceptance Scenarios**:

1. **Given** grupo com preço 10,50 / 10,00 / 0,50, **When** membro paga a
   mensalidade, **Then** cobra R$ 10,50 e a fatura/pagamento registra repasse
   10,00 e taxa 0,50.
2. **Given** grupo sem preço válido (ex.: legado com `C = 1` ou sem valor
   total), **When** membro tenta pagar ou ingressar, **Then** a operação é
   recusada com mensagem de preço indisponível; nada é cobrado.

---

### User Story 3 - Exibição consistente para dono e membro (Priority: P2)

No formulário de criação/edição o dono vê, antes de salvar, uma prévia: "o
membro paga X", "você recebe Y por membro", "taxa Cotea Z" e "sua parte
(T/C), sem taxa". Membros veem o valor final com a nota "inclui taxa Cotea de
5%" na listagem, na página do grupo e no checkout. Todas as telas leem o preço
gravado pelo servidor.

**Why this priority**: Evita que a tela prometa um valor diferente do
cobrado, mas a cobrança correta (P1) já entrega valor sem ela.

**Independent Test**: Abrir formulário, página do grupo, listagem e checkout
de um mesmo grupo e conferir que todos mostram o mesmo valor por vaga, igual
ao cobrado.

**Acceptance Scenarios**:

1. **Given** formulário de criação, **When** o dono digita `T = 40` e `C = 4`,
   **Then** a prévia mostra 10,50 / 10,00 / 0,50 e sua parte 10,00.
2. **Given** a prévia mostra um valor, **When** o dono salva, **Then** o valor
   gravado é igual ao da prévia.
3. **Given** grupo com preço válido, **When** o membro vê listagem, página do
   grupo ou checkout, **Then** vê o mesmo valor por vaga com a nota da taxa.
4. **Given** grupo sem preço válido, **When** exibido, **Then** aparece "preço
   indisponível" em vez de um valor estimado.
5. **Given** formulário de edição, **When** aberto, **Then** não há campo
   editável de vagas reservadas; a vaga do dono aparece como informação fixa.

---

### User Story 4 - Migração dos grupos existentes (Priority: P2)

Uma execução única recalcula o preço de todos os grupos existentes pela regra
nova, normaliza `vagasReservadasAdmin` para 1 e gera um relatório com os grupos
atualizados e os que ficaram sem preço válido.

**Why this priority**: Sem ela os grupos antigos continuam cobrando sem taxa,
mas as P1 já protegem grupos novos e editados.

**Independent Test**: Rodar a migração em base com grupos válidos, com `C = 1`
e sem valor total; conferir valores gravados e o relatório; rodar de novo e
ver que nada muda.

**Acceptance Scenarios**:

1. **Given** grupo legado `T = 40`, `C = 4`, `valorPorVaga = 10,00`, **When**
   a migração roda, **Then** passa a 10,50 / 10,00 / 0,50.
2. **Given** grupo legado com `C = 1` ou sem valor total, **When** a migração
   roda, **Then** não recebe valores inventados, fica marcado sem preço válido
   e aparece no relatório.
3. **Given** migração já executada, **When** roda de novo, **Then** nenhum
   grupo muda (idempotente).
4. **Given** faturas emitidas antes da migração, **When** ela roda, **Then**
   seus valores não mudam.

### Edge Cases

- **Meio centavo exato**: `T = 1,00`, `C = 2` → `(0,50 × 1,05) = 0,525` →
  valor por vaga 0,53 (meio-para-cima), repasse 0,50, taxa 0,03. O cálculo não
  pode errar por imprecisão de ponto flutuante.
- **Dízima**: `T = 10,00`, `C = 3` → 3,50 = 3,33 + 0,17 (a taxa absorve o
  resíduo do arredondamento).
- **Valores muito baixos**: repasse arredondado < R$ 0,01 (ex.: `T = 0,01`,
  `C = 3`) → recusado. Taxa pode arredondar para 0,00 em valores ínfimos
  (ex.: `T = 0,05`, `C = 5` → 0,01 / 0,01 / 0,00); é aceito.
- **Entradas mal formadas**: `T` com mais de 2 casas, negativo, zero, texto,
  vírgula decimal; `C` não inteiro → recusa clara (vírgula como separador
  decimal pode ser aceita na normalização, como hoje).
- **Capacidade reduzida na edição** abaixo dos participantes atuais → recusa.
- **Capacidade reduzida até igual aos participantes** → aceita; grupo fica
  cheio.
- **Edição concorrente com ingresso**: a recusa de capacidade usa a contagem
  de participantes no momento da gravação.
- **Grupo sem preço válido** (legado): não aceita ingresso nem cobrança; a
  edição com `T`/`C` válidos o regulariza.
- **Cliente envia repasse/taxa/valor por vaga**: ignorados sempre.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Sistema DEVE calcular, a partir de `T` (valor total, em
  centavos) e `C` (capacidade, inteiro): `valorPorVaga = round((T / C) × 1,05)`
  e `repasse = round(T / C)`, ambos arredondados ao centavo com regra
  meio-para-cima sobre o valor exato, e `taxa = valorPorVaga − repasse`.
- **FR-002**: A regra de FR-001 DEVE ser uma única implementação usada pela
  criação, edição, cobrança, migração e pela pré-visualização dos formulários.
- **FR-003**: Sistema DEVE ignorar `valorPorVaga`, repasse, taxa e
  `vagasReservadasAdmin` recebidos do cliente e gravar os valores calculados
  no servidor.
- **FR-004**: Sistema DEVE recusar criação/edição com `C` não inteiro ou
  `C < 2`.
- **FR-005**: Sistema DEVE recusar criação/edição com `T ≤ 0`, não numérico ou
  com mais de 2 casas decimais.
- **FR-006**: Sistema DEVE recusar criação/edição cujo repasse arredondado
  seja menor que R$ 0,01.
- **FR-007**: Sistema DEVE recusar edição cuja capacidade nova seja menor que
  o número atual de participantes ativos (dono + membros ativos).
- **FR-008**: `vagasReservadasAdmin` DEVE valer sempre 1 em todo grupo; vagas
  para membros = `C − 1`.
- **FR-009**: O grupo DEVE guardar valor por vaga, repasse e taxa vigentes;
  a edição de `T` ou `C` recalcula os três.
- **FR-010**: A cobrança de mensalidade DEVE usar somente o valor por vaga
  vigente do grupo e registrar na fatura/pagamento o repasse e a taxa
  correspondentes ao valor cobrado.
- **FR-011**: Sistema DEVE recusar ingresso e cobrança em grupo sem preço
  válido, sem fallback para valor total, `preco` legado ou cálculo no
  cliente.
- **FR-012**: O sistema NÃO DEVE gerar cobrança da parte do dono (`T / C`).
- **FR-013**: Formulários de criação/edição DEVEM mostrar prévia de valor por
  vaga, repasse, taxa e parte do dono, idêntica ao que o servidor grava para
  os mesmos `T`/`C`; não DEVEM oferecer campo editável de vagas reservadas.
- **FR-014**: Listagem de grupos, página do grupo e checkout DEVEM exibir o
  valor por vaga gravado com a nota "inclui taxa Cotea de 5%", ou "preço
  indisponível" quando o grupo não tem preço válido; nenhuma tela DEVE estimar
  o preço por conta própria.
- **FR-015**: Migração única DEVE recalcular valor por vaga, repasse e taxa de
  todos os grupos com `T`/`C` válidos, normalizar `vagasReservadasAdmin` para
  1, marcar os demais como sem preço válido, ser idempotente e emitir
  relatório (atualizados, inválidos e motivo).
- **FR-016**: Migração e alterações de preço NÃO DEVEM alterar faturas ou
  pagamentos já emitidos.
- **FR-017**: A auditoria de criação/edição de grupo DEVE registrar `T`, `C`
  e o trio calculado (antes/depois na edição).

### Key Entities

- **Grupo**: ganha o preço vigente decomposto — valor por vaga (pago pelo
  membro), repasse ao dono por membro e taxa do Cotea por membro, em centavos
  — e um indicador de preço válido. `vagasReservadasAdmin` fixo em 1.
  Capacidade `C` inclui a vaga do dono.
- **Fatura / Pagamento de mensalidade**: passa a guardar, além do valor
  cobrado, o repasse e a taxa que o compõem, congelados no momento da
  emissão.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% dos casos de uma tabela de referência (incluindo 40/4,
  10/3, 1/2, 55,90/6 e valores ínfimos) produzem exatamente o valor por vaga,
  repasse e taxa esperados, com `repasse + taxa = valorPorVaga` em todos.
- **SC-002**: 0 grupos gravados com capacidade < 2 ou com valor por vaga
  diferente do calculado a partir de `T`/`C`, após a migração e em qualquer
  criação/edição posterior.
- **SC-003**: Para um mesmo grupo, prévia do formulário, listagem, página do
  grupo, checkout e valor cobrado mostram o mesmo valor por vaga.
- **SC-004**: 0 cobranças emitidas em grupo sem preço válido ou com valor
  diferente do valor por vaga vigente.
- **SC-005**: Segunda execução da migração altera 0 grupos.

## Assumptions

- Ainda não há membros pagantes reais em produção, então recalcular o preço
  de todos os grupos existentes não fere contratos vigentes.
- Até V2-13, a edição de preço/capacidade continua direta (sem aprovação) e
  vale para as próximas cobranças.
- A taxa de 5% é a mesma no público e no corporativo (RN 1097) e não é
  configurável nesta feature.
- Valores monetários são tratados em centavos inteiros, como no ledger
  (feature 002).
- Quem pode editar o grupo continua como hoje (dono / admin do sistema).

## Clarifications

### Sessão 2026-11-24

- Q: Destino de `vagasReservadasAdmin`? → A: Fixar em 1 (vaga do dono), não
  editável, ignorado do body, normalizado nos grupos existentes.
- Q: Arredondamento quando `T/C` não fecha em centavos? → A: `valorPorVaga` e
  repasse arredondados meio-para-cima ao centavo; a taxa absorve o resíduo
  (`taxa = valorPorVaga − repasse`).
- Q: Grupos existentes com preço da regra antiga? → A: Migração recalcula
  todos; faturas já emitidas não mudam.
- Q: Até onde vai a taxa na cobrança? → A: Cobrança pelo preço único e
  decomposição (repasse + taxa) gravada; lançamento em `receita_taxa` e
  repasse ficam para V2-06/V2-11.
- Q: Exibição? → A: Dono vê decomposição na prévia do formulário; membro vê o
  valor final com a nota "inclui taxa Cotea de 5%".
- Q: A parte do dono gera cobrança? → A: Não; é só informativa.
- Q: Limites? → A: Só mínimos: `C ≥ 2` inteiro, `T > 0` com até 2 casas,
  repasse ≥ R$ 0,01. Sem tetos.
- Q: Edição com capacidade abaixo dos participantes atuais? → A: Recusar.
- Q: Grupos legados que não permitem aplicar a regra? → A: Migração relata e
  marca sem preço válido; não aceitam ingresso/cobrança até serem corrigidos.
- Q: Cobrança/exibição de grupo sem preço válido? → A: Sem fallback; recusa a
  cobrança e mostra "preço indisponível".
