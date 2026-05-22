# Cotea

Plataforma de gerenciamento de assinaturas em grupo. Usuários entram em grupos pagos, gerenciam carteiras digitais e realizam pagamentos via PIX.

## Stack

- **Framework:** Next.js 14 (Pages Router)
- **Banco de dados:** MongoDB Atlas (driver nativo v6)
- **Autenticação:** NextAuth.js v4 — Google OAuth, sessão JWT
- **Pagamentos:** PIX (simulado)
- **Armazenamento de arquivos:** Cloudflare R2 (compatível com S3)
- **E-mail:** Nodemailer (Gmail)
- **Estilização:** Tailwind CSS v3

## Pré-requisitos

- Node.js 18+
- Conta no MongoDB Atlas
- Credenciais do Google OAuth (Google Cloud Console)
- Bucket no Cloudflare R2
- Conta Gmail com senha de app (para Nodemailer)

## Instalação

```bash
git clone <repo-url>
cd cotea
npm install
```

Crie o arquivo `.env.local` na raiz do projeto com as variáveis abaixo.

## Variáveis de ambiente

```env
# MongoDB
MONGODB_URI=
MONGODB_DB=

# Site
NEXT_PUBLIC_SITE_URL=http://localhost:3000

# Google OAuth
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

# JWT / Sessão
JWT_SECRET=                         # string aleatória longa
SESSION_MAX_AGE_SECONDS=86400       # opcional, padrão 86400 (24h)
SESSION_UPDATE_AGE_SECONDS=1800     # opcional, padrão 1800 (30min)

# E-mail
EMAIL_USER=                         # endereço Gmail
EMAIL_PASS=                         # senha de app Gmail

# Criptografia (obrigatório: 64 caracteres hex = 32 bytes)
ENCRYPTION_KEY=

# Cloudflare R2
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET_NAME=
R2_PUBLIC_BASE_URL=
R2_ENDPOINT=
```

## Comandos

```bash
npm run dev      # Servidor de desenvolvimento (http://localhost:3000)
npm run build    # Build de produção
npm run start    # Inicia servidor de produção
npm run lint     # ESLint
```

## Estrutura de pastas

```
cotea/
├── pages/
│   ├── api/                  # API Routes (serverless functions)
│   │   ├── auth/             # NextAuth
│   │   ├── grupos/           # CRUD de grupos
│   │   ├── assinaturas/      # Pagamento e reembolso de assinaturas
│   │   ├── wallet/           # Saldo e operações da carteira
│   │   ├── withdraw/         # Solicitação e aprovação de saques
│   │   ├── pix/              # PIX simulado (criar/confirmar)
│   │   ├── payments/         # Listagem de pagamentos
│   │   ├── upload/           # Upload/remoção de imagens (R2)
│   │   └── admin/            # Gerenciamento de usuários e auditoria
│   ├── admin/                # Painel administrativo (role-gated)
│   ├── assinatura/           # Fluxo de assinatura de grupo
│   ├── wallet/               # Carteira: saldo, recarga, saque, faturas
│   ├── grupos/               # Detalhe e administração de grupo
│   ├── auth/                 # Signin / erro de autenticação
│   ├── index.js              # Homepage — listagem de grupos
│   ├── cadastro.js           # Cadastro de novo usuário
│   ├── verificacao.js        # Verificação de e-mail
│   ├── perfil.js             # Perfil do usuário
│   ├── meus-grupos.js        # Grupos do usuário logado
│   └── notificacoes.js       # Central de notificações
├── components/
│   ├── Header.js             # Cabeçalho com busca
│   └── FlowStepper.js        # Indicador de etapas
├── lib/
│   ├── mongodb.js            # Conexão e helpers de coleção
│   ├── authz.js              # RBAC (roles e permissões)
│   ├── wallet.js             # Cálculo de saldo e helpers de sessão
│   ├── invoices.js           # Lógica de faturas
│   ├── r2.js                 # Upload/delete/URL no Cloudflare R2
│   ├── audit.js              # Registro de auditoria
│   ├── encryption.js         # Criptografia de dados sensíveis
│   ├── ratelimit.js          # Rate limiting para API routes
│   ├── validation.js         # Validação de entrada
│   ├── logger.js             # Logger centralizado
│   └── env.js                # Validação de variáveis de ambiente
├── database/
│   └── schemas/              # Schemas JSON (documentação — não são enforced)
├── middleware.js             # Autenticação e verificação de conta
├── next.config.mjs           # Config Next.js (headers de segurança, imagens)
└── jsconfig.json             # Alias @/* → raiz do projeto
```

## Autenticação e autorização

O middleware (`middleware.js`) protege todas as rotas não públicas:

- **Rotas públicas:** home, detalhe de grupo, cadastro, verificação, signin
- **Rotas autenticadas:** todas as demais (redireciona para `/auth/signin`)
- **Rotas verificadas:** wallet, assinaturas, admin, meus-grupos (exige `contaValidada`)

**RBAC** em `lib/authz.js` — papéis: `admin`, `support`, `finance`, `user`. Contas com `isBlocked: true` são bloqueadas independentemente do papel.

## Coleções MongoDB

| Coleção | Descrição |
|---|---|
| `users` | Dados dos usuários |
| `grupos` | Grupos disponíveis |
| `membrosGrupo` | Membros ativos por grupo |
| `wallets` | Carteira de cada usuário |
| `walletTransactions` | Débitos e créditos (`confirmed`, `blocked`, `pending`, `cancelled`) |
| `payments` | Pagamentos registrados |
| `withdrawals` | Solicitações de saque |
| `invoices` | Faturas |
| `transacoes` / `saques` | Histórico de transações e saques |
| `mensagens` | Mensagens enviadas pelo admin do grupo |
| `notificacoesUsuario` | Notificações por usuário |
| `logsAcessoGrupo` | Auditoria de acesso aos grupos |
| `verificationCodes` | Códigos de verificação de e-mail |

## Segurança

- Headers HTTP configurados no `next.config.mjs`: CSP, HSTS, X-Frame-Options, Referrer-Policy
- CORS restrito ao domínio configurado em `NEXT_PUBLIC_SITE_URL`
- Rate limiting nas API routes via `lib/ratelimit.js`
- Criptografia de dados sensíveis via `lib/encryption.js` (chave de 32 bytes)
- Validação de variáveis de ambiente na inicialização (`lib/env.js`)
