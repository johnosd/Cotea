# Bug Assessment: Usuario bloqueado consegue criar grupo (B-05)

- **Slug**: b05-bloqueado-cria-grupo
- **Criado**: 2026-11-24
- **Origem**: texto colado (backlog B-05, P1)
- **Veredito**: valid
- **Severidade**: high

## Report

A criacao de grupo (`POST /api/grupos`) checa so `contaValidada` (`pages/api/grupos/index.js:71`), mas a regra de negocio proibe criar grupos a usuario com `isBlocked` (`.docs/regras-negocio-v2.md` linhas 242 e 1016). Pagamento, participacao em grupos ja existentes e saque continuam permitidos para bloqueado.

## Symptom

Usuario com `isBlocked: true` e `contaValidada: true` recebe 201 ao criar grupo e vira admin/membro dele. Esperado: 403.

## Reproduction

1. Marcar um usuario validado como `isBlocked: true` (admin > bloquear).
2. Autenticado como ele, `POST /api/grupos` com corpo valido.
3. Resposta 201; grupo e `membrosGrupo` (papel admin) gravados.

## Suspected Code Paths

- `pages/api/grupos/index.js:69-77` (`handleCreate`) — sessao so validada contra `contaValidada`; `adminUser` ja e carregado do banco logo depois e nao tem `isBlocked` verificado.
- `pages/api/auth/[...nextauth].js:62,103,127` — `isBlocked` entra no JWT no login e e ressincronizado do banco apenas no refresh periodico (`updateAge`, padrao 1800 s). Ou seja, o valor da sessao pode estar defasado ate 30 min (e um bloqueio feito agora so e visto apos o proximo refresh).
- `lib/authz.js:9` — `isUserBlocked(session)` le so a sessao (arquivo fora do escopo; nao editar).
- Outros caminhos de criacao: `pages/api/grupos/index.js` e a unica rota que cria grupo (busca por `insertOne` em `grupos` nao mostra outra).
- Tela de criacao: `pages/admin/grupos/novo.js:176-179` — exibe `errData.error` da API em `msg`; entao um 403 com mensagem clara ja aparece ao usuario sem alterar a tela.

## Root Cause Hypothesis

Omissao: a checagem de bloqueio nunca foi adicionada ao handler de criacao. Confianca: high. Como o JWT pode estar defasado, a checagem deve usar o documento `users` ja carregado do banco (fonte de verdade), com a sessao como reforco (`session.user.isBlocked || adminUser.isBlocked`).

## Proposed Remediation

**Preferida**: em `handleCreate`, apos carregar `adminUser`, responder 403 (`Conta bloqueada. Voce nao pode criar grupos.`) se `adminUser.isBlocked === true` ou `session.user.isBlocked`. Mantem a ordem existente (401 -> contaValidada -> sessao invalida -> usuario inexistente) e nao toca em pagamento/participacao/saque.

**Alternativas**:
- Usar apenas `isUserBlocked(session)` de `lib/authz.js`: mais simples, mas sujeito a defasagem do JWT e arquivo fora do escopo. Rejeitada.
- Aviso proativo na tela `pages/admin/grupos/novo.js` (banner/botao desabilitado quando `session.user.isBlocked`): fora do escopo permitido (`pages/admin/**`); a tela ja mostra a mensagem do 403 ao enviar. Registrado como follow-up.

**Files likely to change**:
- `pages/api/grupos/index.js` (somente POST)
- `tests/bugs/b05-bloqueado-cria-grupo.test.js` (novo)

**Tests to add or update**:
- POST com `adminUser.isBlocked: true` no banco e sessao sem flag (JWT defasado) -> 403, nada gravado em `grupos`/`membrosGrupo`.
- POST com sessao `isBlocked: true` -> 403.
- POST de usuario nao bloqueado continua 201 (regressao).

## Risks & Considerations

- A regra diz que o bloqueio vale igualmente em qualquer contexto; ha apenas um ponto de criacao hoje, entao a checagem unica cobre.
- Nao alterar `join.js`/`participar.js`/`pay.js`/`withdraw` (fora de escopo). Nota: `.docs` linha 545 diz "Usuario bloqueado: negar" na entrada em grupo, divergindo da linha 242 ("Pode ser membro de grupos, fazer pagamentos"); a linha 242/1016 e a regra explicita do report, portanto nao se bloqueia participacao aqui.

## Open Questions

- Nenhuma que bloqueie o fix. Observacao para o usuario: linha 545 vs 242 do documento de regras sao contraditorias sobre entrada em grupo por bloqueado (fora do escopo de B-05).
