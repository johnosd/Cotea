# Handoff — 004-cadastro-financeiro (sdd-plan → sdd-execute)

## Contexto

- Repositório `J:\Cotea`, branch `feature/godfiles`. Next.js 14 Pages Router + MongoDB (driver 6) + NextAuth (Google/JWT), Vitest.
- Próximo comando: `/sdd-execute 004-cadastro-financeiro`. Backlog: **Planejada** (0/58 tasks; o total inclui o checklist de release).
- Arquivos do plan ainda **não commitados**: `sdd/specs/004-cadastro-financeiro/**`, os stubs (`lib/cadastro-financeiro.js`, `lib/cadastro-financeiro-servidor.js`, `lib/cep.js`, `hashCPF` em `lib/encryption.js`, `pages/api/perfil/cadastro-financeiro.js`), `tests/contract/004-cadastro-financeiro.contract.test.js` e `.planning/backlog.md`.

## O que a feature entrega

- **US1 (P1)** — Perfil valida CPF (dígito verificador, único entre contas) e endereço (CEP consultado); CPF gravado só cifrado + `cpfHash`, **travado** e exibido **mascarado** depois de salvo; salvar o perfil nunca apaga o CPF (bug atual).
- **US2 (P1)** — Gate no servidor: pagar assinatura (qualquer meio, inclusive saldo), depósito PIX, saque, **uso de saldo (`wallet/pay`, decisão D-11)** e criar grupo recusam cadastro incompleto com 409 `cadastro_financeiro_incompleto` + `pendencias`, antes de qualquer efeito.
- **US3 (P2)** — Formulário embutido (`components/CadastroFinanceiroForm.js`) nas cinco telas; a ação continua após salvar, sem perder dados.
- **US4 (P2)** — PIX e saque **não pedem mais CPF/chave**: usam o CPF do perfil (o do corpo é ignorado). Decisão do usuário.
- **US5 (P3)** — Só **admin** corrige CPF (motivo obrigatório, auditoria sem CPF; não corrige o próprio).
- **US6 (P3)** — Migração: CPF em texto puro → cifrado + hash; inválido → `cpfLegadoInvalido`; repetidos → conflito reportado.
- Usuário **bloqueado** continua podendo completar cadastro, pagar, entrar, depositar e sacar; só não cria grupo (já implementado pelo B-05).

## Leitura obrigatória, em ordem

1. `spec.md` — histórias, FR-001..022, 14 clarificações da sessão 2026-11-25.
2. `plan.md` — Decisões Invariantes D-01..D-12 (gate, hash, CEP no servidor, formulário embutido) e riscos R-001..R-008.
3. `tasks.md` — T001..T044 por fase, com contrato por fase.
4. `logic/cadastro.md` — regras exatas de CPF, endereço, `avaliar`, `planejar` e migração. **Rua e bairro nunca vêm do CEP no servidor.**
5. `data-model.md` — `cpfHash`, `cpfLegadoInvalido`, `endereco.cepConfirmado`, índice `cpfHash_unico`, ações de auditoria.
6. `contracts/api-cadastro-financeiro.md` — formatos de resposta, ordem das checagens nos handlers, consumidores a atualizar.
7. `quickstart.md` — migração e roteiro manual.
8. `.planning/memory/constitution.md`.

## Testes de contrato

- `tests/contract/004-cadastro-financeiro.contract.test.js` — 5 testes, travado (`contract-tests.lock`):
  - "valida CPF…" e "valida o endereço…" → Fase 2 (T001)
  - "PUT/GET do cadastro…" → Fase 3 (T009, depende de T002/T004)
  - "…recusam cadastro incompleto sem nenhum efeito" → Fase 4 (T013-T018)
  - "…gravam o CPF do perfil…" → Fase 6 (T028/T029)
- Rodar: `npx vitest run tests/contract/004-cadastro-financeiro.contract.test.js` (de `J:\Cotea`).
- Integridade: `.\.planning\scripts\powershell\check-contract-tests.ps1 -Slug 004-cadastro-financeiro`.
- Outras travas que podem quebrar: nenhuma das 001-003 chama os handlers tocados; rode `npm run test:contrato` no fim mesmo assim.
- Vermelho confirmado no plan: 3× `Error: not implemented`, `pay: expected 404 to be 409`, `expected '11144477735' to be '52998224725'`.

## Stubs criados

- `lib/cadastro-financeiro.js` — constantes **reais** (`CODIGO_CADASTRO_INCOMPLETO`, `PENDENCIAS`, `UFS`, `STATUS_CEP`); funções lançam `not implemented`.
- `lib/cadastro-financeiro-servidor.js` — só `verificarCadastroFinanceiro` (stub). Adicionar `salvarCadastroFinanceiro` e `resumoCadastroFinanceiro` (T004).
- `lib/cep.js` — `consultarCep` (stub).
- `lib/encryption.js` — `hashCPF` (stub), o resto inalterado.
- `pages/api/perfil/cadastro-financeiro.js` — handler stub.

## Armadilhas já mapeadas

- **Posição do gate** (contrato 3): logo após sessão/`contaValidada` (e bloqueio, em `POST /api/grupos`), **antes** de ler o grupo ou validar o corpo — senão o `pay` devolve 404 e o teste falha.
- O contrato 3 mocka `lib/cadastro-financeiro-servidor`: os handlers precisam importar `verificarCadastroFinanceiro` **desse módulo** (caminho relativo `../../../lib/cadastro-financeiro-servidor`).
- O contrato 4 usa a implementação **real** do gate via `vi.importActual`; `lib/mongodb` é mockado (`getDb` e o `default` com `db()` devolvem o banco em memória). O endpoint pode usar qualquer um dos dois.
- `getServerSession` é mockado tanto em `next-auth` quanto em `next-auth/next`.
- `hashCPF` normaliza para dígitos (`hashCPF('529.982.247-25') === hashCPF('52998224725')`).
- O banco em memória (`tests/helpers/db-grupos-memoria.js`) só tem `$set` e `$ne/$in/$exists`; pode ser **estendido** (não é travado) se faltar `$unset` etc.
- `setupDatabase.js` e `setup-indexes.js` precisam do índice `cpfHash_unico` com opções idênticas: `tests/bugs/b09-setup-indexes-conflito.test.js` compara os dois.
- Os testes `tests/bugs/b04-*`, `b05-*`, `pay-aceita-fatura-estornada`, `tests/preco/handler-pay`, `handlers-grupos` quebram com o gate: mockar o módulo do gate como `{ ok: true, cpf, usuario }` (T020) **sem** mudar as asserções.
- **`.env.local` aponta para o banco de produção.** Migração (T042), `setupDatabase.js` e testes manuais que gravam só com autorização explícita do usuário; dados de teste com `@example.invalid` e limpeza no fim.
- **Nunca rodar `npm run build` com o `next dev` ligado**: o build sobrescreve `.next` e o dev passa a responder 500. Peça ao usuário para parar o dev (o auto mode bloqueia matar o processo dele).
- Mensagens em português sem acento, como no resto da API; `atualizarPerfil` mantém `message` (não `error`).
- Nunca imprimir CPF (nem em log, auditoria ou relatório da migração).

## Pendências do Analyze

- **A1 · MEDIUM** — D-11 inclui `wallet/pay` no gate, mas FR-011 e US2 da spec citam só "pagamento de assinatura". Recomendação: emendar FR-011/US2 para "pagamento (assinatura ou uso de saldo)" na Clarifications, ou o usuário decidir remover `wallet/pay` do gate (exigiria mudar o contrato 3).
- **A2 · LOW** — FR-021 (sem exceção para antigos) e FR-022 (registros antigos intactos) não têm teste próprio; ficam cobertos pelo desenho (gate para todos; migração não toca `payments`/`withdrawals`). Conferir no converge.
- **A3 · LOW** — US3 sem teste automatizado (o projeto não tem infraestrutura de UI); validação manual em T027/T043.
- **A4 · LOW** — T042 depende de autorização para gravar no banco de produção; sem ela, o índice único não é criado e o converge fica pendente.

## Gate de pronto

- Contratos 5/5 verdes + `check-contract-tests.ps1 -Slug 004-cadastro-financeiro` íntegro (e 001-003 íntegros).
- `npm test`, `npm run lint`, `npm run build` (com o dev parado).
- `quickstart.md` passos 1-6; migração aplicada e índice criado (T042) com autorização.
- Docs no Polish: `.docs/regras-negocio-v2.md` (T040), `CLAUDE.md` e nota na V2-17 do backlog (T041).
- Validação em navegador/Playwright das telas é **gate** (sem testes de UI no projeto).
