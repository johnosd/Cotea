# Implementation Plan: Cadastro financeiro completo sob demanda e permissões de conta

**Slug**: `004-cadastro-financeiro` | **Date**: 2026-11-25 | **Spec**: `sdd/specs/004-cadastro-financeiro/spec.md`

**Nota**: Este template é preenchido pelo skill `sdd-plan`; a definição do skill
descreve o fluxo de execução completo.

## Summary

Introduzir o estado derivado **cadastro financeiro completo** (CPF válido e
único + endereço válido com CEP consultado) e exigi-lo no servidor ao concluir
pagamento de assinatura, depósito PIX, saque, uso de saldo e criação de grupo.
Abordagem: regras num módulo puro (`lib/cadastro-financeiro.js`), um único
gate de servidor (`lib/cadastro-financeiro-servidor.js`) chamado pelos cinco
handlers antes de qualquer efeito, unicidade do CPF por `cpfHash` (HMAC) com
índice único parcial, endpoint novo `GET/PUT /api/perfil/cadastro-financeiro`
usado pelo perfil e por um formulário embutido nas telas financeiras, CPF do
PIX e do saque vindo do perfil, correção de CPF pelo admin com auditoria e um
script de migração dry-run/`--aplicar`.

## Technical Context

**Language/Version**: JavaScript (ES modules), Node 22 (Vercel `gru1`), Next.js 14 Pages Router

**Primary Dependencies**: Next.js 14, NextAuth v4 (JWT), driver `mongodb` 6.16, `crypto` nativo (AES-256-GCM já usado; HMAC-SHA256 novo), `fetch` nativo para o ViaCEP

**Storage**: MongoDB Atlas — coleção `users` (campos novos `cpfHash`, `cpfLegadoInvalido`, `endereco.cepConfirmado`; índice único parcial `cpfHash`); `auditLogs` (ações novas)

**Testing**: Vitest (`environment: 'node'`, `tests/**/*.test.js`); handlers testados com `tests/helpers/db-grupos-memoria.js` + `vi.mock` de `next-auth`, `lib/mongodb`, `lib/audit`; sem testes de UI no projeto (telas validadas manualmente/Playwright)

**Target Platform**: Web (Vercel serverless, região `gru1`)

**Performance Goals**: gate = 1 `findOne` em `users` por ação financeira; consulta de CEP só no salvamento do endereço, com timeout de 3 s

**Constraints**: CPF nunca em claro fora da memória do servidor; nenhuma variável de ambiente nova (hash derivado de `ENCRYPTION_KEY`); o banco do `.env.local` é o de produção (migração e testes manuais com autorização)

**Scale/Scope**: 4 usuários hoje (1 com CPF legado em texto puro); 5 handlers financeiros; 7 telas consumidoras

## Decisões Invariantes

- **D-01 · Fonte única das regras**: `lib/cadastro-financeiro.js` (puro, sem
  `lib/mongodb`/criptografia) concentra `validarCpf`, `avaliarCadastroFinanceiro`,
  `planejarCadastroFinanceiro`, `planejarMigracaoCpf` e as constantes. Servidor e
  telas importam dele; as cópias locais de `validarCpf` em
  `pages/api/pix/simulated/create.js`, `pages/assinatura/pagamento.js` e
  `pages/wallet/add.js` são removidas. Regras detalhadas em `logic/cadastro.md`.
- **D-02 · Unicidade por hash**: `cpfHash = HMAC-SHA256(k, dígitos)` em hex, com
  `k = HMAC-SHA256(ENCRYPTION_KEY bytes, 'cotea:cpf-hash:v1')`; função `hashCPF`
  em `lib/encryption.js`. Índice único parcial `{ cpfHash: 1 }`
  (`partialFilterExpression: { cpfHash: { $type: 'string' } }`). O CPF cifrado
  (IV aleatório) não serve para unicidade.
- **D-03 · Gate único no servidor**: `verificarCadastroFinanceiro(userId)` em
  `lib/cadastro-financeiro-servidor.js` recarrega o usuário do banco, decifra o
  CPF e aplica `avaliarCadastroFinanceiro` (sem rede; `cepConfirmado` não é
  exigido). Retorna `{ ok: true, cpf, usuario }` ou
  `{ ok: false, http: 409, body: { error, codigo: 'cadastro_financeiro_incompleto', pendencias } }`.
  Chamado em `assinaturas/pay`, `pix/simulated/create`, `withdraw/create`,
  `wallet/pay` e `POST /api/grupos`, **logo após** sessão/`contaValidada`/bloqueio
  e **antes** de validar corpo, ler grupo, criar carteira, fatura, pagamento,
  reserva ou lançamento. Não há campo "cadastro completo" gravado.
- **D-04 · CPF só cifrado e mascarado**: persistência apenas via `encryptCPF` +
  `cpfHash`; CPF travado = `validarCpf(decryptCPF(user.cpf))`. Nenhuma resposta
  ao próprio usuário (nem ao admin no GET do perfil) traz o CPF completo: usar
  `mascararCPF` de `lib/cpf-mascara.js`. A única exceção continua sendo
  `GET /api/withdraw/chave-pix` (B-03).
- **D-05 · Uma função de salvamento**: `salvarCadastroFinanceiro({ userId, enviado })`
  em `lib/cadastro-financeiro-servidor.js` (consulta CEP via `lib/cep.js` →
  `planejarCadastroFinanceiro` → duplicidade por `cpfHash` com pré-checagem e
  captura de E11000 → `$set`). Usada por `PUT /api/perfil/cadastro-financeiro` e
  por `POST /api/atualizarPerfil`. Com qualquer erro, nada é gravado.
- **D-06 · Consulta de CEP no servidor**: `lib/cep.js` chama o ViaCEP
  (`https://viacep.com.br/ws/<cep>/json/`) com `AbortController` de 3 s e nunca
  lança (`indisponivel` em timeout, rede, status ≠ 200 ou JSON inválido;
  `{ erro: true }` → `nao_encontrado`). `fetchImpl` injetável para testes.
- **D-07 · PIX e saque usam o CPF do gate**: `pix/simulated/create` grava
  `pixCpf = encryptCPF(verificacao.cpf)` e ignora `req.body.cpf`;
  `withdraw/create` grava `pixKeyCpf = encryptCPF(verificacao.cpf)`, ignora e não
  exige `cpfPixKey`.
- **D-08 · Formulário embutido**: componente `components/CadastroFinanceiroForm.js`
  (lê `GET /api/perfil/cadastro-financeiro`, mostra só os campos de
  `pendencias`, pré-preenche endereço pelo ViaCEP no navegador como o perfil
  já faz, salva via `PUT`). As telas tratam a resposta 409
  `cadastro_financeiro_incompleto` abrindo o formulário e, após `onSalvo`,
  repetem a mesma ação com o estado que já tinham (nada é resetado).
- **D-09 · Correção pelo admin**: `PUT /api/admin/users/[id]/cpf`, permissão
  nova `PERMISSIONS.CORRIGIR_CPF = ['admin']`; motivo obrigatório; recusa o
  próprio id; `logAudit('user.cpf_corrected', { motivo })` sem CPF.
- **D-10 · Migração**: `scripts/migrar-cpf-usuarios.js`, dry-run por padrão,
  `--aplicar` grava; planejada por `planejarMigracaoCpf`. Ordem: dry-run →
  aplicar → dry-run (0 ações) → `setupDatabase.js` (índice) → deploy. Conflitos
  de CPF repetido param o processo para tratamento manual.
- **D-11 · `wallet/pay` incluso**: o uso genérico de saldo (`POST /api/wallet/pay`)
  também passa pelo gate — é pagamento com saldo e deixá-lo aberto seria uma
  brecha. Divergência pequena do texto da spec (que fala em "pagamento de
  assinatura"), registrada em R-006.
- **D-12 · HTTP 409** para cadastro incompleto e `cpf_indisponivel` (mesmo padrão
  das recusas de estado de negócio já usadas em `pay`/`join`).

## Constitution Check

*GATE: deve passar antes da Fase 0. Reavaliado após o design da Fase 1.*

| Princípio | Pré-Design | Pós-Design | Notas |
| --- | --- | --- | --- |
| I. Segurança no servidor | ✅ | ✅ | Gate recarrega o usuário do banco (D-03); CPF do PIX/saque vem do banco, não do cliente (D-07); CPF cifrado + hash com chave derivada, mascarado em todas as respostas (D-02/D-04); correção por `hasRole(PERMISSIONS.CORRIGIR_CPF)` (D-09); nenhuma variável nova nem log de CPF. |
| II. Integridade financeira | ✅ | ✅ | Nenhum movimento novo de dinheiro; o gate roda antes de qualquer lançamento/reserva (contrato 3). Ledger, idempotência e auditoria financeiras inalterados. |
| III. Regras de negócio como fonte | ✅ | ✅ | Spec cita RN:161-176, 236-242, 345-368, 1005. `.docs/regras-negocio-v2.md` (Fluxo 3 e "Usuário validado") é atualizado no Polish (T040); a inclusão de `wallet/pay` (D-11) fica registrada. |
| IV. Persistência documentada | ✅ | ✅ | `users.schema.json` + índice em `setupDatabase.js` e `setup-indexes.js` (mesmas opções) na mesma mudança (T005); IDs normalizados no gate (`ObjectId` vs string). |
| Restrições do Projeto | ✅ | ✅ | Pages Router; reusa `getDb`, `logAudit`, `hasRole`, `mascararCPF`, `encryptCPF`; Vitest; consulta de CEP com timeout de 3 s cabe na função serverless; migração é script manual, não timer. |
| Fluxo de Desenvolvimento | ✅ | ✅ | Consumidores de todas as APIs alteradas estão listados em `contracts/` e têm task; quickstart cobre a validação manual. |

Sem violações — `Complexity Tracking` vazio.

## Project Structure

### Documentation (this feature)

```text
sdd/specs/004-cadastro-financeiro/
├── spec.md
├── plan.md                     # este arquivo
├── data-model.md               # users: cpfHash, cpfLegadoInvalido, endereco.cepConfirmado; índice; auditoria
├── contracts/
│   └── api-cadastro-financeiro.md   # recusa 409, GET/PUT cadastro, atualizarPerfil, admin cpf, pix, saque
├── logic/
│   └── cadastro.md             # validarCpf, endereço, avaliar, planejar, migração
├── quickstart.md
├── tasks.md
├── contract-tests.lock
└── handoff.md
```

### Source Code (repository root)

```text
lib/
├── cadastro-financeiro.js            + NOVO (stub) regras puras (D-01)
├── cadastro-financeiro-servidor.js   + NOVO (stub) gate + salvarCadastroFinanceiro (D-03/D-05)
├── cep.js                            + NOVO (stub) consulta ViaCEP (D-06)
├── encryption.js                     ~ hashCPF (stub) (D-02)
├── authz.js                          ~ PERMISSIONS.CORRIGIR_CPF (D-09)
└── cpf-mascara.js                      (reuso)
pages/
├── api/
│   ├── perfil/cadastro-financeiro.js + NOVO (stub) GET/PUT
│   ├── atualizarPerfil.js            ~ GET mascarado; POST delega CPF/endereço (D-05)
│   ├── assinaturas/pay.js            ~ gate
│   ├── pix/simulated/create.js       ~ gate + CPF do perfil
│   ├── withdraw/create.js            ~ gate + chave = CPF do perfil
│   ├── wallet/pay.js                 ~ gate (D-11)
│   ├── grupos/index.js               ~ gate no POST, após o B-05
│   └── admin/users/[id]/cpf.js       + NOVO correção de CPF
├── perfil.js                         ~ CPF travado/mascarado, regras do endereço
├── assinatura/pagamento.js           ~ sem campo CPF; formulário embutido
├── wallet/add.js                     ~ sem campo CPF; formulário embutido
├── wallet/withdraw.js                ~ sem campo de chave; CPF mascarado; formulário embutido
├── wallet/pay.js                     ~ formulário embutido
├── admin/grupos/novo.js              ~ formulário embutido preservando o grupo
└── admin/index.js                    ~ ação "Corrigir CPF"
components/
└── CadastroFinanceiroForm.js         + NOVO formulário embutido (D-08)
database/
├── schemas/users.schema.json         ~ campos novos
├── setupDatabase.js                  ~ índice cpfHash
└── setup-indexes.js                  ~ mesmo índice, mesmas opções
scripts/
└── migrar-cpf-usuarios.js            + NOVO dry-run/--aplicar (D-10)
tests/
├── contract/004-cadastro-financeiro.contract.test.js   TRAVADO (5)
├── cadastro/                          + NOVO testes adicionais do executor
└── (ajustes) bugs/b04-*, bugs/b05-*, bugs/pay-aceita-fatura-estornada, preco/handler-pay, preco/handlers-grupos
```

**Structure Decision**: projeto Next.js único (Pages Router). Regras puras em
`lib/` (padrão de `lib/preco.js` e `lib/grupo-entrada.js`), acesso ao banco em
módulo `*-servidor.js` (padrão de `lib/ledger/servidor.js`), APIs em
`pages/api/`, componentes em `components/`, scripts de migração em `scripts/`
(padrão de `scripts/migrar-precos-grupos.js`), testes em `tests/<área>/`.

## Complexity Tracking

> **Preencher SOMENTE se o Constitution Check tiver violações que precisam ser justificadas**

| Violação | Por que é necessária | Alternativa mais simples rejeitada porque |
| --- | --- | --- |

## Estratégia de Testes

Prioridade: unitário → contrato/integração → E2E → manual (último recurso).

- **Unitário**: `lib/cadastro-financeiro.js` (puro), `hashCPF`, `lib/cep.js` com
  `fetchImpl` falso, `planejarMigracaoCpf`.
- **Integração de handler**: banco em memória (`tests/helpers/db-grupos-memoria.js`)
  + `vi.mock` de `next-auth`, `lib/mongodb`, `lib/audit`, `lib/cep`. Para os
  testes existentes dos handlers financeiros, mockar
  `lib/cadastro-financeiro-servidor` retornando `{ ok: true, cpf }`.
- **Manual/Playwright**: telas (sem infraestrutura de teste de UI no projeto),
  roteiro em `quickstart.md`.

Comandos-base (de `J:\Cotea`, drive maiúsculo):

```powershell
npm test
npm run test:contrato
npm run lint
npm run build    # parar o next dev antes (ver quickstart)
```

### Testes de Contrato

Arquivos travados em `contract-tests.lock`: `tests/contract/004-cadastro-financeiro.contract.test.js` (5 testes)

Comando: `npx vitest run tests/contract/004-cadastro-financeiro.contract.test.js`

| Teste | Origem | Fase | Vermelho esperado (antes do execute) |
| --- | --- | --- | --- |
| valida CPF pelo dígito verificador, trava o CPF salvo e deriva o cadastro completo | US1-AC1/AC3/AC4 · FR-001/002/005 | Fase 2 (T001) | `Error: not implemented` |
| valida o endereço com a consulta de CEP: confirma, recusa inexistente, aceita indisponível e não deixa voltar a incompleto | US1-AC5/AC6/AC7 · FR-006/007/009 | Fase 2 (T001) | `Error: not implemented` |
| pagamento, depósito PIX, saque, uso de saldo e criação de grupo recusam cadastro incompleto sem nenhum efeito | US2-AC1..AC4 · FR-011/012/013 · SC-001 | Fase 4 | `AssertionError: pay: expected 404 to be 409` |
| PUT/GET do cadastro: CPF único sem revelar a outra conta, gravado cifrado com hash, travado e nunca devolvido completo | US1-AC2/AC3/AC4 · FR-003/004/005/010 · Constitution I | Fase 3 | `Error: not implemented` (hashCPF no setup) |
| depósito PIX e saque gravam o CPF do perfil, ignorando o CPF/chave enviados, e o saque dispensa a chave | US4-AC1..AC3 · FR-015/016 | Fase 6 | `AssertionError: expected '11144477735' to be '52998224725'` |

Stubs criados pelo plan (ponto de partida do execute, não travados):
`lib/cadastro-financeiro.js`, `lib/cadastro-financeiro-servidor.js`,
`lib/cep.js`, `hashCPF` em `lib/encryption.js`,
`pages/api/perfil/cadastro-financeiro.js`.

## Estado Atual

<!-- Sobrescrita a cada checkpoint pelo sdd-execute. Vazia na criação. -->

| Área | Estado |
| --- | --- |
| Código das 6 histórias (regras, gate, perfil, formulário embutido, PIX/saque com CPF do perfil, correção pelo admin, migração) | Implementado; contratos 20/20 (001-004), `npm test` 277/277, `npm run lint` 0 erros, `npm run build` ok |
| Documentação | `.docs/regras-negocio-v2.md` (Usuário validado, Fluxos 3, 15, 16, 18), `CLAUDE.md` e nota na V2-17 do backlog atualizados |
| Banco de produção | **Migração não aplicada e índice `cpfHash_unico` não criado** (T042, decisão do usuário: junto do deploy). Dry-run: 1 `marcar_invalido` (admin), 0 conflitos |
| Validação manual | Parcial (T043): falta salvamento real pelo formulário e PIX/saque de ponta a ponta com conta de cadastro completo |

## Riscos e Decisões

<!--
  IDs estáveis (R-001, R-002...), nunca deletados. Item resolvido ganha
  prefixo "Resolvido:" na célula de Mitigação em vez de sumir da tabela.
-->

| ID | Risco/Decisão | Impacto | Mitigação/Encaminhamento |
| --- | --- | --- | --- |
| R-001 | ViaCEP indisponível ou lento a partir da Vercel | Médio (salvamento do endereço) | D-06: timeout 3 s e fallback `indisponivel` → aceita com `cepConfirmado: false` (FR-007) |
| R-002 | CPF repetido entre contas impede criar o índice único | Alto na implantação | D-10: migração em dry-run antes; conflito para o processo; índice só depois |
| R-003 | Os 3 usuários sem cadastro passam a ser barrados em pagamento/saque até completar | Médio (atrito), esperado (FR-021) | Formulário embutido (US3) reduz o atrito; comunicar no deploy |
| R-004 | Testes existentes dos handlers financeiros quebram com o gate | Baixo | T020: mockar `lib/cadastro-financeiro-servidor` como `{ ok: true }` nesses arquivos (nenhum é contrato travado) |
| R-005 | O contrato 3 fixa a posição do gate (antes de ler o grupo/corpo) | Baixo | É a decisão D-03; executor não deve mover o gate para depois das validações |
| R-006 | `wallet/pay` incluído no gate sem estar explícito na spec | Baixo | D-11; atualizar a RN no Polish (T040) |
| R-007 | Admin único não consegue corrigir o próprio CPF | Baixo | Premissa da spec; correção fica fora do produto até haver 2º admin |
| R-008 | CPF legado em texto puro antes da migração | Baixo | `decryptCPF` já aceita legado; gate e travamento funcionam antes e depois da migração |
| R-009 | O contrato 3 mocka `lib/cadastro-financeiro-servidor` expondo só `verificarCadastroFinanceiro`; o endpoint não pode importar dali o salvamento | Baixo (estrutura) | Resolvido: leitura/gravação (`carregarUsuario`, `cpfClaroDoUsuario`, `resumoCadastroFinanceiro`, `salvarCadastroFinanceiro`) movidas para `lib/cadastro-financeiro-perfil.js`; o `-servidor` expõe só o gate (ajusta D-03/D-05 sem mudar o comportamento) |
| R-010 | CSP `connect-src 'self'` (`next.config.mjs`) bloqueia o ViaCEP no navegador; o perfil antigo nunca preencheu o CEP e apagava UF/cidade/bairro/rua ao abrir | Médio (UX e perda de dados ao salvar) | Resolvido: proxy `GET /api/cep/[cep]` (sessão obrigatória, `lib/cep.js`) e `components/EnderecoCampos.js`, que só consulta quando o usuário altera o CEP (T011a/T011b). D-08 passa a usar o proxy em vez do ViaCEP direto |
| R-011 | O CPF legado (texto puro) do único usuário com CPF não passa no dígito verificador | Baixo | Esperado pela spec: conta como ausente (campo editável); a migração (T042) o move para `cpfLegadoInvalido`; o usuário precisa informar um CPF válido para operar |

## Execution Notes

<!--
  Tabela append-only, mantida pelo sdd-execute. Quando passar de ~40 linhas,
  arquivar as mais antigas (exceto as ~10 mais recentes) em history.md,
  substituindo por uma linha de resumo consolidado aqui.
-->

| Data | Fase/Story | Resumo | Pendência Principal |
| --- | --- | --- | --- |
| 2026-11-25 | Fase 2 (Fundação) | Regras puras, hashCPF, consultarCep, gate/salvamento no servidor, schema e índice; contratos 1-2 verdes; 34 testes em `tests/cadastro` + B-09 | — |
| 2026-11-25 | Fase 3 (US1) | Endpoint de cadastro, `atualizarPerfil` (não apaga CPF, GET mascarado), perfil com CPF travado, `EnderecoCampos` + proxy de CEP (CSP); módulo `-perfil` separado do gate (R-009); contrato 4 verde | Gravação pela tela não exercitada contra o banco (T043) |

| 2026-11-25 | Fase 4 (US2) | Gate ligado aos cinco handlers; 5 arquivos de teste existentes passam a simular o gate aprovado; `tests/cadastro/gate-handlers.test.js` com o gate real; suíte 263/264 (falta só o contrato da Fase 6) | — |

| 2026-11-25 | Fase 5 (US3) | `CadastroFinanceiroForm` + formulário embutido em checkout, recarga, saque, uso de saldo e criação de grupo; validado no navegador (409 real → formulário → reenvio com o mesmo corpo), sem efeitos no banco | Salvamento real pelo formulário em T043 |

| 2026-11-25 | Fase 6 (US4) | PIX e saque usam o CPF do gate e ignoram o do corpo; telas sem campo de CPF/chave (saque mostra o CPF mascarado); suíte 269/269, contratos 20/20 | — |

| 2026-11-25 | Fase 7 (US5) | Permissão `CORRIGIR_CPF`, rota de correção com motivo e auditoria sem CPF, ação no painel; 5 testes; suíte 274/274 | — |

| 2026-11-25 | Fase 8 (US6) | `planejarMigracaoCpf` + script de migração (dry-run/`--aplicar`, conflito aborta); 3 testes; dry-run no banco: 1 inválido, 0 conflitos | Aplicar + índice (T042) com autorização |

| 2026-11-25 | Fase 9 (Polish) | RN, CLAUDE.md e V2-17 atualizados; quickstart parcial no servidor real (duplicidade, DV, CEP, correção pelo admin, gate) com limpeza; gates: test 277/277, lint 0 erros, build ok | T042 no deploy; T043 restante com conta de cadastro completo |

**PRÓXIMO**: no deploy — `scripts/migrar-cpf-usuarios.js` (dry-run → `--aplicar` → dry-run 0) → `node database/setupDatabase.js` → deploy; depois concluir T043 (o admin informa o CPF real no perfil e testa PIX/saque) e rodar `sdd-converge`

## Arquivos Principais

<!-- Sobrescrita a cada checkpoint — foco da etapa atual, não a árvore inteira. -->

- `scripts/migrar-cpf-usuarios.js` e `database/setupDatabase.js` — passos do deploy (T042)
- `sdd/specs/004-cadastro-financeiro/quickstart.md` — passos 2 e 4 restantes (T043)

## Cuidados para Retomada

<!-- Armadilhas operacionais específicas desta feature, anexadas conforme descobertas. -->

- Rodar o Vitest pelo PowerShell a partir de `J:\Cotea`; pelo Bash (`/j/Cotea`) o Vitest carrega duas vezes e falha com `Cannot read properties of undefined (reading 'config')`.
- Chamadas do navegador para fora do domínio são bloqueadas pela CSP (`connect-src 'self'`): usar proxies em `pages/api/` (ex.: `/api/cep/[cep]`).
- Handlers e endpoints que precisam de leitura/gravação do cadastro importam de `lib/cadastro-financeiro-perfil.js`; de `lib/cadastro-financeiro-servidor.js` só o gate (o contrato 3 o mocka inteiro).
- Logo após editar uma página, o `next dev` pode servir a tela presa em "Carregando..." durante o Fast Refresh; recarregar depois da recompilação antes de concluir que quebrou.
- Teste novo que chame `pay`, `pix/simulated/create`, `withdraw/create`, `wallet/pay` ou `POST /api/grupos` precisa simular `lib/cadastro-financeiro-servidor` (ou semear usuário com CPF cifrado válido + endereço válido), senão recebe 409 do gate.
- Para validar telas sem gravar no banco de produção: interceptar `PUT /api/perfil/cadastro-financeiro` com `page.route` e conferir que a ação é reenviada com o mesmo corpo; as recusas 409 do gate não têm efeito.
- A sessão do navegador do Playwright expira (login Google): se `/api/auth/session` vier vazio, abrir `/auth/signin` e pedir ao usuário para entrar de novo; páginas de admin carregam a lista depois do título — esperar o conteúdo antes de contar linhas.
