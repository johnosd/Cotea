# Data Model: 004-cadastro-financeiro

## `users` (alterado)

| Campo | Tipo | Regra |
| --- | --- | --- |
| `cpf` | string | **Sempre** cifrado (`encryptCPF`, formato `iv:tag:dado`). Ausente = sem CPF. Nunca gravar `''` por cima de um CPF existente (bug atual do perfil). Legado em texto puro é aceito na leitura até a migração. |
| `cpfHash` | string (novo) | `hashCPF(dígitos)` — HMAC-SHA256 hex com chave derivada de `ENCRYPTION_KEY` (D-02). Presente sempre que `cpf` válido estiver gravado. Índice **único parcial** (só documentos com `cpfHash` string). |
| `cpfLegadoInvalido` | string (novo) | Cifrado. Só a migração grava: CPF antigo que não passa no dígito verificador sai de `cpf` e vem para cá (histórico preservado, FR-020). |
| `endereco.cep` | string | 8 dígitos, sem hífen. |
| `endereco.uf` | string | Sigla maiúscula ∈ 27 UFs. |
| `endereco.cidade`, `bairro`, `rua`, `numero`, `complemento` | string | Ver `logic/cadastro.md`; `numero` aceita `S/N`. |
| `endereco.cepConfirmado` | bool (novo) | `true` se o CEP foi encontrado na consulta no momento do salvamento; `false` se a consulta estava indisponível (FR-007). |

**Estado derivado (não gravado)**: `cadastroFinanceiroCompleto =
avaliarCadastroFinanceiro({ cpf: decryptCPF(user.cpf), endereco: user.endereco }).completo`.
Não existe campo `cadastroCompleto` no documento: o estado é sempre recalculado
do banco (D-03).

**CPF travado** (derivado): `validarCpf(decryptCPF(user.cpf))`.

Schema: atualizar `database/schemas/users.schema.json` (`cpfHash`,
`cpfLegadoInvalido`, `endereco.cepConfirmado`). O validator usa
`additionalProperties` livre, então os campos novos não quebram gravações
antes da atualização, mas a constitution IV exige o schema na mesma mudança.

Índice (constitution IV): em `database/setupDatabase.js` **e**
`database/setup-indexes.js` (mesmas opções — teste do B-09 compara os dois):

```js
db.collection('users').createIndex(
  { cpfHash: 1 },
  { unique: true, partialFilterExpression: { cpfHash: { $type: 'string' } }, name: 'cpfHash_unico' }
);
```

Criar o índice **depois** de aplicar a migração (D-10): CPFs repetidos
impedem a criação.

## `auditLogs` (sem mudança de formato)

Novas ações:

| action | Quando | details |
| --- | --- | --- |
| `user.cpf_corrected` | Admin corrige CPF (FR-018/FR-019) | `{ motivo }` — **sem CPF**, nem mascarado |
| `user.cpf_migrado` | Script de migração aplica uma ação | `{ tipo }` (`criptografar` / `definir_hash` / `marcar_invalido`) |

## Sem mudança

`payments.pixCpf` e `withdrawals.pixKeyCpf` continuam cifrados como hoje; só a
**origem** do valor muda (CPF do perfil, FR-015/FR-016). Registros antigos não
são alterados (FR-022).
