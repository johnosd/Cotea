# Contrato de API: moderação de grupos (005-aprovacao-grupos)

Erros sempre `{ error: <mensagem em português>, codigo: <CODIGOS_MODERACAO> }`.
Sessão via `getServerSession`; usuário e grupo recarregados do banco.

## `POST /api/admin/grupos/[id]/moderacao` — decisões do admin do sistema

Body: `{ acao, texto? }`, `acao` ∈ `ACOES_ADMIN`
(`aprovar`, `pedir_ajuste`, `rejeitar`, `confirmar_revisao`, `reprovar_revisao`, `cancelar`).

| Situação | HTTP | `codigo` |
| --- | --- | --- |
| sem sessão | 401 | — |
| sessão sem `PERMISSIONS.MODERAR_GRUPOS` (`['admin']`; suporte incluso) ou bloqueado | 403 | — |
| id inválido / grupo inexistente | 400 / 404 | — |
| `acao` fora de `ACOES_ADMIN` | 400 | `acao_invalida` |
| `acao` com texto obrigatório e texto vazio após `trim` | 400 | `texto_obrigatorio` |
| texto > 1000 caracteres | 400 | `texto_longo` |
| grupo não está no estado de origem da ação (ou outra decisão venceu) | 409 | `moderacao_conflito` |
| sucesso | 200 | `{ message, status, moderacao }` |

Validação de texto antes da checagem de estado (texto vazio → 400 mesmo que o
estado também esteja errado).

## `POST /api/grupos/[id]/moderacao` — dono

Body: `{ acao, texto? }`, `acao` ∈ `ACOES_DONO` (`reenviar`, `desistir`, `encerrar`). `encerrar` (R-008, decidido no execute): `ativo` → `cancelado` com `cancelamento.origem: 'dono'`, `texto` opcional (até 1000) e notificação só aos membros atuais; sem estorno até a V2-14.

| Situação | HTTP | `codigo` |
| --- | --- | --- |
| sem sessão | 401 | — |
| não é o dono (`adminId`/membro `papel: admin` não banido) | 403 | — |
| `reenviar`: conta não validada / bloqueado (banco ou sessão) | 403 | — |
| `reenviar`: cadastro financeiro incompleto | 409 | `cadastro_financeiro_incompleto` (corpo de `verificarCadastroFinanceiro`) |
| `acao` inválida | 400 | `acao_invalida` |
| estado de origem errado | 409 | `moderacao_conflito` |
| sucesso | 200 | `{ message, status, moderacao }` |

`desistir` e `encerrar` não exigem cadastro nem conta desbloqueada (só ser o dono).

## `GET /api/admin/moderacao?visao=pendentes|revisao|aprovados`

Permissão: `PERMISSIONS.GROUPS_TAB` (suporte e admin). Resposta:

```js
{
  contagens: { pendentes: number, revisao: number },
  podeDecidir: boolean,            // hasRole(session, PERMISSIONS.MODERAR_GRUPOS)
  itens: [{
    _id, nome, categoria, descricao, subtitulo, imageUrl, linkOficial,
    valorTotal, valorPorVaga, repassePorVaga, taxaPorVaga, capacidadeTotal, acesso,
    necessitaAnalise, observacoesInternas,
    dono: { id, nome, email },     // e-mail: tela restrita a staff
    status, moderacao: { envio, enviadoEm, aprovacao, ultimaDecisao, historico },
    venceEm: Date | null,          // só em 'pendentes' (vencimentoAprovacao)
  }],
}
```

`pendentes`: `status: 'em_aprovacao'`, ordem `moderacao.enviadoEm` crescente.
`revisao`: `status: 'ativo'` e `moderacao.revisaoPendente: true`, ordem
`moderacao.aprovacao.em` crescente. `aprovados` (acrescentada no execute, T040):
`status: 'ativo'`, ordem `updatedAt` decrescente, para o cancelamento pelo Cotea.
Visão desconhecida cai em `pendentes`. Limite 200 itens por visão.

## Alterações em rotas existentes

| Rota | Mudança |
| --- | --- |
| `POST /api/grupos` | grava `status: 'em_aprovacao'`, `statusDetalhado: 'em_formacao'` e `moderacao` inicial; ignora `status`, `statusDetalhado`, `moderacao` do body; `tipoGrupo` não dispensa aprovação. Resposta 201 igual (com os campos gravados). |
| `GET /api/grupos` | só grupos com status efetivo `ativo` (`$match: { $or: [{ status: 'ativo' }, { status: { $exists: false } }] }`). |
| `GET /api/grupos/[id]` | grupo não público → 404 `{ error: 'Grupo nao encontrado' }` exceto staff (`GROUPS_TAB`), dono ou membro atual não banido. |
| `PUT /api/grupos/[id]` | ignora `status`/`statusDetalhado` do body (mantém os gravados); dono não-admin do sistema só edita em `ajustes` ou `ativo`; admin do sistema edita fora de `rejeitado`/`cancelado`; senão 409 `edicao_bloqueada_moderacao`. Edição não muda `status` nem prazo. |
| `DELETE /api/grupos/[id]` | só com status efetivo `ativo` (fluxo atual, V2-14); outros → 409 `edicao_bloqueada_moderacao` (pendente usa `desistir`; final preserva histórico). |
| `pay` / `join` | sem mudança de código: `motivoGrupoIndisponivel` já recusa status ≠ `ativo` (B-04). |
| `GET /api/meus-grupos` | projeta também `moderacao.ultimaDecisao`, `moderacao.cancelamento` e `moderacao.revisaoPendente` (sem histórico). |
| SSR `pages/index.js` | mesmo filtro do `GET /api/grupos`. |
| SSR `pages/grupos/[id].js` | `notFound` quando não público e o visitante não é staff, dono ou membro atual (sessão via `getServerSession(context.req, context.res, authOptions)`). |
