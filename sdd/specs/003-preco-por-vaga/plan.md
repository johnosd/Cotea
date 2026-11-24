# Implementation Plan: Regra única de preço por vaga (taxa Cotea 5%) e capacidade mínima

**Slug**: `003-preco-por-vaga` | **Date**: 2026-11-24 | **Spec**: `sdd/specs/003-preco-por-vaga/spec.md`

**Nota**: Este template é preenchido pelo skill `sdd-plan`; a definição do skill
descreve o fluxo de execução completo.

## Summary

Um módulo puro, `lib/preco.js`, passa a ser a única fonte da regra de preço:
calcula em centavos inteiros `valorPorVaga = round((T/C)·1,05)`,
`repasse = round(T/C)` (meio-para-cima exato) e `taxa = valorPorVaga −
repasse`, valida `C ≥ 2` inteiro, `T > 0` com até 2 casas e repasse ≥ R$ 0,01.
Criação e edição de grupo (`pages/api/grupos/index.js`, `[id].js`) ignoram
preço, reservadas e vagas vindos do body e gravam o trio + `precoValido`;
`vagasReservadasAdmin` fica fixo em 1; a edição recusa capacidade abaixo de
dono + membros ativos. A cobrança (`pages/api/assinaturas/pay.js`) usa só
`precoDoGrupo(grupo)` — sem fallback para `valorTotal`/body — e grava a
`composicao` (repasse + taxa) na fatura; lançar taxa/repasse no ledger fica
para V2-06/V2-11. Home, página do grupo, lista admin e checkout exibem o
mesmo preço via `precoDoGrupo`; os formulários mostram a prévia com a mesma
função. Um script com dry-run recalcula os 5 grupos existentes.

## Technical Context

**Language/Version**: JavaScript (ES modules transpilados pelo Next.js), Node.js 22 local

**Primary Dependencies**: Next.js 14.2 (Pages Router), `mongodb` 6.16 (driver nativo; `Double`/`Int32` nos grupos), `next-auth` 4.24, React 18, Tailwind 3, SWR (lista admin)

**Storage**: MongoDB Atlas, banco `usaComigo`. Altera `grupos` (3 campos novos, 3 passam a ser calculados) e `invoices` (`composicao`); escreve `auditLogs`. Sem coleção nem índice novos (ver `data-model.md`)

**Testing**: Vitest 5.1 (`npm test`, `npm run test:contrato`); regra pura testada pelos contratos travados; handlers e telas validados por `quickstart.md` (handlers importam `lib/mongodb.js`, que valida env no import)

**Target Platform**: Vercel, funções serverless em `gru1` (ADR-001)

**Performance Goals**: N/A — cálculo O(1); migração lê todos os grupos de uma vez (5 hoje)

**Constraints**: `lib/preco.js` é importado por páginas cliente → não pode importar `lib/mongodb.js`, `mongodb` nem módulos Node; ponto flutuante ingênuo erra o arredondamento (casos travados no contrato); validator de `grupos` está ativo via `setupDatabase.js` — campos novos não podem virar `required`; Windows: rodar Vitest de `J:\Cotea`

**Scale/Scope**: 5 grupos, 1 membro pagante, 5 faturas na base de desenvolvimento; pré-lançamento

## Decisões Invariantes

- **D-01 · Fonte única**: toda conta de preço passa por `lib/preco.js`
  (`calcularPrecoVaga`, `precoDoGrupo`, `validarNovaCapacidade`,
  `planejarMigracaoPrecos`). Nenhuma tela ou handler calcula `T/C` por conta
  própria. Módulo puro (D-01 vale para cliente e servidor).
- **D-02 · Aritmética**: centavos inteiros com
  `floor((2n + d) / (2d))` (meio-para-cima exato); `taxa = valorPorVaga −
  repasse`, pode ser 0. Gravação em reais (`Double`), como os campos atuais.
  Ver `logic/preco.md`.
- **D-03 · Campos do grupo**: `valorPorVaga` (mantido, agora calculado),
  `repassePorVaga`, `taxaPorVaga`, `precoValido` (novos). `parteDono =
  repassePorVaga` (não gravado à parte).
- **D-04 · Body nunca é fonte de preço**: `valorPorVaga`, `repassePorVaga`,
  `taxaPorVaga`, `vagasReservadasAdmin` e `vagasDisponiveis` do body são
  ignorados em criação e edição. `vagasReservadasAdmin = VAGAS_DONO (1)`;
  `vagasDisponiveis` = `C − 1` (criação) / `max(C − participantes, 0)`
  (edição).
- **D-05 · Edição**: o PUT recalcula a partir de `valorTotal`/`capacidadeTotal`
  do body, com a permissão atual (dono ou membro admin). A **UI de edição
  mantém T e C só-leitura**, como hoje; mudar preço/capacidade pela tela é
  V2-13. Só a API exerce US1-AC4/AC5.
- **D-06 · Participantes** = `membrosGrupo` do grupo com `papel !== 'admin'`
  e `status !== 'banido'` + 1 (dono). Contagem lida imediatamente antes do
  `updateOne`, sem transação (R-002).
- **D-07 · Cobrança**: fatura nova usa `precoDoGrupo`; inválido → 409
  `preco_indisponivel` antes de criar fatura. Fatura existente (`invoiceId`)
  é debitada pelo próprio `invoice.amount`. `composicao: { repasseDono,
  taxaCotea }` só em fatura nova. Ledger inalterado: 1 perna `pessoal`; sem
  `receita_taxa`.
- **D-08 · Ingresso**: recusa por preço inválido em `pay.js` (porta de entrada
  do fluxo pago) e `participar.js` (staff); `join.js` não recusa por preço
  (R-003).
- **D-09 · Exibição**: telas usam `precoDoGrupo`; inválido → "Preco
  indisponivel"; o checkout busca o grupo em `GET /api/grupos/[id]` e não lê
  mais `preco` da query; links deixam de enviar `preco`.
- **D-10 · Migração**: `scripts/migrar-precos-grupos.js`, dry-run por padrão,
  `--aplicar` grava, idempotente, auditoria por grupo alterado, não toca
  faturas. Ordem de implantação: migrar → deploy → migrar de novo (pega
  grupos criados pelo código antigo na janela).
- **D-11 · Mensagens**: erros de preço vêm de `calcularPrecoVaga` /
  `validarNovaCapacidade` (mesmo texto no formulário e na API), em português
  sem acento como as atuais; `campo` = `motivo`.

## Constitution Check

*GATE: deve passar antes da Fase 0. Reavaliado após o design da Fase 1.*

| Princípio | Pré-Design | Pós-Design | Notas |
| --- | --- | --- | --- |
| I. Segurança no servidor | PASS | PASS | Preço, reservadas e vagas deixam de vir do cliente (D-04); `pay.js` perde o fallback `req.body.amount` (hoje um usuário poderia pagar valor arbitrário se o grupo não tivesse preço); checkout deixa de confiar no `preco` da query (D-09). Handlers já usam `getServerSession` e recarregam o grupo do banco. |
| II. Integridade financeira | PASS | PASS | Nenhum movimento novo de dinheiro; o débito de assinatura continua pelo núcleo do ledger com `operacaoId` idempotente. A decomposição fica na fatura como dado, **não** como movimento (registrar `receita_taxa` sem a perna correspondente seria campo solto — por isso fica para V2-06/V2-11). Valores em centavos inteiros; `normalizeAmount` segue nos pontos que já o usam — `lib/preco.js` não o importa porque `lib/wallet.js` puxa `lib/mongodb.js` (inviável no cliente); a normalização equivalente é feita em centavos (R-004). |
| III. Regras de negócio como fonte | PASS | PASS | Spec cita RN:394-398, 409, 1097-1098. A regra de arredondamento (taxa absorve resíduo), `vagasReservadasAdmin = 1`, recusa de capacidade abaixo dos participantes e o "sem fallback" não estão na RN: T030 atualiza o Fluxo 4 (Regras e Gap) e as Regras financeiras consolidadas na mesma entrega. |
| IV. Persistência documentada | PASS | PASS | `grupos.schema.json` e `invoices.schema.json` atualizados (T002); sem coleção/índice novos, então `setupDatabase.js` não muda. IDs: grupos continuam `ObjectId`; `invoices.grupoId` string, como hoje. |
| Restrições do Projeto | PASS | PASS | Pages Router, driver nativo, helpers de `lib/` (`logAudit`, `getDb`, `parseObjectId`); Vitest; mensagens em português; script com `MongoClient` próprio, padrão da 002; nenhuma rotina agendada. |
| Fluxo de Desenvolvimento | PASS | PASS | Polish cobre build, lint, `npm test` (contratos 001+002+003), quickstart; consumidores de `/api/grupos*` e `/api/assinaturas/pay` em `pages/` atualizados na mesma mudança (US3); nenhuma variável de ambiente nova. |

## Project Structure

### Documentation (this feature)

```text
sdd/specs/003-preco-por-vaga/
├── spec.md
├── plan.md                 # este arquivo
├── data-model.md           # campos de grupos/invoices, auditoria, migração
├── contracts/
│   └── api-grupos.md       # criação, edição, pay, participar, join, checkout
├── logic/
│   └── preco.md            # fórmula inteira, ordem das validações, planner
├── quickstart.md
├── tasks.md
├── contract-tests.lock
└── handoff.md
```

### Source Code (repository root)

Arquivos que esta feature cria (+) ou altera (~), na árvore real:

```text
lib/
├── preco.js                         + STUB (plan) → regra única, precoDoGrupo, capacidade, planner
├── invoices.js                      ~ createInvoice aceita `composicao`
└── grupos-utils.js                  (inalterado; normalizarPreco deixa de ser usado para preço)
pages/
├── api/
│   ├── grupos/
│   │   ├── index.js                 ~ POST: calcularPrecoVaga, ignora body, auditoria
│   │   ├── [id].js                  ~ PUT: recálculo, validarNovaCapacidade, auditoria antes/depois
│   │   └── [id]/
│   │       ├── join.js              ~ reservadas = VAGAS_DONO
│   │       └── participar.js        ~ recusa preço inválido
│   └── assinaturas/pay.js           ~ precoDoGrupo, sem fallback, composicao, invoice.amount
├── admin/grupos/
│   ├── novo.js                      ~ prévia via calcularPrecoVaga; sem envio de valorPorVaga/reservadas
│   ├── [id].js                      ~ reservadas fixa "1 (vaga do dono)"; prévia; sem envio dos campos ignorados
│   └── index.js                     ~ lista usa precoDoGrupo
├── grupos/[id].js                   ~ precoDoGrupo; link do checkout sem `preco`
├── index.js                         ~ precoDoGrupo
└── assinatura/
    ├── pagamento.js                 ~ busca GET /api/grupos/[id]; nota da taxa
    └── relacionamento.js            ~ não repassa `preco`
scripts/
└── migrar-precos-grupos.js          + migração dry-run/--aplicar
database/schemas/
├── grupos.schema.json               ~ repassePorVaga, taxaPorVaga, precoValido
└── invoices.schema.json             ~ composicao
tests/
├── contract/003-preco-por-vaga.contract.test.js   + TRAVADO (5 testes)
└── preco/                           + testes adicionais do execute
.docs/regras-negocio-v2.md           ~ Fluxo 4 + regras financeiras consolidadas
```

**Structure Decision**: projeto único Next.js (Pages Router). Regra pura em
`lib/` (padrão de `lib/calendario.js` e `lib/ledger/ledger.js`), testes em
`tests/` (Vitest, `tests/**/*.test.js`), scripts operacionais em `scripts/`.

## Complexity Tracking

> Sem violações da constitution.

| Violação | Por que é necessária | Alternativa mais simples rejeitada porque |
| --- | --- | --- |

## Estratégia de Testes

Prioridade: unitário (regra pura) → contrato → manual (`quickstart.md`) para
handlers, telas e migração real. Sem E2E automatizado no projeto.

Comandos-base (de `J:\Cotea`):

```powershell
npm test
npm run test:contrato
npx vitest run tests/contract/003-preco-por-vaga.contract.test.js
.\.planning\scripts\powershell\check-contract-tests.ps1 -Slug 003-preco-por-vaga
npm run lint
npm run build
```

### Testes de Contrato

Arquivos travados em `contract-tests.lock`: `tests/contract/003-preco-por-vaga.contract.test.js` (5 testes)

Comando: `npx vitest run tests/contract/003-preco-por-vaga.contract.test.js`

Validados contra uma implementação de referência descartável (5/5 verdes)
antes de travar — são satisfazíveis.

| Teste | Origem | Fase | Vermelho esperado (antes do execute) |
| --- | --- | --- | --- |
| calcula valor por vaga, repasse e taxa pela regra única, com meio-para-cima exato e taxa absorvendo o resíduo | US1-AC1/AC2 · FR-001 · SC-001 | Fase 2 | `Error: not implemented` |
| recusa capacidade < 2 ou não inteira, valor total inválido e repasse abaixo de R$ 0,01 | US1-AC3 · FR-004/005/006 | Fase 2 | `Error: not implemented` |
| precoDoGrupo usa só o preço vigente gravado e nunca cai em fallback legado | US2-AC1/AC2, US3-AC4 · FR-010/011/014 | Fase 2 | `Error: not implemented` |
| recusa capacidade nova abaixo de dono + membros ativos e aceita igual | US1-AC4 · FR-007 | Fase 2 | `Error: not implemented` |
| migração recalcula válidos, marca inválidos sem inventar valores, normaliza reservadas e é idempotente | US4-AC1/AC2/AC3 · FR-008/015 · SC-005 | Fase 6 | `Error: not implemented` |

Stubs criados pelo plan (ponto de partida do execute, não travados): `lib/preco.js`

## Estado Atual

| Área | Estado |
| --- | --- |
| Regra pura (`lib/preco.js`) | Pronta |
| Criação/edição (US1) | Pronta e testada |
| Cobrança (US2) | Pronta e testada |
| Telas (US3) | Prontas e validadas no navegador (lista admin só pela API: exige papel) |
| Migração (US4) | Aplicada na base de desenvolvimento; idempotente |
| Gates | 121/121; travas 001/002/003 íntegras; lint 0 erros; build ok |
| Feature | Implementada |

## Riscos e Decisões

| ID | Risco/Decisão | Impacto | Mitigação/Encaminhamento |
| --- | --- | --- | --- |
| R-001 | Janela de implantação: código novo com grupos ainda sem `precoValido` → todos aparecem "Preco indisponivel" e não cobram | Alto (bloqueia entrada) por minutos | D-10: migrar antes do deploy (código antigo ignora os campos novos e já cobra o `valorPorVaga` novo) e migrar de novo depois. Base de desenvolvimento já migrada em 2026-11-24; produção segue a mesma ordem no deploy |
| R-002 | Edição de capacidade concorrente com um ingresso pode deixar o grupo 1 acima da capacidade | Baixo (pré-lançamento, edição só por API) | Aceito; a spec pede contagem no momento da gravação. Revisitar em V2-13 (pedido aprovado) |
| R-003 | `join.js` não recusa grupo sem preço válido; um grupo invalidado entre `pay` e `join` ainda recebe o membro | Baixo (invalidação só pela migração) | Aceito: recusar no join prenderia dinheiro já debitado; checagem fica em `pay.js` e `participar.js` |
| R-004 | Constitution II pede `normalizeAmount()`; `lib/preco.js` não pode importá-lo (cadeia `lib/wallet.js` → `lib/mongodb.js` quebra no cliente) | Baixo | Normalização equivalente em centavos inteiros dentro de `lib/preco.js`; handlers seguem usando `normalizeAmount` onde já usam. Registrado no Constitution Check |
| R-005 | Fatura `aguardando_recarga` emitida antes da migração com preço antigo é paga pelo `amount` antigo (sem taxa) | Baixo (nenhuma nessa situação na base hoje) | Comportamento desejado (FR-016: faturas emitidas não mudam) |
| R-006 | Handlers não tinham teste automatizado (importam `lib/mongodb.js`) | Médio (validação só manual) | Resolvido: `vi.mock` de `next-auth`, `lib/mongodb`, `lib/audit`, `lib/r2` + banco em memória `tests/helpers/db-grupos-memoria.js`; cobre quickstart §2–§3 de API. Passada manual no navegador segue na T025 |
| R-007 | Script de migração grava números inteiros (ex.: 45) como `int32`, enquanto os handlers gravam `Double` | Baixo (schema aceita `number`; `precoDoGrupo` usa `Number()`) | Aceito; sem impacto de leitura |

## Execution Notes

<!--
  Tabela append-only, mantida pelo sdd-execute. Quando passar de ~40 linhas,
  arquivar as mais antigas (exceto as ~10 mais recentes) em history.md,
  substituindo por uma linha de resumo consolidado aqui.
-->

| Data | Fase/Story | Resumo | Pendência Principal |
| --- | --- | --- | --- |
| 2026-11-24 | Fase 2 | Regra pura e schemas; contratos 1–4 verdes | Fase 3: handlers de criação/edição |
| 2026-11-24 | Fase 3 (US1) | Criação/edição com regra única, capacidade e auditoria; testes de handler com banco em memória | Fase 4: cobrança |
| 2026-11-24 | Fase 4 (US2) | Cobrança só pelo preço gravado, composição na fatura, 409 sem fallback | Fase 5: telas |
| 2026-11-24 | Fase 5 (US3) | Telas usam a regra única e o preço gravado; checkout sem preço na URL | T018 depende da migração (Fase 6) |
| 2026-11-24 | Fase 6 (US4) | Planner e script de migração; contratos 5/5; dry-run real ok | `--aplicar` aguarda autorização |
| 2026-11-24 | Fase 7 (Polish) | Regras de negócio atualizadas; suíte 121/121, 3 travas íntegras, lint 0 erros, build ok (em cópia, dev server ativo) | Autorização para `--aplicar`; depois T018/T022/T025 |
| 2026-11-24 | Polish / T018 / T022 / T025 | Migração aplicada (5/5, 2ª execução 0); telas validadas no navegador; feature implementada | Deploy: migrar → deploy → migrar de novo (D-10); converge |

**PRÓXIMO**: `sdd-converge 003-preco-por-vaga`

## Arquivos Principais

- `lib/preco.js`
- `pages/api/grupos/index.js`, `pages/api/grupos/[id].js`, `pages/api/assinaturas/pay.js`
- `scripts/migrar-precos-grupos.js`
- `components/PrevisaoPreco.js`

## Cuidados para Retomada

<!-- Armadilhas operacionais específicas desta feature, anexadas conforme descobertas. -->
- `tests/helpers/db-grupos-memoria.js` devolve **cópias** em `findOne`/`find` (como o driver); sem isso a auditoria 'antes' sai igual ao 'depois'.
- Antes da migração, todo grupo aparece 'Preco indisponivel' e não cobra (R-001): validar telas só depois de `scripts/migrar-precos-grupos.js --aplicar`.
- Build com o dev server na porta 3000: copiar o repo para `J:/Cotea/.tmp-build-003` (sem `node_modules`/`.next`/`.git`) e rodar `npx next build` lá; cópia no drive C: com junção falha (webpack não resolve caminho entre drives). Apagar a pasta depois, sair dela antes (o shell trava o diretório).
