# AGENTS.md

Instrucoes essenciais para agentes trabalhando neste repositorio.

## Visao Geral

- App Next.js com Pages Router. Paginas ficam em `pages/`, APIs em `pages/api/`, componentes em `components/`, contexto React em `context/` e utilitarios compartilhados em `lib/`.
- O dominio principal e uma galeria/marketplace de grupos de jogos, assinaturas e carteira: grupos, membros, notificacoes, faturas, pagamentos, saques e ledger de carteira.
- MongoDB e a fonte de dados principal. Schemas e indices ficam em `database/schemas/` e `database/setupDatabase.js`.
- Autenticacao usa NextAuth com Google em `pages/api/auth/[...nextauth].js`; autorizacao administrativa usa `lib/authz.js`.
- Upload/remocao de imagens de grupos usa Cloudflare R2 via `lib/r2.js` e APIs em `pages/api/upload/`.

## Comandos

- Instalar dependencias: `npm install`
- Desenvolvimento: `npm run dev`
- Build: `npm run build`
- Producao local: `npm run start`
- Lint configurado no `package.json`: `npm run lint`
- Configurar/atualizar colecoes, validators e indices do MongoDB: `node database/setupDatabase.js`

Observacao: nao ha suite de testes automatizados configurada no reposititorio. Para mudancas de comportamento, valide com `npm run build` e fluxo manual relevante.

## Variaveis de Ambiente

Nao leia nem exponha valores de `.env.local`. Use apenas nomes de variaveis quando precisar documentar ou diagnosticar configuracao.

Variaveis usadas pelo app:

- Banco: `MONGODB_URI`, `MONGODB_DB`
- Auth/session: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `JWT_SECRET`, `NEXTAUTH_SECRET`, `SESSION_MAX_AGE_SECONDS`, `SESSION_UPDATE_AGE_SECONDS`
- Admin legado/autorizacao: `ADMIN_EMAILS`
- E-mail: `EMAIL_USER`, `EMAIL_PASS`
- URL publica: `NEXT_PUBLIC_SITE_URL`
- R2: `CLOUDFLARE_R2_ACCOUNT_ID`, `R2_ACCOUNT_ID`, `CLOUDFLARE_R2_ENDPOINT`, `R2_ENDPOINT`, `CLOUDFLARE_R2_ACCESS_KEY_ID`, `R2_ACCESS_KEY_ID`, `CLOUDFLARE_R2_SECRET_ACCESS_KEY`, `R2_SECRET_ACCESS_KEY`, `CLOUDFLARE_R2_BUCKET`, `R2_BUCKET_NAME`, `CLOUDFLARE_R2_PUBLIC_BASE_URL`, `R2_PUBLIC_BASE_URL`

## Estrutura e Padroes

- Preserve o Pages Router. Novas rotas de tela devem ir em `pages/`; novas APIs devem ir em `pages/api/`.
- Use imports com alias `@/*` quando isso reduzir caminhos relativos; o alias esta em `jsconfig.json`.
- Tailwind esta configurado para `pages/**/*` e `components/**/*`; estilos globais ficam em `styles/globals.css`.
- Prefira helpers existentes em `lib/` para acesso a banco, carteira, faturas, R2 e autorizacao.
- `lib/mongodb.js` exporta `clientPromise`, `getDb()` e helpers de carteira/pagamentos. Reutilize `getDb()` em codigo novo.
- O codigo mistura ES modules e CommonJS em pontos existentes. Siga o estilo do arquivo editado em vez de fazer refatoracoes amplas.
- Muitos textos estao em portugues. Mantenha mensagens de UI/API em portugues e consistentes com as existentes.

## Banco de Dados

- Para validar ou atualizar schemas, use o MongoDB MCP como fonte da verdade do schema observado nos documentos reais. Primeiro rode `count`; depois rode `collection_schema` com `sampleSize` cobrindo todos os documentos quando a colecao for pequena. Se a colecao for grande, use uma amostra ampla e informe que o resultado e um schema observado por amostragem.
- Nao assuma que os arquivos em `database/schemas/` estao atualizados. Diferencie explicitamente: schema observado nos documentos, validator `$jsonSchema` aplicado na colecao se estiver disponivel, e schema versionado local em `database/schemas/`.
- Se o MCP nao expuser o validator real da colecao, diga isso claramente. Ao comparar, trate campos ausentes nos documentos como "nao observados nos documentos atuais" e campos ausentes no schema local como "presentes no MongoDB e ausentes no schema local".
- Antes de editar arquivos de schema, apresente a diferenca entre MongoDB e arquivos locais e aguarde confirmacao.
- Ao alterar formato de documentos, atualize o schema correspondente em `database/schemas/`.
- Ao adicionar colecao ou indice, atualize `database/setupDatabase.js`.
- IDs de MongoDB aparecem tanto como `ObjectId` quanto como strings/UUIDs dependendo da colecao. Confira o schema e os handlers existentes antes de comparar ou inserir IDs.
- Para novos handlers que dependem de sessao, prefira `getServerSession(req, res, authOptions)`.
- Para valores monetarios, reutilize `normalizeAmount()` de `lib/wallet.js` e mantenha arredondamento para duas casas.

## Auth e Autorizacao

- NextAuth injeta dados de usuario na sessao a partir da colecao `users`.
- Middleware protege rotas por padrao e libera apenas caminhos listados em `middleware.js`.
- Para roles administrativas, use `hasRole(session, roles)` e `PERMISSIONS` de `lib/authz.js`.
- Nao confie em dados enviados pelo cliente para permissoes; recarregue usuario/grupo no servidor quando a acao for sensivel.

## Uploads e Imagens

- Upload de imagem de grupo usa `formidable`, valida tamanho maximo de 5 MB e MIME/extensoes jpeg/png/webp.
- Use `hasR2Config()` e `missingR2Config()` antes de operacoes R2 quando criar fluxos novos.
- `next.config.mjs` permite imagens remotas do dominio publico R2 atual e de `lh3.googleusercontent.com`.

## Arquivos Gerados e Cuidados

- Ignore `.next/` e `node_modules/` ao pesquisar padroes; eles sao artefatos gerados.
- Nao edite `package-lock.json` manualmente. Ele so deve mudar por comando npm.
- Nao comite `.env.local` nem valores secretos.
- Evite refatoracoes globais de encoding/textos acentuados em tarefas pequenas; ha arquivos existentes com texto possivelmente salvo em encoding inconsistente.
- Antes de mudar contratos de API, confira os consumidores em `pages/` e componentes que chamam `fetch('/api/...')`.

## Checklist Antes de Finalizar

- Rodou `npm run build` para mudancas de codigo que afetam runtime.
- Rodou `npm run lint` quando a configuracao local permitir.
- Atualizou schemas/indices se mudou persistencia.
- Validou manualmente o fluxo impactado quando nao houver teste automatizado.
- Documentou novas variaveis de ambiente sem expor valores.
