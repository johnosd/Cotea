# Bug Assessment: Estorno sem cancelamento (B-02)

- **Slug**: b02-estorno-sem-cancelamento
- **Criado**: 2026-11-24
- **Origem**: texto colado (backlog `[Bug] B-02`, `.planning/backlog.md:287-291`)
- **Veredito**: valid
- **Severidade**: critical (P0 — devolve dinheiro de fatura paga mantendo o acesso ao grupo)

## Report

O usuário pode chamar `POST /api/assinaturas/refund` para qualquer fatura própria paga e receber o crédito sem sair do grupo nem passar por cancelamento/disputa (`pages/api/assinaturas/refund.js:21-105`). Corrigir antes de liberar V2-12 e V2-15. O checkout atual pode depender do refund para compensar falha no `join` (B-04, outro agente).

## Symptom

Observado: qualquer dono de fatura `paga` consegue estornar via API, recebendo crédito `pessoal` e continuando membro do grupo (ou tendo saído por `DELETE /api/grupos/[id]/join` e ainda reembolsado depois). Esperado: estorno só no caminho legítimo de compensação (pagou, mas a entrada no grupo não aconteceu); depois de entrar, a devolução passa por cancelamento/disputa.

## Reproduction

1. Usuário paga uma fatura de grupo (`/api/assinaturas/pay`) e entra (`POST /api/grupos/[id]/join` com `invoiceId`).
2. Chama `POST /api/assinaturas/refund { invoiceId }` autenticado como o próprio usuário.
3. Resposta 200: fatura `estornada`, crédito `pessoal` no ledger; `membrosGrupo` continua com o registro `ativo`.

Variante: o usuário sai via `DELETE /api/grupos/[id]/join` e estorna depois — a fatura continua `paga` e o estorno passa (consumiu o serviço do período).

## Suspected Code Paths

- `pages/api/assinaturas/refund.js:34-45` — só valida dono da fatura + status `paga`; não consulta `membrosGrupo` nem se a fatura já foi vinculada a uma entrada.
- `pages/assinatura/pagamento.js:279-300` — único consumidor: chama o refund só quando `pagarFaturaAssinatura` deu `paga` e `registrarEntradaNoGrupo` (join) lançou erro. É o caminho legítimo a preservar.
- `pages/api/grupos/[id]/join.js:129-201` — ao entrar grava `invoices.membroId`/`vinculadoEm` (também no ramo "ja membro"); o `DELETE` (linhas 31-82) remove o membro mas não limpa esse vínculo. Serve de marca "a fatura já foi consumida por uma entrada" (arquivo de outro agente; só lido).
- `lib/invoices.js` — `getInvoiceById`, `markInvoiceRefunded` (sem mudança necessária).

## Root Cause Hypothesis

O endpoint foi escrito apenas como compensação do checkout, mas é exposto sem pré-condição de domínio: autoriza só pela propriedade da fatura. Nada verifica que a entrada no grupo falhou. Confiança: high (leitura direta do código e único consumidor identificado).

## Proposed Remediation

**Preferida**: manter o endpoint como compensação de falha de entrada e negar (409) o estorno quando (a) existe registro do usuário em `membrosGrupo` do grupo da fatura (qualquer status, inclusive `banido`) ou (b) a fatura já foi vinculada a uma entrada (`membroId`/`vinculadoEm` presentes — cobre o caso "entrou e saiu"). Regra pura em `lib/estorno.js` (sem importar `lib/mongodb`), consulta a `membrosGrupo` via `getDb()` no handler. Fatura já `estornada` continua idempotente (200). Ledger continua via `obterLedger()` sem mudanças. UI e fluxo de checkout inalterados: o estorno pós-falha de `join` segue funcionando, pois o usuário não é membro e a fatura não foi vinculada.

**Alternativas**:
- Remover o endpoint e fazer o estorno server-side dentro de `join`/`pay` — correto a longo prazo (B-04, V2-06), mas toca arquivos de outros agentes e quebraria a UI atual; rejeitada agora.
- Janela de tempo após o pagamento — heurística frágil; rejeitada.

**Files likely to change**:
- `lib/estorno.js` (novo, regra pura)
- `pages/api/assinaturas/refund.js`
- `tests/bugs/b02-estorno-sem-cancelamento.test.js` (novo)

**Tests to add or update**:
- Regra pura: membro (qualquer status) nega; fatura vinculada nega; sem membro e sem vínculo permite.
- Handler (sessão/mongo/ledger mockados, db em memória): membro ativo → 409, sem lançamento e fatura continua `paga`; entrou-e-saiu (vinculada) → 409; falha de join (sem membro, sem vínculo) → 200 e crédito; fatura de outro usuário → 404; já estornada → 200 idempotente; fatura não paga → 400.

## Risks & Considerations

- Corrida: `join` e `refund` simultâneos na mesma fatura podem passar ambos (join não está em transação com o refund). Mitigação completa requer `join` rechecar o status da fatura após inserir/ou o refund ser feito server-side (B-04/V2-06, outros agentes).
- Faturas antigas que viraram membros por join antigo já têm `membroId`; membros inseridos por `participar` (B-01) sem fatura são cobertos pela checagem em `membrosGrupo`.
- Mensagem de erro 409 deve ser clara; UI de checkout só mostra o erro no caso (raro) de refund negado após falha de join com usuário já membro.

## Open Questions

- Nenhuma que bloqueie. Decisão de produto futura (V2-12/V2-15): como o usuário pede devolução após entrar (cancelamento/disputa) — fora deste bug.
