# Backlog

Painel único de ideias futuras e status de features/bugs geridas pelo
sistema sdd-*. Mantido automaticamente por update-feature-status.ps1 e
update-bug-status.ps1.

## Ideias Futuras

### Regras de Negocio v2 — candidatas para `sdd-specify` (2026-10-31)

Levantamento estatico de `docs/regras-negocio-v2.md` contra o codigo local. Cada
item abaixo ainda precisa de `spec.md`; a tabela `## Features` fica reservada
para features que ja passaram por `sdd-specify`. Prioridade indica a ordem
sugerida de especificacao, nao autorizacao para implementar. Validar estados e
schemas reais no MongoDB antes de planejar alteracoes de persistencia.

- **V2-01 · P0 · Aprovacao, publicacao e visibilidade de grupos** — Especificar
  estados de aprovacao, ajustes, rejeicao e suspensao, fila de moderacao e
  notificacao ao dono; somente grupos aprovados/publicos devem aparecer na
  home, API publica e detalhe. Incluir capacidade minima e impedir que o
  cliente defina o status publico na criacao. Fonte: fluxos 1, 4 e 5
  (`docs/regras-negocio-v2.md:183,265,301`). Evidencia: criacao aceita
  `status = 'ativo'` do body (`pages/api/grupos/index.js:54-64,107-127`), e
  listagens nao filtram status (`pages/api/grupos/index.js:18-51`,
  `pages/index.js:131-159`).

- **V2-02 · P1 · Alteracoes sensiveis e preco por ciclo** — Especificar pedido,
  aprovacao/auditoria reforcada, vigencia no proximo ciclo e notificacoes para
  mudancas de preco, capacidade, acesso e fidelidade. Fixar uma regra unica de
  calculo do valor por vaga na criacao, edicao e cobranca. Fonte: fluxos 4 e 6
  (`docs/regras-negocio-v2.md:299,333-365`). Evidencia: `PUT` grava preco,
  capacidade e status diretamente (`pages/api/grupos/[id].js:83-163`), enquanto
  criacao e edicao calculam o valor em componentes distintos
  (`pages/admin/grupos/novo.js:81-98`, `pages/admin/grupos/[id].js:138-149`).
  Depende de V2-01 e V2-10 para a vigencia em faturas futuras.

- **V2-03 · P1 · Cadastro financeiro sob demanda** — Especificar o estado
  separado de conta validada e cadastro financeiro completo, CPF valido e
  endereco minimo por operacao, sem bloquear a navegacao inicial. Definir se
  CPF informado no PIX atualiza o perfil. Fonte: fluxos 2 e 3
  (`docs/regras-negocio-v2.md:62-77,240-263`). Evidencia: o perfil confere
  apenas 11 digitos (`pages/api/atualizarPerfil.js:69-72`), e criar grupo
  exige conta validada mas nao cadastro financeiro
  (`pages/api/grupos/index.js:66-74`).

- **V2-04 · P0 · Checkout com caucao separada** — Especificar mensalidade +
  caucao de uma mensalidade, taxas, total de hoje, proximo vencimento, ledger
  bloqueado por membro/grupo e estorno consistente se a entrada falhar. Fonte:
  fluxo 7 e regras financeiras (`docs/regras-negocio-v2.md:396-422,880-892`).
  Evidencia: pagamento debita so `valorPorVaga`
  (`pages/api/assinaturas/pay.js:15-20,55-59,99-114`), a entrada grava
  `temCaucao: false` (`pages/api/grupos/[id]/join.js:160-173`) e a UI diz
  "mensalidade + caucao" com o preco simples, alem de mostrar taxa PIX em
  outro trecho (`pages/assinatura/pagamento.js:44-50,288-298`). O estorno por
  falha de entrada depende de uma chamada posterior do navegador
  (`pages/assinatura/pagamento.js:237-262`), nao de compensacao no servidor.

- **V2-05 · P1 · Ativacao e prazo de envio de acesso** — Especificar estados
  aguardando membros/assinatura/acesso, inicio do prazo de cinco dias corridos,
  medicao de vencimento, alerta e caminho para reclamacao. Distinguir acesso
  imediato de `apos_completar` e expor o estado em Meus Grupos. Fonte: fluxos
  7, 8 e 10 (`docs/regras-negocio-v2.md:141-180,425-451,473-494`). Evidencia:
  envio e `dataEnvioAcesso` existem (`pages/api/grupos/[id]/acessos.js:61-68,136-145`),
  mas a entrada cria membro `ativo` aguardando acesso e so altera
  `statusDetalhado` ao completar (`pages/api/grupos/[id]/join.js:160-193`).
  Depende de V2-01.

- **V2-06 · P1 · Cancelamento agendado por ciclo** — Especificar janela de 15
  dias, data efetiva, permanencia de acesso, reversao, ocupacao da vaga futura
  e devolucao/uso da caucao. Fonte: fluxo 11
  (`docs/regras-negocio-v2.md:496-539`). Evidencia: o cancelamento atual
  apaga o membro imediatamente (`pages/api/grupos/[id]/join.js:30-80`) e a
  tela avisa perda imediata do acesso (`pages/grupos/[id]/cancelar.js:17-37,66-72`).
  Depende de V2-04 e V2-10; alimenta V2-12.

- **V2-07 · P1 · Cancelamento antes do acesso e estorno integral** — Especificar
  acoes atomicas para retirar a participacao, devolver mensalidade e caucao,
  atualizar fatura/vaga e notificar dono, com excecao de fraude comprovada.
  Fonte: fluxo 12 (`docs/regras-negocio-v2.md:541-566`). Evidencia: `DELETE`
  de membro nao consulta pagamento nem estorna (`pages/api/grupos/[id]/join.js:30-80`);
  o estorno atual e uma API separada (`pages/api/assinaturas/refund.js:21-105`).
  Depende de V2-04.

- **V2-08 · P1 · Encerramento logico de grupo** — Especificar motivo, calculo
  de impacto, aprovacao com membros ativos, reembolso proporcional, caucao,
  notificacao e preservacao de historico/auditoria. Fonte: fluxo 13
  (`docs/regras-negocio-v2.md:568-604`). Evidencia: `DELETE` remove grupo e
  membros fisicamente (`pages/api/grupos/[id].js:55-80`); `PUT` permite mudar
  status sem esse processo (`pages/api/grupos/[id].js:134-163`). Depende de
  V2-01, V2-04 e V2-11.

- **V2-09 · P1 · Reclamacoes e disputas** — Especificar abertura pelo membro,
  evidencias, resposta do dono, decisao por suporte/admin, bloqueio automatico
  do recebivel relacionado e estorno integral/proporcional conforme acesso
  valido. Fonte: fluxo 14 (`docs/regras-negocio-v2.md:606-647`). Evidencia:
  nao ha rotas de reclamacao/disputa em `pages/` ou `pages/api/`, e o ledger
  atual so agrega por tipo/status (`lib/wallet.js:27-67`). Depende de V2-11
  para bloquear repasses; o estado da disputa pode ser especificado antes.

- **V2-10 · P1 · Faturas mensais e inadimplencia** — Especificar geracao
  recorrente por participacao ativa, vencimento, idempotencia por grupo/membro/
  ciclo, aviso de atraso e eventual uso da caucao/saida. Fonte: fluxo 17
  (`docs/regras-negocio-v2.md:700-719`). Evidencia: `createInvoice` cria uma
  fatura pontual (`lib/invoices.js:12-35`), acionada pelo checkout
  (`pages/api/assinaturas/pay.js:81-90`); nao ha rotina recorrente em
  `pages/api/` ou `scripts/`. Depende de V2-04 para uso da caucao.

- **V2-11 · P1 · Recebiveis e repasse ao dono** — Especificar recebivel por
  grupo/ciclo, retencao de 30 dias, liberacao, bloqueio por disputa, taxas e
  separacao entre saldo pessoal, caucao e repasse retido/liberado. Fonte: fluxo
  19 (`docs/regras-negocio-v2.md:756-776`). Evidencia: o saldo e calculado
  apenas por credito/debito e status (`lib/wallet.js:27-67`), sem entidade ou
  rotina de repasse em `lib/`, `pages/api/` ou `database/setupDatabase.js`.
  Depende de V2-04 e V2-10; integra-se a V2-09.

- **V2-12 · P2 · Fila de espera por vaga futura** — Especificar entrada na
  fila sem cobranca por periodo sem acesso, posicao, previsao de entrada,
  convite com prazo e passagem ao proximo candidato. Fonte: fluxo 20
  (`docs/regras-negocio-v2.md:778-797`). Evidencia: a home so calcula uma
  indicacao a partir de `pedidosSaida` (`pages/index.js:26-35,91-98`), e
  `join` bloqueia grupo completo (`pages/api/grupos/[id]/join.js:154-158`).
  Depende de V2-06.

- **V2-13 · P2 · Extrato financeiro e faturas compreensiveis** — Especificar
  visoes separadas para faturas de assinatura, pagamentos PIX, ledger, caucao,
  recebiveis e saldo sacavel; mostrar os estados reais da participacao em
  Meus Grupos. Fonte: fluxos 10, 17 e 19
  (`docs/regras-negocio-v2.md:473-494,700-719,756-776`). Evidencia: a tela
  "Faturas / Pagamentos" busca somente `payments`
  (`pages/wallet/invoices.js:20-29`) via `pages/api/payments/list.js:27-35`.
  Depende de V2-04, V2-10 e V2-11 para as novas categorias.

- **V2-14 · P2 · Notificacoes dos eventos v2** — Especificar notificacoes
  internas e mensagens pertinentes para aprovacao/rejeicao, acesso, mudanca de
  preco, fatura, caucao, saque, cancelamento e disputa, com destinatarios e
  idempotencia por evento. Fonte: fluxos 9 e 21
  (`docs/regras-negocio-v2.md:453-471,799-821`). Evidencia: ha notificacoes
  pontuais na entrada (`pages/api/grupos/[id]/join.js:202-233`), enquanto o
  envio de acesso registra e-mail e mensagem, sem notificacao interna para
  membros (`pages/api/grupos/[id]/acessos.js:112-162`). Especificar junto aos
  eventos das features anteriores, evitando notificacoes duplicadas.

- **V2-15 · P1 · Saque com identidade e condicoes transparentes** — Especificar
  verificacao da chave PIX CPF contra o usuario ou analise de risco, prazo,
  taxa e destino antes da confirmacao, e impedir saque de caucao/repasse
  retido/em disputa. Fonte: fluxos 3 e 18
  (`docs/regras-negocio-v2.md:255-258,721-754`). Evidencia: `create` valida
  apenas 11 digitos e saldo generico (`pages/api/withdraw/create.js:25-37`),
  e a tela nao mostra prazo/taxa (`pages/wallet/withdraw.js:55-91`). Depende
  de V2-03, V2-04 e V2-11.

### Bugs atuais separados das features v2

- **[Bug] B-01 · P0 · Entrada sem pagamento** — `POST /api/grupos/[id]/participar`
  insere membro sem fatura paga (`pages/api/grupos/[id]/participar.js:11-82`),
  contrariando o fluxo 7 (`docs/regras-negocio-v2.md:379-415`). Tratar via
  `sdd-bugfix` antes de depender do checkout v2.
- **[Bug] B-02 · P0 · Estorno sem cancelamento** — usuario pode chamar
  `POST /api/assinaturas/refund` para qualquer fatura propria paga, sem regra
  de cancelamento/disputa ou retirada do grupo
  (`pages/api/assinaturas/refund.js:21-105`). Tratar via `sdd-bugfix` antes de
  liberar os fluxos V2-07/V2-09.
- **[Bug] B-03 · P1 · CPF aberto na listagem interna** — a API de usuarios
  permite `support` e devolve CPF descriptografado integral
  (`lib/authz.js:11-16`, `pages/api/admin/users/index.js:21-38`), contrariando
  a regra de minimizacao do fluxo 22 (`docs/regras-negocio-v2.md:823-846`).
  Tratar via `sdd-bugfix`.
- **[Bug] B-04 · P0 · Pagamento de grupo indisponivel sem compensacao no servidor**
  — `pay` consulta apenas nome e preco do grupo, sem status/capacidade
  (`pages/api/assinaturas/pay.js:46-59`); `join` so bloqueia capacidade cheia
  depois da fatura paga (`pages/api/grupos/[id]/join.js:124-158`) e nao
  verifica status publico/aprovado. O estorno da falha e iniciado pela UI
  (`pages/assinatura/pagamento.js:247-262`), que pode nao executar. Tratar via
  `sdd-bugfix`, preservando reconciliacao de pagamentos ja efetuados.

### Decisoes a esclarecer em `sdd-specify`

- A regra de conta bloqueada em `docs/regras-negocio-v2.md:139` permite alguns
  pagamentos, mas `:840` proibe acoes sensiveis; definir a politica por acao.
- Definir data-base de vencimento, inicio do ciclo e arredondamento de dias
  antes de especificar V2-02, V2-06, V2-07 e V2-10.
- Corrigir a descricao do comportamento atual em
  `docs/regras-negocio-v2.md:505-506`: `DELETE` apaga o documento de membro,
  nao o marca como `banido` (`pages/api/grupos/[id]/join.js:56`).
- Gateway PIX real e publicacao simplificada para donos confiaveis aparecem
  como possibilidades futuras (`docs/regras-negocio-v2.md:325-327,676-677`),
  nao como features v2 confirmadas; avaliar separadamente quando houver pedido.


## Features

| Slug | Título | Status | Progresso | Última Atualização |
| --- | --- | --- | --- | --- |

## Melhorias Ad-hoc

| Data | Área | Resumo |
| --- | --- | --- |
|

## Bugs

| Slug | Título | Fase Atual | Veredito/Status | Próximo Passo | Última Atualização |
| --- | --- | --- | --- | --- | --- |
