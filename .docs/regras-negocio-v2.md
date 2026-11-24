# Regras de Negocio v2

Documento operacional das regras de negocio do Cotea.

Este arquivo consolida o comportamento atual observado no produto e as regras alvo
para a proxima versao. Quando houver diferenca entre regra desejada e codigo atual,
o texto marca explicitamente como "Gap de implementacao".

## Como ler este documento

- **Atual**: comportamento ja observado nas telas, APIs ou schemas locais.
- **Alvo v2**: regra de negocio que deve guiar o produto.
- **Gap de implementacao**: regra alvo que ainda nao esta completa no codigo.
- **Membro**: usuario que participa de um grupo.
- **Dono do grupo**: usuario que criou/administra um grupo e entrega o acesso.
- **Admin do sistema**: papel interno com permissao de moderar grupos, usuarios e regras globais.
- **Organizacao**: espaco fechado de uma empresa dentro do Cotea (ver "Contextos").
- **Admin da organizacao**: usuario que gerencia as pessoas da organizacao. Nao e papel interno do Cotea.
- **Financeiro**: papel interno com permissao de operar saques.
- **Suporte**: papel interno com permissao de ajudar em usuarios, grupos e disputas.

## Principios do produto

- O Cotea intermedia grupos de assinatura, pagamentos, carteira, notificacoes e historico financeiro.
- O dono do grupo e responsavel pela veracidade do grupo, manutencao da assinatura e envio do acesso.
- O membro paga pela participacao e deve ter previsibilidade sobre acesso, cancelamento, caucao e reembolso.
- O sistema deve proteger as duas pontas: membro contra falta de acesso ou servico ruim, dono do grupo contra inadimplencia e saida sem aviso.
- Regras financeiras devem ser transparentes antes da confirmacao da acao.
- Toda acao sensivel deve ser feita no servidor, usando sessao real e dados recarregados do banco.

## Contextos: publico e organizacoes (modo corporativo)

O Cotea funciona em dois contextos. O mesmo codigo, a mesma conta e a mesma carteira
atendem os dois.

- **Publico**: grupos abertos a qualquer usuario, aprovados pelo admin do sistema.
- **Organizacao**: espaco fechado de uma empresa, em que os funcionarios compartilham
  servicos e assinaturas so entre eles. A organizacao funciona como um "grupo maior":
  os grupos de servico vivem dentro dela.

### Modelo

- Organizacao dentro do mesmo app: mesma base e mesmo login, sem instancia separada.
- Um usuario tem uma unica conta e pode pertencer a varios contextos (publico e uma ou
  mais organizacoes), alternando entre eles.
- A carteira e unica por usuario. Cada lancamento do ledger guarda a organizacao de
  origem (`organizacaoId`, nulo para o publico), para fins de auditoria.
- Todo grupo tem contexto fixo: `organizacaoId` nulo (publico) ou o id da organizacao.
  O grupo nasce no contexto e fica nele; nao ha grupo visivel para varias organizacoes
  nem migracao entre contextos.
- A home e a busca publicas listam so grupos publicos. Grupos de uma organizacao so
  aparecem para os membros dela.

### Criacao da organizacao

- So o Cotea cria organizacoes (venda assistida): cadastra a organizacao e o primeiro
  admin da organizacao. O dominio de e-mail pode ser registrado, mas e so informativo.
- Nao ha criacao por autosservico.

### Papeis dentro da organizacao

- **Admin da organizacao**: gerencia membros, envia convites, aprova solicitacoes de
  ingresso e remove membros. Tambem cria e participa de grupos.
- **Funcionario**: entra em grupos e cria grupos da organizacao.
- **Convidado externo (somente leitura)**: ve e entra em grupos, mas nao cria grupos.

### Ingresso na organizacao

- Por **convite** do admin da organizacao (e-mail ou link). O link leva ao login, ao cadastro (se o usuario ainda nao tem conta) e depois ao aceite de transparencia. O convite **expira em 30 dias**; depois disso o admin precisa enviar outro.
- Por **solicitacao com aprovacao** do admin da organizacao.
- A solicitacao de ingresso aceita **qualquer e-mail validado**, sem exigir o dominio da
  empresa. O filtro e a aprovacao do admin da organizacao.
- O vinculo e verificado **so no ingresso**, pelo convite ou pela aprovacao do admin.
  Nao ha reverificacao periodica.
- O vinculo termina quando o admin da organizacao remove o usuario ou quando o proprio
  usuario sai da organizacao. Se o funcionario sai da empresa mas nao e removido e nao
  sai por conta propria, ele segue na organizacao.

### Remocao e saida da organizacao

Quando o admin da organizacao remove um membro, ou quando o proprio usuario decide sair
da organizacao, valem as mesmas regras:

1. As participacoes ativas dele em grupos da organizacao seguem a regra normal de
   **cancelamento agendado** (Fluxo 11), com acesso ate o fim do ciclo e devolucao da
   caucao ao concluir a saida.
2. A conta continua aberta.
3. Se houver saldo na carteira, o usuario fica **impedido de entrar em qualquer grupo**,
   publico ou corporativo, ate retirar todo o saldo. A trava **ignora saldo abaixo de
   R$ 5,00**, o saque minimo, para ninguem ficar preso sem poder sacar.
4. Grupos de que o usuario era dono **continuam com ele como dono** ate ele encerrar o grupo (Fluxo 13). O admin da organizacao nao consegue tirar o grupo dele. Dentro da organizacao, o ex-membro fica com **todas as demais acoes bloqueadas**: nao cria grupos nem entra em grupos novos. So mantem o que ja existe: entregar acesso, enviar mensagens aos membros, receber repasse e encerrar o grupo. **Nao ha transferencia de posse de grupo** no Cotea.

### Regras dos grupos da organizacao

- Qualquer funcionario ou admin da organizacao com cadastro completo pode criar grupo.
- **Nao ha aprovacao previa**, nem do Cotea nem da empresa. O grupo e publicado direto,
  no contexto da organizacao.
- O Cotea mantem poder de intervencao em fraude, denuncia ou violacao dos termos.
- O admin da organizacao **nao modera grupos**: gerencia so pessoas (convites, solicitacoes e remocoes). Suspensao e encerramento de grupos fora das regras do dono ficam com o Cotea.
- Alteracao de valor em grupo da organizacao segue o Fluxo 6: **aprovada pelo admin do sistema**, como no publico, mesmo sem aprovacao previa na criacao.
- As regras financeiras sao identicas as do publico: o funcionario paga, ha caucao de 1
  mensalidade, taxa de 5% do Cotea, repasse retido por 30 dias e saque com as mesmas
  condicoes. Ver "Regras financeiras consolidadas".
- **Disputas** de grupos da organizacao sao julgadas somente pelo Cotea (suporte e
  admin do sistema), como no publico.

### Visibilidade do admin da organizacao

O admin da organizacao pode ver:

- lista de membros da organizacao;
- em quais grupos da organizacao cada membro participa;
- valores pagos e historico financeiro dos membros dentro da organizacao.

O admin da organizacao **nunca** ve saldo da carteira nem atividade do usuario no
contexto publico ou em outras organizacoes.

**Aviso e aceite obrigatorio**: antes de entrar na organizacao (convite ou solicitacao
aprovada), o usuario ve a lista acima e precisa aceitar. Sem aceite, nao ha ingresso. O
aceite e registrado com data, para fins de LGPD.

Gap de implementacao:

- Nao existem `organizacoes`, papeis de organizacao, convites, solicitacoes de ingresso
  nem `organizacaoId` em grupos e lancamentos do ledger.
- A trava por saldo apos remocao nao existe.

## Papeis e permissoes

### Visitante

Pode:

- Acessar a home.
- Buscar grupos.
- Ver a pagina publica de detalhe de um grupo.
- Iniciar login.

Nao pode:

- Assinar grupo.
- Criar grupo.
- Acessar carteira.
- Ver meus grupos.
- Solicitar saque.
- Acessar painel administrativo.

### Usuario autenticado nao validado

Atual:

- Consegue fazer login via Google.
- Se ainda nao existe em `users`, e tratado como novo usuario e deve completar cadastro inicial.
- Rotas sensiveis redirecionam para verificacao quando `contaValidada` e falsa.

Alvo v2:

- Pode navegar em areas publicas e completar cadastro.
- Deve validar e-mail antes de entrar em grupo, criar grupo, movimentar carteira ou acessar area administrativa.

### Usuario validado

Atual:

- `contaValidada: true` permite acessar assinatura, carteira, meus grupos e admin conforme role.
- Pode criar grupo mesmo sem CPF/endereco completos.

Alvo v2:

- Pode listar, ver detalhes e iniciar fluxos sensiveis.
- O cadastro financeiro completo (CPF e dados de pagamento) e exigido **no momento do primeiro pagamento, saque ou criacao de grupo**, e nao antes. O usuario pode navegar e preencher formularios, mas a acao so conclui com o cadastro completo.

Gap de implementacao:

- Hoje o sistema nao diferencia claramente "conta validada" de "cadastro completo".
- CPF/endereco existem no perfil, mas nem todos os fluxos exigem completude antes da acao.

### Membro

Pode:

- Entrar em grupo com vaga disponivel depois de pagar.
- Ver seus grupos.
- Receber mensagens e notificacoes.
- Cancelar participacao conforme regra de ciclo.
- Abrir reclamacao/disputa quando nao recebeu acesso ou o servico falhou.

### Dono do grupo

Pode:

- Criar grupo.
- Administrar grupos em que e membro com `papel: admin`.
- Enviar acesso aos membros pendentes.
- Enviar mensagem aos membros ativos.
- Solicitar alteracoes de informacoes publicas do grupo.
- Encerrar o grupo (Fluxo 13).
- Solicitar alteracao de valor do grupo (Fluxo 6).

Alvo v2:

- Alteracoes sensiveis, como preco, status publico, capacidade e tipo de acesso, devem respeitar aprovacao ou trilha de auditoria.
- O encerramento do grupo **nao** exige aprovacao: o dono encerra direto e o reembolso proporcional e automatico (Fluxo 13).
- Em grupos de organizacao, o dono e qualquer funcionario ou admin da organizacao, e o grupo dispensa aprovacao previa (ver "Contextos").

### Admin do sistema

Pode:

- Aprovar ou rejeitar grupos, e revisar os aprovados automaticamente.
- Suspender grupos.
- Editar grupos e campos internos.
- Gerenciar usuarios, bloqueios e roles.
- Ver auditoria.
- Decidir disputas e executar os estornos decorrentes, considerando a recomendacao do suporte.

### Financeiro

Pode:

- Listar saques.
- Aprovar saques.
- Rejeitar saques.

### Suporte

Pode:

- Apoiar usuarios e grupos conforme permissoes.
- Listar usuarios, grupos e saques quando autorizado.
- Atuar na investigacao de reclamacoes: analisa evidencias e registra recomendacao, mas **nao decide nem executa estorno**.

## Estados principais

### Estados de usuario

- **Visitante**: sem sessao.
- **Autenticado sem cadastro local**: fez login Google, mas ainda nao possui documento completo em `users`.
- **Cadastro inicial**: possui nome, sobrenome, e-mail, username e telefone opcional.
- **Conta validada**: confirmou e-mail por codigo.
- **Cadastro financeiro completo**: possui CPF e dados minimos de endereco/pagamento exigidos para operacoes financeiras.
- **Bloqueado**: `isBlocked: true`; nao deve executar acoes sensiveis. Pode ser membro de grupos, fazer pagamentos e **sacar normalmente**, mas nao consegue criar grupos. O bloqueio nao restringe o saque. O bloqueio e da conta e vale igualmente em qualquer contexto (publico ou organizacao). Somente o Cotea bloqueia usuarios; o admin da organizacao nao tem esse poder.

### Estados de grupo

Atual:

- `status`: normalmente `ativo` ou `cancelado`.
- `statusDetalhado`: normalmente `em_formacao` ou `ativo`.
- `acesso`: `imediato` ou `apos_completar`.
- Flags auxiliares: `servicoPreAssinado`, `envioAutomaticoAcesso`, `filaEsperaAtiva`, `necessitaAnalise`.

Alvo v2:

- **Em aprovacao**: grupo criado aguardando admin do sistema.
- **Ajustes**: nao publicado; dono recebe motivo para ajustes.
- **Aguardando membros**: aprovado e publico, mas ainda nao completou vagas quando o acesso depende de completar o grupo.
- **Aguardando assinatura**: grupo completou, mas dono ainda precisa contratar/confirmar o servico e liberar acessos, dono tem 5 dias para enviar acessos.
- **Assinado com vaga**: ativo, pre-assinado ou com acesso imediato, ainda tem vaga.
- **Fila de espera**: ativo, sem vaga imediata, mas existe saida agendada.
- **Ativo completo**: ativo, sem vaga.
- **Suspenso**: retirado da listagem e sem novas entradas por decisao do Cotea (fraude, denuncia, reprovacao em revisao ou risco alto em disputa). Membros ativos sao tratados pelo suporte.
- **Cancelado**: encerrado logicamente, sem novas entradas.

Gap de implementacao:

- Hoje a criacao salva grupo como ativo, sem aprovacao previa real.
- Nao ha fluxo completo para rejeicao, suspensao, fila formal ou aguardando assinatura.

### Estados de membro no grupo

Atual:

- `papel`: `admin` ou `membro`.
- `status`: normalmente `ativo` ou `banido`.
- `aguardandoEnvioAcesso`: marca se dono ainda precisa enviar acesso.
- `temCaucao`: existe no schema, mas nao esta integrado ao checkout.

Alvo v2:

- **Na fila**: grupo ativo e cheio; o usuario pagou e aguarda a saida efetiva de outro membro (Fluxo 20).
- **Aguardando acesso**: pagamento confirmado, membro entrou, mas ainda nao recebeu acesso.
- **Ativo**: acesso enviado e participacao vigente.
- **Cancelamento agendado**: saida marcada para fim de ciclo.
- **Em disputa**: reclamacao aberta (Fluxo 14); o repasse relacionado fica bloqueado.
- **Cancelado/removido**: saida concluida ou removido pelo dono do grupo ou admin do sistema/suporte.

## Fluxo 1: visitante lista e avalia grupos

Pre-condicoes:

- Usuario nao precisa estar logado.
- Grupo precisa estar publico e nao cancelado no alvo v2.

Fluxo:

1. Visitante acessa a home.
2. Sistema lista grupos disponiveis.
3. Visitante usa busca por nome.
4. Sistema mostra card com nome, descricao, vagas, membros e mensalidade.
5. Visitante clica em "Ver grupo".
6. Sistema abre detalhe publico do grupo.

Excecoes:

- Grupo inexistente retorna pagina nao encontrada.
- Grupo cancelado/suspenso nao deve aparecer na listagem alvo.

Gap de implementacao:

- A home atual nao filtra explicitamente por status publico/aprovado/cancelado.

## Fluxo 2: login, cadastro e verificacao

Pre-condicoes:

- Usuario possui conta Google.

Fluxo:

1. Usuario clica em entrar.
2. Sistema inicia NextAuth com Google.
3. Se o e-mail ainda nao existe em `users`, usuario e direcionado ao cadastro inicial.
4. Usuario informa nome, sobrenome, username e telefone opcional.
5. Sistema cria usuario com `contaValidada: false`, `systemRole: user` e `isBlocked: false`.
6. Sistema cria notificacao para validar conta.
7. Usuario acessa verificacao.
8. Sistema envia codigo por e-mail.
9. Usuario informa o codigo.
10. Sistema valida codigo mais recente, nao expirado e pendente.
11. Sistema marca `contaValidada: true`.

Excecoes:

- Username duplicado bloqueia cadastro.
- Codigo expirado passa para status expirado.
- Codigo incorreto incrementa tentativas.
- Rate limit bloqueia excesso de envios de codigo.

Alvo v2:

- Validacao de conta e pre-requisito para assinatura, carteira, criacao de grupos e painel interno.
- Cadastro financeiro completo pode ser solicitado apenas quando necessario, evitando atrito no inicio.

## Fluxo 3: completar perfil e cadastro financeiro

Pre-condicoes:

- Usuario autenticado.

Fluxo:

1. Usuario acessa perfil.
2. Sistema carrega dados do usuario.
3. Usuario edita dados pessoais.
4. Usuario informa CPF e endereco quando necessario.
5. Sistema valida campos obrigatorios, formato de username, CPF com 11 digitos e endereco.
6. Sistema salva dados e criptografa CPF.

Alvo v2:

- Para pagar via PIX, sacar, receber repasse ou criar grupo (publico ou de organizacao), o CPF deve estar presente e valido.
- Para saque, a chave PIX deve ser sempre o CPF do proprio usuario, sem excecao (Fluxo 18).

Gap de implementacao:

- O checkout de assinatura pede CPF para PIX, mas nao necessariamente salva esse CPF no perfil.
- O sistema atual valida tamanho do CPF no perfil, mas nao aplica algoritmo de CPF nesse endpoint.

## Fluxo 4: criacao de grupo pelo dono

Pre-condicoes:

- Usuario autenticado e conta validada.
- Alvo v2 exige cadastro financeiro completo na hora de salvar o grupo. O usuario pode abrir e preencher o formulario antes disso.

Fluxo alvo:

1. Dono clica em "Criar Grupo".
2. Sistema apresenta formulario de identidade, categoria, assinatura, acesso, beneficios, regras, fidelidade, FAQ e link oficial.
3. Dono informa valor total e capacidade.
4. Sistema calcula valor por vaga.
5. Dono escolhe tipo de acesso:
   - `imediato`: acesso pode ser enviado logo apos pagamento.
   - `apos_completar`: acesso so deve ser enviado quando o grupo completar capacidade.
6. Dono salva o grupo.
7. Sistema cria o grupo em estado **Em aprovacao**. Em grupo de organizacao, o grupo e publicado direto no contexto da organizacao, sem aprovacao.
8. Sistema cria membro admin vinculado ao dono.
9. Sistema registra auditoria.
10. Admin do sistema recebe tarefa/notificacao de aprovacao (somente grupos publicos).

Regras:

- Capacidade minima: 2, sendo 1 vaga do dono e ao menos 1 vaga para membro.
- **Valor por vaga (regra unica, usada na criacao e na edicao)**: sendo `T` o valor total da assinatura e `C` a capacidade, o membro paga por mes `(T / C) x 1,05`, arredondado para 2 casas.
  - O dono recebe `T / C` por membro; os 5% adicionais sao a taxa do Cotea, somada ao valor do membro.
  - O dono ocupa 1 vaga e paga a parte dele (`T / C`), sem taxa do Cotea.
  - Exemplo: `T = 40`, `C = 4` -> membro paga R$ 10,50; dono recebe R$ 10,00 por membro e o Cotea R$ 0,50.
- Categoria deve estar entre jogos, aplicativos, assinaturas e cursos, tanto no publico quanto nas organizacoes.
- Beneficios, regras e FAQ devem ter limites de quantidade/tamanho.
- Fidelidade: periodo minimo de permanencia opcional definido pelo dono, com efeito real no cancelamento (Fluxo 11).
- Link oficial deve ser URL http/https.
- Upload de imagem deve respeitar JPG, PNG ou WebP e limite de 5 MB.

Gap de implementacao:

- Hoje o grupo e criado como `ativo`.
- Hoje nao ha fila de aprovacao previa implementada.
- Hoje valor por vaga e calculado de forma diferente entre criacao e edicao em alguns pontos: aplicar a formula unica acima (com taxa de 5%) nos dois lugares.

## Fluxo 5: aprovacao de grupo pelo admin do sistema

Pre-condicoes:

- Grupo esta em aprovacao.
- Usuario tem role `admin` ou permissao equivalente.

Fluxo alvo:

1. Admin acessa fila de grupos pendentes.
2. Sistema mostra dados publicos, preco, capacidade, dono, link oficial, riscos e observacoes internas.
3. Admin aprova, rejeita ou pede ajuste.
4. Se aprovar:
   - grupo vira publico;
   - status inicial vira `aguardando_membros` ou `assinado_com_vaga`, conforme tipo de acesso e pre-assinatura;
   - dono recebe notificacao.
5. Se rejeitar:
   - grupo nao aparece publicamente;
   - dono recebe motivo;
   - grupo pode ser editado e reenviado.
6. Se pedir ajuste:
   - grupo fica pendente de correcao;
   - dono recebe lista de pendencias.

Prazo e aprovacao automatica:

- O admin do sistema tem **ate 2 dias uteis** para aprovar, rejeitar ou pedir ajuste.
- Vencido o prazo sem decisao, o grupo e **aprovado automaticamente** e segue o fluxo de aprovado.
- Grupo aprovado automaticamente fica marcado na auditoria e na fila do admin, para revisao posterior.
- **Salvaguarda**: o grupo aprovado automaticamente entra no ar, mas o **repasse ao dono fica retido alem dos 30 dias ate o Cotea revisar o grupo**. Aprovado na revisao, o repasse segue a regra normal; reprovado, o grupo e suspenso e os membros sao estornados conforme o caso.
- Esta regra vale so para grupos publicos; grupos de organizacao nao passam por aprovacao previa.

Regra futura:

- Podera existir grupo "pre-aprovado", em que donos confiaveis ou templates internos publiquem com revisao simplificada.

Gap de implementacao:

- Nao ha endpoint/tela especifica de aprovacao.

## Fluxo 6: edicao e alteracao de grupo

Pre-condicoes:

- Usuario e dono do grupo ou admin do sistema.
- Grupo existe e nao esta em estado irreversivel.

Atual:

- Dono/admin do grupo pode alterar grupo por API se for membro com `papel: admin`.
- Varios campos sensiveis so ficam editaveis para `systemRole: admin` na tela de edicao.
- Dono nao admin do sistema pode cancelar grupo pela tela de edicao.

Alvo v2:

- Dono pode propor alteracoes de conteudo nao sensivel.
- Alteracao de preco, capacidade, status publico, tipo de acesso e fidelidade deve ir para aprovacao do admin do sistema ou gerar auditoria reforcada. O encerramento nao entra aqui: e direto (Fluxo 13).
- Membros devem ser notificados quando alteracao afetar preco, acesso, vencimento, fidelidade ou cancelamento.
- Alteracao de valor so vale para proximas faturas, nunca retroativamente.

Fluxo de alteracao de valor:

1. Dono solicita novo valor.
2. Sistema calcula impacto por membro e data de vigencia.
3. Solicita aprovacao do admin do sistema.
4. Se aprovado, sistema agenda vigencia para o proximo ciclo.
5. Membros recebem notificacao.
6. Proximas faturas usam o novo valor.

Gap de implementacao:

- Alteracao de valor nao possui fluxo de aprovacao dedicado.
- Nao ha notificacao automatica para todos os membros quando preco muda.

## Fluxo 7: entrada em grupo

Pre-condicoes:

- Usuario autenticado.
- Conta validada.
- Grupo aprovado, com vaga imediata ou fila permitida. Se for grupo de organizacao, o usuario precisa pertencer a ela.
- Usuario nao e dono do grupo.
- Cadastro financeiro completo na hora do primeiro pagamento.
- Usuario ainda nao e membro ativo.

Fluxo atual observado:

1. Usuario abre detalhe do grupo.
2. Se nao autenticado, sistema envia para login.
3. Usuario clica em assinar.
4. Sistema abre etapa de relacionamento.
5. Usuario confirma regra de relacionamento.
6. Sistema abre pagamento.
7. Sistema consulta saldo da carteira.
8. Usuario escolhe saldo ou PIX.
9. Sistema cria ou paga fatura de assinatura.
10. Se saldo for insuficiente, fatura fica `aguardando_recarga`.
11. Se usuario escolhe PIX, sistema cria pagamento simulado, confirma e credita saldo.
12. Sistema tenta pagar fatura novamente.
13. Com fatura paga, sistema chama entrada no grupo.
14. Sistema cria membro ativo com `aguardandoEnvioAcesso: true`.
15. Sistema notifica dono para enviar acesso.
16. Usuario vai para tela de sucesso.

Alvo v2:

1. Antes de pagar, sistema deve mostrar claramente:
   - mensalidade atual;
   - caucao de 1 mensalidade;
   - taxa do meio de pagamento, se houver;
   - total de hoje;
   - vencimento do proximo ciclo;
   - prazo maximo de envio de acesso.
2. Na entrada, membro paga **mensalidade atual + caucao de 1 mensalidade**, ambas ja com a taxa de 5% do Cotea (valor por vaga do Fluxo 4). A caucao e devolvida integralmente quando nao for consumida.
3. A caucao fica bloqueada/retida na carteira ou ledger, associada ao membro e grupo.
4. Se o grupo for `apos_completar`, o membro **paga na entrada** e o valor fica retido. O membro aguarda ativacao/acesso ate completar as vagas. Se o grupo nao completar em **30 dias**, o sistema estorna integralmente e automaticamente todos os membros e o grupo e encerrado.
5. Em grupo de organizacao, so entra quem pertence a organizacao.
6. Na etapa de **relacionamento**, antes do pagamento, o membro declara seu vinculo com o dono do grupo: amigo, familia, conhecido ou desconhecido. A declaracao e registrada na participacao.
7. Se a entrada falhar depois do pagamento, sistema deve estornar automaticamente.
8. Se o grupo completar a capacidade, sistema atualiza status e notifica dono e membros.
9. Usuario com a trava de saldo apos remocao de organizacao (ver "Contextos") nao pode entrar em nenhum grupo.

Excecoes:

- Grupo completo e sem saida agendada (sem vaga futura): bloquear entrada antes de pagamento.
- Fatura paga mas entrada falhou: estorno automatico.
- Usuario ja membro: nao duplicar membro nem cobrar novamente.
- Usuario bloqueado: negar.
- Conta nao validada: redirecionar para verificacao.

Gap de implementacao:

- O checkout atual cobra apenas o valor da vaga retornado pelo grupo, apesar de a UI mencionar mensalidade + caucao.
- `temCaucao` existe, mas a caucao nao e cobrada, bloqueada e liquidada de ponta a ponta.
- Fila de espera ainda nao e fluxo completo.

## Fluxo 8: envio de acesso pelo dono do grupo

Pre-condicoes:

- Usuario e dono/admin do grupo.
- Existem membros com `aguardandoEnvioAcesso: true`.

Fluxo:

1. Dono acessa detalhe do grupo.
2. Sistema mostra botao "Enviar acessos" quando ha pendentes.
3. Dono abre tela de mensagem de acesso.
4. Sistema preenche mensagem padrao.
5. Dono envia.
6. Sistema envia e-mail aos membros pendentes.
7. Sistema registra mensagem.
8. Sistema marca membros como sem pendencia de acesso e grava data de envio.
9. Membros recebem notificacao/e-mail.

Regra alvo:

- SLA maximo: **ate 5 dias corridos** apos pagamento/ativacao aplicavel.
- Se o acesso nao for enviado no prazo, o sistema **estorna integralmente e automaticamente** mensalidade e caucao e remove o membro do grupo, sem precisar de reclamacao.
- O repasse daquele membro e cancelado, a vaga volta a ficar disponivel (ou a fila avanca) e o dono e notificado.
- O **texto da mensagem de acesso fica registrado** e o suporte e o admin do sistema podem le-lo em caso de disputa, como prova de entrega.
- Como o texto pode conter credenciais, deve ser criptografado em repouso e cada leitura pelo suporte ou admin deve gerar auditoria (sugestao tecnica, a validar na implementacao).

Gap de implementacao:

- O sistema envia e-mail, mas nao ha medicao automatica de SLA vencido nem estorno automatico por SLA.

## Fluxo 9: mensagens aos membros

Pre-condicoes:

- Usuario e dono/admin do grupo.
- Grupo possui membros ativos alem do admin.

Fluxo:

1. Dono acessa "Enviar mensagem aos membros".
2. Escreve mensagem de **ate 500 caracteres**. Nao ha limite diario de mensagens.
3. Sistema valida conteudo nao vazio.
4. Sistema envia e-mail aos membros ativos.
5. Sistema registra mensagem e status de envio.

Regras:

- Mensagem nao deve ser usada para coletar dados sensiveis fora da plataforma.
- Mensagens relevantes de acesso, preco, status e encerramento tambem devem gerar notificacao interna.

## Fluxo 10: meus grupos

Pre-condicoes:

- Usuario autenticado e validado.

Fluxo:

1. Usuario acessa "Meus grupos".
2. Sistema consulta grupos em que o usuario e membro ou admin.
3. Sistema separa todos, membro e administrador.
4. Sistema mostra status de pagamento, valor pago, membros e vagas.
5. Usuario abre detalhe do grupo.

Regras alvo:

- Deve mostrar status real da participacao: na fila, aguardando acesso, ativo, cancelamento agendado, em disputa ou cancelado.
- Deve separar os grupos por contexto (publico e cada organizacao).
- Deve destacar acoes pendentes: pagar fatura, confirmar acesso, cancelar, abrir reclamacao.

Gap de implementacao:

- Hoje a pagina mostra dados basicos, mas nao todos os estados alvo.

## Fluxo 11: cancelamento de participacao pelo membro

Pre-condicoes:

- Usuario e membro do grupo.
- Usuario nao e dono/admin do grupo.

Atual:

- Tela confirma cancelamento.
- API remove participacao imediatamente marcando membro como `banido`.
- Dono recebe notificacao.
- Nao ha calculo automatico de caucao, ciclo ou reembolso.

Alvo v2:

1. Membro clica em cancelar participacao.
2. Sistema calcula:
   - data do proximo vencimento;
   - dias ate o vencimento;
   - valor de caucao retido;
   - valor estimado a devolver;
   - data efetiva da saida.
3. Sistema mostra resumo antes da confirmacao.
4. Se pedido ocorrer dentro da janela regular:
   - saida e agendada para o proximo ciclo;
   - membro mantem acesso ate a data efetiva;
   - caucao volta como credito na carteira ao concluir saida.
5. Se pedido ocorrer depois da janela limite:
   - saida e agendada para o ciclo seguinte;
   - caucao pode pagar a proxima mensalidade;
   - membro permanece no grupo durante o periodo coberto.
6. Dono recebe notificacao e vaga futura entra em fila/reposicao.
7. Enquanto cancelamento esta agendado, o membro pode desistir da saida a qualquer momento antes da data efetiva. Se ja houver usuario na fila para a vaga dele (Fluxo 20), esse usuario recebe **estorno integral** e perde a posicao.

Fidelidade:

- A fidelidade e o periodo minimo de permanencia exigido pelo dono, definido na criacao do grupo.
- Conta a partir da **data de ativacao do acesso** (envio pelo dono), nao da data de entrada.
- Quem cancela antes de cumprir a fidelidade **perde a caucao como multa**, em favor do dono. A saida segue a janela normal de 15 dias.
- Como a caucao fica retida como multa, o membro paga normalmente as faturas ate a saida efetiva, inclusive o ultimo ciclo.
- Cancelamento antes de receber acesso nao tem fidelidade: o estorno e integral (Fluxo 12).

Regra alvo da janela:

- A regra padrao e aviso com antecedencia minima de 15 dias antes do vencimento.
- O numero pode virar configuracao global no futuro, mas o documento assume 15 dias por padrao.

Gap de implementacao:

- Cancelamento atual e imediato.
- Nao ha agendamento, reversao, liquidacao de caucao ou reposicao automatica.

## Fluxo 12: cancelamento antes de receber acesso

Pre-condicoes:

- Membro pagou.
- Acesso ainda nao foi enviado.

Alvo v2:

1. Membro solicita cancelamento.
2. Sistema verifica `aguardandoEnvioAcesso: true`.
3. Sistema mostra que o estorno sera integral.
4. Confirmado o cancelamento:
   - membro sai do grupo;
   - mensalidade e caucao sao estornadas;
   - fatura fica estornada;
   - dono e notificado;
   - vaga volta a ficar disponivel ou fila avanca.

Regra:

- Cancelamento antes de receber acesso sempre gera estorno integral, salvo fraude comprovada.

Gap de implementacao:

- O estorno automatico so existe para falha tecnica na entrada apos pagamento, nao para cancelamento manual antes do acesso.

## Fluxo 13: cancelamento ou encerramento do grupo

Pre-condicoes:

- Usuario e dono do grupo ou admin do sistema.

Atual:

- Dono/admin pode excluir grupo por detalhe, removendo grupo e membros.
- Tela de edicao permite mudar status para cancelado.

Alvo v2:

1. Dono clica em "Encerrar grupo".
2. Sistema exige motivo.
3. Sistema calcula impacto financeiro por membro.
4. Sistema informa:
   - data de encerramento;
   - reembolsos proporcionais aos dias nao utilizados;
   - valor proporcional aos dias utilizados, devido ao dono;
   - devolucao da caucao.
5. Dono confirma. **Nao ha aprovacao do admin do sistema nem aviso previo obrigatorio.**
6. Sistema processa de forma automatica:
   - grupo vira cancelado logicamente;
   - membros sao notificados;
   - acessos devem ser encerrados;
   - reembolso proporcional e caucao sao creditados aos membros;
   - o dono recebe o valor proporcional aos dias utilizados.

Regras:

- Grupo com membros ativos nao deve ser removido fisicamente sem trilha de auditoria.
- Nao ha penalidade ao dono pelo encerramento. O repasse so e bloqueado se houver disputa aberta (Fluxo 14).
- A regra vale igualmente para grupos publicos e de organizacao.

Gap de implementacao:

- Hoje existe exclusao fisica em endpoint `DELETE`.
- Nao ha calculo proporcional de reembolso nem processamento automatico de caucao no encerramento.

## Fluxo 14: reclamacao e disputa

Pre-condicoes:

- Usuario e **membro** do grupo no momento da abertura. Nao ha reclamacao de ex-membro.
- Membro com cancelamento agendado continua membro ate a saida efetiva e pode reclamar.
- Existe pagamento/participacao relacionada.
- Quando o dono encerra o grupo, o reembolso proporcional e automatico (Fluxo 13) e dispensa disputa. Contestacao do calculo e tratada pelo suporte, fora do fluxo de disputa.

Motivos:

- Acesso nao recebido no SLA.
- Acesso enviado nao funciona.
- Servico deixou de funcionar.
- Dono do grupo nao responde.
- Cobranca ou valor divergente.

Grupo cancelado pelo dono nao e motivo de disputa: o reembolso proporcional e automatico (Fluxo 13).

Fluxo alvo:

1. Membro abre reclamacao no grupo.
2. Sistema coleta motivo, descricao e evidencias.
3. Sistema marca participacao como `em_disputa`.
4. Sistema bloqueia automaticamente repasse ao dono relacionado ao grupo/membro.
5. Dono recebe notificacao para responder e tem **3 dias** para isso. Sem resposta, o Cotea decide com as evidencias do membro.
6. O **suporte investiga** as evidencias e registra uma recomendacao. O **admin do sistema decide e executa** o estorno. **Somente o Cotea julga disputas**, inclusive as de grupos de organizacao; o admin da organizacao nao decide.
7. Decisao possivel:
   - improcedente: disputa encerra e repasse pode ser liberado;
   - procedente parcial: reembolso proporcional;
   - procedente integral: estorno integral;
   - risco alto/fraude: grupo suspenso e admin do sistema assume tratativa.
8. Sistema registra auditoria e comunica as partes.

Regras:

- O Cotea decide a disputa em ate **7 dias** apos a abertura.
- Abertura de reclamacao nao gera estorno automatico.
- Bloqueio de repasse e automatico.
- Reembolso deve ser proporcional aos dias sem servico quando o acesso ja foi usado.
- **Calculo do reembolso proporcional** (disputa procedente parcial e encerramento do grupo): `mensalidade / dias do ciclo x dias sem servico` (ou dias nao utilizados). A taxa de 5% do Cotea e devolvida proporcionalmente, junto com a mensalidade.
- Reembolso integral deve ocorrer quando o membro nunca recebeu acesso valido.

Gap de implementacao:

- Nao ha fluxo/telas/APIs de reclamacao.
- Nao ha repasse ao dono implementado como regra automatica.

## Fluxo 15: carteira - adicionar saldo via PIX

Pre-condicoes:

- Usuario autenticado e validado.
- Usuario informa CPF valido.

Fluxo atual:

1. Usuario acessa carteira.
2. Clica em adicionar saldo.
3. Informa valor e CPF.
4. Sistema cria pagamento PIX simulado em `payments` com status `pending`.
5. Usuario confirma pagamento simulado.
6. Sistema marca pagamento como confirmado.
7. Sistema cria credito confirmado no ledger `walletTransactions`.
8. Saldo fica disponivel.

Regras:

- Valor minimo: R$ 5,00.
- Exige cadastro financeiro completo no primeiro deposito.
- CPF deve passar validacao.
- Existe rate limit para criacao de pagamentos PIX.
- Confirmacao deve ser idempotente: confirmar duas vezes nao deve duplicar credito.

Alvo v2:

- Quando usar gateway real, confirmacao deve vir por webhook e nao por botao manual.
- A taxa do provedor (Mercado Pago) e repassada ao usuario e deve ser exibida antes da criacao do pagamento.

## Fluxo 16: carteira - usar saldo

Pre-condicoes:

- Usuario autenticado.
- Saldo disponivel suficiente.

Fluxo:

1. Usuario acessa "Usar saldo" ou checkout de assinatura.
2. Sistema valida valor.
3. Sistema calcula saldo disponivel.
4. Se saldo suficiente, cria debito confirmado.
5. Sistema atualiza saldo.

Regras:

- Debitos confirmados reduzem saldo total.
- Debitos bloqueados reduzem saldo disponivel, mas nao saldo total ate serem confirmados.
- Todo lancamento tem categoria de saldo (`pessoal`, `caucao`, `retido_entrada`, `recebivel_retido`, `disputa`, `receita_taxa`) e contexto (`organizacaoId`, nulo no publico; `grupoId`/`participacaoId` quando houver) (feature 002).
- Saldo disponivel (= sacavel) = saldo `pessoal` confirmado menos saques em andamento (debitos `blocked` de `pessoal`). Caucao, retido, a receber e disputa nunca entram no disponivel.
- Saldos sao sempre derivados dos lancamentos, calculados em centavos inteiros.
- Todo debito passa pelo nucleo do ledger (`lib/ledger/`), que confere o saldo da categoria dentro da mesma transacao, com a carteira travada: requisicoes simultaneas nunca deixam saldo negativo.

## Fluxo 17: faturas e pagamentos de assinatura

Atual:

- `invoices` representa fatura de assinatura.
- Status conhecidos: `aguardando_pagamento`, `aguardando_recarga`, `paga`, `estornada`.
- `payments` representa pagamento PIX simulado.
- Tela "Faturas / Pagamentos" lista `payments`, nao todas as `invoices`.

Alvo v2:

- Usuario deve ver faturas de assinatura, pagamentos PIX e movimentacoes da carteira de forma separada e compreensivel.
- Faturas mensais devem ser geradas por participacao ativa.
- Fatura em atraso deve notificar membro antes de consumir caucao. O membro recebe aviso no dia do vencimento (dia 0) e no dia 2. A caucao so e consumida **3 dias apos o vencimento**, se a fatura continuar sem pagamento.
- Se a fatura nao for paga, a **caucao quita a fatura** e a **saida do membro e agendada para o fim do ciclo** que a caucao cobriu. O membro mantem o acesso ate la e o dono ganha tempo para repor a vaga.

Gap de implementacao:

- Nao ha geracao recorrente de faturas mensais.
- Tela de faturas lista pagamentos, nao o ciclo completo de faturas de assinatura.

## Fluxo 18: saque de saldo

Pre-condicoes:

- Usuario autenticado e validado.
- Usuario possui saldo disponivel.
- Usuario informa chave PIX do tipo CPF, que deve ser o CPF do proprio usuario.
- Usuario tem cadastro financeiro completo.

Fluxo atual:

1. Usuario acessa "Sacar".
2. Informa valor e CPF.
3. Sistema valida saldo disponivel dentro da mesma transacao que reserva o valor (carteira travada; dois pedidos simultaneos acima do disponivel: so um passa).
4. Sistema cria withdrawal com status `requested`.
5. Sistema cria debito no ledger com status `blocked` na categoria `pessoal` ("saque em andamento"), na mesma operacao do withdrawal.
6. Financeiro/admin lista saques.
7. Financeiro/admin aprova ou rejeita.
8. Ao aprovar:
   - withdrawal vira `paid`;
   - debito bloqueado vira confirmado.
9. Ao rejeitar:
   - withdrawal vira `rejected`;
   - debito bloqueado vira cancelado;
   - saldo volta a ficar disponivel.

Regras alvo:

- Saque deve deixar claro prazo, taxa e chave destino antes da confirmacao.
- Valor minimo de saque: **R$ 5,00**, igual ao deposito minimo.
- Prazo: o financeiro tem **ate 2 dias uteis** para aprovar ou rejeitar.
- A chave PIX do saque deve ser **sempre o CPF do proprio usuario**.
- Exige cadastro financeiro completo.
- Saque nao pode usar saldo de caucao bloqueado, saldo em disputa ou repasse ainda em retencao.
- O saque e liberado sempre que o saldo estiver **disponivel** (nao preso em grupo, caucao, disputa ou retencao) e o usuario tiver cadastro completo. **Usuario bloqueado (`isBlocked`) tambem pode sacar**: nao ha etapa extra de aprovacao nem restricao por bloqueio.

Gap de implementacao:

- Nao ha medicao do prazo de 2 dias uteis nem piso de R$ 5,00 aplicado no codigo.
- Cobranca da taxa do provedor de pagamento (Mercado Pago) no saque ainda nao implementada.
- Resolvido (feature 002): o saque so usa o disponivel (saldo `pessoal` menos saques em andamento); caucao, retido, a receber e disputa ficam fora. O financeiro/admin ve o saldo segmentado do usuario na tela de saques.

## Fluxo 19: repasse ao dono do grupo

Alvo v2:

1. Membro paga mensalidade.
2. Sistema registra valor como recebivel do dono, vinculado ao grupo e periodo.
3. Valor fica retido por **30 dias**. A contagem comeca:
   - no **primeiro pagamento** do membro, na data em que o dono **envia o acesso**;
   - nas **demais mensalidades**, na data do pagamento de cada fatura.
4. Se nao houver disputa, valor passa a ficar disponivel para saque do dono.
5. Se houver disputa, valor permanece bloqueado ate decisao.
6. Taxas da plataforma, quando existirem, sao destacadas antes do repasse.

Regras:

- Em grupo aprovado automaticamente (Fluxo 5), o repasse so e liberado depois da revisao do Cotea, mesmo vencidos os 30 dias.
- Caução nao e repasse mensal do dono; e garantia do membro.
- Repasse deve respeitar reclamacoes abertas.
- No encerramento do grupo pelo dono, o repasse e so o valor proporcional aos dias utilizados, sem penalidade (Fluxo 13).

Gap de implementacao:

- Nao ha fluxo de recebiveis/repasse ao dono implementado: as categorias `recebivel_retido` e `disputa` e a movimentacao entre categorias (`mover`, mantendo grupo e participacao) ja existem (feature 002), mas nenhum fluxo gera recebiveis ainda (V2-11/V2-15).
- Recebivel liberado vira saldo `pessoal` comum (pode pagar grupos ou ser sacado).
- A conta da plataforma (`wallets._id = 'plataforma'`, categoria `receita_taxa`) existe e comeca vazia; nenhum fluxo grava taxa do Cotea ainda (V2-03/V2-11).

## Fluxo 20: fila de espera

Alvo v2:

A fila de espera vale para grupo **ja ativo e sem vaga**, em que um membro agendou a
saida. Nao confundir com "Aguardando membros", em que o grupo ainda nao iniciou.

1. Grupo esta ativo e sem vaga imediata.
2. Um membro agenda saida.
3. Sistema abre vaga futura.
4. Novo usuario entra na fila **pagando na entrada** (mensalidade + caucao), e o valor fica retido ate a vaga abrir.
5. Sistema informa a data prevista de entrada antes da confirmacao.
6. Quando a saida efetiva ocorre, o primeiro da fila e ativado e o dono envia o acesso (prazo de 5 dias).

Regras:

- A fila e por **ordem de pagamento**, com **1 pessoa por vaga futura**: cada saida agendada abre exatamente uma vaga e so um usuario pode reserva-la.
- O usuario da fila pode sair a qualquer momento antes de entrar, com **estorno integral**.
- Se o membro que agendou a saida desistir, o usuario da fila recebe **estorno integral** e perde a posicao.
- O repasse ao dono comeca a contar so quando o usuario da fila entra de fato no grupo.
- Data de entrada prevista deve ser visivel antes da confirmacao.

Gap de implementacao:

- Hoje existe indicacao visual de fila por `pedidosSaida`, mas nao ha fluxo completo.

## Fluxo 21: notificacoes

Atual:

- Sistema cria notificacoes para validacao de conta, entrada de membro, cancelamento e grupo completo em alguns fluxos.
- Usuario pode listar notificacoes lidas e nao lidas.
- Usuario pode marcar notificacao como lida.

Canais:

- **Notificacao interna no app** (`notificacoesUsuario`): sempre.
- **E-mail**: nos eventos financeiros e de acesso.
- Nao ha WhatsApp nem push nesta versao.

Alvo v2:

- Toda acao sensivel deve gerar notificacao para os envolvidos:
  - cadastro pendente;
  - grupo aprovado/rejeitado;
  - novo membro;
  - acesso enviado;
  - cancelamento solicitado;
  - cancelamento efetivado;
  - preco alterado;
  - fatura emitida;
  - pagamento confirmado;
  - caucao usada/devolvida;
  - saque solicitado/aprovado/rejeitado;
  - reclamacao aberta/respondida/encerrada;
  - convite recebido, solicitacao de ingresso aprovada/recusada e remocao da organizacao;
  - grupo aprovado automaticamente e resultado da revisao posterior.

## Fluxo 22: administracao de usuarios

Pre-condicoes:

- Usuario interno com permissao.

Fluxo atual:

1. Admin/suporte acessa painel.
2. Lista usuarios.
3. Admin pode alterar role se tiver permissao.
4. Admin/suporte pode bloquear ou desbloquear.
5. Sistema impede alterar proprio papel.
6. Sistema registra auditoria.

Regras:

- Usuario bloqueado nao pode executar acoes sensiveis, como criar grupos. **Saque nao e bloqueado** (Fluxo 18).
- O CPF aparece **sempre mascarado** (`***.123.456-**`) nas telas administrativas. So o **financeiro** ve o CPF completo, e apenas ao aprovar ou rejeitar um saque, para conferir a chave PIX.
- Dados sensiveis em geral devem ser tratados com cuidado e mascarados quando possivel.
- Alteracao de role deve ser restrita a admin.

Gap de implementacao:

- Revisar exposicao de CPF em listagens administrativas para garantir mascara/descriptografia segura.

## Fluxo 23: upload e remocao de imagem de grupo

Pre-condicoes:

- Usuario autorizado a criar/editar grupo.
- R2 configurado.

Fluxo:

1. Usuario escolhe imagem.
2. Sistema valida tamanho ate 5 MB.
3. Sistema valida MIME/extensao JPG, PNG ou WebP.
4. Sistema envia para Cloudflare R2.
5. Sistema salva URL/chave no grupo.
6. Ao remover/excluir grupo, sistema tenta remover arquivo do R2.

Regras:

- Operacao R2 deve verificar configuracao antes.
- Falha ao remover imagem nao deve corromper o grupo, mas deve ser registrada.

## Fluxo 24: exclusao de conta

Pre-condicoes:

- Usuario autenticado.

Regras:

- O proprio usuario pode excluir a conta, desde que **nao haja**:
  - saldo na carteira;
  - participacao ativa ou agendada em grupo (como membro ou dono);
  - disputa aberta;
  - fatura pendente.
- Com pendencias, o sistema lista o que impede a exclusao e nao exclui.
- A exclusao **anonimiza os dados pessoais** (nome, e-mail, telefone, CPF, endereco). O historico financeiro e de auditoria e mantido pelo prazo legal.
- A exclusao vale para todos os contextos: a conta deixa tambem as organizacoes de que fazia parte.
- Grupos em que o usuario era dono precisam ser encerrados antes (Fluxo 13).

Gap de implementacao:

- Nao existe fluxo de exclusao de conta.

## Fluxo 25: auditoria e seguranca

Regras:

- Criacao, edicao e exclusao/cancelamento de grupo devem gerar auditoria.
- Pagamento, estorno, debito, saque, aprovacao/rejeicao de saque, role e bloqueio de usuario devem gerar auditoria.
- Convite, ingresso, aceite de transparencia, remocao e saida de organizacao devem gerar auditoria.
- Aprovacao automatica de grupo, revisao posterior, decisao de disputa e leitura de mensagem de acesso pelo suporte devem gerar auditoria.
- Permissoes nao devem confiar em dados enviados pelo cliente.
- APIs sensiveis devem usar sessao do servidor.
- IDs de MongoDB podem aparecer como `ObjectId` ou string; cada handler deve normalizar antes de comparar.
- Dados sensiveis como CPF devem ser criptografados em repouso.

## Prazos e calendario

Regra unica para todos os prazos deste documento (SLA de acesso, aprovacao
automatica, saque, disputas, faturas, convites, repasse e grupos
`apos_completar`). Implementada em `lib/calendario.js` (feature
`001-rotinas-agendadas`).

- Todos os limites de dia usam o horario de Brasilia (`America/Sao_Paulo`).
- **Dias corridos**: o prazo vence no instante exato do evento somado de N x 24h
  (ex.: 5 dias corridos = 120 horas).
- **Dias uteis**: o prazo vence no fim do dia (23:59:59) do N-esimo dia util
  posterior ao dia do evento. O dia do evento nunca conta, seja util ou nao.
- Nao sao dias uteis: sabados, domingos, feriados nacionais (01/01, Sexta-feira
  Santa, 21/04, 01/05, 07/09, 12/10, 02/11, 15/11, 20/11 e 25/12) e as datas
  extras cadastradas pelo admin do sistema (ex.: Carnaval, Corpus Christi, pontes).
- Prazos em dias uteis ainda nao vencidos usam o calendario vigente no momento
  da verificacao; prazos ja vencidos e processados nao sao revistos.
- O sistema age em ate 1 hora apos o vencimento, por rotinas automaticas que
  processam cada evento uma unica vez.

## Regras financeiras consolidadas

- Valores monetarios devem ser normalizados para duas casas decimais.
- A taxa do Cotea e de **5%**, somada ao valor do membro, igual no publico e no corporativo. Valor mensal do membro: `(T / C) x 1,05`.
- O dono ocupa 1 vaga e paga `T / C`, sem taxa do Cotea.
- O primeiro pagamento de entrada no grupo no alvo v2 e:
  - mensalidade do ciclo atual (com taxa do Cotea);
  - caucao de 1 mensalidade;
  - taxa do meio de pagamento, se aplicavel.
- Deposito minimo: R$ 5,00. Saque minimo: R$ 5,00, somente para o CPF do proprio usuario, com aprovacao em ate 2 dias uteis.
- As taxas do provedor de pagamento (Mercado Pago) sao **repassadas ao usuario**, no deposito e no saque. O Cotea nao absorve essas taxas e o valor aparece sempre antes da confirmacao.
- Quem cancela antes da fidelidade perde a caucao como multa, em favor do dono, e continua pagando normalmente as faturas ate a saida efetiva, inclusive o ultimo ciclo.
- Em grupos `apos_completar`, o pagamento e feito na entrada e fica retido; se o grupo nao completar em 30 dias, o estorno e integral e automatico.
- A caucao:
  - equivale a 1 mensalidade ja com a taxa de 5% e e **devolvida integralmente**, incluindo a taxa; a taxa so e retida se a caucao pagar uma fatura;
  - pertence ao membro;
  - fica bloqueada como garantia;
  - pode ser devolvida no cancelamento regular;
  - pode pagar ultimo ciclo quando o cancelamento ocorre fora da janela;
  - pode ser usada em inadimplencia conforme regra exibida previamente.
- Pagamento antes de acesso valido pode ser estornado integralmente. Se o dono nao enviar o acesso em 5 dias corridos, o estorno e automatico.
- Pagamento apos uso do servico pode ter estorno proporcional.
- Inadimplencia: a caucao quita a fatura e a saida e agendada para o fim do ciclo coberto.
- Repasse ao dono fica retido por 30 dias, tambem nas organizacoes, e pode ser bloqueado por disputa.
- Saque so pode consumir saldo disponivel e nao bloqueado.
- A carteira e unica por usuario; os lancamentos guardam a organizacao de origem.

## Gaps prioritarios para implementacao futura

1. Criar status e fluxo real de aprovacao previa de grupos.
2. Implementar caucao como lancamento financeiro separado e bloqueado.
3. Ajustar checkout para cobrar mensalidade + caucao e mostrar total correto.
4. Implementar cancelamento agendado por ciclo com janela de 15 dias.
5. Implementar reclamacoes/disputas com bloqueio de repasse.
6. Implementar repasse ao dono com retencao de 30 dias.
7. Trocar exclusao fisica de grupo por cancelamento logico quando houver membros/historico.
8. Criar faturas recorrentes mensais por participacao ativa.
9. Formalizar fila de espera.
10. Melhorar painel financeiro para diferenciar pagamentos, faturas, ledger, caucao, repasse retido e saldo sacavel.
11. Criar o modelo de organizacoes: entidade, papeis, convites, solicitacoes de ingresso, remocao e `organizacaoId` em grupos e ledger.
12. Aplicar a formula unica de valor por vaga com taxa de 5% na criacao e na edicao de grupo.
13. Implementar estorno automatico por SLA de 5 dias e por grupo `apos_completar` nao completado em 30 dias.
14. Implementar encerramento direto pelo dono com reembolso proporcional automatico.
15. Implementar inadimplencia: caucao quita fatura e agenda saida no fim do ciclo.
16. Implementar a trava de saldo para usuario removido de organizacao.
17. Aplicar piso de saque de R$ 5,00, chave PIX so do proprio CPF e prazo de 2 dias uteis.
18. Mascarar CPF nas telas administrativas e liberar o CPF completo so ao financeiro na aprovacao de saque.
19. Aplicar o limite de 500 caracteres nas mensagens do dono aos membros.
20. Implementar exclusao de conta com anonimizacao e checagem de pendencias.
21. Implementar aprovacao automatica de grupo publico em 2 dias uteis, com repasse retido ate a revisao.
22. Registrar o aceite de transparencia da organizacao no ingresso.

## Cenarios de aceite do documento v2

- Visitante consegue entender o que pode fazer sem login.
- Usuario entende quando precisa validar conta e quando precisa completar dados financeiros.
- Membro entende quanto paga, por que paga caucao, quando recebe acesso e como cancela.
- Dono entende como cria grupo, como ele e aprovado, quando envia acesso e quando recebe repasse.
- Admin entende quando aprova, bloqueia, rejeita, suspende ou intervem.
- Financeiro entende como aprovar/rejeitar saques.
- Suporte entende quando abrir disputa e o que bloquear.
- Implementador consegue identificar claramente quais regras ja existem e quais sao gaps.
- Empresa entende que a organizacao e criada pelo Cotea, como os funcionarios entram e o que o admin da organizacao enxerga.
- Funcionario entende que usa a mesma conta e a mesma carteira nos contextos publico e corporativo.
- Funcionario removido da organizacao entende por que nao consegue entrar em grupos enquanto tiver saldo.

## Decisoes em aberto

Pontos que surgiram na revisao final e ainda nao foram decididos:

Nenhuma no momento.
