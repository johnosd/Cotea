/**
 * Regras puras do checkout v2 (feature 006-checkout-caucao).
 * Módulo PURO: não importa lib/mongodb.js nem nada de servidor (é usado também no cliente
 * e pelo script de migração em Node ESM — mantenha a extensão nos imports).
 * Algoritmos em sdd/specs/006-checkout-caucao/logic/checkout.md.
 *
 * Toda a aritmética é em centavos inteiros.
 */
import { precoDoGrupo } from './preco.js';
import { ocupacaoDoGrupo } from './grupo-entrada.js';

export const VINCULOS = Object.freeze([
  Object.freeze({ id: 'amigo', rotulo: 'Amigo' }),
  Object.freeze({ id: 'familia', rotulo: 'Família' }),
  Object.freeze({ id: 'conhecido', rotulo: 'Conhecido' }),
  Object.freeze({ id: 'desconhecido', rotulo: 'Desconhecido' }),
]);

/** Texto aceito antes de pagar (FR-009). Mudou o texto → mude a versão. */
export const REGRAS_CAUCAO = Object.freeze({
  versao: '2026-11-26',
  itens: Object.freeze([
    'A caução equivale a 1 mensalidade (já com a taxa do Cotea). Ela é sua e fica bloqueada como garantia enquanto você participa do grupo.',
    'Na saída regular, a caução volta integralmente para o seu saldo.',
    'Se você sair antes de cumprir a fidelidade do grupo, a caução fica com o dono como multa e você continua pagando as mensalidades até a saída.',
    'Se o pedido de saída for feito a menos de 15 dias do vencimento, a caução pode pagar a mensalidade do último ciclo.',
    'Se uma mensalidade ficar 3 dias em atraso, a caução quita a fatura e a sua saída é agendada para o fim do período pago.',
  ]),
});

/** Taxa do meio de pagamento, em reais: zero enquanto o PIX for simulado (FR-005). */
export const TAXA_MEIO_PAGAMENTO = 0;

/** Formato da chave de idempotência gerada pela tela. */
const FORMATO_CHAVE = /^[A-Za-z0-9_-]{8,80}$/;

const centavos = (valor) => Math.round(Number(valor) * 100);
const reais = (c) => c / 100;

/** Rótulo de um vínculo declarado, ou '' se desconhecido pelo catálogo. */
export function rotuloVinculo(id) {
  return VINCULOS.find((v) => v.id === id)?.rotulo || '';
}

/**
 * Grupo `apos_completar` que já lotou alguma vez (logic §2). `statusDetalhado: 'ativo'`
 * é o formato legado de "lotou".
 */
export function grupoJaLotou(grupo) {
  if (!grupo) return false;
  return Boolean(grupo.lotadoEm)
    || (grupo.acesso === 'apos_completar' && grupo.statusDetalhado === 'ativo');
}

/**
 * Valores e condições da entrada, só com dados do servidor (logic §3).
 * @param {{ grupo: object, membros?: object[] }} entrada membros = membros atuais do grupo
 * @returns {{ valido: false } | {
 *   valido: true, mensalidade: number, caucao: number, taxa: number, total: number,
 *   repasse: number, taxaCotea: number, aposCompletar: boolean, retemMensalidade: boolean,
 *   completaGrupo: boolean, fidelidadeMeses: number, versaoResumo: string }}
 */
export function calcularResumoEntrada({ grupo, membros = [] } = {}) {
  const preco = precoDoGrupo(grupo);
  if (!preco.valido) return { valido: false };

  const mensalidade = centavos(preco.valorPorVaga);
  const taxa = centavos(TAXA_MEIO_PAGAMENTO);
  const aposCompletar = grupo.acesso === 'apos_completar';
  const aguardandoLotar = aposCompletar && !grupoJaLotou(grupo);
  const capacidade = Number(grupo.capacidadeTotal);
  // Quem completa o grupo não fica retido.
  const completaGrupo = aguardandoLotar && capacidade > 0 && ocupacaoDoGrupo(membros) + 1 >= capacidade;
  const retemMensalidade = aguardandoLotar && !completaGrupo;
  const meses = Number(grupo.fidelidade?.periodoMeses);
  const fidelidadeMeses = Number.isFinite(meses) && meses > 0 ? Math.trunc(meses) : 0;

  return {
    valido: true,
    mensalidade: reais(mensalidade),
    caucao: reais(mensalidade),
    taxa: reais(taxa),
    total: reais(2 * mensalidade + taxa),
    repasse: preco.repasse,
    taxaCotea: preco.taxa,
    aposCompletar,
    retemMensalidade,
    completaGrupo,
    fidelidadeMeses,
    // Tudo o que a tela mostrou como condição: mudou algo aqui, o resumo envelheceu.
    versaoResumo: [
      `m${mensalidade}`, `t${taxa}`, `r${retemMensalidade ? 1 : 0}`, `a${aposCompletar ? 1 : 0}`,
      `f${fidelidadeMeses}`, `v${REGRAS_CAUCAO.versao}`,
    ].join('|'),
  };
}

/** Saldo primeiro, PIX pela diferença (FR-013). */
export function dividirPagamento({ total, disponivel } = {}) {
  const totalC = centavos(total);
  const saldo = Math.min(totalC, Math.max(centavos(disponivel) || 0, 0));
  return { valorSaldo: reais(saldo), valorPix: reais(totalC - saldo) };
}

/**
 * Resumo devolvido à tela (contracts/api-entrada.md): o cálculo + o saldo + as regras.
 * Repasse e taxa do Cotea ficam só no servidor.
 */
export function montarResumoParaTela(resumo, saldoDisponivel) {
  const {
    mensalidade, caucao, taxa, total, aposCompletar, retemMensalidade, fidelidadeMeses, versaoResumo,
  } = resumo;
  return {
    mensalidade, caucao, taxa, total,
    saldoDisponivel,
    ...dividirPagamento({ total, disponivel: saldoDisponivel }),
    aposCompletar, retemMensalidade, fidelidadeMeses, versaoResumo,
    regras: { versao: REGRAS_CAUCAO.versao, itens: [...REGRAS_CAUCAO.itens] },
  };
}

export function chaveValida(chave) {
  return typeof chave === 'string' && FORMATO_CHAVE.test(chave);
}

/**
 * Valida `chave`, `vinculo` e `aceiteRegras` do corpo (logic §4).
 * @returns {null | { codigo: string, error: string }} primeiro problema, ou null
 */
export function validarDadosEntrada({ chave, vinculo, aceiteRegras } = {}) {
  if (!chaveValida(chave)) {
    return { codigo: 'chave_invalida', error: 'Confirmacao invalida. Recarregue a pagina de pagamento.' };
  }
  if (!VINCULOS.some((v) => v.id === vinculo)) {
    return { codigo: 'vinculo_invalido', error: 'Informe qual e o seu vinculo com o dono do grupo.' };
  }
  if (aceiteRegras?.versao !== REGRAS_CAUCAO.versao) {
    return { codigo: 'aceite_obrigatorio', error: 'Aceite as regras da caucao para continuar.' };
  }
  return null;
}

const montarPerna = ({ walletId, grupoId, participacaoId }) => (type, categoria, valorEmCentavos) => ({
  walletId,
  type,
  categoria,
  valor: reais(valorEmCentavos),
  organizacaoId: null,
  grupoId: String(grupoId),
  participacaoId: String(participacaoId),
});

/** Pernas do ledger da entrada (logic §5): um débito do total, caução e retenção creditadas. */
export function pernasDaEntrada({ walletId, grupoId, participacaoId, resumo }) {
  const perna = montarPerna({ walletId, grupoId, participacaoId });
  const pernas = [
    perna('debit', 'pessoal', centavos(resumo.total)),
    perna('credit', 'caucao', centavos(resumo.caucao)),
  ];
  if (resumo.retemMensalidade) {
    pernas.push(perna('credit', 'retido_entrada', centavos(resumo.mensalidade) + centavos(resumo.taxa)));
  }
  return pernas;
}

/**
 * O que acontece com caução e mensalidade retida quando a participação acaba (logic §6).
 * @param {{ membro: object, grupo: object|null }} entrada grupo null = grupo excluído
 * @returns {{ caucao: number, retido: number, liberada: boolean, mensalidade: number,
 *             total: number, temMovimento: boolean }}
 *   `retido` = valor ainda em retido_entrada (devolvido ou consumido); `mensalidade` = o
 *   que volta dele; `total` = o que volta para o saldo.
 */
export function planejarLiquidacao({ membro, grupo = null } = {}) {
  const caucao = membro?.caucao?.situacao === 'bloqueada' ? centavos(membro.caucao.valor) : 0;
  const retencao = membro?.retencao;
  const pendente = retencao && (retencao.situacao === 'retida' || retencao.situacao === 'a_liberar');
  const retido = pendente ? centavos(retencao.valor) : 0;
  // Já tem dono quem recebeu o acesso ou viu o grupo lotar, mesmo antes do lançamento.
  const liberada = retido > 0 && (
    retencao.situacao === 'a_liberar'
    || membro.aguardandoEnvioAcesso === false
    || grupoJaLotou(grupo)
  );
  const mensalidade = liberada ? 0 : retido;
  return {
    caucao: reais(caucao),
    retido: reais(retido),
    liberada,
    mensalidade: reais(mensalidade),
    total: reais(caucao + mensalidade),
    temMovimento: caucao + retido > 0,
  };
}

/** Pernas do ledger de um plano de liquidação: um só crédito em `pessoal` (logic §6). */
export function pernasDaLiquidacao({ walletId, grupoId, participacaoId, plano }) {
  const perna = montarPerna({ walletId, grupoId, participacaoId });
  const pernas = [];
  if (plano.caucao > 0) pernas.push(perna('debit', 'caucao', centavos(plano.caucao)));
  if (plano.retido > 0) pernas.push(perna('debit', 'retido_entrada', centavos(plano.retido)));
  if (plano.total > 0) pernas.push(perna('credit', 'pessoal', centavos(plano.total)));
  return pernas;
}

const FATURAS_ABERTAS = ['aguardando_pagamento', 'aguardando_recarga'];

/**
 * Plano da migração das faturas do checkout antigo (logic §10, FR-030). Puro: não grava.
 * @param {{ faturas?: object[], membros?: object[] }} entrada
 * @returns {Array<{ invoiceId: string, acao: 'manter'|'cancelar'|'estornar', motivo: string }>}
 */
export function planejarMigracaoCheckout({ faturas = [], membros = [] } = {}) {
  const temParticipacao = (fatura) => membros.some((m) =>
    String(m.invoiceId || '') === String(fatura._id)
    || (String(m.userId) === String(fatura.userId) && String(m.grupoId) === String(fatura.grupoId)));

  return faturas.map((fatura) => {
    const plano = (acao, motivo) => ({ invoiceId: String(fatura._id), acao, motivo });
    if (fatura.entrada) return plano('manter', 'checkout_v2');
    if (FATURAS_ABERTAS.includes(fatura.status)) return plano('cancelar', 'fatura_aberta');
    if (fatura.status !== 'paga') return plano('manter', 'sem_acao');
    if (fatura.vinculadoEm || fatura.membroId) return plano('manter', 'vinculada_a_participacao');
    if (temParticipacao(fatura)) return plano('manter', 'tem_participacao');
    return plano('estornar', 'paga_sem_participacao');
  });
}
