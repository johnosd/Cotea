# Quickstart: Regra única de preço por vaga

Validação manual no banco de **desenvolvimento** (`usaComigo`). Rodar
comandos de `J:\Cotea` (drive maiúsculo — de `j:\` o Vitest carrega duas
vezes e falha).

## Pré-requisitos

- `.env.local` com `MONGODB_URI`/`MONGODB_DB` (não exibir valores).
- Dev server: `npm run dev` (ou `.tools/start.sh`).
- Contas Google: uma `admin` do sistema (cria/edita pela UI) e uma `user`
  com conta validada e saldo na carteira.

## Checagens automatizadas

```powershell
npm test                          # suíte inteira, inclui contratos 001, 002 e 003
npm run test:contrato
.\.planning\scripts\powershell\check-contract-tests.ps1 -Slug 003-preco-por-vaga
.\.planning\scripts\powershell\check-contract-tests.ps1 -Slug 002-ledger-segmentado
.\.planning\scripts\powershell\check-contract-tests.ps1 -Slug 001-rotinas-agendadas
npm run lint
npm run build                     # parar o dev server antes (mesma pasta .next)
```

## 1. Migração (US4, SC-002, SC-005)

1. `node --env-file=.env.local scripts/migrar-precos-grupos.js` (dry-run):
   lista os 5 grupos. Esperado: "Claude Pro" 180/4 → 47,25 / 45,00 / 2,25;
   "NeoReader" 100/4 → 26,25 / 25,00 / 1,25; "Canva Pro" 85/2 → 44,63 /
   42,50 / 2,13; "heygen" 200/20 → 10,50 / 10,00 / 0,50; "Streaming CCPLAY"
   70/2 → 36,75 / 35,00 / 1,75. 0 inválidos. Nada gravado.
2. `... --aplicar` → 5 atualizados; 5 entradas `grupo.preco_migrado` em
   `auditLogs`.
3. Rodar `--aplicar` de novo → `0 alterados`.
4. Conferir que as 5 faturas existentes (`invoices`) têm o mesmo `amount` de
   antes (FR-016).

## 2. Criação (US1, US3-AC1/AC2)

1. `/admin/grupos/novo`: digitar valor total `40` e capacidade `4`. A prévia
   mostra "membro paga R$ 10,50", "você recebe R$ 10,00 por membro", "taxa
   Cotea R$ 0,50", "sua parte R$ 10,00 (sem taxa)". Sem campo editável de
   vagas reservadas.
2. Valor `10` e capacidade `3` → prévia 3,50 / 3,33 / 0,17.
3. Capacidade `1` → erro de capacidade mínima no formulário (e, forçando via
   DevTools/console um `fetch` POST, 400 do servidor com
   `campo: 'capacidade_minima'`).
4. Salvar 40/4 → no Mongo: `valorPorVaga 10.5`, `repassePorVaga 10`,
   `taxaPorVaga 0.5`, `precoValido true`, `vagasReservadasAdmin 1`,
   `vagasDisponiveis 3`.
5. Via console do navegador (logado como admin), POST `/api/grupos` com
   `valorPorVaga: 1` e `vagasReservadasAdmin: 3` → gravado 10,50 e 1 (US1-AC2,
   US1-AC6).

## 3. Edição (US1-AC4/AC5)

1. Grupo "Streaming CCPLAY" (dono + 1 membro): PUT `/api/grupos/<id>` com
   `capacidadeTotal: 1` → 400 capacidade mínima; com um grupo de dono + 3
   membros, `capacidadeTotal: 3` → 400 `capacidade_participantes`.
2. PUT com `valorTotal: 90` e capacidade igual → preço recalculado (47,25 /
   45,00 / 2,25 para C = 2); faturas antigas inalteradas; `auditLogs`
   `grupo.updated` com `preco.antes`/`preco.depois`.
3. `/admin/grupos/<id>`: "Vagas reservadas" aparece como informação fixa
   "1 (vaga do dono)"; a prévia da decomposição bate com o gravado.

## 4. Exibição e cobrança (US2, US3, SC-003, SC-004)

1. Home (`/`), página do grupo (`/grupos/<id>`), lista admin
   (`/admin/grupos`) e checkout (`/assinatura/pagamento?grupoId=…`) mostram o
   mesmo valor por vaga com a nota "inclui taxa Cotea de 5%" (exceto lista
   admin, que pode mostrar a decomposição).
2. Abrir o checkout com `&preco=1` na URL → continua mostrando e cobrando o
   valor do grupo.
3. Pagar com saldo → fatura nova com `amount` = valor por vaga e
   `composicao: { repasseDono, taxaCotea }` somando `amount`; um único
   lançamento `pessoal` de débito; nenhum `receita_taxa`.
4. No Mongo, setar `precoValido: false` num grupo de teste → home/página
   mostram "Preco indisponivel"; POST `/api/assinaturas/pay` → 409
   `preco_indisponivel`, nenhuma fatura criada. Reverter editando o grupo.
