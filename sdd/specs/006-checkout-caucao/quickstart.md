# Quickstart: validação da 006-checkout-caucao

Rodar de `J:\Cotea` (maiúsculo).

**Atenção**: o banco configurado (`usaComigo`) é o mesmo de produção. Migração e
roteiro manual só com autorização do usuário; anotar o que foi criado e limpar no
fim (usuários de teste e valores simulados).

## 1. Checagens automáticas

```powershell
npm run test:contrato
.\.planning\scripts\powershell\check-contract-tests.ps1 -Slug 006-checkout-caucao
npm test
npm run lint
npm run build
```

## 2. Migração (antes de publicar o código)

```powershell
node --env-file=.env.local scripts/migrar-checkout-v2.js            # dry-run
node --env-file=.env.local scripts/migrar-checkout-v2.js --aplicar  # após aprovação
node --env-file=.env.local database/setup-indexes.js                # confere que não há conflito
```

Esperado no dry-run de 2026-11-26: trocar o índice
`referenceId_1_type_1_source_1`; estornar 3 faturas de R$ 42,50 (R$ 127,50);
manter 1 vinculada e 1 estornada; 0 canceladas. **Divergiu: parar e mostrar.**
Publicar o código logo depois e rodar a migração outra vez (pega faturas criadas
pelo código antigo na janela).

## 3. Roteiro manual

Dois usuários (dono e membro) com cadastro financeiro completo; um grupo
`imediato` e um `apos_completar` de 3 vagas, aprovados.

1. Grupo → "Assinar": 4 vínculos, nenhum marcado; sem vínculo não avança.
2. Pagamento com saldo menor que o total: confere mensalidade, caução, total,
   "do saldo", "no Pix"; sem R$ 0,68, sem cupom, sem escolha de método.
3. Sem marcar o aceite o botão não conclui.
4. Confirmar: PIX da diferença, entrada, tela de sucesso. Carteira mostra a
   caução como "Em caução" e o disponível correto. Notificações para dono e membro.
5. Voltar ao pagamento pelo histórico do navegador e confirmar: não cobra de novo.
6. Dono vê o vínculo na lista de participantes; janela anônima não vê.
7. Preço alterado (API) com a tela de pagamento aberta → resumo atualizado, nada
   cobrado.
8. "Cancelar participação": mostra o que volta; confirmar devolve a caução uma vez.
9. `apos_completar`: entrar (mensalidade "Retida na entrada"), sair (volta tudo);
   entrar de novo, completar com o segundo membro (retenções somem, notificação de
   grupo formado); sair (só a caução).
10. Admin cancela um grupo com membro: caução volta e o membro é notificado.
11. Dono exclui um grupo com membro: caução volta.
12. `/admin` → Rotinas → `liquidacao-participacoes` executa sem falhas.
13. Viewport de celular no pagamento: resumo e regras legíveis, botão acessível.

## Resultado em 2026-11-26

- §2: migração aplicada (índice não único; 3 faturas estornadas, R$ 127,50;
  reexecução sem alterações). `setup-indexes.js` não foi rodado; as definições
  dos índices foram conferidas por leitura. **Falta repetir a migração após o
  deploy.**
- §3: passos 1–12 conferidos no navegador (servidor local, banco de produção),
  com um segundo usuário de teste criado por script. Passo 13 (390 px): resumo,
  regras e botão legíveis; há rolagem horizontal causada pelo `FlowStepper`
  (componente anterior à feature).
- Concorrência com transações reais do MongoDB: última vaga (200 e
  `grupo_cheio`), triplo clique (uma cobrança), duas saídas (um crédito) e
  saída × lotação (um só resultado).
- §4: `join` POST e `refund` → 410; consistência do ledger com 0 achados.
- Limpeza: dados de teste apagados; contagens e saldos iguais aos de antes (só os
  registros do agendador de produção são novos).
- Achados anteriores à feature: a CSP bloqueia ícones do Font Awesome, avatares
  do pravatar e o GIF da tela de sucesso.

## 4. Cross-cutting

- `POST /api/grupos/[id]/join` e `POST /api/assinaturas/refund` → 410.
- Rotina de consistência do ledger sem achados novos.
- Nenhum CPF ou segredo em log; documentos atualizados (regras, CLAUDE.md,
  README, schemas).
