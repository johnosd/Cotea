# Lógica do checkout v2

Módulos: `lib/checkout.js` (puro, usado também no cliente) e
`lib/checkout-servidor.js` (banco). Assinaturas de partida nos stubs.

## 1. Por que desta forma

- O ledger (`registrarOperacao`) já roda numa transação e aceita `extra({ sessao })`
  no mesmo commit. Entrada, participação e fatura cabem ali: não é preciso mudar o
  núcleo `lib/ledger/` (travado pela 002).
- Duas transações que **inserem** membros diferentes não conflitam no MongoDB.
  Sem uma escrita comum, a última vaga vende duas vezes (comprovado com o banco
  em memória: sem a trava o contrato recebe `[200, 200]`). A trava é o
  `$inc` de `grupos.versaoParticipacao`.
- Dentro da transação: uma operação por vez (nada de `Promise.all` com a mesma
  sessão); toda leitura e escrita passa `{ session: sessao }`; não capturar erros
  do driver (o `withTransaction` precisa deles para repetir).

## 2. Lotação

```text
ocupacao(membros)  = 1 (dono) + nº de membros com papel != 'admin' e status != 'banido'
grupoJaLotou(g)    = g?.lotadoEm  ou  (g?.acesso == 'apos_completar' e g.statusDetalhado == 'ativo')
```

`motivoGrupoCheio` (`lib/grupo-entrada.js`) passa a usar a mesma ocupação (hoje
conta documentos: num grupo sem o documento do dono aceita um membro a mais).

## 3. Resumo

`calcularResumoEntrada({ grupo, membros })` →
`{ valido: false }` se `precoDoGrupo` inválido; senão

```text
mensalidade = valorPorVaga          caucao = mensalidade
taxa        = TAXA_MEIO_PAGAMENTO   total  = mensalidade + caucao + taxa
repasse, taxaCotea = do precoDoGrupo
aposCompletar    = grupo.acesso == 'apos_completar'
completaGrupo    = aposCompletar e !grupoJaLotou e ocupacao(membros) + 1 >= capacidadeTotal
retemMensalidade = aposCompletar e !grupoJaLotou e !completaGrupo
fidelidadeMeses  = grupo.fidelidade.periodoMeses ou 0
versaoResumo     = junção determinística de [mensalidade em centavos, taxa em centavos,
                   retemMensalidade, aposCompletar, fidelidadeMeses, REGRAS_CAUCAO.versao]
```

`dividirPagamento({ total, disponivel })` → `valorSaldo = min(total, max(disponivel, 0))`,
`valorPix = total - valorSaldo`, em centavos.

## 4. Validação do corpo

- `chave`: `/^[A-Za-z0-9_-]{8,80}$/` → `chave_invalida`
- `vinculo`: id presente em `VINCULOS` → `vinculo_invalido`
- `aceiteRegras.versao === REGRAS_CAUCAO.versao` → `aceite_obrigatorio`

Nessa ordem de prioridade: vínculo antes do aceite.

## 5. Entrada

Handler: a ordem da tabela em `contracts/api-entrada.md`. Idempotência:

```text
repetida(userId, chave):
  f = invoices.findOne({ userId, 'entrada.chave': chave })   // userId string
  se !f            -> null
  se f.grupoId != grupoId -> 409 confirmacao_ja_utilizada
  m = membrosGrupo.findOne({ _id: ObjectId(f.entrada.participacaoId) })
  se m -> 200 repetida   senão -> 409 confirmacao_ja_utilizada
```

Chamar no passo 6 e de novo antes de **qualquer** recusa dos passos 8–14
(requisições gêmeas: a segunda pode ver "já é membro" ou "saldo mudou" porque a
primeira acabou de concluir).

`registrarEntrada`:

```text
participacaoId = new ObjectId(); invoiceId = randomUUID()
wallet = ensureWallet(userId)             // ANTES da transação (a trava exige a carteira)
ledger.registrarOperacao({
  operacaoId: `entrada_grupo:${userId}:${chave}`, source: 'entrada_grupo',
  referenceId: invoiceId, pernas: pernasDaEntrada(...),
  extra({ sessao, lancamentos }):
    1. g = grupos.findOneAndUpdate({_id}, {$inc:{versaoParticipacao:1}}, {session, returnDocument:'after'})
       !g -> recusa grupo_indisponivel
    2. membros = membrosGrupo.find({grupoId}, {session})
       impedimento = avaliarEntradaNoGrupo({grupo: g, userId, membros}) -> recusa
    3. atual = calcularResumoEntrada({grupo: g, membros})
       atual.versaoResumo != resumo.versaoResumo -> recusa resumo_desatualizado
    4. se atual.completaGrupo: grupos.updateOne({_id}, {$set:{lotadoEm: agora, statusDetalhado:'ativo'}}, {session})
    5. membrosGrupo.insertOne(participacao, {session})
    6. createInvoice({... status 'paga', walletId, ledgerId: lancamentos[0]._id, paidAt, entrada}, {session})
})
```

- Recusa dentro do `extra` = erro próprio (ex.: `RecusaEntrada { http, body }`):
  aborta tudo e o handler responde.
- `SaldoInsuficienteError` → reconsultar a chave; senão 402.
- Erro 11000 (índice único de membro) → reconsultar a chave; senão 409 `ja_membro`.
- `criada: false` → responder pela `repetida` (o `extra` não rodou).
- Depois do commit, cada passo em `try/catch` próprio (falha não desfaz nem muda
  a resposta): notificações, `logAudit('assinatura.paid')` e, se completou o
  grupo, `liberarRetencoes({ db, grupoId })` **aguardado** + notificação de lotação.

`pernasDaEntrada`: débito `pessoal` = total (uma perna só); crédito `caucao` =
caução; se `retemMensalidade`, crédito `retido_entrada` = mensalidade + taxa.

## 6. Liquidação de uma participação

```text
planejarLiquidacao({ membro, grupo }):     // grupo pode ser null (excluído)
  caucao   = membro.caucao?.situacao == 'bloqueada' ? valor : 0
  retido   = membro.retencao?.situacao em ['retida','a_liberar'] ? valor : 0
  liberada = retido > 0 e ( situacao == 'a_liberar'
                            ou membro.aguardandoEnvioAcesso === false
                            ou grupoJaLotou(grupo) )
  mensalidade = liberada ? 0 : retido            // o que volta
  total       = caucao + mensalidade
  temMovimento = caucao + retido > 0
```

`pernasDaLiquidacao`: débito `caucao` (se > 0); débito `retido_entrada` = retido
(se > 0, devolvendo ou consumindo); crédito `pessoal` = total (se > 0, **uma
perna só**).

`encerrarParticipacao` (remove o membro) e a variante que mantém o membro usam o
mesmo laço, até 4 tentativas:

```text
membro = findOne(_id)            -> ausente: nada a fazer
grupo  = findOne(membro.grupoId) -> pode ser null
plano  = planejarLiquidacao
se !plano.temMovimento:
   se remover: transação própria (getClient().startSession().withTransaction):
       $inc versaoParticipacao; deleteOne; fatura.encerramento (se ainda não houver)
       // sem a transação, uma entrada em curso poderia contar quem acabou de sair
   devolver zeros
ledger.registrarOperacao({ operacaoId: `liquidacao_participacao:${id}`, ...,
  extra:
    g = grupos.findOneAndUpdate($inc versaoParticipacao, {session})   // null se excluído
    m = membrosGrupo.findOne(_id, {session})
    se !m ou planejarLiquidacao({m, g}) difere de plano -> PlanoDesatualizado
    remover ? deleteOne : updateOne({ caucao.situacao:'devolvida', caucao.devolvidaEm, temCaucao:false,
                                      retencao.situacao: liberada ? 'liberada' : 'devolvida' (se retido) })
    fatura.encerramento = { em, motivo, porId, caucaoDevolvida, mensalidadeDevolvida }
})
PlanoDesatualizado ou SaldoInsuficienteError (liberação concorrente) -> próxima tentativa
criada == false -> próxima tentativa (o plano agora não terá movimento)
```

Depois do commit (best effort): notificação de devolução (se total > 0),
`logAudit('caucao.devolvida')`; na saída, `logAudit('grupo.saida')`.

O `operacaoId` único por participação é o que garante "exatamente uma vez"
entre saída, cancelamento do grupo e rotina.

## 7. Gatilhos de grupo

**Limite por requisição** (constitution: lote com limite): liquidação e liberação
disparadas por uma requisição tratam no máximo `LIMITE_IMEDIATO = 25`
participações; o restante fica para a rotina (§9), que roda a cada 15 minutos.

**Cancelamento/rejeição** — em `executarTransicao`, depois de gravar e notificar,
se `atualizado.status` for `cancelado` ou `rejeitado`:

```js
try {
  const { liquidarParticipacoesDoGrupo } = await import('./checkout-servidor');
  await liquidarParticipacoesDoGrupo({ db, grupoId, motivo });
} catch (erro) { console.error(...) }   // a rotina completa
```

`import` dinâmico e só quando há o que fazer: `lib/moderacao-servidor.js` é usado
por testes sem `lib/mongodb` mockado. Motivo: `encerrar` → `grupo_encerrado`;
demais → `grupo_cancelado`. `liquidarParticipacoesDoGrupo` busca
`{ grupoId, 'caucao.situacao': 'bloqueada' }` (`.limit(LIMITE_IMEDIATO)`),
liquida **sem remover**, um por vez; erro em um não impede os outros. Só obtém o ledger se a lista não for vazia.

**Exclusão (`DELETE /api/grupos/[id]`)**, nesta ordem:

1. se `grupoJaLotou(grupo)`: `updateMany({ grupoId, 'retencao.situacao':'retida' }, → 'a_liberar')`
   (depois de excluído não há como saber que lotou);
2. `deleteOne` do grupo (com o filtro de status atual): daqui em diante nenhuma
   entrada passa;
3. para cada participação com caução bloqueada (até `LIMITE_IMEDIATO`):
   `encerrarParticipacao` (motivo `grupo_excluido`), erro só logado;
4. `deleteMany({ grupoId, 'caucao.situacao': { $ne: 'bloqueada' } })`.

O que sobrar fica órfão (grupo inexistente) e a rotina liquida **removendo**.

**Edição (`PUT`)**: o filtro do `updateOne` ganha
`versaoParticipacao: <valor lido>` (ou `{ $exists: false }`). Se o grupo é
`apos_completar` (valor efetivo), não lotou e a nova capacidade ≤ participantes,
grava `lotadoEm` e `statusDetalhado: 'ativo'` no mesmo `$set` e depois chama
`liberarRetencoes` + notificação de lotação.

**Envio de acesso**: depois do `updateMany` atual, `liberarRetencoes({ db, grupoId })`
em `try/catch`.

## 8. Liberação

`liberarRetencoes({ db, grupoId })`: participações do grupo com
`retencao.situacao` em `['retida','a_liberar']` cujo plano diga `liberada` (e cujo
grupo não esteja cancelado/rejeitado — nesse caso quem decide é a liquidação),
até `LIMITE_IMEDIATO` por chamada vinda de requisição.
Para cada uma: operação `liberacao_retida:<id>`; `extra` faz
`updateOne({ _id, 'retencao.situacao': situacaoLida }, → 'liberada')` e aborta se
não casar. `SaldoInsuficienteError` ou participação mudada = já tratada, seguir.
Depois do commit: `logAudit('mensalidade.liberada')`.

## 9. Rotina `liquidacao-participacoes`

`lib/rotinas/liquidacao-participacoes.js`, registrada em `registro.js`
(agendamento existente, 15 min → atende o "até 1 hora").

- `buscarVencidos({ contexto: { db } })`:
  - caução bloqueada e (grupo inexistente, ou `status` `cancelado`/`rejeitado`, ou
    membro `banido`) → `{ chave: 'liquidar:<id>' }`;
  - retenção pendente liberável em grupo vivo → `{ chave: 'liberar:<id>' }`.
  Buscar os grupos de uma vez com `$in`.
- `processarItem`: revalida e liquida (remove **só** se o grupo não existe; mantém
  nos demais, inclusive o banido — R-011) ou libera; sem nada a fazer →
  `'ignorado'`; erro propaga (o executor repete e alerta).

## 10. Migração (`scripts/migrar-checkout-v2.js`)

Dry-run por padrão; `--aplicar` grava; reexecutável; não imprime variáveis.

1. **Índice**: se `referenceId_1_type_1_source_1` for único, `dropIndex` e recriar
   parcial não único.
2. **Faturas** (`planejarMigracaoCheckout({ faturas, membros })` →
   `[{ invoiceId, acao: 'manter'|'cancelar'|'estornar', motivo }]`):
   - com `entrada` → manter;
   - `aguardando_pagamento` / `aguardando_recarga` → cancelar (status `cancelada`);
   - `paga` sem `vinculadoEm` e sem `membroId`, sem nenhum membro do mesmo
     usuário+grupo (comparar como string) nem membro com esse `invoiceId` →
     estornar;
   - demais → manter.
3. Estorno pelo ledger (`criarLedger` + `criarRepositorioLedgerMongo`),
   `operacaoId: estorno_assinatura:<id>`, crédito `pessoal`, fatura `estornada`
   no `extra`; uma entrada em `auditLogs` por fatura alterada.

O dry-run lista cada fatura e o total a creditar, para aprovação antes de aplicar.
