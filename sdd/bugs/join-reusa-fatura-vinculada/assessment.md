# Bug Assessment: join reusa fatura paga ja vinculada

- **Slug**: join-reusa-fatura-vinculada
- **Criado**: 2026-11-24
- **Origem**: achado no Test do bug b04-pagamento-grupo-indisponivel (texto colado pelo agente principal)
- **Veredito**: valid
- **Severidade**: high

## Report

`POST /api/grupos/[id]/join` permite que quem saiu do grupo reutilize uma fatura paga ja vinculada (`membroId`/`vinculadoEm` preenchidos) para entrar de novo sem pagar. Regra: uma fatura paga da direito a uma entrada; fatura ja vinculada a uma participacao (mesmo encerrada) nao pode criar outra.

## Symptom

Apos sair (DELETE do join apaga o documento de `membrosGrupo`), o usuario chama `POST join` de novo com a mesma `invoiceId` (status `paga`, `membroId`/`vinculadoEm` preenchidos) e recebe 200 "Membro adicionado": entra sem novo pagamento. Esperado: 409, sem membro criado, sem reestorno.

## Reproduction

1. Pagar fatura F do grupo G e chamar `POST /api/grupos/G/join { invoiceId: F }` (membro criado; F recebe `membroId`/`vinculadoEm`).
2. `DELETE /api/grupos/G/join { userId }` (membro removido; F continua `paga` e vinculada).
3. `POST /api/grupos/G/join { invoiceId: F }` de novo: o codigo so valida dono/status paga/grupo/`jaMembro`; nao olha o vinculo da fatura, insere novo membro e sobrescreve o vinculo. Entrada gratis.

## Suspected Code Paths

- `pages/api/grupos/[id]/join.js:183-189` — valida so existencia, dono e `status === paga`; ignora `membroId`/`vinculadoEm`.
- `pages/api/grupos/[id]/join.js:204-211` — ramo `jaMembro` sobrescreve o vinculo incondicionalmente (`$set membroId`), podendo desvincular a fatura antiga da participacao original.
- `pages/api/grupos/[id]/join.js:252-281` — insere membro e regrava o vinculo.
- `pages/api/grupos/[id]/join.js:115` — DELETE apaga o membro (o vinculo na fatura fica como unico rastro; B-02 depende dele via `lib/estorno.js`).

## Root Cause Hypothesis

O join nunca trata o vinculo da fatura como "consumo" da entrada: so o grava no fim. Como o DELETE apaga o membro, o `jaMembro` deixa de proteger e a fatura paga vira bilhete reutilizavel. Confianca: high.

## Proposed Remediation

**Preferida**: em `join.js`, depois do ramo `jaMembro` (que preserva o 200 idempotente) e antes da checagem de impedimento/insert, se a fatura tiver `membroId` ou `vinculadoEm`, responder 409 `fatura_ja_utilizada` (com `estornada: false`, sem estornar nem inserir). No ramo `jaMembro`, nao sobrescrever vinculo ja existente (so grava se a fatura ainda nao estiver vinculada). Nao tocar no DELETE: `membroId`/`vinculadoEm` permanecem gravados (regra do refund B-02 preservada).

**Alternativas**:
- Marcar a fatura como `consumida` no DELETE: exigiria campo novo e coordenacao com refund/invoices (fora do escopo/arquivos permitidos).
- Claim atomico (`updateOne` condicionado a fatura nao vinculada) antes do insert: fecha tambem concorrencia de duas chamadas simultaneas; mais invasivo, residual aceito (unico indice de membro por grupo/usuario cobre duplicidade do mesmo usuario).

**Files likely to change**:
- `pages/api/grupos/[id]/join.js`

**Tests to add or update**:
- `tests/bugs/join-reusa-fatura-vinculada.test.js` (novo): entrar, sair, tentar reentrar com a mesma fatura -> 409 e sem membro; fatura vinculada com membro inexistente -> 409; ja membro com a mesma fatura vinculada -> 200 sem mudar vinculo; vinculo permanece apos sair; fatura nova paga permite reentrada.

## Risks & Considerations

- O refund (B-02) depende de `membroId`/`vinculadoEm` gravados: nao limpar no DELETE.
- Caso b04 "fatura vinculada + grupo cancelado" espera 409 com `estornada: false`: manter `estornada: false` no corpo.
- Corrida de duas chamadas simultaneas com a mesma fatura (usuarios distintos nao, pois a fatura e do usuario) segue nao atomica; indice unico de membro mitiga o mesmo usuario.

## Open Questions

- Nenhuma decisao de produto pendente.
