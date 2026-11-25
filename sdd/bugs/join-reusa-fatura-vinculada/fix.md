# Bug Fix: join reusa fatura paga ja vinculada

- **Slug**: join-reusa-fatura-vinculada
- **Corrigido**: 2026-11-24
- **Assessment**: ./assessment.md
- **Status**: applied

## Summary

`POST /api/grupos/[id]/join` agora trata o vinculo da fatura (`membroId`/`vinculadoEm`) como consumo da entrada: fatura vinculada (mesmo com a participacao encerrada) que nao pertence a um membro atual recebe 409 `fatura_ja_utilizada`, sem inserir membro nem estornar. O ramo idempotente "ja e membro -> 200" foi mantido e deixou de sobrescrever vinculo ja existente.

## Changes

| Arquivo | Mudanca | Notas |
| --- | --- | --- |
| `pages/api/grupos/[id]/join.js` | modified | (1) ramo `jaMembro` so grava o vinculo se a fatura estiver livre; (2) novo guard logo apos `jaMembro`, antes do impedimento/insert: `vinculadoEm \|\| membroId` -> 409 `fatura_ja_utilizada` com `estornada: false`. DELETE inalterado (vinculo permanece, regra do refund B-02 preservada) |
| `tests/bugs/join-reusa-fatura-vinculada.test.js` | added | regressao (9 casos) |

## Tests Added or Updated

- `tests/bugs/join-reusa-fatura-vinculada.test.js` — entrar/sair/reentrar com a mesma fatura -> 409 sem membro nem estorno; vinculo permanece gravado apos sair e apos tentativa negada; vinculo a membro inexistente -> 409; so um dos campos ja nega; ja membro com mesma fatura -> 200 e vinculo intacto; ja membro com outra fatura vinculada -> 200 sem reescrever; ja membro com fatura livre -> vincula; fatura nova apos sair -> reentra; primeira entrada normal.

## Local Verification

- `npx vitest run tests/bugs/join-reusa-fatura-vinculada.test.js` (de `J:\Cotea`) -> 9/9.
- Com o guard neutralizado temporariamente: 4 falhas (os casos do bug) — o teste trava a regressao; arquivo restaurado.
- `npx vitest run tests/bugs` (inclui b04 e b02) e `npx vitest run` completo -> 34 arquivos, 226 testes passando.
- `npx eslint` em `join.js` e no teste novo -> sem erros.

## Deviations from Assessment

Nenhuma.

## Follow-ups

- Concorrencia: duas chamadas simultaneas de join com a mesma fatura ainda fazem check-then-insert; o indice unico de membro por grupo/usuario cobre o mesmo usuario. Um claim atomico da fatura (`updateOne` condicional) pode entrar junto da V2-06.
- Nao ha mensagem especifica na UI para `fatura_ja_utilizada`; `pagamento.js` exibe `data.error` e tenta refund, que o B-02 nega por fatura vinculada (comportamento desejado).
