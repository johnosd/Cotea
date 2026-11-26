# Bug Assessment: Pagamento de grupo indisponivel sem compensacao no servidor (B-04)

- **Slug**: b04-pagamento-grupo-indisponivel
- **Criado**: 2026-11-24
- **Origem**: texto colado (backlog B-04, P0)
- **Veredito**: valid
- **Severidade**: critical

## Report

`pay` consulta so nome e preco, sem status/capacidade (`pages/api/assinaturas/pay.js:46-62`); `join` so bloqueia grupo cheio depois da fatura paga (`pages/api/grupos/[id]/join.js:124-158`) e nao verifica status; o estorno da falha depende da UI. Preservar a reconciliacao de pagamentos ja feitos. Fix minimo: validar status/capacidade/nao-ser-membro/nao-ser-dono no `pay` antes de cobrar, e no `join` validar status; compensacao no servidor desejavel (solucao completa na feature V2-06).

## Symptom

Um usuario consegue ser cobrado (debito pessoal no ledger + fatura `paga`) por um grupo `inativo`/`cancelado`, cheio, do qual ja e membro ou do qual e dono. O `join` falha depois da cobranca e o dinheiro so volta se o navegador do usuario chamar `/api/assinaturas/refund` (`pages/assinatura/pagamento.js:279-300`); se a aba fechar, a rede cair ou o estorno falhar, o usuario fica cobrado sem vaga. Esperado: nao cobrar quando a entrada e impossivel; e, se a entrada falhar apos cobrar, o servidor compensa.

## Reproduction

1. Grupo com `status: 'cancelado'` (ou `capacidadeTotal` ja preenchida por membros nao banidos) e preco valido.
2. Usuario valido com saldo chama `POST /api/assinaturas/pay` com `{ grupoId }` -> 200, `status: 'paga'`, debito no ledger (hoje).
3. `POST /api/grupos/:id/join` com a fatura paga: grupo cheio -> 400 "Grupo completo"; grupo cancelado -> o membro e inserido mesmo assim (join nao olha `status`). Dono/membro chamando `pay` e cobrado de novo (fatura nova com outro `invoiceId`).
4. Sem a UI chamando `refund`, nada devolve o valor.

Confirmado por leitura do codigo (nenhum caminho do servidor testa status/capacidade/membro antes do debito); nao executado contra banco real.

## Suspected Code Paths

- `pages/api/assinaturas/pay.js:43-49` — projecao so de nome/preco; nenhuma checagem de status, capacidade, membro ou dono antes de `createInvoice` + `registrarOperacao`.
- `pages/api/grupos/[id]/join.js:133-159` — carrega `status` na projecao mas nunca usa; so valida capacidade apos fatura paga e sem compensar.
- `pages/assinatura/pagamento.js:279-300` — unico estorno da falha do join e client-side (nao confiavel).
- `pages/api/assinaturas/refund.js` — estorno idempotente por `operacaoId = estorno_assinatura:<invoiceId>` (fora do escopo deste agente; reaproveitado pelo mesmo `operacaoId`).

## Root Cause Hypothesis

Fluxo em duas etapas (cobrar em `pay`, registrar membro em `join`) sem pre-validacao na etapa de cobranca e sem compensacao server-side quando a segunda etapa falha. Confianca: high.

## Proposed Remediation

**Preferida**:
- `pay`: carregar `status`, `capacidadeTotal`, `adminId`; antes de criar fatura/debitar (exceto fatura ja `paga`, que segue devolvendo 200 — reconciliacao preservada) recusar com 409 e `codigo` estavel: `grupo_indisponivel` (status diferente de `ativo`; ausente conta como `ativo`), `dono_do_grupo` (dono por `adminId` ou membro `papel: admin`), `ja_membro`, `grupo_cheio` (membros nao banidos >= `capacidadeTotal`, mesma regra do `join`/`participar`). Membro banido: 403 `membro_banido`.
- `join`: apos checar `jaMembro` (para nao quebrar reconciliacao de quem ja entrou), validar `status` do grupo (409 `grupo_indisponivel`) e capacidade (409 `grupo_cheio`); nesses dois casos, sendo a fatura `paga` e o usuario nao-membro, estornar no servidor pelo ledger (`obterLedger().registrarOperacao` com o mesmo `operacaoId` do `refund.js`, fatura marcada estornada na mesma transacao). Idempotente: o `refund` posterior da UI cai em "ja estornada".

**Alternativas**:
- Helper puro compartilhado em `lib/grupo-entrada.js` (novo arquivo) para `pay` e `join` nao divergirem — escolhido.
- Mexer em `refund.js`/`lib/invoices.js` para reutilizar: descartado (arquivos de outros agentes/bugs).
- Transacao unica pagar+entrar: solucao completa da V2-06, fora de um fix pontual.

**Files likely to change**:
- `pages/api/assinaturas/pay.js`
- `pages/api/grupos/[id]/join.js`
- `lib/grupo-entrada.js` (novo, puro)
- `tests/bugs/b04-pagamento-grupo-indisponivel.test.js` (novo)

**Tests to add or update**:
- `pay` recusa (409/403, sem fatura nem lancamento) para status inativo/cancelado, grupo cheio, ja membro, dono (adminId e papel admin), banido; aceita grupo ativo com vaga; fatura ja paga continua 200 mesmo com grupo cheio/inativo.
- `join` com fatura paga e grupo cancelado/cheio: 409 e estorno server-side (credito `estorno_assinatura:<id>`, fatura `estornada`), sem inserir membro; ja membro continua 200; grupo ativo com vaga entra.

## Risks & Considerations

- Race residual: duas pessoas pagam a ultima vaga ao mesmo tempo; o `join` do perdedor estorna no servidor (solucao completa fica na V2-06).
- `status` ausente tratado como `ativo` para nao travar grupos legados; qualquer outro valor bloqueia.
- O estorno do `join` replica a logica de `refund.js` (mesmo `operacaoId`, mesma semantica) — se o B-02 mudar a regra do estorno, revisar o `join`.
- `markInvoiceRefunded` le `updateResult.value` (B-06 em outro agente); o `join` usa o retorno de forma tolerante.

## Open Questions

- Nenhuma bloqueante. Decisao assumida: bloquear banido e tratar apenas `status: 'ativo'` como aceitando entrada (usuario pode rever).
