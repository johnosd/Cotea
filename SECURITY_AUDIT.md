# Relatório de Auditoria Arquitetural — Cotea

**Data:** 2026-05-22 | **Branch:** `feature/fatura-assinatura`

---

## Progresso geral

| Prioridade | Total | Concluído |
|---|---|---|
| Crítico | 4 | 4 |
| Alto | 6 | 6 |
| Médio | 5 | 4 |
| Baixo/Qualidade | 6 | 4 |

---

## CRÍTICO

### C1 — Escalação de privilégios via cadastro
**Arquivo:** `pages/api/cadastro.js` linhas 9, 16–17, 54–55

O endpoint aceita `systemRole` e `isBlocked` diretamente do corpo da requisição **sem autenticação**. Qualquer pessoa pode se registrar com `systemRole: "admin"` e obter acesso total ao painel administrativo.

```js
// linha 9 — campo vem do body sem verificação
const { ..., systemRole, isBlocked } = req.body || {};
// linha 16-17 — valida o valor mas não bloqueia o campo
const systemRolesPermitidos = ["user", "support", "finance", "admin"];
const systemRoleSanitizado = systemRolesPermitidos.includes(systemRole) ? systemRole : "user";
```

**Fix:** remover `systemRole`/`isBlocked` do `req.body`; hardcode `"user"` no insert.

- [x] Remover `systemRole` e `isBlocked` do destructuring do `req.body`
- [x] Hardcodar `systemRole: "user"` e `isBlocked: false` no `insertOne`

---

### C2 — Atualização de perfil sem nenhuma autenticação
**Arquivo:** `pages/api/atualizarPerfil.js` linhas 1–98

Este endpoint **não possui nenhuma verificação de sessão**. Qualquer requisição anônima pode:
- Ler o perfil completo (CPF, endereço, role) de qualquer usuário via `GET ?email=...`
- Promover qualquer usuário a `admin` via `POST` com `{ email: "vitima@x.com", systemRole: "admin" }`
- Bloquear qualquer usuário da plataforma

Não há nenhum `getSession()` ou `getServerSession()` em todo o arquivo.

- [x] Adicionar `getServerSession(authOptions)` no topo dos handlers GET e POST
- [x] No GET, garantir que o email consultado pertence à sessão (ou é admin)
- [x] No POST, garantir que o usuário só atualiza o próprio perfil
- [x] Remover `systemRole` e `isBlocked` do endpoint de perfil (apenas admins devem alterar via rota específica)

---

### C3 — Endpoint de notificações sem verificação de ownership
**Arquivo:** `pages/api/notificacoes.js` linhas 5–28

O `GET` aceita qualquer `userId` na query string sem verificar se pertence à sessão ativa. Qualquer usuário consegue ler as notificações de qualquer outro usuário.

- [x] Adicionar `getServerSession` e comparar `session.user.id === userId` antes de consultar
- [x] Retornar 403 se o userId não corresponder à sessão (exceto para admins)

---

### C4 — Conexão MongoDB não reutilizada em produção
**Arquivo:** `lib/mongodb.js` linhas 33–37

```js
} else {
  // Producao: cria nova conexao
  client = new MongoClient(uri, options);
  clientPromise = client.connect();
}
```

Em ambiente serverless, cada invocação fria cria uma conexão nova que nunca é fechada nem pooled. Sob carga, isso esgota o limite de conexões do Atlas e causa falhas em cascata.

- [x] Replicar o padrão `global._mongoClientPromise` do desenvolvimento também em produção
- [x] Configurar `maxPoolSize` e `minPoolSize` nas options do MongoClient

---

## ALTO

### A1 — Sem rate limiting em nenhum endpoint sensível

Nenhuma rota de autenticação, envio de código ou pagamento tem rate limiting. Impacto:
- `POST /api/sendVerificationCode` — spam de e-mail ilimitado em qualquer endereço
- `POST /api/pix/*/create` — tentativas ilimitadas de criação de pagamento
- Endpoints de login — brute force sem proteção

- [x] Implementar rate limiter via MongoDB (`lib/ratelimit.js`) — sem dependências novas
- [x] Aplicar rate limit em `sendVerificationCode` (3 req/hora por IP)
- [x] Aplicar rate limit em endpoints de pagamento PIX (5 req/hora por userId)
- [x] Aplicar rate limit no endpoint de login do NextAuth (callback signIn, 10 req/15min por email)

---

### A2 — TLS desabilitado no Nodemailer
**Arquivo:** `pages/api/sendVerificationCode.js` linha 28 (mesmo padrão em mensagens e acessos de grupos)

```js
tls: {
  rejectUnauthorized: false,
}
```

Desabilitar a validação de certificado em produção abre o canal SMTP para ataques MITM.

- [x] Remover `rejectUnauthorized: false` de todos os transporters Nodemailer
- [ ] Testar envio de e-mail em produção com TLS ativo
- [x] Verificar e corrigir nos arquivos de mensagens e acessos de grupos

---

### A3 — Sem headers de segurança HTTP
**Arquivo:** `next.config.mjs`

O arquivo não configura nenhum header de segurança. Ausentes: `Content-Security-Policy`, `X-Frame-Options`, `X-Content-Type-Options`, `Strict-Transport-Security`, `Permissions-Policy`.

- [x] Adicionar bloco `headers()` no `next.config.mjs` com os headers padrão de segurança
- [x] Configurar `Content-Security-Policy` adequado para as origens usadas (Google, R2)
- [ ] Validar que headers estão presentes em produção via DevTools ou securityheaders.com

---

### A4 — Operações financeiras sem transações MongoDB

Operações que envolvem múltiplas coleções (débito na wallet + invoice + membro) são feitas em operações separadas sem transação atômica. Uma falha parcial deixa o banco em estado inconsistente.

- [x] Mapear todos os fluxos financeiros multi-coleção
- [x] Implementar `session.withTransaction()` nos fluxos de assinatura/pagamento
- [x] Implementar transação no fluxo de saque (debit + withdrawal record)

---

### A5 — CPF armazenado em texto puro

O CPF é persistido como string pura em `users.cpf` e `withdrawals.pixKeyCpf` sem criptografia ou mascaramento, violando boas práticas da LGPD.

- [x] Definir estratégia: criptografia reversível (AES-256-GCM) — CPF precisa ser exibido ao admin
- [x] Implementar criptografia na escrita e decriptografia na leitura
- [x] Retrocompatibilidade: `decryptCPF` retorna valor original se não estiver no formato criptografado

---

### A6 — Código de verificação com baixa entropia
**Arquivo:** `pages/api/sendVerificationCode.js` linha 16

```js
const codigo = crypto.randomBytes(3).toString("hex").toUpperCase(); // ~16M combinações
```

Sem rate limiting (ver A1), um atacante pode fazer brute force no código em segundos.

- [x] Aumentar para `crypto.randomBytes(4).toString("hex")` (~4 bilhões de combinações)
- [x] Implementar bloqueio após N tentativas erradas (`tentativas` já existe no documento)
- [x] Garantir que o campo `tentativas` seja incrementado e validado no endpoint de verificação

---

## MÉDIO

### M1 — Endpoint GET de perfil expõe dados sensíveis
**Arquivo:** `pages/api/atualizarPerfil.js` linhas 8–18

Retorna o documento completo do usuário (incluindo `systemRole`, `cpf`, `endereco`, `isBlocked`) sem autenticação. *(Coberto pela correção do C2, mas requer atenção específica ao payload retornado.)*

- [x] Após adicionar autenticação (C2), garantir que o GET retorna apenas campos necessários (sem `systemRole`, `isBlocked`, CPF completo)

---

### M2 — Sem proteção CSRF

Nenhum mecanismo de CSRF (token, `SameSite=Strict`, verificação de `Origin`) nas rotas de mutation.

- [x] Configurar `sameSite: "lax"` e `secure: true` (produção) nas cookies do NextAuth
- [x] `sameSite: "strict"` quebraria OAuth redirects — "lax" é o correto para este caso

---

### M3 — Ausência de logs de auditoria

Nenhuma ação financeira ou administrativa é registrada com `quem`, `o quê`, `quando` e `de onde`. Fraudes e erros são indetectáveis após o fato.

- [x] Criar `lib/audit.js` com `logAudit` — inserção na coleção `auditLogs` (criada automaticamente)
- [x] Registrar aprovação/rejeição de saques (`withdrawal.approved`, `withdrawal.rejected`)
- [x] Registrar mudanças de `systemRole` (`user.role_changed`) e `isBlocked` (`user.blocked/unblocked`)
- [ ] Registrar exclusões de grupos e pagamentos (wallet reset — fora do escopo financeiro imediato)

---

### M4 — Mix de padrões de autenticação (`getSession` vs `getServerSession`)

A inconsistência aumenta o risco de novos endpoints ficarem desprotegidos por usar o padrão errado.

- [x] Padronizar todos os endpoints para `getServerSession(authOptions)` (NextAuth v4 recomendado)
- [x] Buscar e substituir todos os usos de `getSession(req, res)` legado

---

### M5 — Regex de e-mail permissiva demais

Padrão `/\S+@\S+\.\S+/` usado em múltiplos endpoints aceita strings inválidas.

- [x] Criar `lib/validation.js` com `isValidEmail` — sem dependências novas
- [x] Substituir regex `/\S+@\S+\.\S+/` em acessos.js e mensagens.js

---

## BAIXO / QUALIDADE

- [x] **Q1** — Criado `lib/logger.js` — em produção omite stack trace, expõe só a mensagem
- [x] **Q2** — Criado `lib/env.js` — valida vars obrigatórias e formato da `ENCRYPTION_KEY` no boot
- [x] **Q3** — CORS configurado no `next.config.mjs` restrito a `NEXT_PUBLIC_SITE_URL`
- [x] **Q4** — Limite de payload 100kb via `experimental.serverActions.bodySizeLimit`
- [ ] **Q5** — Sentry: requer conta e DSN — instalar `@sentry/nextjs` e rodar `npx @sentry/wizard`
- [ ] **Q6** — Atlas schema validation: aplicar via mongosh (comandos abaixo)

---

## Resumo de prioridades

| # | Item | Arquivo | Esforço |
|---|---|---|---|
| C1 | Remover systemRole do cadastro | `pages/api/cadastro.js` | 15 min |
| C2 | Adicionar auth em atualizarPerfil | `pages/api/atualizarPerfil.js` | 30 min |
| C3 | Verificar ownership em notificações | `pages/api/notificacoes.js` | 20 min |
| C4 | Connection pooling em produção | `lib/mongodb.js` | 2h |
| A1 | Rate limiting nos endpoints sensíveis | múltiplos | 1 dia |
| A2 | Reabilitar TLS no Nodemailer | múltiplos | 1h |
| A3 | Security headers no next.config.mjs | `next.config.mjs` | 2h |
| A4 | Transações MongoDB em pagamentos | múltiplos | 2 dias |
| A5 | Criptografia de CPF | múltiplos | 1 dia |
| A6 | Entropia do código de verificação | `pages/api/sendVerificationCode.js` | 1h |
| M1–M5 | Melhorias de segurança média | múltiplos | 1 semana |
| Q1–Q6 | Qualidade e infraestrutura | múltiplos | 1 semana |
