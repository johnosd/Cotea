# Quickstart: 005-aprovacao-grupos

## Pré-requisitos

- Rodar a partir de `J:\Cotea` (letra maiúscula; de `j:\` o Vitest carrega duas vezes).
- `.env.local` com `MONGODB_URI`, `MONGODB_DB`, `GOOGLE_*`, `JWT_SECRET`,
  `CRON_SECRET` ou `ROTINAS_SECRET` (só nomes; nunca exibir valores).
- Três contas para o teste manual: um admin do sistema, um usuário de suporte
  e um usuário comum com cadastro financeiro completo (dono). Uma quarta conta
  comum como "terceiro"/membro.

## Checagens automatizadas

```powershell
npm run test:contrato                                   # inclui 005 (5/5) e as travas 001-004
npx vitest run tests/contract/005-aprovacao-grupos.contract.test.js
.\.planning\scripts\powershell\check-contract-tests.ps1 -Slug 005-aprovacao-grupos
npm test
npm run lint
npm run build
```

## Migração (antes e depois do deploy)

```powershell
node --env-file=.env.local scripts/migrar-moderacao-grupos.js            # dry-run: relatório
node --env-file=.env.local scripts/migrar-moderacao-grupos.js --aplicar  # grava
node --env-file=.env.local scripts/migrar-moderacao-grupos.js            # de novo: 0 alterações
node --env-file=.env.local database/setupDatabase.js                     # índice novo (ou o script de índices em uso)
```

Esperado hoje: 5 grupos `ativo` → aprovados (`aprovacao.tipo: 'legado'`), 0 não
classificados. Ordem: migrar → deploy → migrar de novo (pega grupos criados
pelo código antigo na janela).

## Cenário ponta a ponta

1. **Criação** (dono): criar grupo em "Criar Grupo". Mensagem "enviado para
   aprovação". O grupo **não** aparece na home; abrir `/grupos/<id>` em aba
   anônima → página não encontrada. Como dono → banner "Em aprovação" e prazo.
   Tentar editar → bloqueado com mensagem.
2. **Fila** (suporte): `/admin?tab=moderacao` mostra o grupo, sem botões de
   decisão. (admin): mesma fila com contador, prazo restante e botões.
3. **Ajuste**: admin pede ajuste com texto. Dono vê o texto no grupo e em Meus
   Grupos, e uma notificação. Dono edita e reenvia → volta para a fila com
   novo prazo.
4. **Aprovar**: admin aprova → grupo na home; outro usuário consegue pagar e
   entrar (fluxo atual). Dono notificado.
5. **Rejeitar**: com outro grupo, rejeitar com motivo → dono vê o motivo; não
   consegue editar nem reenviar.
6. **Aprovação automática**: em banco de desenvolvimento, ajustar
   `moderacao.enviadoEm` de um grupo pendente para 3 dias úteis atrás e
   executar a rotina `aprovacao-automatica-grupos` pelo painel
   `/admin?tab=rotinas`. Grupo aprovado, aba "Revisão posterior" lista o grupo,
   auditoria `grupo.moderacao.aprovar_automatico` com ator `sistema`. Executar
   de novo → nada muda (item concluído/ignorado).
7. **Revisão**: confirmar a revisão de um grupo → sai da aba. Em outro,
   reprovar com motivo → grupo cancelado.
8. **Cancelamento pelo Cotea**: cancelar um grupo aprovado com membro → some da
   home; membro ainda abre o grupo e vê "cancelado"; dono e membro notificados;
   nada apagado em `grupos`/`membrosGrupo`; `pay` recusa.
9. **Desistência**: dono desiste de um pedido em aprovação → cancelado, sai da fila.

## Itens cross-cutting (constitution)

- Rota de rotinas protegida por segredo (já da 001); nenhuma rota nova sem sessão.
- `npm run build` sem erro de rota (novos arquivos em `pages/api/admin/grupos/[id]/`
  e `pages/api/grupos/[id]/`).
- Schema `database/schemas/grupos.schema.json` atualizado; índice novo em
  `database/setupDatabase.js`.
- Nenhuma variável de ambiente nova.
