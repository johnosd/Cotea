# Bug Fix: Usuario bloqueado consegue criar grupo (B-05)

- **Slug**: b05-bloqueado-cria-grupo
- **Corrigido**: 2026-11-24
- **Assessment**: ./assessment.md
- **Status**: applied

## Summary

`POST /api/grupos` agora responde 403 quando o usuario esta bloqueado: checa `isBlocked` no documento `users` (fonte de verdade, ja carregado no handler) e tambem na sessao. Somente a criacao e barrada; pagamento, participacao e saque ficam intactos.

## Changes

| Arquivo | Mudanca | Notas |
| --- | --- | --- |
| `pages/api/grupos/index.js` | modified | Em `handleCreate`, apos carregar `adminUser`: 403 se `adminUser.isBlocked === true \|\| session.user.isBlocked === true`. Mensagem: "Conta bloqueada. Voce nao pode criar grupos. Procure o suporte." |
| `tests/bugs/b05-bloqueado-cria-grupo.test.js` | added | 4 testes de regressao |

## Tests Added or Updated

- `tests/bugs/b05-bloqueado-cria-grupo.test.js::nega 403 quando o banco marca isBlocked, mesmo com JWT defasado` — bloqueio so no banco; nada gravado em `grupos`/`membrosGrupo`; sem auditoria.
- `...::nega 403 quando a sessao traz isBlocked` — flag so na sessao.
- `...::mantem 201 para usuario nao bloqueado` e `...sem o campo isBlocked (legado)` — sem regressao.

## Local Verification

- `npx vitest run tests/bugs/b05-bloqueado-cria-grupo.test.js tests/preco/handlers-grupos.test.js` (de `J:\Cotea`) → 9/9 passam.
- Mutacao: com a checagem desativada, os 2 testes de bloqueio falham (4 total: 2 fail, 2 pass); restaurada, 4/4 passam.
- `npx eslint` nos 2 arquivos → sem avisos.

## Deviations from Assessment

- Tela de criacao (`pages/admin/grupos/novo.js`) NAO foi editada: fica em `pages/admin/**`, vetado nesta rodada (paralelismo). Ela ja exibe `errData.error` do servidor, entao o 403 aparece como mensagem ao enviar o formulario.
- `.planning/backlog.md` e `update-bug-status.ps1` nao foram tocados (a cargo do agente principal).

## Follow-ups

- Opcional (fora do escopo desta rodada): aviso proativo em `pages/admin/grupos/novo.js` (banner/botao desabilitado quando `session.user.isBlocked`) para o usuario nao preencher o formulario inteiro antes de ser recusado. Observacao: a tela fica sob `/admin`; verificar se usuarios comuns chegam a ela.
- Decisao de produto: `.docs/regras-negocio-v2.md` linha 545 ("Usuario bloqueado: negar" na entrada em grupo) contradiz a linha 242 ("Pode ser membro de grupos, fazer pagamentos"). Nao tratado aqui; confirmar qual vale.
- Sugestao de commit: `fix(grupos): bloqueia criacao de grupo por usuario com isBlocked (B-05)`.
