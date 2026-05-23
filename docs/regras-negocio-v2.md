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
- **Financeiro**: papel interno com permissao de operar saques.
- **Suporte**: papel interno com permissao de ajudar em usuarios, grupos e disputas.

## Principios do produto

- O Cotea intermedia grupos de assinatura, pagamentos, carteira, notificacoes e historico financeiro.
- O dono do grupo e responsavel pela veracidade do grupo, manutencao da assinatura e envio do acesso.
- O membro paga pela participacao e deve ter previsibilidade sobre acesso, cancelamento, caucao e reembolso.
- O sistema deve proteger as duas pontas: membro contra falta de acesso ou servico ruim, dono do grupo contra inadimplencia e saida sem aviso.
- Regras financeiras devem ser transparentes antes da confirmacao da acao.
- Toda acao sensivel deve ser feita no servidor, usando sessao real e dados recarregados do banco.

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
- Para pagar, sacar ou criar grupo publicado, precisa tambem ter cadastro financeiro completo quando a acao exigir CPF/dados de pagamento.

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
- Solicitar encerramento do grupo.

Alvo v2:

- Alteracoes sensiveis, como preco, status publico, capacidade, tipo de acesso e encerramento, devem respeitar aprovacao ou trilha de auditoria.

### Admin do sistema

Pode:

- Aprovar ou rejeitar grupos.
- Editar grupos e campos internos.
- Gerenciar usuarios, bloqueios e roles.
- Ver auditoria.
- Atuar em disputas.

### Financeiro

Pode:

- Listar saques.
- Aprovar saques.
- Rejeitar saques.

### Suporte

Pode:

- Apoiar usuarios e grupos conforme permissoes.
- Listar usuarios, grupos e saques quando autorizado.
- Atuar na investigacao de reclamacoes, sem executar operacoes financeiras finais se nao tiver role adequada.

## Estados principais

### Estados de usuario

- **Visitante**: sem sessao.
- **Autenticado sem cadastro local**: fez login Google, mas ainda nao possui documento completo em `users`.
- **Cadastro inicial**: possui nome, sobrenome, e-mail, username e telefone opcional.
- **Conta validada**: confirmou e-mail por codigo.
- **Cadastro financeiro completo**: possui CPF e dados minimos de endereco/pagamento exigidos para operacoes financeiras.
- **Bloqueado**: `isBlocked: true`; nao deve executar acoes sensiveis. Pode ser membro de grupos fazer pagamentos, mas não consegue criar grupos e precisa de aprovação para saques

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


- **Aguardando acesso**: Pagamento confirmado. membro entrou, mas ainda nao recebeu acesso.
- **Ativo**: acesso enviado e participacao vigente.
- **Cancelamento agendado**: saida marcada para fim de ciclo.
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

- Para pagar via PIX, sacar, receber repasse ou criar grupo publico, o CPF deve estar presente e valido.
- Para saque, a chave PIX CPF deve pertencer ao usuario ou passar validacao de risco.

Gap de implementacao:

- O checkout de assinatura pede CPF para PIX, mas nao necessariamente salva esse CPF no perfil.
- O sistema atual valida tamanho do CPF no perfil, mas nao aplica algoritmo de CPF nesse endpoint.

## Fluxo 4: criacao de grupo pelo dono

Pre-condicoes:

- Usuario autenticado e conta validada.
- Alvo v2 exige cadastro financeiro completo antes de publicar.

Fluxo alvo:

1. Dono clica em "Criar Grupo".
2. Sistema apresenta formulario de identidade, categoria, assinatura, acesso, beneficios, regras, fidelidade, FAQ e link oficial.
3. Dono informa valor total e capacidade.
4. Sistema calcula valor por vaga.
5. Dono escolhe tipo de acesso:
   - `imediato`: acesso pode ser enviado logo apos pagamento.
   - `apos_completar`: acesso so deve ser enviado quando o grupo completar capacidade.
6. Dono salva o grupo.
7. Sistema cria o grupo em estado **Em aprovacao**.
8. Sistema cria membro admin vinculado ao dono.
9. Sistema registra auditoria.
10. Admin do sistema recebe tarefa/notificacao de aprovacao.

Regras:

- Capacidade minima: 2, sendo 1 vaga do dono e ao menos 1 vaga para membro.
- Categoria deve estar entre jogos, aplicativos, assinaturas e cursos.
- Beneficios, regras e FAQ devem ter limites de quantidade/tamanho.
- Link oficial deve ser URL http/https.
- Upload de imagem deve respeitar JPG, PNG ou WebP e limite de 5 MB.

Gap de implementacao:

- Hoje o grupo e criado como `ativo`.
- Hoje nao ha fila de aprovacao previa implementada.
- Hoje valor por vaga e calculado de forma diferente entre criacao e edicao em alguns pontos: a regra alvo deve ser unica e explicita.

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
- Alteracao de preco, capacidade, status publico, tipo de acesso, fidelidade e encerramento deve ir para aprovacao do admin do sistema ou gerar auditoria reforcada.
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
- Grupo publico, aprovado e com vaga imediata ou fila permitida.
- Usuario nao e dono do grupo.
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
2. Na entrada, membro paga **mensalidade atual + caucao de 1 mensalidade**.
3. A caucao fica bloqueada/retida na carteira ou ledger, associada ao membro e grupo.
4. Se o grupo for `apos_completar`, membro pode ficar aguardando ativacao/acesso ate completar vagas.
5. Se a entrada falhar depois do pagamento, sistema deve estornar automaticamente.
6. Se o grupo completar a capacidade, sistema atualiza status e notifica dono e membros.

Excecoes:

- Grupo completo sem fila: bloquear entrada antes de pagamento.
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
- Se o acesso nao for enviado no prazo, membro pode abrir reclamacao e pedir cancelamento com estorno integral ou proporcional, conforme caso.

Gap de implementacao:

- O sistema envia e-mail, mas nao ha medicao automatica de SLA vencido.

## Fluxo 9: mensagens aos membros

Pre-condicoes:

- Usuario e dono/admin do grupo.
- Grupo possui membros ativos alem do admin.

Fluxo:

1. Dono acessa "Enviar mensagem aos membros".
2. Escreve mensagem ate o limite permitido.
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

- Deve mostrar status real da participacao: aguardando acesso, ativo, cancelamento agendado, em disputa ou cancelado.
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
7. Enquanto cancelamento esta agendado, membro pode reverter se a vaga ainda nao foi preenchida.

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

1. Dono solicita encerramento.
2. Sistema exige motivo.
3. Sistema calcula impacto financeiro por membro.
4. Sistema informa:
   - data de encerramento;
   - reembolsos proporcionais;
   - valores devidos ao dono;
   - efeitos sobre caucao.
5. Solicita aprovacao do admin do sistema quando houver membros ativos.
6. Se aprovado:
   - grupo vira cancelado logicamente;
   - membros sao notificados;
   - acessos devem ser encerrados;
   - reembolsos/creditos sao processados.

Regras:

- Grupo com membros ativos nao deve ser removido fisicamente sem trilha de auditoria.
- Encerramento pelo dono antes do periodo prometido pode gerar penalidade ou bloqueio de repasse.

Gap de implementacao:

- Hoje existe exclusao fisica em endpoint `DELETE`.
- Nao ha calculo proporcional de reembolso.

## Fluxo 14: reclamacao e disputa

Pre-condicoes:

- Usuario e membro ou ex-membro recente.
- Existe pagamento/participacao relacionada.

Motivos:

- Acesso nao recebido no SLA.
- Acesso enviado nao funciona.
- Servico deixou de funcionar.
- Dono do grupo nao responde.
- Grupo foi cancelado sem aviso.
- Cobrança ou valor divergente.

Fluxo alvo:

1. Membro abre reclamacao no grupo.
2. Sistema coleta motivo, descricao e evidencias.
3. Sistema marca participacao como `em_disputa`.
4. Sistema bloqueia automaticamente repasse ao dono relacionado ao grupo/membro.
5. Dono recebe notificacao para responder.
6. Suporte/admin analisa evidencias.
7. Decisao possivel:
   - improcedente: disputa encerra e repasse pode ser liberado;
   - procedente parcial: reembolso proporcional;
   - procedente integral: estorno integral;
   - risco alto/fraude: grupo suspenso e admin do sistema assume tratativa.
8. Sistema registra auditoria e comunica as partes.

Regras:

- Abertura de reclamacao nao gera estorno automatico.
- Bloqueio de repasse e automatico.
- Reembolso deve ser proporcional aos dias sem servico quando o acesso ja foi usado.
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

- Valor deve ser positivo.
- CPF deve passar validacao.
- Existe rate limit para criacao de pagamentos PIX.
- Confirmacao deve ser idempotente: confirmar duas vezes nao deve duplicar credito.

Alvo v2:

- Quando usar gateway real, confirmacao deve vir por webhook e nao por botao manual.
- Taxas de pagamento devem ser exibidas antes da criacao.

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
- Saldo disponivel = saldo confirmado menos valores bloqueados.

## Fluxo 17: faturas e pagamentos de assinatura

Atual:

- `invoices` representa fatura de assinatura.
- Status conhecidos: `aguardando_pagamento`, `aguardando_recarga`, `paga`, `estornada`.
- `payments` representa pagamento PIX simulado.
- Tela "Faturas / Pagamentos" lista `payments`, nao todas as `invoices`.

Alvo v2:

- Usuario deve ver faturas de assinatura, pagamentos PIX e movimentacoes da carteira de forma separada e compreensivel.
- Faturas mensais devem ser geradas por participacao ativa.
- Fatura em atraso deve notificar membro antes de consumir caucao.
- Se inadimplencia persistir, sistema pode usar caucao e agendar saida.

Gap de implementacao:

- Nao ha geracao recorrente de faturas mensais.
- Tela de faturas lista pagamentos, nao o ciclo completo de faturas de assinatura.

## Fluxo 18: saque de saldo

Pre-condicoes:

- Usuario autenticado e validado.
- Usuario possui saldo disponivel.
- Usuario informa chave PIX CPF valida.

Fluxo atual:

1. Usuario acessa "Sacar".
2. Informa valor e CPF.
3. Sistema valida saldo disponivel.
4. Sistema cria withdrawal com status `requested`.
5. Sistema cria debito no ledger com status `blocked`.
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
- Saque nao pode usar saldo de caucao bloqueado, saldo em disputa ou repasse ainda em retencao.

Gap de implementacao:

- Nao ha taxa/prazo de saque documentado no produto.
- Nao ha separacao de saldo de repasse do dono versus saldo comum.

## Fluxo 19: repasse ao dono do grupo

Alvo v2:

1. Membro paga mensalidade.
2. Sistema registra valor como recebivel do dono, vinculado ao grupo e periodo.
3. Valor fica retido por **30 dias**.
4. Se nao houver disputa, valor passa a ficar disponivel para saque do dono.
5. Se houver disputa, valor permanece bloqueado ate decisao.
6. Taxas da plataforma, quando existirem, sao destacadas antes do repasse.

Regras:

- Caução nao e repasse mensal do dono; e garantia do membro.
- Repasse deve respeitar reclamacoes abertas.
- Encerramento antecipado do grupo pode bloquear ou reduzir repasse.

Gap de implementacao:

- Nao ha fluxo de recebiveis/repasse ao dono implementado.
- Wallet atual e generica e nao diferencia saldo pessoal, caucao, repasse liberado e repasse retido.

## Fluxo 20: fila de espera

Alvo v2:

1. Grupo esta ativo e sem vaga imediata.
2. Um membro agenda saida.
3. Sistema abre vaga futura.
4. Novo usuario pode entrar na fila.
5. Sistema informa data prevista de entrada e condicoes de pagamento.
6. Quando a saida efetiva ocorre, primeiro da fila e convidado/ativado.
7. Se usuario da fila nao pagar ou confirmar no prazo, perde a posicao.

Regras:

- Usuario nao deve pagar por periodo sem acesso, salvo regra explicita de reserva aceita antes.
- Data de entrada prevista deve ser visivel antes da confirmacao.

Gap de implementacao:

- Hoje existe indicacao visual de fila por `pedidosSaida`, mas nao ha fluxo completo.

## Fluxo 21: notificacoes

Atual:

- Sistema cria notificacoes para validacao de conta, entrada de membro, cancelamento e grupo completo em alguns fluxos.
- Usuario pode listar notificacoes lidas e nao lidas.
- Usuario pode marcar notificacao como lida.

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
  - reclamacao aberta/respondida/encerrada.

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

- Usuario bloqueado nao pode executar acoes sensiveis.
- Dados sensiveis, como CPF, devem ser tratados com cuidado e mascarados quando possivel.
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

## Fluxo 24: auditoria e seguranca

Regras:

- Criacao, edicao e exclusao/cancelamento de grupo devem gerar auditoria.
- Pagamento, estorno, debito, saque, aprovacao/rejeicao de saque, role e bloqueio de usuario devem gerar auditoria.
- Permissoes nao devem confiar em dados enviados pelo cliente.
- APIs sensiveis devem usar sessao do servidor.
- IDs de MongoDB podem aparecer como `ObjectId` ou string; cada handler deve normalizar antes de comparar.
- Dados sensiveis como CPF devem ser criptografados em repouso.

## Regras financeiras consolidadas

- Valores monetarios devem ser normalizados para duas casas decimais.
- O primeiro pagamento de entrada no grupo no alvo v2 e:
  - mensalidade do ciclo atual;
  - caucao de 1 mensalidade;
  - taxa do meio de pagamento, se aplicavel.
- A caucao:
  - pertence ao membro;
  - fica bloqueada como garantia;
  - pode ser devolvida no cancelamento regular;
  - pode pagar ultimo ciclo quando o cancelamento ocorre fora da janela;
  - pode ser usada em inadimplencia conforme regra exibida previamente.
- Pagamento antes de acesso valido pode ser estornado integralmente.
- Pagamento apos uso do servico pode ter estorno proporcional.
- Repasse ao dono fica retido por 30 dias e pode ser bloqueado por disputa.
- Saque so pode consumir saldo disponivel e nao bloqueado.

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

## Cenarios de aceite do documento v2

- Visitante consegue entender o que pode fazer sem login.
- Usuario entende quando precisa validar conta e quando precisa completar dados financeiros.
- Membro entende quanto paga, por que paga caucao, quando recebe acesso e como cancela.
- Dono entende como cria grupo, como ele e aprovado, quando envia acesso e quando recebe repasse.
- Admin entende quando aprova, bloqueia, rejeita, suspende ou intervem.
- Financeiro entende como aprovar/rejeitar saques.
- Suporte entende quando abrir disputa e o que bloquear.
- Implementador consegue identificar claramente quais regras ja existem e quais sao gaps.
