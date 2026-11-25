# Lógica: cadastro financeiro (`lib/cadastro-financeiro.js`)

Módulo puro (sem I/O, sem `lib/mongodb`, sem criptografia). Fonte única das
regras; servidor e telas importam dele. Os testes de contrato 1 e 2 fixam os
casos abaixo.

## `somenteDigitosCpf(cpf)`

`String(cpf ?? '').replace(/\D/g, '')`.

## `validarCpf(cpf)` — FR-001/FR-002

1. `d = somenteDigitosCpf(cpf)`; inválido se `d.length !== 11` ou
   `/^(\d)\1{10}$/`.
2. Algoritmo padrão (o mesmo de `pages/api/pix/simulated/create.js` hoje):
   para `base` de 9 e depois 10 dígitos, `soma = Σ d[i] × (base.length + 1 − i)`,
   `dv = (soma × 10) % 11`, `dv === 10 → 0`; comparar com `d[9]` e `d[10]`.
3. Entradas não-string (`null`, `undefined`, número) → tratar via `String()`;
   letras não viram dígitos (`'abcdefghijk'` → 0 dígitos → inválido).

Depois desta feature, **remover** as cópias locais de `validarCpf` em
`pages/api/pix/simulated/create.js`, `pages/assinatura/pagamento.js` e
`pages/wallet/add.js` (as telas importam este módulo, que é puro).

## Endereço válido (usado por `avaliar` e `planejar`) — FR-006

`enderecoValido(e)` (interna) é verdadeira quando:

- `cep` com 8 dígitos (após remover não-dígitos);
- `uf` (maiúscula) ∈ `UFS`;
- `cidade`, `bairro`, `rua`, `numero` não vazios após `trim()`.

Não olha `cepConfirmado` (endereço salvo com CEP indisponível conta como
válido — FR-007).

## `avaliarCadastroFinanceiro({ cpf, endereco })` — FR-001

```
pendencias = []
se !validarCpf(cpf)           → push('cpf')
se !endereco || !enderecoValido(endereco) → push('endereco')
return { completo: pendencias.length === 0, pendencias }
```

Ordem sempre `['cpf', 'endereco']`.

## `planejarCadastroFinanceiro({ atual, enviado, cep })`

Entrada: `atual.cpf` em claro (`''` se ausente/ilegível), `atual.endereco`
gravado (ou null); `enviado.cpf` / `enviado.endereco` do cliente (ausente =
não mexer); `cep` = resultado de `consultarCep` para o CEP **enviado** (null se
nenhum endereço enviado ou CEP sem 8 dígitos — o servidor não consulta nesses
casos).

### CPF

```
travado = validarCpf(atual.cpf)
se travado                      → cpfParaGravar = null, sem erro (FR-005: ignora o enviado)
senão:
  d = somenteDigitosCpf(enviado.cpf)
  se d === ''                   → cpfParaGravar = null, sem erro (salvar sem CPF é permitido)
  se !validarCpf(d)             → erros.cpf = 'CPF invalido.'
  senão                         → cpfParaGravar = d
```

(Unicidade é do servidor — não cabe num módulo puro.)

### Endereço

```
se enviado.endereco === undefined → enderecoParaGravar = null, sem erro
e = normalizar(enviado.endereco):
    cep = só dígitos; uf = trim().toUpperCase(); cidade/bairro/rua/complemento = trim();
    numero = trim(); se numero, sem espaços, casefold ∈ {'s/n','sn','s.n.','s/nº'} → 'S/N'
todosVazios = cep, uf, cidade, bairro, rua, numero, complemento todos ''
atualCompleto = atual.endereco && enderecoValido(atual.endereco)

se todosVazios:
    se atualCompleto → erros.endereco = 'Endereco obrigatorio para o cadastro financeiro.'   (FR-009)
    senão            → enderecoParaGravar = null, sem erro (nada a gravar)
senão se e.cep.length !== 8 → erros.endereco = 'CEP deve ter 8 digitos.'
senão conforme cep.status:
  'nao_encontrado' → erros.endereco = 'CEP nao encontrado.'
  'encontrado'     → e.uf = cep.uf; e.cidade = cep.cidade;              (cidade/UF do CEP)
                     cepConfirmado = true
                     (rua e bairro NUNCA vêm do CEP no servidor: são sempre os
                     enviados — a tela é que pré-preenche pelo CEP. Assim, apagar
                     a rua é recusado mesmo com CEP confirmado — contrato 2)
  'indisponivel' ou null → cepConfirmado = false                         (FR-007)
  se !erro e !enderecoValido(e) → erros.endereco = mensagem do 1º campo faltante
       ('UF invalida.', 'Informe a cidade.', 'Informe o bairro.', 'Informe a rua.', 'Informe o numero (ou S/N).')
  se !erro → enderecoParaGravar = { cep, uf, cidade, bairro, rua, numero, complemento, cepConfirmado }
```

Endereço parcialmente preenchido com `atual` incompleto → valida (vira erro se
inválido); só "tudo vazio" é tratado como "não mexer".

### Resultado

`ok = Object.keys(erros).length === 0`. Com erro em qualquer campo, o servidor
**não grava nada** (nem o campo que estava certo) — a resposta 400 lista
`campos` com as chaves de `erros`.

## `planejarMigracaoCpf(usuarios, { hash })` — FR-020

Entrada por usuário: `{ _id, cpfClaro, cpfCifrado, cpfHash }` (`cpfClaro` =
`decryptCPF(cpf)`, `''` se sem CPF; `cpfCifrado` = o valor gravado já tem o
formato `iv:tag:dado`).

```
para cada u com cpfClaro !== '':
  se !validarCpf(cpfClaro) → acao 'marcar_invalido'      (move para cpfLegadoInvalido, remove cpf/cpfHash)
  senão h = hash(cpfClaro); agrupar por h
grupos de h com >1 usuário → conflito { ids } ; nenhum desses usuários recebe ação
demais válidos:
  se !cpfCifrado             → acao 'criptografar' (grava cpf cifrado + cpfHash)
  senão se u.cpfHash !== h   → acao 'definir_hash'
  senão                      → nenhuma ação (idempotência)
resumo = { total, criptografar, definirHash, marcarInvalido, conflitos, semCpf, semAlteracao }
```

O script aplica as ações; reexecutar após aplicar produz 0 ações.
