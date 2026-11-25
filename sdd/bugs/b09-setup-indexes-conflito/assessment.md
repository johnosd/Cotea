# Bug Assessment: setup-indexes.js conflita com setupDatabase.js (IndexKeySpecsConflict)

- **Slug**: b09-setup-indexes-conflito
- **Criado**: 2026-11-24
- **Origem**: texto colado (entrada B-09 do `.planning/backlog.md`, achada no `sdd-execute` da 001 em 2026-11-20)
- **Veredito**: valid
- **Severidade**: low

## Report

`database/setup-indexes.js` cria `walletTransactions { referenceId, type, source }` sem `unique`/parcial, mas
`setupDatabase.js` já cria o mesmo índice como único parcial; o script aborta com `IndexKeySpecsConflict`
(code 86) e não cria os índices seguintes. Pedido adicional: comparar os dois scripts por inteiro (há outros
índices divergentes?), decidir a fonte de verdade, alinhar, e considerar os índices do ledger segmentado
(`operacaoId` etc., spec 002).

## Symptom

Rodar `node --env-file=.env.local database/setup-indexes.js` num banco que já passou por `setupDatabase.js`
aborta em `walletTransactions` (linha 47) e nunca cria os índices seguintes (`operacaoId`, `wallets`, `invoices`,
`rateLimits`, `notificacoesUsuario`, `auditLogs`, `verificationCodes`, `rotina*`). Esperado: o script é idempotente
e convive com `setupDatabase.js`.

## Reproduction

Sem banco disponível (e proibido rodar contra banco real); a conclusão vem de leitura dos dois scripts:

1. `setupDatabase.js:140-143` cria `walletTransactions { referenceId:1, type:1, source:1 }` com
   `{ unique: true, partialFilterExpression: { referenceId: { $type: 'string' } } }`.
2. `setup-indexes.js:47` pede a MESMA chave sem opções. O MongoDB gera o mesmo nome
   (`referenceId_1_type_1_source_1`) com opções diferentes -> `IndexKeySpecsConflict` (86).

Comparação completa (S = setup-indexes.js, D = setupDatabase.js):

| Coleção | Índice | Situação |
|---|---|---|
| walletTransactions | `{referenceId,type,source}` | **CONFLITO**: S sem opções, D único parcial |
| walletTransactions | `{operacaoId,walletId,categoria,type}` único parcial | idêntico |
| walletTransactions | `{walletId,categoria,status}` | idêntico |
| walletTransactions | `{walletId,type,status}` | só em S |
| membrosGrupo | `{grupoId,status}` | idêntico |
| membrosGrupo | `{userId,status}`, `{grupoId,papel}`, `{grupoId,userId,papel}` | só em S |
| grupos | `{slug}` único | idêntico |
| grupos | `{categoria,status}` | só em S |
| wallets | `{userId}` único | idêntico |
| invoices | `{userId,grupoId}` | só em S (D tem chaves diferentes, sem conflito) |
| verificationCodes | `{expiresAt}` TTL 0 | idêntico |
| rotinaItens / rotinaExecucoes / rotinaSaudeSondas | todos | idênticos |
| rateLimits | `{resetAt}` TTL 0 | só em S (também criado em runtime por `lib/ratelimit.js`, mesmas opções) |
| notificacoesUsuario | `{userId,lido}` | só em S |
| auditLogs | `{createdAt:-1}` | só em S |

Só há UM conflito de opções (o reportado). Os "só em S" não conflitam, mas violam a constituição (princípio IV:
índice novo vai para `setupDatabase.js`, "e `setup-indexes.js` quando aplicável") por não estarem no script
canônico: quem roda apenas `setupDatabase.js` fica sem eles.

## Suspected Code Paths

- `database/setup-indexes.js:47` — índice `{referenceId,type,source}` sem `unique`/`partialFilterExpression`.
- `database/setupDatabase.js:140-143` — definição que já está aplicada no banco dev (002 T033, conferido via MCP).
- `database/setup-indexes.js:43-89` — índices que só existem em S.

## Root Cause Hypothesis

Os dois scripts evoluíram em separado: o índice de idempotência por `referenceId` foi tornado único parcial só em
`setupDatabase.js`, e `setup-indexes.js` (mais antigo) ficou com a definição original. Nada garante que os dois
fiquem sincronizados. Confiança: high.

## Proposed Remediation

**Preferida** (fonte de verdade = `setupDatabase.js`, conforme `AGENTS.md`, constituição IV e o que já está
aplicado no banco):

1. `setup-indexes.js`: alinhar `{referenceId,type,source}` ao de D (`unique` + `partialFilterExpression:
   { referenceId: { $type: 'string' } }`).
2. `setupDatabase.js`: incorporar os índices que só existiam em S (tabela acima), para D ser superconjunto e
   `setup-indexes.js` ser um espelho "só índices" (sem validators/collMod). Índices do ledger segmentado
   (`operacaoId`, `{walletId,categoria,status}`) já são idênticos; mantidos.
3. Teste de regressão (leitura estática dos dois arquivos, sem banco): todo `createIndex` de S existe em D com
   as mesmas opções, e nenhuma chave aparece com opções distintas.
4. Registrar em `fix.md`/relatório a pendência (não corrigida aqui, decisão do usuário): o único `{referenceId,
   type, source}` pode colidir com operações multi-perna futuras do ledger (ver Riscos).

**Alternativas**:
- Remover o índice de `setup-indexes.js`: resolve o conflito, mas deixa S sem o índice único e diverge da
  constituição ("espelhar"). Rejeitada.
- Tornar S tolerante a erro 85/86 (try/catch por índice): mascara divergência futura; o teste estático já a evita.
  Não adotada (fail-fast é desejável).
- Extrair a lista de índices para um módulo comum: mais robusto, porém é refatoração maior e sai dos arquivos
  permitidos. Registrar como melhoria futura.

**Files likely to change**:
- `database/setup-indexes.js`
- `database/setupDatabase.js`
- `tests/bugs/b09-setup-indexes-conflito.test.js` (novo)

**Tests to add or update**:
- `tests/bugs/b09-setup-indexes-conflito.test.js`: extrai os `createIndex` dos dois scripts e verifica (a) mesma
  chave => mesmas opções, (b) S ⊆ D, (c) índices do ledger segmentado presentes e idênticos, (d) o índice
  `{referenceId,type,source}` de S é único parcial.

## Risks & Considerations

- Rodar `setupDatabase.js` de novo passa a criar índices extras (leves, não únicos); o script já faz `collMod` em
  todas as coleções e só deve ser rodado com autorização do usuário. Nenhum script foi executado nesta correção.
- Alinhar S ao único parcial faz `setup-indexes.js` falhar com E11000 num banco com duplicatas de
  `(referenceId,type,source)`; o mesmo já vale para D (que o usuário aplicou no dev). Em outros ambientes, checar
  duplicatas antes.
- **Risco latente (fora do escopo)**: todas as pernas de uma mesma operação do ledger compartilham `source` e
  `referenceId` (`lib/ledger/ledger.js`, `registrarOperacao`). Hoje todos os chamadores usam 1 perna, então não
  colide; uma operação futura com duas pernas do mesmo `type` (ex.: crédito ao dono + crédito `receita_taxa` na
  plataforma) violaria o único legado `{referenceId,type,source}`, já que a idempotência passou a ser garantida
  por `operacaoId`. Decisão para o usuário/spec 002: manter, ou trocar por índice não único.
- `setup-indexes.js` usa `import` ESM sem `"type": "module"` no `package.json`; funciona no Node 22.16
  (detecção de módulo), mas não em Node mais antigo. Não alterado.
- `setupDatabase.js` não aplica validator em `notificacoesUsuario`/`creditosUsers` (têm schema em
  `database/schemas/`); fora do escopo deste bug.

## Open Questions

- Nenhuma que bloqueie o fix. Decisão futura do usuário: ver risco latente do índice legado acima.
