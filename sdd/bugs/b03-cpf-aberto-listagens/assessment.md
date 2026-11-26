# Bug Assessment: CPF aberto em listagens administrativas (B-03)

- **Slug**: b03-cpf-aberto-listagens
- **Criado**: 2026-11-24
- **Origem**: texto colado (backlog B-03)
- **Veredito**: valid
- **Severidade**: high (P1 — dado pessoal sensível exposto a perfil sem necessidade)

## Report

B-03 · P1 · CPF aberto em listagens internas — a API de usuários permite `support` e devolve o CPF descriptografado integral (`lib/authz.js:12`, `pages/api/admin/users/index.js:24,35`), exibido em `pages/admin/index.js:134`; a listagem de saques devolve o documento cru, inclusive a `support` (`pages/api/withdraw/list.js:22-34`), e a tela `pages/admin/withdrawals.js:104` mostra `pixKeyCpf` cifrado. Regra (RN:1006 de `.docs/regras-negocio-v2.md`, linha 1017 no arquivo atual): CPF sempre mascarado (`***.123.456-**`) nas telas administrativas; completo só para o financeiro (`finance`) na aprovação de saque.

## Symptom

`GET /api/admin/users` devolve `cpf` em claro (decriptado) para `support`/`admin`; `GET /api/withdraw/list` devolve `pixKeyCpf` (ciphertext AES-GCM) para `support`/`finance`/`admin`, e `withdrawals.js` renderiza `PIX CPF: {w.pixKeyCpf}` (o financeiro vê um blob cifrado, inútil). Esperado: CPF mascarado em toda tela/listagem administrativa; completo só ao financeiro, no contexto de aprovar/rejeitar saque.

## Reproduction

1. Autenticar como `support`, chamar `GET /api/admin/users` → `cpf` com 11 dígitos em claro.
2. Autenticar como `support`, chamar `GET /api/withdraw/list` → itens com `pixKeyCpf` (ciphertext `iv:tag:dados`) e demais campos crus.
3. Abrir `/admin/withdrawals` como `finance` → "PIX CPF: <ciphertext>".

Confirmado por leitura de código (sem execução contra banco real).

## Suspected Code Paths

- `pages/api/admin/users/index.js:35` — `cpf: decryptCPF(u.cpf)` devolvido integral.
- `lib/authz.js:12` — `USERS_TAB` inclui `support` (aba de usuários é legítima p/ support; o problema é o CPF, não o acesso).
- `pages/admin/index.js:136` — renderiza `u.cpf` (nesta árvore a linha é 136).
- `pages/api/withdraw/list.js:22-34` — `find({})` sem projeção, devolve `pixKeyCpf` cifrado e doc cru; role check permite `support` (a UI de saques só libera `finance`/`admin` via `PERMISSIONS.WITHDRAWALS_TAB`, inconsistência com a API).
- `pages/admin/withdrawals.js:160` — exibe `w.pixKeyCpf`.
- `pages/api/withdraw/approve.js` / `reject.js` — não expõem CPF (ok, não alterar).

## Root Cause Hypothesis

Não existe camada de máscara/redação de CPF: a listagem de usuários decripta e devolve integral, e a listagem de saques devolve o documento do Mongo sem projeção. Também não há caminho dedicado para o financeiro conferir a chave PIX na aprovação, por isso a tela mostra o ciphertext. Confiança: high.

## Proposed Remediation

**Preferida**:
- Helper puro `lib/cpf-mascara.js` com `mascararCPF(valor)` (`***.456.789-**`; vazio -> `''`; formato inválido -> `***.***.***-**`; nunca lança, aceita `null`).
- `pages/api/admin/users/index.js`: decriptar apenas para mascarar; devolver `cpf` já mascarado (mesma chave, a tela `index.js` continua funcionando; não há mudança necessária em `pages/admin/index.js` além, se quiser, nada).
- `pages/api/withdraw/list.js`: remover `pixKeyCpf` do payload e devolver `pixKeyCpfMascarado`; manter a lista de papéis (admin/finance/support) — support passa a ver só o mascarado.
- Novo endpoint `pages/api/withdraw/chave-pix.js` (`GET ?withdrawalId=`): único ponto que devolve CPF completo; exige `PERMISSIONS.CPF_COMPLETO_SAQUE` (`finance`, `admin`, mesma regra do `LEDGER_FINANCEIRO`/D-12 e de quem pode aprovar), só para saque em aberto (`requested`/`blocked`), grava `logAudit` (sem o CPF).
- `lib/authz.js`: adicionar `CPF_COMPLETO_SAQUE`.
- `pages/admin/withdrawals.js`: mostrar `pixKeyCpfMascarado`; botão "Ver CPF completo" (somente quem tem a permissão e só nos pendentes) que chama o novo endpoint e exibe sob demanda no estado local.

**Alternativas**:
- Devolver o CPF completo já na listagem para `finance` — rejeitada: expõe 200 CPFs de uma vez; a regra pede "ao aprovar".
- Restringir `admin` fora do CPF completo (estrito "só finance") — ver Open Questions.

**Files likely to change**:
- `lib/cpf-mascara.js` (novo)
- `lib/authz.js`
- `pages/api/admin/users/index.js`
- `pages/api/withdraw/list.js`
- `pages/api/withdraw/chave-pix.js` (novo)
- `pages/admin/withdrawals.js`
- `pages/admin/index.js` (apenas se necessário)

**Tests to add or update**:
- `tests/bugs/b03-cpf-aberto-listagens.test.js`: unit do helper; handler `admin/users` (support recebe só mascarado, sem o CPF em claro no JSON); handler `withdraw/list` (sem `pixKeyCpf` cifrado, com mascarado, para support e finance); handler `chave-pix` (support 403, finance 200 com CPF completo só em saque aberto, 400/404, auditoria sem CPF).

## Risks & Considerations

- Decriptação falha (`null`) ou dado legado em plaintext: a máscara deve tratar ambos sem vazar nem lançar.
- Qualquer outro consumidor de `pixKeyCpf` em `/api/withdraw/list` (varredura: só `withdrawals.js`) quebraria; não há outros.
- `ENCRYPTION_KEY` é necessária nos handlers de listagem (já era no de usuários).

## Open Questions

- [NEEDS CLARIFICATION: "completo só para o financeiro" — `admin` também deve ver o CPF completo na aprovação? Adotado `finance`+`admin` (admin também aprova saques); trocar para só `finance` é mudar `PERMISSIONS.CPF_COMPLETO_SAQUE`. Não bloqueia a correção.]
