# Bug Fix: Página de edição de grupo abre para qualquer usuário logado

- **Slug**: admin-editar-grupo-sem-permissao
- **Corrigido**: 2026-11-24
- **Assessment**: ./assessment.md
- **Status**: applied

## Summary

O `getServerSideProps` de `/admin/grupos/[id]` passou a exigir sessão no servidor e a autorizar pelo mesmo critério do PUT (dono/membro admin não banido) ou por staff com `PERMISSIONS.GROUPS_TAB`. Sem sessão redireciona ao login; sem permissão devolve `notFound` sem nenhum dado nos props.

## Changes

| Arquivo | Mudança | Notas |
| --- | --- | --- |
| `lib/grupos-acesso.js` | added | `podeEditarGrupo` (regra pura, normaliza ObjectId/string, bloqueado negado), `carregarGrupoParaEdicao` e `resolverPaginaEdicaoGrupo` (redirect / notFound / props). Recebe `db` por parâmetro. |
| `pages/admin/grupos/[id].js` | modified | Só o `getServerSideProps` e imports: `getServerSession` + `resolverPaginaEdicaoGrupo`. Removidos o `fetch` à API pública e o `aggregate`; o enriquecimento do grupo (admin, membrosAtivos) e a lista de participantes têm o mesmo formato de antes. |

## Tests Added or Updated

- `tests/bugs/admin-editar-grupo-sem-permissao.test.js` — sem sessão (redirect), estranho/membro comum/admin banido/finance/bloqueado/grupo inexistente/ID inválido (notFound sem vazar `observacoesInternas` nem e-mails), dono (ObjectId e string), co-admin, staff support/admin, regra pura e verificação de que o gSSP usa `getServerSession` e não usa `fetch`.

## Local Verification

- `npx vitest run` (de `J:\Cotea`) → 25 arquivos, 146 testes passando.
- `npx eslint` nos 3 arquivos tocados → sem erros.
- `check-contract-tests.ps1` dos slugs 001, 002 e 003 → trava íntegra.

## Deviations from Assessment

Nenhuma. A leitura passou a ser direta do banco (conforme a preferida do assessment) em vez do `fetch` à API pública.

## Follow-ups

- Dono com `systemRole: 'user'` passa a ver a tela mas `handleSalvar` só permite admin do sistema (comportamento já existente, não alterado); avaliar se deve salvar.
- `pages/admin/grupos/index.js` e `novo.js` merecem a mesma checagem server-side se ainda não a têm (fora do escopo).
- Validação manual com sessões reais (dono, estranho, staff) no dev server ainda não executada.
