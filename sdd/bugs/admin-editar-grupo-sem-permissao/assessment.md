# Bug Assessment: Página de edição de grupo abre para qualquer usuário logado

- **Slug**: admin-editar-grupo-sem-permissao
- **Criado**: 2026-11-24
- **Origem**: texto colado (descoberto durante a feature 003-preco-por-vaga)
- **Veredito**: valid
- **Severidade**: high

## Report

A página `/admin/grupos/[id]` abre para qualquer usuário logado, inclusive quem não é dono do grupo nem staff. O `getServerSideProps` lê o grupo e os membros direto do Mongo e entrega tudo como props. Salvar fica bloqueado no cliente e o PUT da API exige dono/membro admin, mas os dados (membros, e-mails, campos internos) aparecem para quem não deveria. Verificado em 2026-11-24 com sessão `systemRole: 'user'` que não é dona do grupo "Canva Pro": o formulário completo foi renderizado.

## Symptom

Observado: qualquer visitante, até sem sessão, recebe no HTML/props o grupo completo e a lista de participantes com e-mail. Esperado: só dono/membro admin não banido do grupo, ou staff com `PERMISSIONS.GROUPS_TAB`, veem a página; os demais são redirecionados (sem sessão) ou recebem 404 sem dados.

## Reproduction

1. Entrar com um usuário `systemRole: 'user'` que não é dono do grupo.
2. Abrir `/admin/grupos/<id do grupo>`.
3. O formulário completo renderiza, com e-mails dos participantes e `observacoesInternas` nos props (`__NEXT_DATA__`).

Confirmado por leitura do código: o `getServerSideProps` (`pages/admin/grupos/[id].js:959`) recebe só `{ params }`, nunca chama `getServerSession`. Também não há sessão necessária para a requisição, então visitante anônimo recebe os props (a checagem do cliente só redireciona depois da hidratação).

## Suspected Code Paths

- `pages/admin/grupos/[id].js:959` — `getServerSideProps` sem sessão nem autorização; busca o grupo por `fetch` à API pública e participantes (nome/e-mail) por `aggregate`.
- `pages/admin/grupos/[id].js:93,229` — checagens só no cliente (`isSystemAdmin`, `handleSalvar`), inócuas contra vazamento.
- `pages/api/grupos/[id].js:187-201` — critério de referência: dono (`adminId`/`adminIdString`/`admin.userId`) ou `membrosGrupo` com `papel: 'admin'` e `status != 'banido'`.
- `lib/authz.js:13` — `PERMISSIONS.GROUPS_TAB = ['support','admin']`; `hasRole` já bloqueia `isBlocked`.

## Root Cause Hypothesis

O `getServerSideProps` foi escrito sem verificar a sessão no servidor (Constitution I). A proteção existe só no cliente e no PUT, que não impedem a leitura dos props. Confiança: alta.

## Proposed Remediation

**Preferida**: no `getServerSideProps`, obter `getServerSession(req, res, authOptions)`; sem sessão, `redirect` para `/auth/signin?callbackUrl=...`; carregar o grupo do banco e decidir com uma função pura `podeEditarGrupo` (dono/membro admin não banido, normalizando ObjectId vs string, ou `hasRole(session, PERMISSIONS.GROUPS_TAB)`; usuário bloqueado nunca). Quem não pode recebe `notFound` (não confirma a existência do grupo) e nenhum dado vai nos props. Mover a lógica para `lib/grupos-acesso.js` (testável sem JSX, pois o Vitest não faz parse de JSX em `.js`). Ler o grupo direto do Mongo (em vez do `fetch` à API pública) desacopla a página da correção em paralelo do GET público, que pode remover campos internos/e-mail que esta tela precisa; manter o mesmo formato de props (grupo enriquecido + participantes). Trocar o `aggregate`/`$lookup` por `find` + busca de `users` por `$in`, equivalente e compatível com o fake em memória.

**Alternativas**:
- Manter o `fetch` à API e só adicionar a checagem: menor diff, mas fica dependente do GET público em mudança e de `NEXT_PUBLIC_SITE_URL`.

**Files likely to change**:
- `pages/admin/grupos/[id].js` (só o `getServerSideProps` e imports)
- `lib/grupos-acesso.js` (novo)
- `tests/bugs/admin-editar-grupo-sem-permissao.test.js` (novo)

**Tests to add or update**:
- Regra pura `podeEditarGrupo` (dono por `adminId` ObjectId/string, membro admin, membro banido, membro comum, staff support/admin, finance/user negados, bloqueado negado).
- `carregarGrupoParaEdicao` com o banco em memória: sem sessão, estranho, dono, staff, grupo inexistente/ID inválido, e ausência de vazamento para negados.

## Risks & Considerations

- Dono com `systemRole: 'user'` passa a ver a página mas continua sem conseguir salvar (`handleSalvar` exige admin do sistema); comportamento existente, não alterado.
- Dados enriquecidos (adminNome etc.) devem manter o mesmo formato para a tela.

## Open Questions

- Nenhuma bloqueante. Observação: a tela só salva para `systemRole === 'admin'`, o que sugere que dono comum não edita pela UI; fora do escopo.
