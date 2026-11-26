# Bug Fix: Entrada em grupo sem pagamento via /participar

- **Slug**: b01-entrada-sem-pagamento
- **Corrigido**: 2026-11-24
- **Assessment**: ./assessment.md
- **Status**: applied

## Summary

`POST /api/grupos/[id]/participar` virou um stub que responde 410 `rota_desativada` para qualquer método/papel,
sem acessar sessão nem banco; toda a lógica de inserção em `membrosGrupo` foi removida. Nenhum consumidor no
front/testes foi encontrado.

## Changes

| Arquivo | Mudança | Notas |
| --- | --- | --- |
| `pages/api/grupos/[id]/participar.js` | modified | Handler reduzido a resposta 410; remove inserção de membro, notificações e bypass de staff |
| `tests/bugs/b01-entrada-sem-pagamento.test.js` | added | Teste de regressão |

## Tests Added or Updated

- `tests/bugs/b01-entrada-sem-pagamento.test.js` — usuário comum, staff com `userId` no body e sem-sessão/GET recebem 410 e
  `membrosGrupo` continua vazio; `getServerSession` não é consultado. Contra o código antigo falha (200 / 401).

## Local Verification

- `npx vitest run tests/bugs/b01-entrada-sem-pagamento.test.js tests/preco/handlers-grupos.test.js` (de `J:\Cotea`) → 8 passed.
- Mesmo teste contra a versão original (`git show HEAD:...`) → 3 failed (200 membro criado), confirmando que reproduz o bug.
- `npx vitest run` (suite completa, em memória) → 27 arquivos / 153 testes passed.

## Deviations from Assessment

Nenhum.

## Follow-ups

- Spec 003 (`sdd/specs/003-preco-por-vaga/contracts/api-grupos.md:60`, `plan.md`, `tasks.md` T010) ainda descreve o 409 `preco_indisponivel`
  desta rota; não editado aqui (spec/contratos). Atualizar quando conveniente.
- Se produto quiser adição manual de membro por staff, especificar no V2-06 (com fatura/caução/ledger).
- Atualizar o painel `## Bugs` em `.planning/backlog.md` (não feito: agente principal faz em série).
- Sugestão de commit: `fix(grupos): desativa /participar (entrada sem pagamento, B-01)`.
