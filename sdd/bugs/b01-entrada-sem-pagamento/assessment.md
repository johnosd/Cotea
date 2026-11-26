# Bug Assessment: Entrada em grupo sem pagamento via /participar

- **Slug**: b01-entrada-sem-pagamento
- **Criado**: 2026-11-24
- **Origem**: backlog B-01 (`.planning/backlog.md`, "Bugs atuais separados das features v2")
- **Veredito**: valid
- **Severidade**: critical (P0 — contorna a cobrança)

## Report

`POST /api/grupos/[id]/participar` insere membro sem fatura paga para qualquer usuário validado
(`pages/api/grupos/[id]/participar.js:11-82`), contrariando o fluxo 7 de `.docs/regras-negocio-v2.md`
(RN:485-545). Remover ou restringir a rota; a correção definitiva vem na feature V2-06 (checkout v2).

## Symptom

Qualquer usuário autenticado com `contaValidada` faz `POST /api/grupos/<id>/participar` e vira membro
`ativo` (com `aguardandoEnvioAcesso: true`) sem fatura paga, sem débito na carteira, sem caução e sem
declaração de relacionamento. Esperado (fluxo 7): só entra quem pagou mensalidade + caução; a entrada
ocorre via `pay` -> `join`.

## Reproduction

1. Logar com usuário `contaValidada: true` que não é membro de um grupo com preço válido e vagas.
2. `POST /api/grupos/<id>/participar` (corpo vazio) -> 200 `Participante adicionado`; documento criado em
   `membrosGrupo` sem nenhuma `invoices`/`walletTransactions` associada.

Confirmado por leitura do código (sem checagem de fatura/ledger no handler); não executado contra banco real.

## Suspected Code Paths

- `pages/api/grupos/[id]/participar.js:11-82` — handler faz `insertOne` em `membrosGrupo` apenas com checagem de
  sessão/conta validada/capacidade/preço válido; nenhuma verificação de pagamento. Staff (`admin`/`support`)
  ainda pode inserir qualquer `userId` via body.
- `pages/api/grupos/[id]/join.js` — caminho correto (exige fatura paga); fora do escopo deste agente.
- Consumidores no front: busca por `participar` em `pages/`, `components/`, `lib/`, `tests/` encontra apenas
  texto de UI em `pages/grupos/[id].js` ("Entrar para participar", "Beneficios de participar"); nenhum
  `fetch`/`axios` chama a rota. Também não há teste (inclusive contract/locked) que a use. Só aparece em docs
  da spec 003 (`contracts/api-grupos.md:60`, `plan.md`, `tasks.md` T010).

## Root Cause Hypothesis

A rota é um atalho legado de "adicionar participante" anterior ao fluxo pago (`pay` -> `join`) e nunca foi
amarrada a fatura/ledger. Sem consumidores no front, ela só serve como porta dos fundos. Confiança: high.

## Proposed Remediation

**Preferida**: desativar a rota para todos (inclusive staff) respondendo `410 Gone` com
`{ error, codigo: 'rota_desativada' }` antes de qualquer acesso a sessão/banco, mantendo o arquivo (stub) para
um erro explícito em vez de 404 ambíguo; remover toda a lógica de inserção. Staff também é desativado porque
adicionar membro sem fatura/caução/ledger viola o mesmo fluxo; entrada administrativa legítima deve vir no V2-06.

**Alternativas**:
- Apagar o arquivo (404): equivalente em segurança, mas menos explícito e deixa a spec 003 apontando para rota inexistente.
- Restringir a staff: mantém bypass de ledger/caução; rejeitado sem decisão de produto.

**Files likely to change**:
- `pages/api/grupos/[id]/participar.js`
- `tests/bugs/b01-entrada-sem-pagamento.test.js` (novo)

**Tests to add or update**:
- Handler responde 410 para POST de usuário comum validado, para staff com `userId` no body e para outros métodos,
  e não toca em `clientPromise`/`membrosGrupo` (mock do módulo mongodb que falha se usado).

## Risks & Considerations

- Nenhum consumidor encontrado; risco de quebra baixo. Clientes externos/scripts eventualmente usando a rota passarão a receber 410.
- Docs da spec 003 (`contracts/api-grupos.md`, T010) descrevem o 409 `preco_indisponivel` desta rota; ficam desatualizados (follow-up documental, spec não editada aqui).

## Open Questions

- Nenhuma bloqueante. Decisão de produto (opcional): V2-06 deve prever caminho administrativo de adição manual de membro, se desejado.
