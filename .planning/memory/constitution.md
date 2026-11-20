<!--
Relatório de Impacto de Sincronização
- Mudança de versão: 1.0.0 -> 1.1.0
- Princípios modificados: nenhum
- Seções modificadas: Restrições do Projeto (plataforma definida pela ADR-001; regras de serverless, região e trabalho agendado)
- Seções removidas: nenhuma
- Pendências: nenhuma (e-mail transacional segue a ADR-002, sem regra de gate)
-->

# Constitution do Cotea

## Princípios Fundamentais

### I. Segurança no servidor

- Toda API que lê dados privados ou executa ação sensível DEVE obter a sessão
  com `getServerSession(req, res, authOptions)` e recarregar do banco o
  usuário/grupo/recurso envolvido antes de decidir.
- Permissões, papéis, preços, valores, status e IDs de dono NÃO DEVEM ser
  aceitos do cliente como fonte da verdade; papéis são checados com
  `hasRole`/`PERMISSIONS` de `lib/authz.js`.
- Rotas sem sessão de usuário (ex.: chamadas de agendador) DEVEM exigir um
  segredo de servidor e NÃO DEVEM estar liberadas sem verificação.
- CPF DEVE ser criptografado em repouso e mascarado em telas/respostas
  administrativas, exceto onde a regra de negócio exigir o valor completo.
- Valores de `.env.local` e segredos NÃO DEVEM ser lidos para exibição,
  registrados em log/erro, nem commitados; só nomes de variáveis são
  documentados.

### II. Integridade financeira

- Todo movimento de dinheiro DEVE ser registrado como lançamento no ledger
  (`walletTransactions`), nunca só como campo solto em outro documento.
- Operações que movimentam dinheiro DEVEM ser idempotentes por
  referência/evento (repetir a chamada não duplica efeito) e atômicas quando
  tocam mais de um documento (transação).
- Valores monetários DEVEM ser normalizados para 2 casas com
  `normalizeAmount()` de `lib/wallet.js`.
- Débito, crédito, estorno, saque e suas aprovações DEVEM gerar auditoria via
  `logAudit`.

### III. Regras de negócio como fonte

- Comportamento de produto DEVE seguir `.docs/regras-negocio-v2.md`.
- Toda spec DEVE citar as regras que implementa; uma mudança que diverge do
  documento DEVE atualizar o documento na mesma entrega ou registrar a
  divergência como decisão explícita na spec.

### IV. Persistência documentada

- Mudança de formato de documento DEVE atualizar o schema correspondente em
  `database/schemas/` na mesma mudança.
- Nova coleção ou índice DEVE ser adicionado a `database/setupDatabase.js`
  (e `database/setup-indexes.js` quando aplicável) na mesma mudança.
- Handlers DEVEM normalizar IDs (`ObjectId` vs string) antes de comparar ou
  inserir, conforme o formato real da coleção.

## Restrições do Projeto

- Stack travada: Next.js 14 com **Pages Router** (telas em `pages/`, APIs em
  `pages/api/`), MongoDB via driver nativo, NextAuth v4 (Google, JWT),
  Cloudflare R2 via `lib/r2.js`, Tailwind.
- Código novo DEVE reutilizar os helpers de `lib/` (`getDb()`, `normalizeAmount()`,
  `logAudit()`, `hasRole()`, `hasR2Config()`) em vez de reimplementá-los.
- Testes automatizados usam **Vitest**; testes ficam junto da feature e rodam
  por `npm test`.
- Mensagens de UI e de API em português, consistentes com as existentes; não
  fazer refatorações globais de encoding/acentuação em tarefas pequenas.
- Deploy na **Vercel** (ADR-001), com funções serverless na região `gru1`. Código
  de servidor DEVE caber no tempo máximo de função do plano: processamento em
  lote DEVE ter limite por execução e continuar na execução seguinte.
- Funções e banco DEVEM ficar na mesma região (alvo: São Paulo, ADR-001).
- Trabalho agendado DEVE ser uma rota HTTP protegida por segredo
  (`Authorization: Bearer <CRON_SECRET>`), chamada pelo agendador da plataforma
  (Vercel Schedules); timers dentro do processo (`setInterval`, `node-cron`) NÃO
  DEVEM ser usados.
- Decisões de arquitetura ficam em `sdd/adr/`; um plano que as contrarie DEVE
  propor emenda via `sdd-adr`.

## Fluxo de Desenvolvimento

Uma mudança só está pronta quando:

1. `npm run build` passa.
2. `npm run lint` passa (quando a configuração local permitir).
3. `npm test` passa, incluindo os testes de contrato travados da feature.
4. O fluxo afetado foi validado manualmente (roteiro em `quickstart.md`
   quando a feature tiver um).
5. Contratos de API alterados tiveram os consumidores em `pages/` e
   `components/` atualizados na mesma mudança.
6. Schemas/índices e novas variáveis de ambiente (só nomes) estão documentados.

## Governança

Emendas são feitas editando este arquivo e atualizando a versão e o relatório
de impacto no topo. Decisões de arquitetura que fundamentam uma emenda devem ter
ADR em `sdd/adr/`.

A constitution usa versionamento semântico. Uma versão MAJOR denota remoção ou
redefinição incompatível de um princípio. Uma versão MINOR denota um novo
princípio ou expansão material da governança. Uma versão PATCH denota
esclarecimentos, correções ou mudanças de texto não semânticas.

**Versão**: 1.1.0 | **Ratificada**: 2026-11-20 | **Última Emenda**: 2026-11-20
