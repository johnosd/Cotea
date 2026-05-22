# Checklist de Qualidade de Código — Cotea

Gerado em: 2026-05-22  
Origem: auditoria estática do codebase

---

## Legenda

- `[ ]` — pendente
- `[x]` — corrigido
- **CRÍTICO** — risco de segurança ou dados
- **ALTO** — impacto em manutenibilidade ou corretude
- **MÉDIO** — dívida técnica relevante
- **BAIXO** — cosmético / padronização

---

## Segurança

- [x] **CRÍTICO** — `pages/api/meus-grupos.js`: endpoint aceita `userId` do query param sem validar sessão — qualquer usuário pode ler grupos de outro usuário
- [x] **MÉDIO** — `lib/encryption.js`: `decryptCPF` agora emite `console.warn` para dados legados em plaintext (rastreável em produção) e retorna `null` (em vez do ciphertext) quando a decriptação falha — callers em `atualizarPerfil.js`, `usuario.js` e `admin/users/index.js` propagam `null` naturalmente sem quebrar
- [x] **MÉDIO** — `pages/api/atualizarPerfil.js`: CPF vazio não era problema real (`encryptCPF("")` já retornava `""`); corrigido o problema real: CPF agora é extraído como dígitos e validado com 11 chars antes de cifrar
- [x] **MÉDIO** — `pages/api/sendVerificationCode.js`: reordenado para checar IP primeiro — IP bloqueado não incrementa mais o contador de e-mail da vítima; índice TTL via `indexEnsured` flag é aceitável (cria uma vez por instância, `createIndex` é idempotente)
- [ ] **BAIXO** — `pages/api/auth/[...nextauth].js`: rate limit no login somente por e-mail — adicionar IP requer Next.js Middleware (callback `signIn` não expõe `req`); melhoria futura

---

## Endpoints de Teste em Produção

- [x] **ALTO** — `pages/api/testSendEmail.js`: deletado — envio de e-mail coberto por `sendVerificationCode.js`, `acessos.js` e `mensagens.js`
- [x] **ALTO** — `pages/api/wallet/reset.js`: deletado da API; lógica migrada para `scripts/reset-wallet.js` (script local, nunca vira rota HTTP). Uso: `node --env-file=.env.local scripts/reset-wallet.js <userId>`
- [ ] **BAIXO** — `pages/api/pix/simulated/create.js` e `confirm.js`: apesar do nome, são o gateway de pagamento real — renomear para remover "simulated" requer atualizar `pagamento.js` e `wallet/add.js`

---

## God Files / Tamanho Excessivo

- [x] **ALTO** — `pages/api/grupos/[id].js`: 346 → 195 linhas; lógica extraída em `handleGet`, `handleDelete`, `handleUpdate`; `handler` exportado é dispatcher de ~30 linhas com auth compartilhada entre DELETE e PUT
- [x] **ALTO** — `pages/api/grupos/index.js`: 323 → 160 linhas; lógica extraída em `handleList` e `handleCreate`; `handler` exportado é dispatcher de ~10 linhas
- [x] **MÉDIO** — `components/Header.js`: 369 → 107 linhas; `NotificationsDropdown` (115 linhas) e `ProfileMenu` (100 linhas) extraídos como componentes autônomos com próprio estado, refs e efeito de click-outside/ESC

---

## Duplicação de Código

- [x] **ALTO** — Funções `parseObjectId`, `parseLista`, `parseFaq`, `parseFidelidade`, `normalizarPreco`, `parseNumero`, `slugify` e `CATEGORIAS_PERMITIDAS` extraídas para `lib/grupos-utils.js`; ambos os arquivos atualizados para importar do módulo compartilhado
- [x] **MÉDIO** — `getSessionUserId` de `lib/wallet.js` agora usado em `grupos/index.js` e `grupos/[id].js` no lugar do pattern inline duplicado

---

## Corretude e Consistência

- [x] **ALTO** — `pages/api/grupos/index.js:321`: falta `return` antes de `res.status(500).json()` — pode tentar enviar resposta dupla
- [x] **MÉDIO** — `pages/api/auth/[...nextauth].js`: `session` callback eliminado do banco (lia `users` em toda page load); dados lidos do JWT token; refresh periódico no `jwt` callback expandido para incluir campos de perfil (`nome`, `sobrenome`, `telefone`, `username`, `image`)
- [ ] **MÉDIO** — `pages/api/atualizarPerfil.js`: após atualizar perfil, o token JWT não é invalidado imediatamente — mudanças de nome/avatar levam até `SESSION_UPDATE_AGE_SECONDS` (padrão 30min) para refletir na sessão; solução futura: forçar refresh do token via `unstable_update` do NextAuth ou revalidar a sessão no cliente após salvar
- [x] **MÉDIO** — `getSessionUserId` de `lib/wallet.js` agora usado em todos os endpoints que tinham o pattern inline (`grupos/index.js`, `grupos/[id].js`, `grupos/[id]/acessos.js`, `grupos/[id]/mensagens.js`); `parseObjectId` local removido de `acessos.js` e `mensagens.js` — agora importado de `lib/grupos-utils.js`
- [x] **BAIXO** — `pages/api/notificacoes.js`: `lido` agora aceita `"true"` e `"1"`; adicionado `isUserBlocked` check; autorização migrada para `hasRole` + `getSessionUserId` (consistente com restante do código)

---

## Audit Logging

- [x] **MÉDIO** — `grupos/index.js`: `grupo.created` registrado após criação bem-sucedida
- [x] **MÉDIO** — `grupos/[id].js`: `grupo.deleted` e `grupo.updated` registrados após operações bem-sucedidas
- [x] **MÉDIO** — `assinaturas/pay.js`: `assinatura.paid` registrado após débito + invoice marcada paga
- [x] **MÉDIO** — `wallet/pay.js`: `wallet.debit` registrado após débito bem-sucedido
- [x] **MÉDIO** — `assinaturas/refund.js`: `assinatura.refunded` registrado após estorno bem-sucedido (única operação de invoice sem audit — `createInvoice` e `markInvoicePaid` já cobertos por `assinatura.paid`)
- [ ] **OK** — Aprovação de saque (`withdraw/approve.js`) — tem audit logging ✓
- [ ] **OK** — Mudança de role (`admin/users/[id]/role.js`) — tem audit logging ✓
- [ ] **OK** — Bloqueio de usuário (`admin/users/[id]/block.js`) — tem audit logging ✓

---

## Validação de Entrada

- [x] **MÉDIO** — `pages/api/atualizarPerfil.js`: `endereco` agora tem limite de tamanho por campo (cep 9, uf 2, cidade/bairro 100, rua 200, numero 20, complemento 100); `nome`/`sobrenome` limitados a 100 chars; `username` a 30 chars com validação de caracteres permitidos; `telefone` a 20 chars
- [x] **MÉDIO** — `pages/api/grupos/index.js` e `[id].js`: arrays `beneficios` (máx 30 itens, 200 chars/item), `regras` (máx 30, 500 chars) e `faq` (máx 20 itens) agora validados antes de persistir; parse feito uma única vez e reutilizado no documento
- [ ] **BAIXO** — Convenção de chave de resposta inconsistente: arquivos antigos (`atualizarPerfil.js`, `cadastro.js`, `verifyCode.js`, `notificacoes.js`, `sendVerificationCode.js`) usam `{ message: }` para erros; arquivos novos usam `{ error: }`. Padrão correto: `error:` para erros, `message:` para sucesso. Migração requer atualizar frontend junto — `pages/perfil.js`, `pages/verificacao.js`, `pages/cadastro.js` e `pages/notificacoes.js` leem `.message` dessas rotas. Fazer em sprint separado.

---

## Performance

- [x] **MÉDIO** — Índices documentados e scriptados em `database/setup-indexes.js`: `membrosGrupo` indexado por `{userId,status}`, `{grupoId,status}`, `{grupoId,papel}`, `{grupoId,userId,papel}`; índices adicionados para `wallets`, `walletTransactions`, `invoices`, `rateLimits`, `notificacoesUsuario`, `auditLogs` e `verificationCodes`

---

## Progresso Geral

Corrigidos: 24 / 29
