# Lógica: núcleo do ledger e repositório Mongo

Arquivos: `lib/ledger/ledger.js` (puro, stub), `lib/ledger/categorias.js`,
`lib/ledger/repositorio-mongo.js` (novo), `lib/ledger/servidor.js` (novo).
Porta do repositório: **`tests/helpers/ledger-memoria.js` (travado)** — o
repositório Mongo replica métodos e retornos.

## 1. `calcularResumo(lancamentos)` — puro

```text
centavos(v) = Math.round(Number(v) * 100)
para cada l:
  cat = l.categoria                     # legado já migrado; ver nota
  se l.type == 'debit' e l.status == 'blocked': saque += centavos(l.amount); continue
  se l.status != 'confirmed': continue
  sinal = credit ? +1 : -1
  net[cat] += sinal * centavos(l.amount)
  se cat ∈ CATEGORIAS_BLOQUEADAS: grupo[(cat, grupoId, participacaoId)] += sinal * centavos
disponivel = net.pessoal - saque
total = Σ net
retorna tudo / 100, porGrupo sem entradas zeradas
```

Nota: o núcleo nunca vê lançamento sem categoria depois da migração. Antes
dela, `calculateBalances` (compat) trata ausência como `pessoal` — é o que
garante SC-001 mesmo se o deploy do código chegar antes da migração.

## 2. Validação de cada perna (antes de abrir a transação)

Recusa com `LancamentoInvalidoError` (nada gravado) quando:

- `categoria` fora de `TODAS_CATEGORIAS`;
- `organizacaoId` ausente/`undefined` (`null` é válido) — FR-021;
- `centavos(valor) <= 0` ou não finito;
- categoria em `CATEGORIAS_BLOQUEADAS` sem `grupoId` — FR-002;
- `status: 'blocked'` em perna que não seja débito de `pessoal`;
- `receita_taxa` fora da conta da plataforma, ou outra categoria nela;
- `mover` com `de === para`;
- `operacaoId` vazio.

## 3. `registrarOperacao({ operacaoId, source, referenceId, descricao, pernas, extra })`

```text
validar(pernas)
travar = carteiras distintas com perna de DÉBITO        # crédito não trava (plataforma não vira gargalo)
repo.executarAtomico({ travar }, async (tx) => {
  existentes = tx.buscarPorOperacao(operacaoId)
  se existentes: return { criada: false, lancamentos: existentes }   # idempotente, sem revalidar saldo
  para cada (walletId, categoria, grupoId) com débito:
     saldo = (categoria == 'pessoal') ? disponivel : net(categoria, grupoId)  # caução de G1 não cobre G2
     se saldo < Σ débitos da chave: throw SaldoInsuficienteError({ walletId, categoria, disponivel, solicitado })
  docs = pernas → lançamentos (amount = normalizado, status default 'confirmed', operacaoId, pernasTotal, createdAt = agora())
  resultadoExtra = extra ? await extra({ sessao: tx.sessao, lancamentos: docs }) : undefined   # efeito externo na MESMA transação
  tx.inserir(docs)
  return { criada: true, lancamentos: docs, resultadoExtra }
})
```

- Ordem `extra` antes de `inserir` é livre; o que importa é estar dentro da
  transação: se qualquer um lançar, nada fica (contrato 5). `extra` recebe os
  lançamentos já montados (com `_id`) porque `markInvoicePaid` precisa do
  `ledgerId`; `insertWithdrawal` recebe o `_id` gerado antes (o `operacaoId`
  `saque:<withdrawalId>` tem de existir antes da operação).
- `SaldoInsuficienteError.disponivel` alimenta o `faltante` do checkout
  (`pages/api/assinaturas/pay.js`).
- E11000 no índice `operacaoId` (corrida entre duas carteiras sem trava em
  comum, ex.: dois créditos PIX iguais): repositório Mongo relê
  `buscarPorOperacao` e devolve `{ criada: false }`.

## 4. `mover(...)`

Açúcar de `registrarOperacao` com 2 pernas na mesma carteira: débito em `de`
e crédito em `para`, ambas com `grupoId`/`participacaoId`/`organizacaoId` da
origem (FR-007). Usado por V2-06 (pessoal→caução), V2-10 (caução→pessoal),
V2-11 (recebível→pessoal), V2-15 (recebível→disputa).

## 5. `liquidarReserva({ operacaoId, acao, extra })`

```text
para = acao == 'confirmar' ? 'confirmed' : 'cancelled'
repo.executarAtomico({ travar: [] }, async (tx) => {
  alterados = tx.atualizarStatus({ operacaoId, de: 'blocked', para })
  resultadoExtra = extra ? await extra({ sessao: tx.sessao, alterados }) : undefined
  return { alterados, resultadoExtra }
})
```

Só `blocked` muda: confirmar depois de cancelar (ou o contrário) dá
`alterados: 0` — o handler responde "saque já finalizado". Não precisa travar
a carteira: liberar ou baixar reserva nunca deixa saldo negativo.

## 6. `resumo(walletId)` — leitura via `executarAtomico({ travar: [] })` + `calcularResumo`.

## 7. Repositório Mongo (`lib/ledger/repositorio-mongo.js`)

```js
export function criarRepositorioLedgerMongo({ client, db }) {
  return {
    async executarAtomico({ travar = [] }, fn) {
      const session = client.startSession();
      try {
        return await session.withTransaction(async () => {
          for (const walletId of [...new Set(travar)].sort()) {
            const r = await db.collection('wallets').updateOne(
              { _id: walletId }, { $inc: { versaoLedger: 1 } }, { session });
            if (r.matchedCount === 0) throw new Error(`carteira inexistente: ${walletId}`);
          }
          return fn({
            sessao: session,
            listarLancamentos: (walletId) => db.collection('walletTransactions').find({ walletId }, { session }).toArray(),
            buscarPorOperacao: (operacaoId) => db.collection('walletTransactions').find({ operacaoId }, { session }).toArray(),
            inserir: (docs) => db.collection('walletTransactions').insertMany(docs, { session }),
            atualizarStatus: async ({ operacaoId, de, para }) =>
              (await db.collection('walletTransactions').updateMany({ operacaoId, status: de }, { $set: { status: para } }, { session })).modifiedCount,
          });
        }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } });
      } finally { await session.endSession(); }
    },
  };
}
```

Por que funciona (FR-008): o `$inc` em `wallets` é a primeira escrita da
transação; duas transações que travam a mesma carteira geram `WriteConflict`,
e `withTransaction` repete a perdedora **depois** do commit da vencedora, já
enxergando o débito dela. Não usar `findOneAndUpdate(...).value` (driver 6.16
devolve o documento direto — R-007 da 001 / B-06).

Cuidado: `withTransaction` pode rodar `fn` mais de uma vez — `extra` tem de ser
seguro para repetição dentro da transação (só escritas com `{ session }`, nada
de e-mail/log de auditoria lá dentro). Auditoria (`logAudit`) fica no handler,
**depois** do commit.

## 8. Montagem no servidor (`lib/ledger/servidor.js`)

```js
export async function obterLedger() {          // importa lib/mongodb.js — só em rotas
  const client = await getClient(); const db = await getDb();
  return criarLedger({ repo: criarRepositorioLedgerMongo({ client, db }) });
}
export async function garantirContaPlataforma(db) { /* upsert do doc fixo de data-model.md */ }
```

`lib/wallet.js` → `calculateBalances(walletId)` passa a usar `calcularResumo`
sobre `find({ walletId })` e devolve os campos antigos (`balance` = total,
`available` = disponível, `blockedDebits` = saqueEmAndamento, `pendingTotal`,
`returnedTotal`) **mais** `resumo`, para os consumidores atuais não quebrarem.

## 9. Rotina `ledger-consistencia` (US4)

- `buscarVencidos({ agora })` → 1 item por dia: `chave = 'consistencia:' + data local de Brasília (AAAA-MM-DD)`.
  O agendador chama a cada 15 min; a idempotência da 001 garante 1 execução/dia.
- `processarItem({ contexto: { db } })`:
  1. agregação `walletTransactions` por `{ walletId, categoria, grupoId, type, status }` (uma passada);
  2. `verificarConsistencia(agregados, lancamentosSemCampos, operacoesIncompletas)` puro em `lib/ledger/consistencia.js`
     → lista de achados `{ walletId, categoria, grupoId?, tipo: 'categoria_negativa'|'disponivel_negativo'|'sem_categoria'|'sem_contexto'|'operacao_incompleta'|'categoria_fora_da_conta' }`;
  3. operações incompletas: `$group` por `operacaoId` com `count != pernasTotal`;
  4. com achados: notificação interna para cada admin não bloqueado + `logAudit('ledger.inconsistencia', ...)`; **sem corrigir nada**;
  5. retorna `'concluido'` (com ou sem achados). Erro de leitura → lança (retentativa da 001).
