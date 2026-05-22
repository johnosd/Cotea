# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # Start dev server (http://localhost:3000)
npm run build    # Production build
npm run start    # Start production server
npm run lint     # Run ESLint
```

No test framework is configured.

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
```

### Remote image domains

`next.config.mjs` allows remote images from Google (`*.googleusercontent.com`) and the R2 CDN domain — update it when adding new image sources.
