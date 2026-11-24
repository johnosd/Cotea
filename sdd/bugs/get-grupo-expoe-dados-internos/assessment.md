# Bug Assessment: GET /api/grupos/[id] expõe dados internos sem sessão

- **Slug**: get-grupo-expoe-dados-internos
- **Criado**: 2026-11-24
- **Origem**: texto colado (descoberto durante a feature 003-preco-por-vaga)
- **Veredito**: valid
- **Severidade**: high

## Report

`GET /api/grupos/[id]` (`handleGet`) é público (não exige sessão) e devolve o documento
inteiro do grupo com `...grupo`, incluindo `observacoesInternas` (campo só da equipe) e o
e-mail do dono (`adminEmail`, `admin.email`).

## Symptom

Qualquer visitante anônimo que conheça (ou enumere) o ID de um grupo recebe campos internos
(`observacoesInternas`, `necessitaAnalise`), o e-mail do dono e o ID dos participantes
(`participantesIds`). O esperado é a resposta pública conter só dados de vitrine/cobrança.

## Reproduction

1. Sem sessão, chamar `GET /api/grupos/<id>` de um grupo com `observacoesInternas` preenchido.
2. A resposta contém `observacoesInternas`, `necessitaAnalise`, `adminEmail`, `admin.email`,
   `participantesIds` e `imageKey`.

Confirmado por leitura do código (`pages/api/grupos/[id].js:44-53`, spread de `grupo` e
projeção de `users` com `email`); será reproduzido de forma automatizada no teste de regressão.

## Suspected Code Paths

- `pages/api/grupos/[id].js:20-54` (`handleGet`) — spread `...grupo` + `adminEmail`/`admin.email`; nenhuma checagem de sessão.
- `pages/api/grupos/[id].js:184` — GET retorna antes de `getServerSession`.
- `pages/admin/grupos/[id].js:962` — `getServerSideProps` consome o GET por `fetch` SEM cookies
  e usa `observacoesInternas`, `necessitaAnalise`, `adminEmail`, `participantesIds`, `imageKey`,
  `membrosAtivos`, `vagasDisponiveis` etc. Ficará com a resposta pública depois do fix (consumidor impactado).
- `pages/assinatura/pagamento.js:93` — usa `nome`, `valorPorVaga`, `repassePorVaga`, `taxaPorVaga`, `precoValido`.
- Demais ocorrências de `/api/grupos/${id}` em `pages/` são PUT/DELETE ou sub-rotas (`/join`, `/acessos`, `/mensagens`); `pages/grupos/[id].js` não usa o GET.

## Root Cause Hypothesis

O GET foi escrito como "devolver o documento + dados do dono" sem distinguir quem consome.
Falta uma allowlist de campos públicos e uma checagem de quem pode ver os campos internos
(constitution I). Confiança: alta.

## Proposed Remediation

**Preferida**: extrair a montagem da resposta para `lib/grupo-publico.js` (puro, sem mongodb):
allowlist de campos públicos (identidade, vitrine, preço por vaga, vagas, regras/FAQ/fidelidade,
dono só com `id`/`nome`/`avatar`, `membrosAtivos`). No handler, `getServerSession` opcional:
resposta completa (comportamento atual) só para staff (`hasRole(session, PERMISSIONS.GROUPS_TAB)`)
ou dono/admin do grupo (adminId do documento ou `membrosGrupo` papel admin não banido), com o
usuário recarregado do banco; qualquer outro caso (sem sessão, bloqueado, erro de sessão) recebe a versão pública.

**Alternativas**:
- Rota separada para a versão interna: mudaria o contrato e exigiria alterar o consumidor admin; descartada.
- Exigir sessão em todo o GET: quebraria `pagamento.js` para visitantes e a SSR admin sem cookies.

**Files likely to change**:
- `lib/grupo-publico.js` (novo)
- `pages/api/grupos/[id].js` (só `handleGet` + roteamento do GET)
- `tests/bugs/get-grupo-expoe-dados-internos.test.js` (novo)
- `tests/helpers/db-grupos-memoria.js` (se necessário)

**Tests to add or update**:
- anônimo: sem `observacoesInternas`/`necessitaAnalise`/e-mails/`participantesIds`; mantém campos de preço, `nome`, `membrosAtivos`.
- dono, membro admin e staff veem os campos internos; usuário comum e conta bloqueada não.
- 404 e 400 inalterados.
- unitários da allowlist.

## Risks & Considerations

- `pages/admin/grupos/[id].js` (SSR com `fetch` sem cookies) perderá os campos internos; salvar o formulário
  como admin de sistema com `observacoesInternas` vazio apagaria a observação. A correção desse arquivo
  está com outro agente (fora do escopo/permissão desta fase): deve ler o grupo direto do Mongo.
  O helper `lib/grupo-publico.js` é reutilizável por ele. Sinalizar no relatório.
- Campo novo no schema de grupos passa a ser público só se entrar na allowlist (falha segura).

## Open Questions

- Nenhuma bloqueante.
