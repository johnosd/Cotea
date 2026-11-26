# Bug Fix: SSR de /grupos/[id] expõe dados internos e e-mails a qualquer visitante

- **Slug**: ssr-grupo-detalhe-expoe-dados-internos
- **Corrigido**: 2026-11-26
- **Assessment**: ./assessment.md
- **Status**: applied

## Summary

O `getServerSideProps` de `pages/grupos/[id].js` passou a montar as props com a allowlist de
`lib/grupo-publico.js` (visão completa só para staff `GROUPS_TAB` e dono/admin do grupo, sessão
lida com `getServerSession`, falha = pública). A identidade do visitante (já é membro? é dono?)
agora é calculada no servidor e enviada em `visao`, então a página não precisa mais de e-mail nem
de `userId` de participantes nas props públicas.

## Changes

| Arquivo | Mudança | Notas |
| --- | --- | --- |
| `lib/grupo-visao-servidor.js` | added | `identificarVisaoGrupo`: sessão opcional, staff, dono/admin (adminId ou `membrosGrupo` admin não banido), bloqueado = pública |
| `pages/grupos/[id].js` | modified | SSR com `{ params, req, res }`, `montarRespostaGrupo`, participantes reduzidos, prop `visao { jaMembro, souAdmin }`; componente usa `visao` em vez de e-mail/IDs |
| `tests/bugs/ssr-grupo-detalhe-expoe-dados-internos.test.js` | added | regressão (15 testes) |
| `vitest.config.mjs` | modified | `oxc.include/exclude/lang/jsx` para o Vite aceitar JSX nos `.js` de `pages/` e `components/` (só assim o teste importa o `getServerSideProps` da página); não afeta os demais testes |

### Mapa de campos

Público (visitante, usuário comum, membro, bloqueado, erro de sessão): allowlist `CAMPOS_PUBLICOS_GRUPO`
+ `adminNome`, `adminAvatar`, `membrosAtivos`, `admin { id, nome, avatar }`; participantes só com
`nome` e `avatar`; `visao.jaMembro` do próprio visitante. `admin.id` (id do dono) é público também
na API e a página não o usa; mantido por consistência com a API.

Visão completa (staff e dono/admin do grupo): documento inteiro + dados do dono (`adminEmail`,
`admin.email`, `observacoesInternas`, `necessitaAnalise`, `imageKey`, `participantesIds`...),
e participantes com `userId`, `status`, `papel`, `aguardandoEnvioAcesso`, `dataEnvioAcesso`
(botões "Enviar acessos"/"Enviar mensagem"). Para ninguém vai o e-mail de participante, nem
e-mail como nome de exibição de participante; e-mail como fallback de `adminNome` só na visão completa.

`visao.souAdmin` só é verdadeiro para dono/admin do grupo: staff que não é dono continua sem os
botões do dono, como antes.

## Tests Added or Updated

- `tests/bugs/ssr-grupo-detalhe-expoe-dados-internos.test.js` — anônimo, usuário comum, membro,
  banido, erro de sessão, conta bloqueada (dono e admin do sistema) e finance sem campos internos,
  e-mails nem IDs de participantes (participante com só `nome`/`avatar`); mantém vitrine e preço;
  nome sem cadastro não cai no e-mail; dono, admin via `membrosGrupo` e staff (support/admin)
  recebem a visão completa; admin banido volta à pública; `notFound` para id inválido/inexistente;
  props serializáveis. Usa um `aggregate` mínimo no próprio teste (o fake travado não tem).
  Contra o código antigo, 13 dos 15 falham (os 2 que passam são `notFound`).

## Local Verification

- `npx vitest run tests/bugs/ssr-grupo-detalhe-expoe-dados-internos.test.js` (de `J:\Cotea`) → 15/15.
- Mesmo teste contra a página de `HEAD` → 13 falhas (regressão travada de fato).
- Ver `test.md` para suíte completa, lint e build.

## Deviations from Assessment

`vitest.config.mjs` não estava na lista de arquivos: foi necessário para o Vitest (Vite 8/oxc)
analisar JSX em `pages/*.js`. Mudança restrita a `pages/` e `components/`.

## Follow-ups

- Feature 005: T012 (API) e T013 (SSR) devem decidir a visibilidade por status uma só vez. O SSR
  já tem `visao` (`staff`, `dono`, `userId`, `completa`) e o comentário do ponto de extensão logo
  antes de montar as props; falta acrescentar "membro atual não banido" ao gate. Sugestão: fazer
  `podeVerCamposInternos` da API usar `identificarVisaoGrupo` para ter uma única regra.
- T013/T036/T041 não devem passar `moderacao` a terceiros: `moderacao` não está em
  `CAMPOS_PUBLICOS_GRUPO`, então só a visão completa (dono/staff) o carrega. Para exibir o banner
  a membro (T041) enviar um campo derivado em `visao`, nunca o objeto `moderacao`.
- Resíduo pré-existente na API: `adminNome` em `GET /api/grupos/[id]` cai em `adminUser.email` quando
  o dono não tem nome; vale remover o fallback na visão pública (arquivo em edição pela feature 005).
