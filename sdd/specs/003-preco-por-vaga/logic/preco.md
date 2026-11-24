# Lógica: regra única de preço por vaga

Implementação em `lib/preco.js` (stub criado pelo plan). Módulo **puro**: sem
`lib/mongodb.js`, sem `mongodb`, sem Node APIs — é importado por handlers,
pelo script de migração **e por páginas cliente** (prévia do formulário).

## Por que centavos inteiros e fórmula inteira

`Math.round(T / C * 1.05 * 100)` erra em casos reais por ponto flutuante:
`T = 3,30, C = 3` dá 115 (correto: 1,155 → **116**); `T = 0,57, C = 2` dá
repasse 28 (correto: 0,285 → **29**). O contrato trava esses casos. Por isso
toda a conta é feita em centavos inteiros, com divisão arredondada
meio-para-cima exata:

```js
// arredonda n/d meio-para-cima, n >= 0, d > 0, ambos inteiros
const dividirArredondando = (n, d) => Math.floor((2 * n + d) / (2 * d));
```

Os inteiros ficam muito abaixo de 2^53 para qualquer valor plausível
(`T` até R$ 10 milhões → `t * 105 * 2` ≈ 2·10^11).

## calcularPrecoVaga({ valorTotal, capacidade })

```
1. C = Number(capacidade)
   se capacidade é '', null, undefined, não inteiro, ou C < CAPACIDADE_MINIMA
     → { valido:false, motivo:'capacidade_minima',
         mensagem:'Capacidade minima de 2 (1 vaga do dono + 1 vaga de membro).' }
2. t = paraCentavos(valorTotal)
   paraCentavos: null/undefined/'' → inválido; String(v).replace(',', '.').trim();
   Number(...) finito e > 0; c = Math.round(n*100); se |n*100 − c| > 1e-6
   (mais de 2 casas) → inválido
   inválido → { valido:false, motivo:'valor_total_invalido',
               mensagem:'Informe o valor total (maior que zero, ate 2 casas decimais).' }
3. repasse = dividirArredondando(t, C)
   se repasse < 1 → { valido:false, motivo:'repasse_minimo',
                      mensagem:'Valor total muito baixo para esta capacidade: cada vaga precisa render ao menos R$ 0,01 ao dono.' }
4. valorPorVaga = dividirArredondando(t * (100 + TAXA_COTEA_PERCENTUAL), 100 * C)
5. taxa = valorPorVaga − repasse            // absorve o resíduo; pode ser 0
6. → { valido:true, valorTotal:t/100, capacidade:C,
       valorPorVaga:valorPorVaga/100, repasse:repasse/100, taxa:taxa/100,
       parteDono:repasse/100 }
```

Ordem das checagens: capacidade → valor total → repasse (o contrato testa
cada motivo isolado; manter esta ordem evita ambiguidade quando os dois estão
errados). Mensagens sem acento, no padrão das mensagens atuais das APIs.

## precoDoGrupo(grupo)

Única fonte de preço para **cobrança e exibição** (FR-010/011/014). Sem
fallback para `valorTotal`, `preco`, `T/C` ou query string.

```
se !grupo ou grupo.precoValido !== true → { valido:false }
v, r, x = Number(grupo.valorPorVaga), Number(grupo.repassePorVaga), Number(grupo.taxaPorVaga)
se algum não finito, ou v <= 0, ou r < 0.01, ou x < 0,
   ou round(r*100) + round(x*100) !== round(v*100) → { valido:false }
→ { valido:true, valorPorVaga:v, repasse:r, taxa:x }
```

Retorno **exato** `{ valido, valorPorVaga, repasse, taxa }` (o contrato usa
`toEqual`): não acrescentar campos.

## validarNovaCapacidade({ capacidade, membrosAtivos })

```
participantes = Number(membrosAtivos) + VAGAS_DONO
capacidade >= participantes → { valido:true, participantes }
senão → { valido:false, participantes,
          mensagem:`Capacidade nao pode ficar abaixo dos ${participantes} participantes atuais (dono + membros).` }
```

`membrosAtivos` é contado pelo handler: `membrosGrupo` do grupo com
`papel !== 'admin'` e `status !== 'banido'` (mesmo critério de
`pages/api/grupos/[id]/join.js`). O dono conta sempre 1, mesmo que o
documento `membrosGrupo` do dono não exista (caso real: grupo "heygen" na base
de desenvolvimento).

## planejarMigracaoPrecos(grupos)

```
para cada g:
  r = calcularPrecoVaga({ valorTotal: g.valorTotal, capacidade: g.capacidadeTotal })
  alvo = r.valido
    ? { valorPorVaga:r.valorPorVaga, repassePorVaga:r.repasse, taxaPorVaga:r.taxa,
        precoValido:true, vagasReservadasAdmin:1 }
    : { precoValido:false, vagasReservadasAdmin:1 }      // NUNCA valorPorVaga/T/C
  diferente = algum campo de alvo !== g[campo] (comparar Number() para números)
  acao = !r.valido ? 'invalido' : diferente ? 'atualizar' : 'inalterado'
  set = diferente ? alvo : null
  item = { _id:g._id, acao, set, ...(r.valido ? {} : { motivo:r.motivo }) }
```

Inválido continua com `acao: 'invalido'` na 2ª execução (aparece no
relatório), mas com `set: null` — idempotência (SC-005). Valores vindos do
Mongo podem ser `Double`/`Int32` do driver: o planner recebe números JS (o
driver já desserializa assim), mas a comparação usa `Number()` por segurança.

## Uso nos handlers (resumo; detalhes em `contracts/api-grupos.md`)

```js
const preco = calcularPrecoVaga({ valorTotal: req.body.valorTotal, capacidade: req.body.capacidadeTotal });
if (!preco.valido) return res.status(400).json({ error: preco.mensagem, campo: preco.motivo });
// grava: valorTotal: new Double(preco.valorTotal), capacidadeTotal: new Int32(preco.capacidade),
//        valorPorVaga: new Double(preco.valorPorVaga), repassePorVaga: new Double(preco.repasse),
//        taxaPorVaga: new Double(preco.taxa), precoValido: true,
//        vagasReservadasAdmin: new Int32(VAGAS_DONO)
// req.body.valorPorVaga / vagasReservadasAdmin / vagasDisponiveis: IGNORADOS
```
