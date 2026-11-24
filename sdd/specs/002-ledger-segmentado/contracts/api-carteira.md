# Contrato de API: carteira segmentada

Todas as rotas usam `getServerSession` e recarregam do banco o que decidem.
Mensagens de erro em português, no campo `error`, como as atuais.

## `GET /api/wallet/balance` (alterada, compatível)

Usuário autenticado; sempre a própria carteira.

```json
{
  "walletId": "17789ed2-…",
  "balance": 130.0,
  "available": 100.0,
  "blockedDebits": 0,
  "pendingTotal": 0,
  "returnedTotal": 0,
  "resumo": {
    "total": 130.0,
    "disponivel": 100.0,
    "sacavel": 100.0,
    "saqueEmAndamento": 0,
    "categorias": {
      "caucao":           { "valor": 30.0, "porGrupo": [{ "grupoId": "665f…", "grupoNome": "Netflix família", "participacaoId": "…", "valor": 30.0 }] },
      "retido_entrada":   { "valor": 0, "porGrupo": [] },
      "recebivel_retido": { "valor": 0, "porGrupo": [] },
      "disputa":          { "valor": 0, "porGrupo": [] }
    }
  }
}
```

- Campos antigos mantidos com o mesmo significado (`balance` = total,
  `available` = disponível, `blockedDebits` = saque em andamento) — consumidores:
  `pages/wallet/index.js`, `pages/assinatura/pagamento.js`.
- `grupoNome` é enriquecido no servidor (`grupos._id` é `ObjectId`; `grupoId`
  no ledger é string — normalizar). Grupo apagado → `grupoNome: null`.
- `receitaTaxa` não aparece para usuário.

## `GET /api/withdraw/resumo-usuario?withdrawalId=<id>` (nova)

`hasRole(session, PERMISSIONS.LEDGER_FINANCEIRO)` (`finance`, `admin`); senão
403 `Apenas administradores ou financeiro podem ver o saldo do usuario`.

- 400 `withdrawalId obrigatorio`; 404 `Saque nao encontrado`.
- 200: `{ withdrawalId, userId, walletId, resumo }` (mesmo formato de `resumo` acima, com `grupoNome`).
- Não devolve CPF.

## `GET /api/admin/plataforma/receita?limite=50` (nova)

`PERMISSIONS.LEDGER_FINANCEIRO`; senão 403.

- 200: `{ walletId: 'plataforma', total: 0, lancamentos: [{ _id, amount, source, referenceId, operacaoId, organizacaoId, createdAt }] }`
  ordenados por `createdAt` desc, `limite` 1–200 (padrão 50).
- Conta vazia é resposta válida (`total: 0`, `lancamentos: []`).

## Rotas existentes que mudam por dentro (respostas iguais)

| Rota | Mudança |
| --- | --- |
| `POST /api/pix/simulated/confirm` | crédito `pessoal` via núcleo, `operacaoId: pix:<paymentId>`, status do pagamento na mesma transação; `logAudit('wallet.credit')` |
| `POST /api/wallet/pay` | débito `pessoal` via núcleo (`uso_saldo:<uuid>`); 400 `Saldo insuficiente` vem de `SaldoInsuficienteError` |
| `POST /api/assinaturas/pay` | débito `pessoal` + `markInvoicePaid` na mesma operação (`assinatura_grupo:<invoiceId>`); sem saldo → `aguardando_recarga` com `faltante` de `SaldoInsuficienteError.disponivel` |
| `POST /api/assinaturas/refund` | crédito `pessoal` + `markInvoiceRefunded` na mesma operação (`estorno_assinatura:<invoiceId>`). Quem pode chamar não muda (B-02 fora do escopo) |
| `POST /api/withdraw/create` | reserva (`blocked`, `pessoal`) + `insertWithdrawal` na mesma operação (`saque:<withdrawalId>`, id gerado antes); checagem de saldo dentro da transação; `logAudit('withdrawal.requested')` |
| `POST /api/withdraw/approve` / `reject` | `liquidarReserva` + status do `withdrawals` na mesma transação; sem `.value` (B-06 nestes dois arquivos); `alterados: 0` com saque já finalizado → 400 `Saque ja finalizado` |
