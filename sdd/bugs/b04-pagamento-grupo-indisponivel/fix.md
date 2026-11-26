# Bug Fix: Pagamento de grupo indisponivel sem compensacao no servidor (B-04)

- **Slug**: b04-pagamento-grupo-indisponivel
- **Corrigido**: 2026-11-24
- **Assessment**: ./assessment.md
- **Status**: applied

## Summary

`pay` agora valida status do grupo, capacidade, dono, ja-membro e banido antes de criar fatura/debitar (fatura ja `paga` segue devolvendo 200). `join` valida status e capacidade depois de reconhecer quem ja e membro e, se a fatura paga nao puder virar vaga, estorna no servidor pelo ledger (mesmo `operacaoId` do `refund`); tambem desfaz a entrada se a fatura for estornada concorrentemente durante o insert (corrida join x refund apontada pelo B-02).

## Changes

| Arquivo | Mudanca | Notas |
| --- | --- | --- |
| `lib/grupo-entrada.js` | added | Funcoes puras `avaliarEntradaNoGrupo`, `motivoGrupoIndisponivel`, `motivoGrupoCheio`; codigos `grupo_indisponivel`, `grupo_cheio`, `dono_do_grupo`, `ja_membro`, `membro_banido`. |
| `pages/api/assinaturas/pay.js` | modified | Projecao ganha `status`, `capacidadeTotal`, `adminId`; checagem antes de `ensureWallet`/`createInvoice`/debito, pulada para fatura `paga`. |
| `pages/api/grupos/[id]/join.js` | modified | Substitui o "Grupo completo" 400 por 409 (`grupo_indisponivel`/`grupo_cheio`) com `estornada: true/false`; helper `estornarFaturaSemVaga` via `obterLedger().registrarOperacao` (credito pessoal `estorno_assinatura:<invoiceId>` + `markInvoiceRefunded` na mesma transacao); recheca fatura apos o insert e remove o membro se nao estiver mais `paga` (409 `fatura_estornada`). Gravacao de `membroId`/`vinculadoEm` na fatura mantida inalterada. |
| `tests/bugs/b04-pagamento-grupo-indisponivel.test.js` | added | 17 casos (ver abaixo). |

## Tests Added or Updated

- `tests/bugs/b04-pagamento-grupo-indisponivel.test.js` — `pay`: inativo/cancelado, cheio, banido nao ocupa vaga, dono (adminId e papel admin), ja membro, membro banido, fatura aberta em grupo cancelado, fatura ja paga continua 200, grupo ativo/legado sem `status` cobra. `join`: cancelado e cheio estornam no servidor (credito no ledger, fatura `estornada`, sem membro), repeticao nao duplica estorno, fatura ja vinculada nao e estornada, quem ja e membro reconcilia 200, caminho feliz vincula fatura, corrida join x refund desfaz a entrada.

## Local Verification

- `npx vitest run tests/bugs/b04-pagamento-grupo-indisponivel.test.js tests/preco` (de `J:\Cotea`) -> 6 arquivos, 41 testes passando.
- `npx vitest run` (suite completa) -> 32 arquivos, 206 testes passando.
- `npx eslint` nos 3 arquivos de codigo -> sem saida (sem erros).
- Nada exigindo rede/banco real foi executado.

## Deviations from Assessment

- Adicionada a rechecagem da fatura apos o insert em `join` (corrida join x refund), pedida pelo coordenador apos o aviso do B-02; nao estava no assessment.
- `refund.js`, `lib/estorno.js` e `lib/invoices.js` nao foram tocados. O estorno do `join` replica a operacao do `refund.js` (mesmo `operacaoId`) em vez de reutiliza-la, para nao editar arquivo de outro agente; o `join` nao passa pela regra `avaliarEstorno` do B-02, mas so estorna fatura sem `membroId`/`vinculadoEm` e de usuario que nao e membro (nesse ponto ele ja foi checado).
- UI (`pages/assinatura/*`) nao alterada: o fluxo atual ja mostra `data.error` e chama `refund`, que devolve "ja estornada".

## Follow-ups

- Janela residual: o check-then-insert do `join` e a rechecagem nao sao transacionais; ultima vaga disputada por dois pagamentos simultaneos so fica exata com a transacao unica pagar+entrar (feature V2-06). O perdedor, porem, e estornado.
- Decisoes de produto assumidas (rever se discordar): somente `status: 'ativo'` (ou ausente) aceita entrada; membro banido recebe 403 antes de cobrar; dono recebe 409.
- Resposta do `join` para grupo cheio mudou de 400 "Grupo completo" para 409 "Grupo sem vagas disponiveis" (nada no repo dependia do texto antigo).
- Fora de escopo notado: `pay` com `invoiceId` de fatura `estornada` nao e barrado (reprocessa pelo `operacaoId` idempotente); `join` permite reuso de fatura paga ja vinculada por quem saiu do grupo (so nao estorna). Candidatos a bugs proprios.
