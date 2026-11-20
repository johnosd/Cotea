# Lógica: executor de rotinas

Arquivos: `lib/rotinas/executor.js` (stub), `lib/rotinas/repositorio-mongo.js`,
interface de referência `tests/helpers/repositorio-rotinas-memoria.js` (travada).

## Interface da rotina (registrada em `lib/rotinas/registro.js`)

```js
{
  id: 'saude',                       // estável; vira rotinaId no banco
  descricao: 'Verificação de funcionamento',
  ativa: true,                       // false = não roda no disparo automático
  async buscarVencidos({ agora, contexto }) { return [{ chave, dados }] },
  async processarItem({ chave, dados, agora, contexto }) { return 'concluido' | 'ignorado' },
}
```

- `buscarVencidos` decide o que venceu (usa `lib/calendario.js` para prazos).
  Pode devolver itens já concluídos: o executor os pula. Não precisa
  "lembrar" o que já foi feito.
- `processarItem` DEVE revalidar a condição de negócio e retornar
  `'ignorado'` se ela não vale mais (FR-007). Lançar erro = falha.
  Qualquer retorno diferente de `'ignorado'` conta como `'concluido'`.
- `contexto` = `{ db, datasExtras }` montado pela rota de disparo; nos testes,
  vazio.

## `executarRotina(rotina, opcoes)` — algoritmo

```
opcoes: repo (obrigatório), agora = new Date(), origem = 'automatica', autorId = null,
        alertar = async () => {}, contexto = {}, limite = 500,
        leaseMs = LEASE_PADRAO_MS (10 min), maxTentativas = MAX_TENTATIVAS (5)

execucaoId = await repo.iniciarExecucao({ rotinaId: rotina.id, origem, autorId, inicio: agora })
c = { processados: 0, ignorados: 0, falhas: 0, pulados: 0 }
try:
  vencidos = await rotina.buscarVencidos({ agora, contexto })
catch e:
  await repo.finalizarExecucao(execucaoId, { fim: new Date(), resultado: 'erro', ...c, erro: msg(e) })
  return { execucaoId, resultado: 'erro', ...c }          // NÃO relança

for item of vencidos.slice(0, limite):                    // SEQUENCIAL (for...of + await)
  claim = await repo.reivindicarItem({ rotinaId, chave: item.chave, dados: item.dados ?? {}, agora, leaseMs })
  if !claim.reivindicado: c.pulados++; continue
  try:
    r = await rotina.processarItem({ chave, dados: claim.registro.dados, agora, contexto })
    situacao = r === 'ignorado' ? 'ignorado' : 'concluido'
    await repo.concluirItem({ rotinaId, chave, situacao, agora })
    situacao === 'ignorado' ? c.ignorados++ : c.processados++
  catch e:
    { tentativas, definitiva } = await repo.registrarFalhaItem({ rotinaId, chave, erro: msg(e), agora, maxTentativas })
    c.falhas++
    if definitiva:
      try await alertar({ rotinaId, chave, erro: msg(e), tentativas }) catch → console.error (não propaga)

resultado = c.falhas === 0 ? 'sucesso' : (c.processados + c.ignorados > 0 ? 'parcial' : 'erro')
await repo.finalizarExecucao(execucaoId, { fim: new Date(), resultado, ...c })
return { execucaoId, resultado, ...c }

msg(e) = String(e?.message ?? e).slice(0, 500)   // sem stack
```

Pontos que parecem contraintuitivos:

1. **Processamento sequencial**, não `Promise.all`. A concorrência que importa
   é entre execuções (duas instâncias do agendador), resolvida pelo
   `reivindicarItem`. Paralelizar dentro da execução só aumentaria a carga no
   banco e a chance de timeout.
2. **`agora` é fixo por execução**: usado para lease, `concluidoEm` e para
   decidir vencimento. Não chame `new Date()` dentro do loop (só no `fim`).
3. **Falha de `alertar` não vira falha do item**: o item já está
   `falha_definitiva`; o alerta é melhor esforço (logado).
4. **Item `falha` volta a ser tentado** só se `buscarVencidos` o devolver de
   novo. Se a condição de negócio sumiu, ele fica `falha` parado; o painel
   mostra e o admin decide.
5. **Idempotência do mecanismo ≠ idempotência do efeito**: se o processo morrer
   depois do efeito e antes de `concluirItem`, o item volta após o lease e roda
   de novo. Por isso toda `processarItem` que movimenta dinheiro DEVE ser
   idempotente pelo próprio evento (ex.: `walletTransactions` tem índice único
   `{ referenceId, type, source }`) — Constitution II. Isso é exigência às
   features consumidoras, documentada aqui.

## `reexecutarItem(rotina, chave, opcoes)`

```
reg = await repo.obterItem({ rotinaId, chave })
if !reg → throw Error('Item nao encontrado')            // API → 404
if reg.situacao in ['concluido', 'ignorado'] → return { chave, situacao: reg.situacao, reprocessado: false }
await repo.reabrirItem({ rotinaId, chave, agora })
execucao origem 'manual' com o mesmo laço do executarRotina, mas para um único
item [{ chave, dados: reg.dados }] (reaproveitar a função interna do laço)
return { chave, situacao: <situação final do item>, reprocessado: true }
```

Item `processando` com lease vigente → `reivindicarItem` recusa →
`reprocessado: false`, situação `processando`.

## Repositório Mongo (`lib/rotinas/repositorio-mongo.js`)

`criarRepositorioMongo(db)` implementa os MESMOS métodos e retornos do fake
em memória. O fake usa `travadoAte` em ms; no Mongo guarde `Date`.

`reivindicarItem` — um único `findOneAndUpdate` com upsert; o índice único
`{ rotinaId, chave }` resolve a corrida:

```js
const FINAIS = ['concluido', 'ignorado', 'falha_definitiva'];
try {
  const doc = await col.findOneAndUpdate(
    {
      rotinaId, chave,
      situacao: { $nin: FINAIS },
      $or: [{ situacao: { $ne: 'processando' } }, { travadoAte: { $lte: agora } }],
    },
    {
      $set: { situacao: 'processando', travadoAte: new Date(agora.getTime() + leaseMs), atualizadoEm: agora },
      $setOnInsert: { _id: randomUUID(), dados, tentativas: 0, ultimoErro: null, concluidoEm: null, criadoEm: agora },
    },
    { upsert: true, returnDocument: 'after' }
  );
  return { reivindicado: true, registro: doc };   // driver v6: findOneAndUpdate retorna o documento
} catch (e) {
  if (e?.code !== 11000) throw e;
  // Já existe em estado final ou travado: o filtro não casou e o upsert colidiu no índice único
  const atual = await col.findOne({ rotinaId, chave });
  return { reivindicado: false, motivo: FINAIS.includes(atual?.situacao) ? atual.situacao : 'em_processamento' };
}
```

- NÃO repita `rotinaId`/`chave` no `$setOnInsert` (já vêm da igualdade do filtro).
- Confira a versão do driver: no `mongodb` v6, `findOneAndUpdate` retorna o
  documento direto (sem `.value`), salvo `includeResultMetadata: true`. Os
  handlers antigos (`withdraw/approve.js`) usam `.value` — não copie esse padrão
  sem verificar.
- `registrarFalhaItem`: `findOneAndUpdate` com `$inc: { tentativas: 1 }` e,
  com o valor retornado, um segundo `updateOne` para `situacao`
  (`falha_definitiva` se `tentativas >= maxTentativas`), ou pipeline update numa
  só operação. Retorna `{ tentativas, definitiva }`.
- `iniciarExecucao` insere com `resultado: null, fim: null` e devolve o `_id`.
