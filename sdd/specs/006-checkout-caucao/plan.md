# Implementation Plan: Checkout v2 com caução e elegibilidade no servidor

**Slug**: `006-checkout-caucao` | **Date**: 2026-11-26 | **Spec**: `sdd/specs/006-checkout-caucao/spec.md`

**Nota**: Este template é preenchido pelo skill `sdd-plan`; a definição do skill
descreve o fluxo de execução completo.

## Summary

A entrada em grupo passa a ser uma única operação no servidor: `POST
/api/assinaturas/pay` cobra mensalidade + caução com valores calculados no
servidor, cria a participação e a fatura na mesma transação do ledger e é
idempotente. Um `$inc` no documento do grupo serializa entradas, saídas e
lotação. Toda saída (membro, staff, encerramento, cancelamento, exclusão)
liquida a participação por uma operação única do ledger; grupos "após completar"
retêm a mensalidade até lotar. Uma rotina completa o que a requisição não
terminou. As rotas `join` (POST) e `refund` são desativadas e as telas do
checkout são refeitas sobre um resumo vindo do servidor.

## Technical Context

**Language/Version**: JavaScript (ESM), Node 20+, Next.js 14 Pages Router, React 18

**Primary Dependencies**: MongoDB driver nativo v6 (Atlas, transações), NextAuth
v4 (JWT), núcleo `lib/ledger/` (002), `lib/preco.js` (003),
`lib/cadastro-financeiro-servidor.js` (004), `lib/moderacao*.js` (005),
executor de rotinas (001). Nenhuma dependência nova.

**Storage**: `membrosGrupo`, `grupos`, `invoices`, `walletTransactions`,
`wallets`, `notificacoesUsuario`, `auditLogs`. Banco `usaComigo`, o mesmo de
produção; validadores `$jsonSchema` aplicados (`validationLevel: moderate`).

**Testing**: Vitest (`tests/**/*.test.js`), sem runner de UI. Novo helper
`tests/helpers/db-transacional-memoria.js` (transação, snapshot, conflito de
escrita) permite usar o ledger real nos testes.

**Target Platform**: Vercel, funções serverless em `gru1`; rotinas a cada 15 min
(`vercel.json`, ADR-001).

**Performance Goals**: N/A (poucos usuários). Limite de 25 liquidações por
requisição.

**Constraints**: contratos travados 004 e 005 chamam `pay` e fixam a ordem das
primeiras checagens; o núcleo do ledger não muda (travado pela 002); API estrita
do MongoDB (`strict: true`); uma operação por vez dentro da transação; índice
único `walletTransactions { referenceId, type, source }` existe no banco e
precisa deixar de ser único; PIX simulado.

**Scale/Scope**: 5 grupos, 1 membro não dono e 5 faturas no banco em 2026-11-26.

## Decisões Invariantes

- **D-01**: a entrada é `POST /api/assinaturas/pay` (reaproveitada; sem rota
  paralela), na ordem de checagens de `contracts/api-entrada.md`. O gate de
  cadastro vem antes de qualquer leitura; a elegibilidade antes da validação do
  corpo.
- **D-02**: uma única `registrarOperacao` por entrada; participação, fatura e
  lotação entram no `extra`. A primeira escrita do `extra` é o `$inc` de
  `grupos.versaoParticipacao`; elegibilidade e resumo são reavaliados lá dentro.
- **D-03**: idempotência por `chave` gerada na tela, com `operacaoId`
  `entrada_grupo:<userId>:<chave>` e busca em `invoices.entrada.chave`. Antes de
  recusar, reconsultar a chave.
- **D-04**: nenhum valor vem do cliente. O cliente devolve `versaoResumo` e
  `saldoVisto` só para o servidor detectar que o resumo envelheceu.
- **D-05**: a participação continua apagada fisicamente na saída; o estado vivo
  fica no documento do membro (`caucao`, `retencao`) e o histórico na fatura
  (`entrada`, `encerramento`). Sem coleção nova.
- **D-06**: uma só operação de liquidação por participação
  (`liquidacao_participacao:<id>`) para todos os caminhos; liberação em
  `liberacao_retida:<id>`. O plano é função pura de (membro, grupo).
- **D-07**: gatilhos de grupo liquidam de forma síncrona e limitada (25) e a
  rotina `liquidacao-participacoes` completa e cobre órfãos. A transição de
  moderação nunca falha por causa da liquidação.
- **D-08**: o índice `{ referenceId, type, source }` passa a parcial **não
  único**; a migração roda **antes** de publicar o código.
- **D-09**: PIX inalterado: a tela cria e confirma o depósito do `valorPix` do
  resumo e chama o `pay` de novo. Taxa constante zero em `lib/checkout.js`.
- **D-10**: `POST /api/grupos/[id]/join` e `/api/assinaturas/refund` respondem
  410. `lib/estorno.js` e as funções de `lib/invoices.js` permanecem.
- **D-11**: notificações (com `_id` determinístico) e auditoria depois do commit,
  em melhor esforço.
- **D-12**: ocupação do grupo = 1 (dono) + membros não donos não banidos, na
  elegibilidade e na lotação.
- **D-13**: o `PUT` do grupo é condicional a `versaoParticipacao`.

## Constitution Check

*GATE: deve passar antes da Fase 0. Reavaliado após o design da Fase 1.*

| Princípio | Pré-Design | Pós-Design | Notas |
| --- | --- | --- | --- |
| I. Segurança no servidor | Passa | Passa | Valores, elegibilidade e vínculo permitido vêm do servidor (D-04); `chave` é só idempotência, isolada por usuário; vínculo apenas na visão completa; CPF não é tocado |
| II. Integridade financeira | Passa | Passa | Todo movimento pelo ledger, idempotente e transacional (D-02, D-06); `normalizeAmount`/centavos; auditoria. Repasse e taxa não são lançados (V2-11): o débito continua registrado |
| III. Regras de negócio como fonte | Passa com registro | Passa | Divergências listadas na spec; atualização do documento na mesma entrega (T036) |
| IV. Persistência documentada | Passa | Passa | Schemas, `setupDatabase.js` e `setup-indexes.js` na mesma mudança (T006, T007) |
| Restrições (stack, serverless, rotinas) | Passa com ajuste | Passa | Pages Router; lote limitado por requisição e rotina por rota protegida (D-07); sem timers |

## Project Structure

### Documentation (this feature)

```text
sdd/specs/006-checkout-caucao/
├── spec.md
├── plan.md
├── data-model.md
├── contracts/api-entrada.md
├── logic/checkout.md
├── quickstart.md
├── tasks.md
├── handoff.md
└── contract-tests.lock
```

### Source Code (repository root)

```text
lib/
├── checkout.js                  # novo (stub): regras puras
├── checkout-servidor.js         # novo (stub): entrada, liquidação, liberação
├── grupo-entrada.js             # ocupação (D-12)
├── invoices.js                  # composição estendida, status cancelada
├── moderacao-servidor.js        # gatilho de liquidação
├── estorno.js                   # inalterado
├── ledger/                      # inalterado
└── rotinas/
    ├── liquidacao-participacoes.js   # novo
    └── registro.js
pages/
├── api/assinaturas/pay.js       # reescrito
├── api/assinaturas/resumo.js    # novo (stub)
├── api/assinaturas/refund.js    # 410
├── api/grupos/[id].js           # DELETE e PUT
├── api/grupos/[id]/join.js      # POST 410; DELETE liquida
├── api/grupos/[id]/acessos.js   # libera retenção
├── assinatura/{relacionamento,pagamento,sucesso}.js
└── grupos/{[id].js,[id]/cancelar.js}
database/{setupDatabase.js,setup-indexes.js,schemas/{membrosGrupo,invoices,grupos}.schema.json}
scripts/migrar-checkout-v2.js    # novo
tests/
├── contract/006-checkout-caucao.contract.test.js   # travado
├── helpers/db-transacional-memoria.js              # travado
├── checkout/                                       # testes do execute
└── bugs/, preco/                                   # testes antigos a reescrever
```

**Structure Decision**: segue a estrutura atual (regras puras e `*-servidor` em
`lib/`, rotas em `pages/api/`, rotina registrada em `lib/rotinas/`, como nas
features 004 e 005).

## Complexity Tracking

> **Preencher SOMENTE se o Constitution Check tiver violações que precisam ser justificadas**

| Violação | Por que é necessária | Alternativa mais simples rejeitada porque |
| --- | --- | --- |
| — | Nenhuma violação | — |

## Estratégia de Testes

Prioridade: unitário → contrato/integração → E2E → manual (último recurso).

Comandos-base (de `J:\Cotea`):

```powershell
npm run test:contrato
npm test
npm run lint
npm run build
```

### Testes de Contrato

Arquivos travados em `contract-tests.lock`:
`tests/contract/006-checkout-caucao.contract.test.js` (5 testes) e
`tests/helpers/db-transacional-memoria.js` (0 testes).

Comando: `npx vitest run tests/contract/006-checkout-caucao.contract.test.js`

Integridade: `.\.planning\scripts\powershell\check-contract-tests.ps1 -Slug 006-checkout-caucao`

| Teste | Origem | Fase | Vermelho esperado (antes do execute) |
| --- | --- | --- | --- |
| entrada cobra mensalidade + caução com valores do servidor… | US1/AC1, AC4 · FR-004, 012, 015, 016, 018–020 · Constitution I e II | 3 | `Error: not implemented` (resumo) |
| última vaga disputada… clique duplo cobra uma vez | US1/AC2, AC4 · FR-016, 017 · SC-002, 003 | 3 | `Error: not implemented` |
| resumo divide saldo e PIX; … não cobram nada | US3/AC1, AC3, AC4 · US5/AC2 · FR-001–003, 005, 006, 009, 010, 013 | 3 | `Error: not implemented` |
| a caução volta uma única vez na saída e no cancelamento… | US2/AC1, AC2, AC4, AC5 · FR-012, 016, 021, 022, 024, 031 | 4 | `Error: not implemented` |
| grupo após completar: retém, devolve tudo antes de lotar… | US4/AC1–AC5 · FR-025–028 | 6 | `Error: not implemented` |

Vermelho confirmado em 2026-11-26: 5/5; os outros 430 testes verdes com os stubs.

Verificação do próprio contrato (protótipo descartável numa cópia, removido): 5/5
verdes; sem o `$inc` da trava o 2º teste falha com `[200, 200]`.

Fora do contrato (testes do execute): exclusão e edição de grupo, rotina,
migração, visibilidade do vínculo, concorrência saída × lotação. Telas: sem
runner de UI, verificadas pelo `quickstart.md`.

Stubs criados pelo plan (ponto de partida do execute, não travados):
`lib/checkout.js` (constantes definitivas, funções vazias),
`lib/checkout-servidor.js`, `pages/api/assinaturas/resumo.js`.

## Estado Atual

<!-- Sobrescrita a cada checkpoint pelo sdd-execute. Vazia na criação. -->

| Área | Estado |
| --- | --- |
| Código (Fases 1–7) | Concluído; 497/497 testes, contratos 30/30, lint e build ok |
| Banco | Migrado: índice por referência não único; 3 faturas antigas estornadas |
| Roteiro manual | Executado em 2026-11-26; dados de teste removidos |
| Publicação | Pendente: commit, PR, deploy e nova passada da migração (T040) |

## Riscos e Decisões

<!--
  IDs estáveis (R-001, R-002...), nunca deletados. Item resolvido ganha
  prefixo "Resolvido:" na célula de Mitigação em vez de sumir da tabela.
-->

| ID | Risco/Decisão | Impacto | Mitigação/Encaminhamento |
| --- | --- | --- | --- |
| R-001 | O índice único `referenceId_1_type_1_source_1` está no banco; operações com duas pernas do mesmo tipo falham com E11000. | Alto: entrada com retenção e liquidação quebram se o código for publicado antes. | D-08: migração antes do deploy (quickstart §2); asserção do `b09` ajustada (T006); script aborta se o índice único por `operacaoId` não existir; Resolvido: aplicado em 2026-11-26, antes do deploy (T040). |
| R-002 | As 3 faturas pagas de dez/2025 (R$ 127,50) podem ter gerado participação apagada antes de existir `vinculadoEm`. | Baixo (mesmo usuário e grupo, valores simulados). | Resolvido: dry-run mostrado, aprovado e aplicado em 2026-11-26. |
| R-003 | O membro antigo sem caução continua sem caução. | Nenhum financeiro. | FR-024; nada retroativo. |
| R-004 | Testes antigos do fluxo `pay` → `join` quebram: 33 casos em `b04`, `join-reusa-fatura-vinculada`, `pay-aceita-fatura-estornada` e `preco/handler-pay` (medido no protótipo), mais a parte de handler do `b02` (rota passa a 410) e a asserção de índice do `b09`. | Médio: apagar sem cuidado perde a proteção dos bugs B-02 e B-04. | Resolvido: T014 reescreveu os cinco arquivos preservando o invariante de cada bug (cenário comum em `tests/helpers/checkout-cenario.js`). |
| R-005 | Queda entre o commit e a notificação/auditoria perde o aviso. | Baixo. | D-11, mesmo padrão aceito na 005; o dinheiro e o estado são atômicos. |
| R-006 | Grupo com mais de 25 participações: devolução/liberação não termina na requisição. | Baixo (prazo ≤ 15 min, FR-022 pede 1 h). | D-07: rotina. |
| R-007 | O banco em memória travado não suporta `$or`, `$and`, upsert nem `aggregate`. | Baixo: restringe os caminhos cobertos pelo contrato. | Usar `$in`/consultas separadas nos caminhos do checkout; se faltar algo, voltar ao plan. |
| R-008 | O depósito PIX terá mínimo de R$ 5,00 (V2-18) e já tem limite de 5 por hora. | Baixo agora. | V2-18 precisa isentar a diferença do checkout; erro 429 aparece na tela. |
| R-009 | O banco de testes manuais é o de produção. | Médio. | Resolvido: executado com autorização e limpo em 2026-11-26 (contagens e saldos iguais). |
| R-010 | Edição de grupo concorrente com uma entrada passa a responder 409. | Baixo. | Esperado (D-13); a tela já trata o conflito pela mensagem. |
| R-011 | A logic §9 mandava a rotina **remover** o membro banido; apagar o registro permitiria reentrar, contra o edge case "banido no grupo não reentra". O `DELETE /join` anterior à feature também deixava o banido apagar o próprio registro. | Médio (hoje nenhum fluxo grava `banido`). | Resolvido: T042 — só o staff remove um banido; o próprio e a rotina apenas devolvem a caução. Logic §9 atualizada. |

## Execution Notes

<!--
  Tabela append-only, mantida pelo sdd-execute. Quando passar de ~40 linhas,
  arquivar as mais antigas (exceto as ~10 mais recentes) em history.md,
  substituindo por uma linha de resumo consolidado aqui.
-->

| Data | Fase/Story | Resumo | Pendência Principal |
| --- | --- | --- | --- |
| 2026-11-26 | Fase 1 (Setup) | Ponto de partida confirmado (T001) | Revisão do texto de `REGRAS_CAUCAO` pelo usuário (A-02) |
| 2026-11-26 | Fase 2 (Foundational) | T002–T009: regras puras, fatura, índice não único e schemas | Índice no banco só na T040 |
| 2026-11-26 | Fase 3 (US1) | T010–T016: entrada atômica, resumo, rotas antigas em 410, testes reescritos | Devolução (Fase 4) |
| 2026-11-26 | Fase 4 (US2) | T017–T024 e T042: liquidação única por participação, gatilhos, rotina e tela de cancelar | Telas (Fase 5) |
| 2026-11-26 | Fase 5 (US3) | T025–T028: telas de relacionamento, pagamento e sucesso | Conferência no navegador (T041) |
| 2026-11-26 | Fase 6 (US4) | T029–T033: retenção, liberação, envio de acesso, edição e rotina | — |
| 2026-11-26 | Fase 7 (US5) | T034–T035: vínculo visível só ao dono e à equipe | — |
| 2026-11-26 | Fase 8 (parcial) | T036–T039: documentos, migração e gates | Autorização para T040 e T041 |
| 2026-11-26 | Fase 8 (T040 parcial, T041, T043) | Migração aplicada, roteiro executado no navegador, auditoria de saída corrigida | Deploy e repetir a migração |

**PRÓXIMO**: `sdd-converge 006-checkout-caucao`; commit e PR; após o deploy, repetir a migração (fecha a T040).

## Arquivos Principais

<!-- Sobrescrita a cada checkpoint — foco da etapa atual, não a árvore inteira. -->

- `sdd/specs/006-checkout-caucao/quickstart.md` (resultado)
- `scripts/migrar-checkout-v2.js`

## Cuidados para Retomada

<!-- Armadilhas operacionais específicas desta feature, anexadas conforme descobertas. -->
- O banco de `.env.local` (`usaComigo`) é o de produção: `--aplicar` e o roteiro manual só com autorização.
- Publicar o código antes de aplicar a troca do índice quebra a entrada em grupo "após completar" e a devolução com retenção (E11000).
