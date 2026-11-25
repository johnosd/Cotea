# Quickstart: 004-cadastro-financeiro

## Pré-requisitos

- `.env.local` com `MONGODB_URI`, `MONGODB_DB`, `ENCRYPTION_KEY` (só os nomes;
  nunca imprimir valores). **O banco do `.env.local` é o de produção** — todo
  passo que grava precisa de autorização do usuário.
- `next dev` na porta 3000 para os passos manuais. **Não rodar `npm run build`
  com o `next dev` ligado** (o build sobrescreve `.next` e quebra o dev server
  com `Cannot find module './chunks/vendor-chunks/next.js'`): parar o dev,
  buildar, apagar `.next` e subir o dev de novo.

## Checagens automatizadas (de `J:\Cotea`, drive maiúsculo)

```powershell
npx vitest run tests/contract/004-cadastro-financeiro.contract.test.js   # 5/5
.\.planning\scripts\powershell\check-contract-tests.ps1 -Slug 004-cadastro-financeiro
npm test
npm run lint
npm run build      # com o next dev parado
```

## Migração (US6) — com autorização do usuário

```powershell
node --env-file=.env.local scripts/migrar-cpf-usuarios.js            # dry-run: relatório, sem gravar
node --env-file=.env.local scripts/migrar-cpf-usuarios.js --aplicar  # grava
node --env-file=.env.local scripts/migrar-cpf-usuarios.js            # deve mostrar 0 ações
node database/setupDatabase.js                                       # cria o índice único cpfHash
```

Esperado na base atual (4 usuários): 1 CPF em texto puro → `criptografar`;
3 sem CPF; 0 conflitos. Se houver conflito, **parar** e reportar ao usuário
antes do `setupDatabase.js` (o índice único falharia).

## Cenário ponta a ponta (manual, Playwright ou navegador)

Usar usuários de teste marcados (`@example.invalid`) e limpá-los no fim, como
na verificação dos bugs de 2026-11-25.

1. **Gate (US2)**: com usuário sem CPF/endereço, chamar `POST /api/assinaturas/pay`,
   `/api/pix/simulated/create`, `/api/withdraw/create`, `/api/wallet/pay` e
   `/api/grupos` → 409 `cadastro_financeiro_incompleto` com `pendencias`;
   saldo, faturas, saques e grupos inalterados.
2. **Inline (US3)**: em `/assinatura/pagamento` clicar "Finalizar pagamento" →
   aparece o formulário só com os campos pendentes → salvar → o pagamento
   conclui sem reescolher grupo/meio. Repetir em `/wallet/add`,
   `/wallet/withdraw`, `/admin/grupos/novo` (dados do grupo preservados) e
   `/wallet/pay`.
3. **Perfil (US1)**: CPF com DV errado → recusado; CPF de outra conta → "CPF
   indisponível" sem revelar a conta; CPF válido → passa a aparecer
   `***.ddd.ddd-**` travado; salvar o perfil de novo não muda o CPF; CEP
   inexistente → recusado; CEP geral → cidade/UF travadas, rua/bairro
   obrigatórios; apagar a rua de um cadastro completo → recusado.
4. **PIX/saque (US4)**: recarga e checkout PIX sem campo de CPF; saque sem
   campo de chave, mostrando o CPF mascarado; no banco, `payments.pixCpf` e
   `withdrawals.pixKeyCpf` decifram para o CPF do perfil.
5. **Admin (US5)**: como admin, corrigir o CPF de um usuário de teste com
   motivo → `auditLogs` com `user.cpf_corrected` e `details.motivo`, sem CPF;
   sem motivo → 400; o próprio CPF → 403; como `support`/`finance` → 403.
6. **Bloqueado (FR-017)**: usuário bloqueado com cadastro completo paga,
   deposita e saca; criar grupo → 403 "Conta bloqueada".

## Cross-cutting (constitution)

- CPF nunca aparece completo em resposta de API ao próprio usuário nem em log.
- Consulta de CEP no servidor com timeout (≤ 3 s) — cabe no tempo de função da Vercel.
- `users.schema.json`, `setupDatabase.js` e `setup-indexes.js` atualizados juntos
  (o teste `tests/bugs/b09-setup-indexes-conflito.test.js` compara os dois scripts).
