# Bug Assessment: `pay` aceita invoiceId de fatura estornada

- **Slug**: pay-aceita-fatura-estornada
- **Criado**: 2026-11-24
- **Origem**: achado na fase Test do bug `b04-pagamento-grupo-indisponivel` (repasse do agente principal)
- **Veredito**: valid
- **Severidade**: high

## Report

`POST /api/assinaturas/pay` so trata a fatura `paga` como caso especial. Qualquer outro status (inclusive `estornada`) cai no mesmo caminho de cobranca de uma fatura aberta. Pedido: verificar o que acontece hoje ao reenviar um `invoiceId` estornado e quais outros status deveriam ser recusados.

## Symptom

Com `invoiceId` de fatura `estornada`, o handler nao recusa: reaproveita a fatura, chama `registrarOperacao({ operacaoId: 'assinatura_grupo:<invoiceId>' })` e responde 200 com `status: 'paga'` fixo (ou a empurra para `aguardando_recarga`). O esperado e recusar (409) e exigir uma fatura nova.

## Reproduction

Analise estatica do codigo (`pay.js`, `lib/ledger/ledger.js:209-214`, `lib/invoices.js`) e confirmacao por teste de handler com ledger fiel ao real (repeticao de `operacaoId` devolve `criada:false` e NAO executa `extra`):

1. Usuario paga (`assinatura_grupo:F` debitado, fatura `paga`), `join` falha, `refund` credita `estorno_assinatura:F` e marca a fatura `estornada`.
2. Cliente reenvia `POST /pay { grupoId, invoiceId: F }` (a pagina `pagamento.js` mantem `invoiceId` no estado e reenvia no retry).
3. Cenarios resultantes:
   - **A (caminho normal)**: ledger acha o debito antigo, `criada:false`, `extra` nao roda. O handler devolve 200 `status:'paga'`, `ledgerId` do debito ja estornado e `saldoAposDebito`, grava audit `assinatura.paid` falso, e a fatura segue `estornada` no banco. Nada e cobrado de novo; `join` depois responde 402 (fatura nao paga), logo nao entra sem pagar. Resposta mentirosa e auditoria falsa.
   - **B (fatura estornada sem debito `assinatura_grupo:F` no ledger, ex.: legado/pre-ledger)**: o debito e criado de novo e `markInvoicePaid` reabre a fatura `estornada` -> `paga`. Depois um novo `refund` cai em `estorno_assinatura:F` ja existente (idempotente, `criada:false`), so realinha a fatura e NAO credita: o usuario perde o valor.
   - **C (B com saldo insuficiente)**: `markInvoiceAwaitingTopUp` reescreve `estornada` -> `aguardando_recarga` sem checar status, mesmo problema de ressuscitar a fatura.
4. Status desconhecido/legado (qualquer valor fora dos 4 de `INVOICE_STATUS`) tambem segue o caminho de cobranca.

## Suspected Code Paths

- `pages/api/assinaturas/pay.js:58-63,88-97` — so `PAGA` e tratada; `estornada` e demais status passam adiante.
- `pages/api/assinaturas/pay.js:141-165` — resposta `status: PAGA` fixa e audit `assinatura.paid` mesmo quando `operacao.criada === false`.
- `lib/invoices.js:64-80,82-96` — `markInvoicePaid` / `markInvoiceAwaitingTopUp` atualizam por `_id`, sem guarda de status.
- `pages/assinatura/pagamento.js:186` — mantem o `invoiceId` no estado e o reenvia (consumidor; fora do escopo de edicao).

## Root Cause Hypothesis

Falta uma allow-list de status no `pay` para fatura existente: ele assume que toda fatura nao paga e "aberta" (aguardando_pagamento/aguardando_recarga). Confianca: high.

## Proposed Remediation

**Preferida**: em `pay.js`, logo apos carregar a fatura existente (antes de avaliar entrada/ensureWallet/ledger), decidir por status: `paga` -> segue reconciliacao 200 atual; `aguardando_pagamento` / `aguardando_recarga` -> segue; `estornada` -> 409 `fatura_estornada` ("inicie um novo pagamento"); qualquer outro -> 409 `fatura_indisponivel`. Defesa em profundidade: se o ledger devolver `criada:false` para uma fatura nao paga, nao responder `paga` (tratar como inconsistencia 409) em vez de mentir. Nao reaproveitar fatura estornada silenciosamente.

**Alternativas**:
- Ignorar a fatura estornada e emitir uma nova automaticamente: evita travar o retry, mas cobra sem a intencao explicita do `invoiceId` enviado; rejeitada. (Nota: o retry com fatura estornada ja falha hoje, via `join` 402, entao nao e regressao.)
- Guarda de status em `markInvoicePaid`/`markInvoiceAwaitingTopUp` (filtro `status: {$in:[abertos]}`): reforco em `lib/invoices.js`, mas `markInvoicePaid` roda dentro da transacao do ledger e retornar null mudaria o contrato; adiado, so se necessario.

**Files likely to change**:
- `pages/api/assinaturas/pay.js`

**Tests to add or update**:
- `tests/bugs/pay-aceita-fatura-estornada.test.js` (novo): estornada -> 409 sem novo lancamento, sem audit, fatura segue `estornada`; estornada sem debito previo (cenario B) -> 409 e sem debito; status desconhecido -> 409; `paga` -> 200 reconcilia sem lancamento; `aguardando_pagamento`/`aguardando_recarga` -> cobra normalmente e fica `paga`; fatura de outro usuario/grupo -> 404.

## Risks & Considerations

- Front (`pagamento.js`) mantem o `invoiceId` estornado no estado: apos falha de join + estorno, o retry vera 409 ate recarregar a pagina (hoje o retry ja falha, por outro erro). Follow-up de front: limpar `invoiceId` quando o estorno ocorrer ou ao receber `fatura_estornada`.
- A decisao de produto (recusar vs. emitir fatura nova automaticamente) esta registrada como decisao para o usuario.

## Open Questions

- Nenhuma bloqueante.
