# Bug Fix: CPF aberto em listagens administrativas (B-03)

- **Slug**: b03-cpf-aberto-listagens
- **Corrigido**: 2026-11-24
- **Assessment**: ./assessment.md
- **Status**: applied

## Summary

Listagens administrativas passam a devolver o CPF só mascarado (`***.456.789-**`). O CPF completo da chave PIX passou a ter um endpoint dedicado, restrito a `finance`/`admin`, só para saques em aberto e com auditoria; a tela de saques o mostra sob demanda ("Ver CPF completo").

## Changes

| Arquivo | Mudança | Notas |
| --- | --- | --- |
| `lib/cpf-mascara.js` | added | `mascararCPF`: puro; ciphertext/tamanho inválido -> `***.***.***-**`, vazio -> `''` |
| `lib/authz.js` | modified | `PERMISSIONS.CPF_COMPLETO_SAQUE = ['finance','admin']` |
| `pages/api/admin/users/index.js` | modified | `cpf` = máscara do CPF decriptado (mesma chave de resposta; `pages/admin/index.js` não precisou mudar) |
| `pages/api/withdraw/list.js` | modified | remove `pixKeyCpf` do payload, adiciona `pixKeyCpfMascarado`; papéis permitidos inalterados |
| `pages/api/withdraw/chave-pix.js` | added | GET `?withdrawalId=`; 403 fora de finance/admin, 400 se saque finalizado, `logAudit` sem CPF |
| `pages/admin/withdrawals.js` | modified | exibe mascarado; botão "Ver CPF completo" p/ quem tem a permissão |

## Tests Added or Updated

- `tests/bugs/b03-cpf-aberto-listagens.test.js` — unit da máscara; users (support só mascarado, sem CPF em claro); list (support/finance/admin sem `pixKeyCpf`); chave-pix (support 403, finance 200 + auditoria sem CPF, finalizado 400, 404/400/401/403).

## Local Verification

- `npx vitest run tests/bugs/b03-cpf-aberto-listagens.test.js` (de `J:\Cotea`) -> 11 passed.
- `npx vitest run tests/ledger tests/contract` -> 54 passed.
- `npx eslint` nos arquivos alterados -> sem saídas.
- `npx vitest run tests/bugs` mostra 1 falha em `b09-setup-indexes-conflito.test.js` (bug de outro agente, em andamento; não relacionado).

## Deviations from Assessment

Nenhum. `pages/admin/index.js` não foi alterado (a tela já exibe `u.cpf`, agora mascarado). `approve.js`/`reject.js`/`create.js` intactos.

## Follow-ups

- Decisão de produto: `admin` vê o CPF completo? Adotado `finance`+`admin` (ajustar `PERMISSIONS.CPF_COMPLETO_SAQUE`).
- `/api/withdraw/list` ainda aceita `support` (a UI só libera finance/admin); dados agora mascarados, mas vale decidir se a API deve usar `PERMISSIONS.WITHDRAWALS_TAB`.
- Verificar outros pontos que exibam CPF (ex. detalhes de usuário, exportações) fora do escopo deste bug.
- Painel de bugs em `.planning/backlog.md` não atualizado por este agente (regra de paralelismo).
