# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # Start dev server (http://localhost:3000)
npm run build    # Production build
npm run start    # Start production server
npm run lint     # Run ESLint
npm test         # Run Vitest (all tests)
npm run test:contrato  # Run only locked SDD contract tests (tests/contract)
```

Tests use **Vitest** (`vitest.config.mjs`, files in `tests/**/*.test.js`). Files listed in `sdd/specs/*/contract-tests.lock` are locked contract tests — never edit them. On Windows, run tests from `J:\Cotea` (uppercase drive letter); from `j:\` Vitest loads twice and fails with `Cannot read properties of undefined (reading 'config')`.

## Architecture

This is a **Next.js 14 (Pages Router)** app — a group subscription management platform where users join paid groups, manage wallets, and make PIX payments.

### Key directories

- `pages/` — Next.js Pages Router; all routes live here
  - `pages/api/` — Backend API routes (Node.js serverless functions)
  - `pages/admin/` — Admin dashboard (role-gated)
  - `pages/assinatura/` — Subscription flow
  - `pages/wallet/` — Wallet/payment flow
  - `pages/grupos/` — Group detail pages
- `components/` — Shared React components
- `lib/` — Server-side utilities (never import in client components without `'use client'` caution)
  - `lib/mongodb.js` — DB connection + all collection accessors
  - `lib/authz.js` — RBAC permission helpers
  - `lib/wallet.js` — Wallet balance calculations and session helpers
  - `lib/ledger/` — Segmented ledger core (pure, injected repository) + Mongo repository (`repositorio-mongo.js`) and server wiring (`servidor.js`)
  - `lib/r2.js` — Cloudflare R2 (S3-compatible) upload/delete/URL
  - `lib/invoices.js` — Invoice logic
- `database/schemas/` — JSON Schema definitions for each MongoDB collection (documentation only — not enforced by application code)

### Database

MongoDB Atlas via native driver (`mongodb` v6). Connection is cached globally in development and opened fresh per-request in production. All collection helpers are exported from `lib/mongodb.js` — always use those rather than constructing collection references inline.

Collections: `users`, `grupos`, `membrosGrupo`, `wallets`, `walletTransactions`, `payments`, `withdrawals`, `notificacoesUsuario`, `invoices`, `transacoes`, `saques`, `mensagens`, `logsAcessoGrupo`, `verificationCodes`.

### Authentication & Authorization

- **NextAuth.js v4** with Google OAuth only. Sessions use JWT strategy.
- The session JWT is extended (via `lib/wallet.js` helpers) with: `nome`, `sobrenome`, `email`, `telefone`, `username`, `systemRole`, `contaValidada`, `isBlocked`.
- **RBAC** is in `lib/authz.js`. Roles: `admin`, `support`, `finance`, `user`. Use `hasPermission(role, permission)` to gate API routes and admin UI tabs. `isBlocked` blocks access regardless of role.

### Payments & Wallet

- Users have a `wallets` document; credits/debits are recorded in `walletTransactions` (status: `confirmed` | `blocked` | `pending` | `cancelled`).
- **Every ledger entry goes through `obterLedger()` (`lib/ledger/servidor.js`)** — `registrarOperacao` / `mover` / `liquidarReserva`. Never insert into `walletTransactions` directly from a handler. Each entry has `categoria` (`pessoal`, `caucao`, `retido_entrada`, `recebivel_retido`, `disputa`, `receita_taxa`), `organizacaoId` (null = public), optional `grupoId`/`participacaoId`, and an idempotency key `operacaoId` (`<source>:<referenceId>`). Side effects that must commit with the entry go in `extra({ sessao, lancamentos })` using `{ session }`; `logAudit` only after commit.
- Balances are always derived (integer cents): available (= withdrawable) = `pessoal` minus pending withdrawals (`blocked` debits). The platform account is `wallets._id = 'plataforma'` (only `receita_taxa`).
- `lib/ledger/ledger.js`, `consistencia.js`, `migracao.js` must not import `lib/mongodb.js` (it validates env on import). Client pages import only `lib/ledger/rotulos.js`.
- **Financial profile gate (feature 004)**: every action that charges, deposits, withdraws, spends balance or creates a group calls `verificarCadastroFinanceiro(userId)` from `lib/cadastro-financeiro-servidor.js` right after the session/`contaValidada`/block checks and before any read of the group, body validation or side effect; on failure return `res.status(v.http).json(v.body)` (409 `cadastro_financeiro_incompleto` + `pendencias`). Rules live in the pure `lib/cadastro-financeiro.js`; profile read/write in `lib/cadastro-financeiro-perfil.js`.
- CPF is stored only via `encryptCPF` plus `hashCPF` (`cpfHash`, unique partial index `cpfHash_unico`); it is locked once saved (only an admin corrects it, `PUT /api/admin/users/[id]/cpf`) and never returned in full to the user. PIX and withdrawals use the profile CPF (`verificacao.cpf`), never one sent by the client.
- The site CSP (`connect-src 'self'`) blocks browser calls to other domains: proxy them through `pages/api/` (e.g. `GET /api/cep/[cep]` for ViaCEP).
- PIX payments are under `pages/api/pix/` and `pages/api/payments/`.
- Subscription payments go through `pages/api/assinaturas/`.
- Withdrawals have a request/approve/reject flow under `pages/api/withdraw/`.

### File Storage

Cloudflare R2 (S3-compatible) via AWS SDK v3. All R2 operations go through `lib/r2.js`. Group images and profile pictures are stored there; public URLs use the `R2_PUBLIC_BASE_URL` env var.

### Path Alias

`@/*` resolves to the project root (configured in `jsconfig.json`).

### Required Environment Variables

```
MONGODB_URI
MONGODB_DB
NEXT_PUBLIC_SITE_URL
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
JWT_SECRET
EMAIL_USER          # Gmail address for Nodemailer
EMAIL_PASS          # Gmail app password
R2_ACCOUNT_ID
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
R2_BUCKET_NAME
R2_PUBLIC_BASE_URL
R2_ENDPOINT
SESSION_MAX_AGE_SECONDS     # optional, default 86400
SESSION_UPDATE_AGE_SECONDS  # optional, default 1800
CRON_SECRET                 # bearer secret sent by Vercel Schedules to /api/rotinas/executar (ADR-001)
ROTINAS_SECRET              # fallback bearer secret for local runs/other schedulers (route returns 503 if neither is set)
```

### Remote image domains

`next.config.mjs` allows remote images from Google (`*.googleusercontent.com`) and the R2 CDN domain — update it when adding new image sources.
