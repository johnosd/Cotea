# Contratos de API alterados (003-preco-por-vaga)

Todas as mensagens de erro seguem o padrão atual (português sem acento,
`{ error }`). Campos novos de resposta são aditivos.

## POST `/api/grupos` (criação) — `pages/api/grupos/index.js`

Body: igual ao atual. **Ignorados**: `valorPorVaga`, `vagasReservadasAdmin`,
`vagasDisponiveis`, e qualquer `repassePorVaga`/`taxaPorVaga`.

| Situação | Status | Body |
| --- | --- | --- |
| `capacidadeTotal` ausente, não inteira ou < 2 | 400 | `{ error: <mensagem de calcularPrecoVaga>, campo: 'capacidade_minima' }` |
| `valorTotal` ausente, ≤ 0, não numérico ou > 2 casas | 400 | `{ error, campo: 'valor_total_invalido' }` |
| repasse < R$ 0,01 | 400 | `{ error, campo: 'repasse_minimo' }` |
| sucesso | 201 (como hoje) | resposta atual + `preco: { valorPorVaga, repasse, taxa }` |

Grava os campos de `data-model.md` (`precoValido: true`,
`vagasReservadasAdmin: 1`, `vagasDisponiveis: C − 1`).

## PUT `/api/grupos/[id]` (edição) — `pages/api/grupos/[id].js`

Autorização inalterada (dono do grupo ou membro `papel: 'admin'`). Recalcula
o preço a partir de `valorTotal`/`capacidadeTotal` do body, mesmas recusas
400 da criação, e mais:

| Situação | Status | Body |
| --- | --- | --- |
| `capacidadeTotal` < participantes atuais | 400 | `{ error: <mensagem de validarNovaCapacidade>, campo: 'capacidade_participantes' }` |
| sucesso | 200 | `{ message, preco: { valorPorVaga, repasse, taxa } }` |

`vagasDisponiveis = max(C − participantes, 0)` calculado no servidor.
Edição com `T`/`C` válidos em grupo `precoValido: false` o regulariza.

## GET `/api/grupos` e GET `/api/grupos/[id]`

Sem mudança de código: os documentos passam a trazer `repassePorVaga`,
`taxaPorVaga`, `precoValido`. Consumidores DEVEM usar `precoDoGrupo(grupo)`
de `lib/preco.js` em vez de ler `valorPorVaga` cru.

## POST `/api/assinaturas/pay` — `pages/api/assinaturas/pay.js`

- Projeção do grupo passa a incluir `valorPorVaga, repassePorVaga,
  taxaPorVaga, precoValido`.
- `getGrupoPreco` e o fallback `req.body.amount` são **removidos**.

| Situação | Status | Body |
| --- | --- | --- |
| sem `invoiceId` e `precoDoGrupo(grupo).valido === false` | 409 | `{ error: 'Preco indisponivel para este grupo', codigo: 'preco_indisponivel' }` — nada é criado nem debitado |
| sem `invoiceId`, preço válido | 200 (como hoje) | fatura criada com `amount = valorPorVaga` e `composicao: { repasseDono, taxaCotea }` |
| com `invoiceId` (fatura existente não paga) | 200 (como hoje) | debita **`invoice.amount`** (congelado), não o preço atual; `composicao` da fatura não muda |

O débito no ledger continua uma única perna `pessoal` de `amount`
(`operacaoId: assinatura_grupo:<invoiceId>`). **Nenhum** lançamento de
`receita_taxa` ou de repasse (V2-06/V2-11).

`createInvoice` (`lib/invoices.js`) aceita `composicao` opcional e o grava
quando presente (valida `repasseDono + taxaCotea === amount` em centavos).

## POST `/api/grupos/[id]/participar` — `pages/api/grupos/[id]/participar.js`

Projeção passa a incluir os campos de preço; se `precoDoGrupo(grupo).valido
=== false` → 409 `{ error: 'Preco indisponivel para este grupo', codigo:
'preco_indisponivel' }`.

## POST `/api/grupos/[id]/join` — sem recusa por preço

A fatura já está paga quando o join roda; recusar aqui prenderia o dinheiro
(R-003). Só muda a leitura de reservadas: usa `VAGAS_DONO` em vez de
`grupo.vagasReservadasAdmin`.

## Página `/assinatura/pagamento` (consumidor)

Deixa de usar `router.query.preco` como valor: busca `GET
/api/grupos/[grupoId]` e usa `precoDoGrupo`. Os links que montam a URL
(`pages/grupos/[id].js:255`, `pages/assinatura/relacionamento.js:15`, e o
`append('preco', …)` em `pagamento.js:243`) deixam de enviar `preco`.
