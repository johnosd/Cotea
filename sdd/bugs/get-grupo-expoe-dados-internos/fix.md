# Bug Fix: GET /api/grupos/[id] expõe dados internos sem sessão

- **Slug**: get-grupo-expoe-dados-internos
- **Corrigido**: 2026-11-24
- **Assessment**: ./assessment.md
- **Status**: applied

## Summary

O GET público passou a devolver só uma allowlist de campos (`lib/grupo-publico.js`). A visão
completa (documento inteiro + dados do dono, contrato antigo) só sai para staff
(`PERMISSIONS.GROUPS_TAB`: admin/support) e para dono/admin do grupo, com sessão válida e conta não bloqueada.

## Changes

| Arquivo | Mudança | Notas |
| --- | --- | --- |
| `lib/grupo-publico.js` | added | `CAMPOS_PUBLICOS_GRUPO` + `montarRespostaGrupo()`; puro, sem mongodb |
| `pages/api/grupos/[id].js` | modified | só o GET: `podeVerCamposInternos()` (getServerSession opcional, falha segura) e `handleGet(grupoId, req, db, res)`; PUT/DELETE intactos |
| `tests/bugs/get-grupo-expoe-dados-internos.test.js` | added | regressão |

Resposta pública: identidade/vitrine (`_id`, `nome`, `slug`, `capa`, `imageUrl`, `subtitulo`, `descricao`,
`categoria`, `tipoGrupo`, `status`, `statusDetalhado`, `acesso`, `tempoEntrega`, `confiabilidade`,
`linkOficial`, `beneficios`, `regras`, `faq`, `fidelidade`), preço/vagas (`valorTotal`, `valorPorVaga`,
`repassePorVaga`, `taxaPorVaga`, `precoValido`, `capacidadeTotal`, `vagasReservadasAdmin`, `vagasDisponiveis`),
características (`servicoPreAssinado`, `envioAutomaticoAcesso`, `filaEsperaAtiva`), datas, `membrosAtivos`,
`adminNome`, `adminAvatar` e `admin: { id, nome, avatar }`.
Restrito (só visão completa): `observacoesInternas`, `necessitaAnalise`, `adminEmail`, `admin.email`,
`participantesIds`, `imageKey`, `adminId`, `adminIdString` e qualquer campo futuro não listado.

## Tests Added or Updated

- `tests/bugs/get-grupo-expoe-dados-internos.test.js` — anônimo sem campos internos/e-mail; mantém preço e vitrine;
  404/400; erro de sessão; usuário comum, membro, finance e conta bloqueada não veem; dono, admin do grupo
  (não banido) e staff veem; allowlist sem campos internos e fechada para campos novos.

## Local Verification

- `npx vitest run tests/bugs` (de `J:\Cotea`) → 13/13.
- Ver `test.md` para a suíte completa.

## Deviations from Assessment

Nenhuma. Observação: ao final, `pages/admin/grupos/[id].js` (corrigido pelo outro bug) já não faz `fetch`
ao GET no `getServerSideProps`, então o risco registrado no assessment não se materializou. O consumidor
restante, `pages/assinatura/pagamento.js`, não precisou de ajuste.

## Follow-ups

- Campo novo de grupo que precise aparecer na vitrine/cobrança deve ser adicionado a `CAMPOS_PUBLICOS_GRUPO`.
- Staff é decidido por `hasRole` sobre a sessão JWT (padrão do projeto), sem recarregar o usuário do banco.
