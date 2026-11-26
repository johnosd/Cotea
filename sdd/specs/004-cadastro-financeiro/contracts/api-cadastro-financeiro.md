# Contratos de API: 004-cadastro-financeiro

Mensagens em português sem acento, no padrão das APIs existentes. Erros em
`error` (APIs novas e financeiras); `atualizarPerfil` mantém `message` (CQ-02
fora de escopo).

## Recusa comum por cadastro incompleto (FR-011/FR-012)

Usada por: `POST /api/assinaturas/pay`, `POST /api/pix/simulated/create`,
`POST /api/withdraw/create`, `POST /api/wallet/pay`, `POST /api/grupos`.

```http
409
{ "error": "Complete seu cadastro financeiro (CPF e endereco) para continuar.",
  "codigo": "cadastro_financeiro_incompleto",
  "pendencias": ["cpf", "endereco"] }      // subconjunto, nessa ordem
```

Ordem nos handlers (D-03): 405 → 401 sessão → 403 conta não validada (onde
já existe) → 403 bloqueado (só `POST /api/grupos`) → **409 cadastro** →
validações de corpo / leituras de grupo / efeitos.

## `GET /api/perfil/cadastro-financeiro` (novo)

Sessão obrigatória (401). Recarrega o usuário do banco por `session.user.id`
(fallback e-mail).

```http
200
{ "completo": true,
  "pendencias": [],
  "cpfTravado": true,
  "cpfMascarado": "***.982.247-**",       // "" quando sem CPF válido
  "endereco": { "cep": "01001000", "uf": "SP", "cidade": "São Paulo", "bairro": "Sé",
                "rua": "Praça da Sé", "numero": "100", "complemento": "" },   // null se não houver
  "cepConfirmado": true }
```

Nunca contém o CPF completo (FR-010).

## `PUT /api/perfil/cadastro-financeiro` (novo)

```http
PUT { "cpf": "52998224725", "endereco": { cep, uf, cidade, bairro, rua, numero, complemento } }
```

Ambos opcionais. Fluxo: carrega usuário → `consultarCep` só se `endereco`
enviado com CEP de 8 dígitos → `planejarCadastroFinanceiro` → se
`cpfParaGravar`, checa duplicidade por `cpfHash` (`findOne({ cpfHash, _id: { $ne } })`)
→ `$set` de `cpf` (cifrado) + `cpfHash` e/ou `endereco` → resposta.

| Status | Corpo |
| --- | --- |
| 200 | mesmo corpo do GET, já com o estado novo |
| 400 | `{ error, codigo: 'cadastro_invalido', campos: { cpf?: msg, endereco?: msg } }` — nada é gravado |
| 409 | `{ error: 'CPF indisponivel. Se ele e seu, fale com o suporte.', codigo: 'cpf_indisponivel' }` — também quando o índice único dispara (E11000) numa corrida |
| 401/405 | padrão |

CPF enviado com CPF já travado: ignorado, 200 (FR-005).

## `POST /api/atualizarPerfil` (alterado)

- Campos `cpf` e `endereco` passam pela mesma função de servidor do PUT
  acima (`salvarCadastroFinanceiro`, D-05). Erros dela voltam como
  `400 { message, codigo, campos }` / `409 { message, codigo: 'cpf_indisponivel' }`
  (mantém `message`, que é o que `pages/perfil.js` lê).
- Nunca mais grava `cpf: encryptCPF('')` incondicional.

## `GET /api/atualizarPerfil` (alterado)

Remove `cpf` da resposta e acrescenta `cpfMascarado` e `cpfTravado` — também
quando um admin consulta outro e-mail.

## `PUT /api/admin/users/[id]/cpf` (novo) — FR-018/FR-019

Permissão `PERMISSIONS.CORRIGIR_CPF = ['admin']` (`lib/authz.js`).

```http
PUT { "cpf": "11144477735", "motivo": "Digitacao errada confirmada por documento" }
```

| Status | Quando |
| --- | --- |
| 200 `{ cpfMascarado }` | corrigido; grava `cpf` cifrado + `cpfHash`; `logAudit('user.cpf_corrected', details: { motivo })` |
| 400 | id inválido, motivo vazio (após trim) ou CPF inválido |
| 403 | sem permissão, ou `id` é o próprio admin |
| 404 | usuário não encontrado |
| 409 `cpf_indisponivel` | CPF de outra conta |

## `POST /api/pix/simulated/create` (alterado) — FR-015

Corpo: `{ amount }`. `cpf` enviado é **ignorado**; `pixCpf = encryptCPF(verificacao.cpf)`.

## `POST /api/withdraw/create` (alterado) — FR-016

Corpo: `{ amount }`. `cpfPixKey` enviado é **ignorado** e deixa de ser
obrigatório; `pixKeyCpf = encryptCPF(verificacao.cpf)`.

## Consumidores a atualizar (constitution, Fluxo de Desenvolvimento 5)

`pages/perfil.js`, `pages/assinatura/pagamento.js`, `pages/wallet/add.js`,
`pages/wallet/withdraw.js`, `pages/wallet/pay.js`, `pages/admin/grupos/novo.js`,
`pages/admin/index.js`.
