# Quickstart: Ledger segmentado e saldo sacável

Validação manual no banco de **desenvolvimento** (`usaComigo`). Rodar comandos
de `J:\Cotea` (drive maiúsculo, R-005 da 001).

## Pré-requisitos

- `.env.local` com `MONGODB_URI`/`MONGODB_DB` (não exibir valores).
- Autorização do usuário para rodar `node database/setupDatabase.js` (faz
  `collMod` em todas as coleções).
- Contas Google: uma `user` com saldo, uma `finance` ou `admin`, uma `support`.

## Checagens automatizadas

```powershell
npm test                       # suíte inteira, inclui contratos 001 e 002
npm run test:contrato
.\.planning\scripts\powershell\check-contract-tests.ps1 -Slug 002-ledger-segmentado
.\.planning\scripts\powershell\check-contract-tests.ps1 -Slug 001-rotinas-agendadas
npm run lint
npm run build                  # parar o dev server antes (mesma pasta .next)
```

## 1. Migração (US1-AC5, SC-001)

1. `node --env-file=.env.local scripts/migrar-ledger-categorias.js` (dry-run):
   lista as 3 carteiras com total/disponível antes e depois — devem ser iguais;
   a carteira `11a282cf…` deve mostrar `0.68` (não `0.6799…`) nos dois.
2. `node --env-file=.env.local scripts/migrar-ledger-categorias.js --aplicar`.
3. Rodar de novo com `--aplicar`: `0 documentos alterados`.
4. Conferir: `walletTransactions.countDocuments({ categoria: { $exists: false } })` = 0
   e `({ organizacaoId: { $exists: false } })` = 0.
5. Com autorização: `node database/setupDatabase.js` (validator novo, índices,
   conta `plataforma`). Conferir `wallets.findOne({ _id: 'plataforma' })`.

## 2. Carteira do usuário (US1, US2)

1. Logar como `user`, abrir `/wallet`: disponível em destaque igual ao de
   antes; sem linhas de bloqueado se só houver saldo pessoal (US2-AC1).
2. Depositar R$ 10 por PIX simulado (`/wallet/add`) → disponível +10.
   Reenviar a confirmação do mesmo pagamento → saldo não muda.
3. Sacar R$ 5 (`/wallet/withdraw`) → disponível −5, "Saque em andamento R$ 5,00".
4. Tentar sacar mais que o disponível → "Saldo insuficiente para saque", nada gravado.
5. Concorrência real (FR-008, SC-002): com disponível D, disparar 2 `POST
   /api/withdraw/create` simultâneos de valor > D/2 (DevTools: dois `fetch` no
   mesmo `Promise.all`) → um 201, um 400; disponível ≥ 0.
6. Caução simulada (US2-AC2/AC3): em dois grupos reais G1 e G2,
   `node --env-file=.env.local scripts/semear-ledger-teste.js <walletId> caucao <G1> 12.34`
   e o mesmo com `<G2> 5` (script só de desenvolvimento, T023; grava pelo
   núcleo com `operacaoId: teste:<uuid>` e `source: 'teste'`) → `/wallet` mostra
   "Em caução R$ 17,34", o nome e o valor de cada grupo e a explicação;
   disponível inalterado. Ao final, `... semear-ledger-teste.js --remover <walletId>`
   apaga só os lançamentos `source: 'teste'`.

## 3. Saque pelo financeiro (US1-AC4, US3)

1. Logar como `finance`, abrir `/admin/withdrawals`: no saque pendente,
   "Ver saldo do usuário" mostra disponível e saque em andamento (US3-AC1).
2. Rejeitar → usuário volta a ter o disponível; aprovar outro → total cai.
   Repetir a ação → "Saque ja finalizado". Resposta 200 (não 400/404 como antes, B-06).
3. Seção "Receita do Cotea": total R$ 0,00 e lista vazia (conta começa vazia).
4. Logar como `support`: `GET /api/withdraw/resumo-usuario?withdrawalId=…` e
   `GET /api/admin/plataforma/receita` → 403 (US3-AC3). Idem como `user`.
5. `auditLogs`: `withdrawal.requested`, `withdrawal.approved`/`rejected`, `wallet.credit`.

## 4. Conferência diária (US4)

1. `/admin?tab=rotinas`: rotina `ledger-consistencia` listada; "Executar
   agora" → sucesso, 0 alertas (US4-AC1).
2. Inserir à mão um lançamento de teste `{ categoria: 'caucao', type: 'debit',
   amount: 1, status: 'confirmed', grupoId: 'x', organizacaoId: null, walletId: <teste> }`
   (categoria negativa). Como o item do dia já foi concluído, usar "Reexecutar"
   no item → notificação "Inconsistência no ledger" para cada admin + auditoria
   `ledger.inconsistencia`; nada corrigido (US4-AC2). Apagar o lançamento de teste.

## Pre-acceptance (constitution)

- Build, lint e `npm test` verdes; travas 001 e 002 íntegras.
- Schemas (`walletTransactions`, `wallets`) e índices atualizados em
  `database/schemas/`, `setupDatabase.js` e `setup-indexes.js`.
- Nenhuma variável de ambiente nova.
- Consumidores de `/api/wallet/balance` (`pages/wallet/index.js`,
  `pages/assinatura/pagamento.js`) conferidos.
