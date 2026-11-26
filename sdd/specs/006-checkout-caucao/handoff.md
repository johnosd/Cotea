# Handoff: 006-checkout-caucao (sdd-plan → sdd-execute)

## Contexto

- Repositório `J:\Cotea`, branch `feature/godfiles`. Next.js 14 Pages Router +
  MongoDB (driver v6) + NextAuth v4 (JWT) + Vitest, deploy Vercel `gru1`.
- Próximo comando: `/sdd-execute 006-checkout-caucao`. Backlog: **Planejada**
  (o script conta 52 caixas porque inclui o Checklist de Release; são 41 tasks).
- Commit `b6861d2` ("v2-06", só a spec) está local, sem push. Tudo que o plan
  criou está **sem commit**. O PR #8 (005) usa esta mesma branch e estava aberto:
  um push antes do merge leva a 006 junto. Confirme com o usuário.
- Rode tudo de `J:\Cotea` (maiúsculo); de `j:\` o Vitest falha.

## O que a feature entrega

- **US1 (P1)**: `POST /api/assinaturas/pay` vira a entrada atômica (mensalidade +
  caução, participação, fatura), idempotente por `chave`.
- **US2 (P1)**: caução volta uma única vez em toda saída (membro, staff,
  encerramento, cancelamento, exclusão). **Mensalidade não volta** fora do caso
  "após completar" não lotado, mesmo sem acesso enviado (V2-12).
- **US3 (P1)**: resumo do servidor, saldo primeiro e PIX pela diferença, taxa
  zero, aceite das regras; sem escolha de método, sem cupom.
- **US4 (P2)**: `apos_completar` retém a mensalidade até lotar ou receber acesso.
- **US5 (P2)**: vínculo visível só ao dono e à equipe.
- Decisões que contrariam a expectativa: repasse e taxa **não** são lançados
  (V2-11); ciclo conta do envio do acesso (só texto, nenhuma data calculada);
  a devolução integral da caução é transitória, mas a tela mostra e registra o
  aceite das regras v2 completas.
- Publicação **única** ao final (não publique fases soltas).

## Leitura obrigatória, em ordem

1. `spec.md` — FR-001 a FR-032 e clarificações.
2. `plan.md` — D-01 a D-13, R-001 a R-010, tabela de contratos.
3. `tasks.md` — 8 fases, T001–T041.
4. `logic/checkout.md` — algoritmos (entrada, liquidação, gatilhos, rotina, migração).
5. `data-model.md` — campos novos, `operacaoId`s, índice, dados reais do banco.
6. `contracts/api-entrada.md` — ordem das checagens, códigos, telas.
7. `quickstart.md` — migração e roteiro manual.
8. `.planning/memory/constitution.md`.

## Testes de contrato

- `tests/contract/006-checkout-caucao.contract.test.js` — 5 testes: 3 na Fase 3,
  1 na Fase 4, 1 na Fase 6.
- `tests/helpers/db-transacional-memoria.js` — helper **travado** (0 testes):
  transações com snapshot e conflito de escrita; o ledger real roda por cima.
- Rodar: `npx vitest run tests/contract/006-checkout-caucao.contract.test.js`
  (vermelho confirmado: 5/5 com `Error: not implemented`; outros 430 verdes).
- Integridade: `.\.planning\scripts\powershell\check-contract-tests.ps1 -Slug 006-checkout-caucao`.
- O contrato foi validado contra um protótipo descartável (5/5 verdes; sem a
  trava do grupo o 2º falha com `[200, 200]`). O protótipo foi apagado.
- Travas que esta feature pode quebrar: **004** e **005** chamam o `pay`; **002**
  (núcleo do ledger, não altere `lib/ledger/ledger.js`). Rode `npm run test:contrato`.

## Stubs criados

- `lib/checkout.js` — `VINCULOS`, `REGRAS_CAUCAO` (versão `2026-11-26`) e
  `TAXA_MEIO_PAGAMENTO` **definitivos**; 8 funções com `not implemented`.
- `lib/checkout-servidor.js` — 4 assinaturas provisórias; pode criar
  `RecusaEntrada` e afins à vontade.
- `pages/api/assinaturas/resumo.js` — handler que só lança (T012 substitui).

## Armadilhas já mapeadas

- **Ordem do `pay`**: gate de cadastro antes de tudo (004); `grupoId` inválido →
  400 antes de olhar a `chave` (`tests/cadastro/gate-handlers` espera 400 com
  corpo vazio); elegibilidade antes de validar vínculo/aceite (005 envia só
  `grupoId` e espera `grupo_indisponivel`).
- **Reconsultar a `chave` antes de qualquer recusa** — senão o clique duplo
  responde `ja_membro` ou `resumo_desatualizado` (contrato 2).
- **Sem o `$inc` de `grupos.versaoParticipacao`** dentro do `extra` a última vaga
  vende duas vezes.
- **Dentro da transação**: toda operação com `{ session: sessao }`, em série, sem
  engolir erro do driver. No banco em memória, escrever sem sessão num documento
  que a própria transação já escreveu trava o teste até o timeout.
- **Banco em memória**: sem `$or`, `$and`, upsert ou `aggregate`.
- **`lib/mongodb` mockado no contrato** expõe só `default`, `getDb`, `getClient`,
  `getWalletByUser`, `createWallet`: o checkout não pode usar outros exports
  (`insertLedgerEntry`, `insertPayment`…).
- **`moderacao-servidor`**: `import()` dinâmico de `checkout-servidor`; há testes
  de moderação sem `lib/mongodb` mockado.
- **Contratos 4 e 5 exigem efeito na própria requisição**: devolução já feita
  quando o cancelamento responde (e 2 avisos novos ao membro: cancelamento +
  devolução); retenções liberadas quando o `pay` que lota responde.
- **Nunca grave `grupos.status`** na entrada (o `join` antigo grava; é estado de
  moderação). Ao lotar: só `lotadoEm` e `statusDetalhado`.
- **Um só crédito `pessoal` por operação** (índice único por `operacaoId` +
  carteira + categoria + tipo); o índice por `referenceId` precisa virar não único
  (T006) e a memória **não** detecta se você esquecer.
- **Testes antigos que vão quebrar** (reescrever, T014/T006):
  `tests/bugs/b04-…`, `join-reusa-fatura-vinculada`, `pay-aceita-fatura-estornada`,
  `tests/preco/handler-pay`, parte de handler do `b02`, asserção de índice do `b09`.
- **Testes que não podem mudar**: `tests/moderacao/cancelar-ssr` (prop `grupo` da
  tela de cancelar é exata) e `tests/bugs/ssr-grupo-detalhe-…` (participante
  público só com `avatar` e `nome`).
- **Banco = produção** (`usaComigo`): migração e roteiro manual só com
  autorização; o índice atual é único e a migração vem antes do deploy.

## Pendências do Analyze

- A-01 (MEDIUM): telas (FR-003, FR-007, FR-008, FR-014) sem teste automatizado —
  tratar o quickstart no navegador (T041) como gate antes do deploy.
- A-02 (MEDIUM): o texto de `REGRAS_CAUCAO` foi redigido no plan e vincula o
  membro; o usuário ainda não o revisou. Se mudar, mude `versao` (o contrato não
  fixa o texto).
- A-03 (LOW): devolução que falhar 5 vezes na rotina vira `falha_definitiva` e só
  alerta os admins, podendo passar de 1 h (FR-022) — reexecução pela aba Rotinas;
  aceitar ou ampliar.
- A-04 (LOW): o aviso de cancelamento pelo Cotea diz que o suporte vai tratar a
  participação, enquanto a caução volta sozinha — ajustar o texto na T019.
- A-05 (LOW): a página do grupo tem botões "Entrar" que abrem o WhatsApp para
  quem não é membro (anterior à feature) — candidato a `sdd-adhoc`.

## Gate de pronto

- 5 contratos 006 verdes; travas 001–006 íntegras; `npm run test:contrato`.
- `npm test`, `npm run lint` (0 erros; 5 warnings anteriores), `npm run build`.
- Migração em dry-run mostrada ao usuário e aplicada antes do deploy.
- `quickstart.md` §3–§4 no navegador (gate, não recomendação).
- Documentos: regras de negócio, `CLAUDE.md`, `README.md`, schemas e índices.
