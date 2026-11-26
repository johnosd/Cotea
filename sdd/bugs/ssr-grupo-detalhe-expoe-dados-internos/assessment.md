# Bug Assessment: SSR de /grupos/[id] expõe dados internos e e-mails a qualquer visitante

- **Slug**: ssr-grupo-detalhe-expoe-dados-internos
- **Criado**: 2026-11-26
- **Origem**: achado A-02 / risco R-003 do plan da feature 005-aprovacao-grupos (texto colado)
- **Veredito**: valid
- **Severidade**: high

## Report

`getServerSideProps` de `pages/grupos/[id].js` carrega o documento completo do grupo e devolve
`props: { grupo: { ...grupoDoc, adminNome, adminEmail, adminAvatar, participantes } }`. Tudo isso
vai para o HTML e para o `__NEXT_DATA__`, visível a qualquer visitante, inclusive anônimo. O bug
`get-grupo-expoe-dados-internos` corrigiu só a API `GET /api/grupos/[id]`; o SSR da página ficou
de fora.

## Symptom

Visitante sem sessão (ou usuário comum que não é dono/admin do grupo nem staff) recebe
`observacoesInternas`, `necessitaAnalise`, `imageKey`, `adminEmail`, `admin.email`,
`participantesIds`, `adminId`/`adminIdString` e o e-mail de cada participante
(`participantes[].email`, além de `participantes[].userId`). Esperado: só dados de vitrine/cobrança.

## Reproduction

1. Sem sessão, abrir `/grupos/<id>` de um grupo com `observacoesInternas` preenchido e membros.
2. Ver o código-fonte da página: o `__NEXT_DATA__` contém os campos acima.

Confirmado por leitura (`pages/grupos/[id].js`, `getServerSideProps`: spread de `grupoDoc` e
`email: m.email` em cada participante; fallback de nome com e-mail). Será reproduzido de forma
automatizada no teste de regressão.

## Suspected Code Paths

- `pages/grupos/[id].js` `getServerSideProps` — spread `...grupoDoc`, `adminEmail`, `participantes[].email/userId`;
  sem checagem de sessão. Fallbacks `adminMember?.email` (adminNome) e `m.email` (nome do participante)
  também gravam e-mail em campos de exibição.
- `pages/grupos/[id].js` componente — consumo real de `grupo` (mapeado abaixo).
- `pages/api/grupos/[id].js` `podeVerCamposInternos` — regra de visão completa a reaproveitar (não exportada).
- `lib/grupo-publico.js` — allowlist e `montarRespostaGrupo`, a reutilizar sem duplicar.

### Mapa de consumo da UI (`pages/grupos/[id].js`)

Do grupo: `_id`, `nome`, `subtitulo`, `descricao`, `imageUrl`/`capa`, `acesso`, `tempoEntrega`,
`confiabilidade`, `beneficios`, `fidelidade`, `regras`, `faq`, `linkOficial`, `capacidadeTotal`,
`valorPorVaga`/`repassePorVaga`/`taxaPorVaga`/`precoValido` (via `precoDoGrupo`), `adminNome`,
`adminAvatar` — todos já na allowlist. Para identificar o dono a UI hoje usa `adminIdString`,
`adminId`, `admin.id/userId`, `adminEmail`/`admin.email` e participantes com `papel === 'admin'`
casando por `userId` ou e-mail; para saber se é membro, `participantes[].userId`/`email`. Esses
três usos (dono, membro, e-mail) são os que forçam a exposição e serão trocados por flags
calculadas no servidor.
De participante: `nome`, `avatar` (todos); `papel`, `aguardandoEnvioAcesso` (só botões do dono:
"Enviar acessos", "Enviar mensagem"); `status` (só em `calcularStatusGrupo`, e o servidor já filtra
banidos); `dataEnvioAcesso` e `email` não são exibidos.

## Root Cause Hypothesis

O SSR foi escrito como "documento inteiro + membros" sem distinguir quem vê, e a UI usa e-mail e
IDs nas props para decidir no cliente quem é dono e quem é membro. Falta a allowlist e a decisão
de visão no servidor (constitution I). Confiança: alta.

## Proposed Remediation

**Preferida**: criar `lib/grupo-visao-servidor.js` com `identificarVisaoGrupo` (sessão opcional,
falha segura; staff `GROUPS_TAB`, dono/admin do grupo e `userId` da sessão; conta bloqueada = pública)
e usar `montarRespostaGrupo` de `lib/grupo-publico.js` no SSR (allowlist para o público, visão
completa para staff/dono). O servidor passa a calcular `visao: { jaMembro, souAdmin }` e a página
deixa de depender de e-mail/IDs para isso. Participantes: público recebe só `nome` e `avatar`;
dono/staff recebem também `userId`, `papel`, `status`, `aguardandoEnvioAcesso`, `dataEnvioAcesso`;
e-mail de participante não vai a ninguém (a UI não o exibe). Fallbacks de nome com e-mail só na
visão completa. `getServerSideProps` passa a receber `{ params, req, res }`; sem gate de status
(feature 005, T013) — mesmo comportamento de visibilidade de hoje.

**Alternativas**:
- Exportar `podeVerCamposInternos` da rota de API e importar na página: acopla página a módulo de
  API (r2, audit) e a rota está sendo alterada pela feature 005; descartada.
- Mudar a página para buscar `GET /api/grupos/[id]` no SSR: perde cookies e duplica rede; descartada.

**Files likely to change**:
- `lib/grupo-visao-servidor.js` (novo)
- `pages/grupos/[id].js` (SSR + consumo de `visao`)
- `tests/bugs/ssr-grupo-detalhe-expoe-dados-internos.test.js` (novo)

**Tests to add or update**:
- anônimo e usuário comum: sem campos internos, sem e-mails, sem `participantesIds`/`imageKey`/`adminId`; mantém preço/vitrine.
- dono e staff (support) recebem visão completa; finance não; bloqueado não.
- falha de sessão = pública; 404 para id inválido/inexistente; `visao.jaMembro`/`souAdmin` corretos.

## Risks & Considerations

- A feature 005 (T013) vai acrescentar o gate de visibilidade ao mesmo `getServerSideProps`
  (assinatura já com `req`/`res`) e `podeVerCamposInternos` da API (T012) segue duplicado com
  `identificarVisaoGrupo`: unificar na 005 (a rota de API não foi tocada aqui por estar em edição).
- `adminNome` na API ainda pode cair em e-mail (`adminUser?.email`) quando não há nome: vazamento
  residual pré-existente da API, fora do escopo; sinalizado.
- Efeito colateral na UI: o público deixa de receber `status` de participante, `papel`; sem impacto visual.

## Open Questions

- Nenhuma bloqueante. Decisão registrada: `userId` de participante não vai ao público (a checagem
  de "já sou membro" passa a vir do servidor em `visao.jaMembro`).
