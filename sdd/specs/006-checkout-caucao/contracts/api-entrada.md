# Contrato de API: entrada em grupo e saída

Mensagens `error` em português, no padrão dos handlers atuais.

## `GET /api/assinaturas/resumo?grupoId=<24hex>` (nova)

Somente leitura: não cria fatura nem lançamento (pode criar a carteira vazia via
`ensureWallet`). Não passa pelo gate de cadastro financeiro.

Ordem: método (405) → sessão (401) → `contaValidada` (403) → `grupoId` (400) →
grupo (404 `Grupo nao encontrado`) → elegibilidade (`avaliarEntradaNoGrupo`) →
preço (409 `preco_indisponivel`).

200:

```json
{
  "grupo": { "_id": "…", "nome": "…" },
  "resumo": {
    "mensalidade": 10.5, "caucao": 10.5, "taxa": 0, "total": 21,
    "saldoDisponivel": 5, "valorSaldo": 5, "valorPix": 16,
    "aposCompletar": false, "retemMensalidade": false, "fidelidadeMeses": 3,
    "versaoResumo": "…",
    "regras": { "versao": "2026-11-26", "itens": ["…"] }
  }
}
```

Recusas de elegibilidade: mesmos status e `codigo` do `pay`, sem dados do grupo.

## `POST /api/assinaturas/pay` (reescrita: é a entrada atômica)

Corpo:

```json
{
  "grupoId": "…", "chave": "uuid gerado pela tela",
  "vinculo": "amigo", "aceiteRegras": { "versao": "2026-11-26" },
  "versaoResumo": "…", "saldoVisto": 21
}
```

Qualquer valor enviado (`amount`, `valor`, `invoiceId`…) é **ignorado**.

Ordem obrigatória (os contratos travados 004 e 005 dependem dela):

| # | Checagem | Resposta |
| --- | --- | --- |
| 1 | método | 405 |
| 2 | sessão | 401 |
| 3 | `contaValidada` | 403 |
| 4 | `verificarCadastroFinanceiro` | 409 `cadastro_financeiro_incompleto` |
| 5 | `grupoId` válido | 400 |
| 6 | `chave` já usada por este usuário (só se `chave` válida) | 200 `repetida: true`, ou 409 `confirmacao_ja_utilizada` |
| 7 | grupo existe | 404 |
| 8 | elegibilidade | `grupo_indisponivel` 409, `grupo_cheio` 409, `dono_do_grupo` 409, `ja_membro` 409, `membro_banido` 403 |
| 9 | preço do grupo | 409 `preco_indisponivel` |
| 10 | corpo | 400 `chave_invalida`, `vinculo_invalido`, `aceite_obrigatorio` |
| 11 | `versaoResumo` igual à calculada agora | 409 `resumo_desatualizado` + `resumo` |
| 12 | `saldoVisto` igual ao disponível agora | 409 `resumo_desatualizado` + `resumo` |
| 13 | disponível ≥ total | 402 `saldo_insuficiente` + `resumo` |
| 14 | transação (logic §5) | 200, ou as recusas acima se algo mudou no meio |

- Toda recusa a partir do passo 7 **reconsulta a `chave`** antes de responder: se
  uma requisição gêmea acabou de concluir, responde o passo 6.
- `resumo` nas recusas tem o mesmo formato do GET.
- Nenhuma recusa cria fatura, lançamento ou participação.

200:

```json
{
  "status": "paga", "repetida": false, "grupoId": "…",
  "invoiceId": "…", "participacaoId": "…", "total": 21, "saldoAposDebito": 0
}
```

## `DELETE /api/grupos/[id]/join` (saída do membro ou remoção pelo staff)

Autorização inalterada (o próprio membro, `admin` ou `support`; membro
`papel: admin` não sai por aqui). Corpo `{ "userId": "…" }`.

200:

```json
{ "message": "Participacao cancelada", "devolvido": { "caucao": 10.5, "mensalidade": 0, "total": 10.5 } }
```

Saída e devolução valem juntas: se a liquidação falhar, responde 500 e o membro
continua no grupo. A notificação ao dono continua.

## `GET /api/grupos/[id]/join?userId=` — inalterada.

## Rotas desativadas (410 `{ error, codigo: 'rota_desativada' }`)

- `POST /api/grupos/[id]/join` — a entrada é feita só pelo `pay` (FR-002).
- `POST /api/assinaturas/refund` — não existe mais "pago sem participação"
  (FR-015). Qualquer método, sem consultar sessão, como `participar.js`.

## Rotas existentes com efeito novo

| Rota | Efeito |
| --- | --- |
| `POST /api/admin/grupos/[id]/moderacao` e `POST /api/grupos/[id]/moderacao` | se o grupo vira `cancelado` ou `rejeitado`, liquida todas as participações com caução antes de responder (falha só é logada; a rotina completa). Resposta inalterada. |
| `DELETE /api/grupos/[id]` | liquida e remove as participações com caução (logic §7) |
| `PUT /api/grupos/[id]` | condicional a `versaoParticipacao`; redução de capacidade que lota grupo `apos_completar` libera as retenções. Conflito: 409 já existente |
| `POST /api/grupos/[id]/acessos` | libera a mensalidade retida de quem recebeu o acesso |

## Telas

- `pages/assinatura/relacionamento.js`: quatro vínculos de `VINCULOS`, nenhum
  pré-selecionado; "Continuar" exige vínculo e o termo atual; envia `vinculo` na
  query para o pagamento.
- `pages/assinatura/pagamento.js` (fluxo):
  1. sem `vinculo` válido na query → volta ao relacionamento;
  2. carrega o resumo; recusa de elegibilidade mostra a mensagem e o link do grupo;
  3. mostra mensalidade, caução, taxa (só se > 0), total, "do saldo", "no Pix",
     regra do vencimento (FR-007), prazo de acesso (FR-008), fidelidade, aviso de
     grupo "após completar" (retenção) e as regras com caixa de aceite;
  4. um botão. Sem escolha de método, sem cupom, sem R$ 0,68;
  5. `POST pay`; em `saldo_insuficiente` → cria e confirma o PIX de
     `resumo.valorPix` → `POST pay` de novo com a **mesma `chave`** e
     `saldoVisto` = `available` devolvido pela confirmação;
  6. `resumo_desatualizado` → mostra o resumo novo e pede nova confirmação;
  7. qualquer erro depois do PIX confirmado informa que o valor está no saldo;
  8. `confirmacao_ja_utilizada` → gera outra `chave`; cadastro incompleto →
     `CadastroFinanceiroForm` embutido e repete ao salvar.
- `pages/assinatura/sucesso.js`: não chama o `join`; só confirma e explica o
  próximo passo (aguardando acesso).
- `pages/grupos/[id]/cancelar.js`: a SSR acrescenta a prop
  `devolucao: { caucao, mensalidade, total, temEntrada }` (de
  `planejarLiquidacao`) **sem alterar a prop `grupo`** (teste da 005); a tela
  mostra o que volta e que a mensalidade paga não é devolvida quando for o caso.
- `pages/grupos/[id].js`: `vinculo` entra no `$project` e só nos participantes da
  visão completa (dono e staff); a lista mostra o rótulo (FR-011).
