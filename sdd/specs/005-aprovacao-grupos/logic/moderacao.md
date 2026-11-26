# Lógica: moderação de grupos

Arquivos: `lib/moderacao.js` (puro, stub), `lib/moderacao-servidor.js` (stub),
`lib/rotinas/aprovacao-automatica.js` (stub). Formato dos documentos em
`data-model.md`; superfícies HTTP em `contracts/api-moderacao.md`.

## 1. Funções puras (`lib/moderacao.js`)

```
statusEfetivo(grupo)       = grupo?.status ?? 'ativo'                 // D-02
grupoEhPublico(grupo)      = statusEfetivo(grupo) === 'ativo'
podeVerGrupo({ grupo, ehStaff, ehDono, ehMembroAtual })
                           = grupoEhPublico(grupo) || ehStaff || ehDono || ehMembroAtual
donoPodeEditar(grupo)      = statusEfetivo(grupo) in ['ajustes', 'ativo']
moderacaoInicial({ agora, ator }) → subdocumento de data-model.md (envio 1, histórico [enviado])
vencimentoAprovacao(grupo, { datasExtras })
   = grupo.status === 'em_aprovacao' && grupo.moderacao?.enviadoEm
       ? vencimentoDiasUteis(new Date(enviadoEm), PRAZO_APROVACAO_DIAS_UTEIS, { datasExtras })
       : null
normalizarTexto(texto)     = String(texto ?? '').trim()  → '' | até 1000
```

`vencimentoDiasUteis` vem de `lib/calendario.js` (puro, pode ser importado): o
dia do envio não conta e o prazo vence às 23:59:59.999 (Brasília) do 2º dia útil
seguinte. **Não** criar outra função de prazo (decisão do usuário no plan).

## 2. `planejarTransicao({ grupo, acao, texto, ator, agora })`

Tabela única (D-05). `envio` = `grupo.moderacao?.envio ?? 0`.

| acao | de (filtro `status`) | condição extra no filtro | para | `$set` além de status | notificar |
| --- | --- | --- | --- | --- | --- |
| `aprovar` | `em_aprovacao` | — | `ativo` | `aprovacao {manual, em, porId}`, `revisaoPendente: false`, `ultimaDecisao` | `dono` |
| `pedir_ajuste` | `em_aprovacao` | — | `ajustes` | `ultimaDecisao {texto}` | `dono` |
| `rejeitar` | `em_aprovacao` | — | `rejeitado` | `ultimaDecisao {texto}` | `dono` |
| `aprovar_automatico` | `em_aprovacao` | `'moderacao.envio': envioEsperado` | `ativo` | `aprovacao {automatica, porId: null}`, `revisaoPendente: true`, `ultimaDecisao` | `dono` |
| `confirmar_revisao` | `ativo` | `'moderacao.revisaoPendente': true` | `ativo` | `revisaoPendente: false`, `revisao {confirmada}` | — |
| `reprovar_revisao` | `ativo` | `'moderacao.revisaoPendente': true` | `cancelado` | `revisaoPendente: false`, `revisao {reprovada}`, `cancelamento {origem: 'cotea', motivo}`, `ultimaDecisao` | `dono_e_membros` |
| `cancelar` | `ativo` | — | `cancelado` | `revisaoPendente: false`, `cancelamento {origem: 'cotea', motivo}`, `ultimaDecisao` | `dono_e_membros` |
| `reenviar` | `ajustes` | — | `em_aprovacao` | `envio: envio + 1` (valor calculado, não `$inc`), `enviadoEm: agora` | — |
| `desistir` | `$in: ['em_aprovacao', 'ajustes']` | — | `cancelado` | `cancelamento {origem: 'dono'}` | — |

Ordem das checagens (determina o `codigo`):

1. `acao` desconhecida → 400 `acao_invalida`.
2. Ação em `ACOES_COM_TEXTO` com texto normalizado vazio → 400
   `texto_obrigatorio`; > 1000 → 400 `texto_longo`.
3. Estado atual do `grupo` (lido do banco) não casa com "de"/condição → 409
   `moderacao_conflito` (checagem antecipada, só para mensagem; a garantia real é
   o filtro do passo 3 abaixo).

Saída `ok: true`: `filtro` = `{ _id, status: de, ...condição }`, `update` =
`{ $set: { status: para, updatedAt: agora, 'moderacao.<campo>': ... },
$push: { 'moderacao.historico': { $each: [evento], $slice: -100 } } }`, e
`evento` = `{ acao, de: grupo.status, para, texto|null, porId|null, automatico,
envio: <envio após a ação>, em: agora }`.

Só `$set` e `$push` (o fake travado de testes suporta também `$inc`/`$unset`,
mas `$set` com caminho pontuado é suficiente e mais legível). Use caminhos
pontuados (`'moderacao.revisaoPendente'`) — não sobrescreva `moderacao` inteiro,
para não perder o histórico em corrida.

## 3. `executarTransicao(db, { grupoId, acao, texto, ator, agora = new Date(), ip, envioEsperado })`

```
grupo = findOne({ _id: grupoId }); if !grupo → { ok: false, http: 404 }
plano = planejarTransicao(...); if !plano.ok → { ok: false, http, body: { error, codigo } }
atualizado = findOneAndUpdate(plano.filtro, plano.update, { returnDocument: 'after' })
if !atualizado → { ok: false, http: 409, body: { codigo: 'moderacao_conflito' } }   // outro venceu
await notificarEventoModeracao(db, { grupo: atualizado, evento: plano.evento, destino: plano.notificar })
await logAudit({ action: `grupo.moderacao.${acao}`, actorId: ator.automatico ? 'sistema' : ator.id, ... })
return { ok: true, grupo: atualizado }
```

- Sem transação: uma transição é um único documento (`grupos`); notificação e
  auditoria são efeitos posteriores (FR-028: auditoria só após efetivar).
- **driver v6**: `findOneAndUpdate` devolve o documento (ou `null`), sem
  `.value` (B-06).
- Falha de notificação não desfaz a transição: logar (`console.error`) e seguir
  para a auditoria.

`notificarEventoModeracao`: destinatários `dono` = `grupo.adminId` (fallback
`adminIdString`/`admin.userId`); `dono_e_membros` = dono + `membrosGrupo` do
grupo com `status != 'banido'` e `papel != 'admin'`. Para cada um,
`insertOne({ _id: 'moderacao:<grupoId>:<evento.envio>:<acao>:<userId>', ... })`;
erro `code === 11000` é ignorado (já notificado). Textos (sem acento, como as
notificações atuais):

| acao | titulo |
| --- | --- |
| aprovar | Grupo aprovado |
| aprovar_automatico | Grupo aprovado automaticamente |
| pedir_ajuste | Ajustes solicitados no seu grupo |
| rejeitar | Grupo rejeitado |
| cancelar / reprovar_revisao | Grupo cancelado pelo Cotea |

Mensagem inclui o nome do grupo e, quando houver, o texto do admin. Para os
membros no cancelamento: "O suporte vai entrar em contato para tratar sua
participacao".

## 4. Rotina `aprovacao-automatica-grupos`

```
buscarVencidos({ agora, contexto: { db, datasExtras } }):
  if !db → []
  grupos = await db.collection('grupos').find({ status: 'em_aprovacao' }).toArray()
  return grupos
    .map(g => ({ g, vence: vencimentoAprovacao(g, { datasExtras }) }))
    .filter(x => x.vence && agora >= x.vence)
    .sort(por x.vence crescente)
    .map(({ g }) => ({ chave: `grupo:${g._id}:envio:${g.moderacao.envio}`,
                       dados: { grupoId: String(g._id), envio: g.moderacao.envio } }))

processarItem({ chave, dados, agora, contexto: { db } }):
  r = await executarTransicao(db, { grupoId: new ObjectId(dados.grupoId), acao: 'aprovar_automatico',
                                    ator: { id: 'sistema', automatico: true }, agora,
                                    envioEsperado: dados.envio })
  if r.ok → 'concluido'
  // revalidação (FR-007 da 001): reenvio, decisão manual ou outra execução venceu
  atual = findOne({ _id })
  if atual?.status === 'ativo' && atual.moderacao?.aprovacao?.tipo === 'automatica'
     && atual.moderacao.envio === dados.envio:
       // re-tentativa após queda entre gravar e notificar: renotifica (idempotente pelo _id)
       await notificarEventoModeracao(db, { grupo: atual, evento: { acao: 'aprovar_automatico', envio: dados.envio, ... }, destino: 'dono' })
  return 'ignorado'
```

Pontos contraintuitivos:

1. **A chave inclui o envio**: o reenvio cria um item novo; o item do envio
   antigo (se ainda existir pendente) é `ignorado` pelo filtro
   `'moderacao.envio'`. Nunca use só `grupo:<id>` — o executor da 001 nunca
   reprocessa item `concluido`, e um grupo reenviado ficaria sem aprovação.
2. **`find` sem `sort`/projeção no banco e filtro de prazo em JS**: o volume de
   pendentes é pequeno; `vencimentoDiasUteis` não é expressável em query. O
   executor da 001 limita itens por execução (500) e o orçamento de 45 s.
3. **Duas execuções concorrentes**: só um `findOneAndUpdate` casa; o outro cai
   no ramo de revalidação, pode renotificar (o `_id` colide e é ignorado) e
   devolve `'ignorado'`. Auditoria só no vencedor.
4. `agora` vem do executor (fixo por execução): não chame `new Date()` aqui.

Registrar em `lib/rotinas/registro.js` (`ROTINAS = [rotinaSaude,
rotinaLedgerConsistencia, rotinaAprovacaoAutomatica]`). O agendador da 001 já
dispara todas as rotinas ativas a cada execução de `/api/rotinas/executar`.

## 5. Visibilidade no servidor

`GET /api/grupos/[id]` e SSR do detalhe: carregar o grupo; se
`grupoEhPublico` → fluxo atual. Senão, obter sessão (falha → tratar como
anônimo) e calcular `ehStaff = hasRole(session, PERMISSIONS.GROUPS_TAB)`,
`ehDono` (adminId resolvido == usuário) e `ehMembroAtual`
(`membrosGrupo.findOne({ grupoId, userId, status: { $ne: 'banido' } })`). Se
`!podeVerGrupo(...)` → 404 / `{ notFound: true }`. Não diferencie "não existe"
de "não pode ver".

## 6. Atualização do execute (2026-11-26)

Acrescentado depois do plan; a tabela da §2 continua valendo para as demais ações.

| acao | de | para | `$set` além de status | notificar |
| --- | --- | --- | --- | --- |
| `encerrar` (dono, R-008) | `ativo` | `cancelado` | `revisaoPendente: false`, `cancelamento {origem: 'dono', motivo: texto opcional (até 1000)}`, `ultimaDecisao` | `membros` (só membros atuais não banidos; o dono não) |

- `ACOES_DONO` = `reenviar`, `desistir`, `encerrar`; `encerrar` está em `ACOES_TEXTO_OPCIONAL`.
- `notificarEventoModeracao` aceita o destino `membros`; a mensagem ao membro não inclui o motivo do Cotea, e no `encerrar` inclui o motivo opcional do dono.
- Fila: visão `aprovados` (`status: 'ativo'`, ordem `updatedAt` decrescente) com a ação `cancelar` (R-009).
- `lib/moderacao.js` importa `./calendario.js` com extensão (o script de migração, em Node ESM, importa o módulo direto).
