# Bug Fix: Estorno sem cancelamento (B-02)

- **Slug**: b02-estorno-sem-cancelamento
- **Corrigido**: 2026-11-24
- **Assessment**: ./assessment.md
- **Status**: applied

## Summary

`POST /api/assinaturas/refund` passou a funcionar só como compensação de falha de entrada: nega (409 `estorno_indisponivel`) quando o usuário tem registro em `membrosGrupo` do grupo da fatura (qualquer status) ou quando a fatura já foi vinculada a uma entrada (`membroId`/`vinculadoEm`, que cobre "entrou e saiu"). O estorno pós-falha de `join` do checkout continua funcionando.

## Changes

| Arquivo | Mudança | Notas |
| --- | --- | --- |
| `lib/estorno.js` | added | `avaliarEstorno({ invoice, membro })` (regra pura, sem lib/mongodb), `MOTIVO_ESTORNO`, `MENSAGEM_ESTORNO_NEGADO` |
| `pages/api/assinaturas/refund.js` | modified | após validar fatura paga/não estornada, consulta `membrosGrupo` (grupoId/userId como ObjectId ou string via `$in`) e aplica a regra; ledger (`obterLedger().registrarOperacao`, `estorno_assinatura:<invoiceId>`), idempotência e resposta 200 inalterados |
| `tests/bugs/b02-estorno-sem-cancelamento.test.js` | added | regressão |

`pages/assinatura/pagamento.js` (único consumidor) não precisou mudar: ele lê `data.error` da resposta não-ok, que agora traz a mensagem do 409.

## Tests Added or Updated

- `tests/bugs/b02-estorno-sem-cancelamento.test.js` — regra pura (membro ativo/banido, fatura vinculada, caminho livre); handler: membro ativo com e sem vínculo → 409 sem lançamento e fatura `paga`; entrou-e-saiu → 409; falha de join (não membro, não vinculada) → 200 com crédito `pessoal` `estorno_assinatura:inv-1` e fatura `estornada`; fatura de outro usuário 404; já estornada 200 idempotente; não paga 400; sem sessão 401. Confirmado que 3 deles falham contra o `refund.js` original.

## Local Verification

- `npx vitest run tests/bugs/b02-estorno-sem-cancelamento.test.js` (de `J:\Cotea`) → 11/11.
- Contra o código original do refund: 3 falhas (os casos do bug) — teste realmente trava a regressão.
- `npx vitest run` → 29 arquivos, 171 testes passando (inclui trabalho paralelo de outros agentes).
- `npx eslint` nos 3 arquivos → sem erros.
- `check-contract-tests.ps1` 001/002/003 → trava íntegra.

## Deviations from Assessment

Nenhuma.

## Follow-ups

- Corrida join x refund na mesma fatura (join não participa da mesma transação): fechar em B-04/V2-06 fazendo `join` rechecar a fatura (`paga`, não `estornada`) após inserir o membro, ou movendo a compensação para o servidor. `join.js` pertence a outro agente; não alterado.
- V2-12/V2-15: o caminho de devolução após entrar (cancelamento/disputa) ainda não existe; o `DELETE /api/grupos/[id]/join` não gera devolução (comportamento existente).
- Nota para B-04: se `join` passar a limpar/alterar `membroId`/`vinculadoEm` da fatura, a regra "entrou e saiu" deste fix deixa de valer; manter o vínculo ou migrar para um campo próprio.
