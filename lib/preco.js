/**
 * Regra única de preço por vaga (feature 003-preco-por-vaga).
 *
 * Módulo PURO: não importa lib/mongodb.js nem nada de servidor, porque é usado
 * também no cliente (prévia dos formulários). Toda a aritmética é em centavos
 * inteiros; ver sdd/specs/003-preco-por-vaga/logic/preco.md.
 *
 * valorPorVaga = round((T / C) × 1,05)   — pago pelo membro
 * repasse      = round(T / C)            — repasse ao dono por membro (= parte do dono)
 * taxa         = valorPorVaga − repasse  — taxa Cotea; absorve o resíduo do arredondamento
 * (arredondamento ao centavo, meio-para-cima, sobre o valor exato)
 */

export const TAXA_COTEA_PERCENTUAL = 5;
export const CAPACIDADE_MINIMA = 2;
export const VAGAS_DONO = 1;

export const MOTIVOS_PRECO_INVALIDO = {
  CAPACIDADE_MINIMA: 'capacidade_minima',
  VALOR_TOTAL_INVALIDO: 'valor_total_invalido',
  REPASSE_MINIMO: 'repasse_minimo',
};

const MENSAGENS = {
  [MOTIVOS_PRECO_INVALIDO.CAPACIDADE_MINIMA]: 'Capacidade minima de 2 (1 vaga do dono + 1 vaga de membro).',
  [MOTIVOS_PRECO_INVALIDO.VALOR_TOTAL_INVALIDO]: 'Informe o valor total (maior que zero, ate 2 casas decimais).',
  [MOTIVOS_PRECO_INVALIDO.REPASSE_MINIMO]:
    'Valor total muito baixo para esta capacidade: cada vaga precisa render ao menos R$ 0,01 ao dono.',
};

const invalido = (motivo) => ({ valido: false, motivo, mensagem: MENSAGENS[motivo] });

const vazio = (valor) => valor === null || valor === undefined || (typeof valor === 'string' && valor.trim() === '');

/** Divide n/d (inteiros, n >= 0, d > 0) arredondando meio-para-cima, sem ponto flutuante. */
const dividirArredondando = (n, d) => Math.floor((2 * n + d) / (2 * d));

/** Reais (número ou string com vírgula/ponto) → centavos inteiros > 0, ou NaN. */
function paraCentavos(valor) {
  if (vazio(valor)) return NaN;
  const numero = Number(String(valor).replace(',', '.').trim());
  if (!Number.isFinite(numero) || numero <= 0) return NaN;
  const centavos = Math.round(numero * 100);
  if (Math.abs(numero * 100 - centavos) > 1e-6) return NaN; // mais de 2 casas decimais
  return centavos;
}

const paraReais = (centavos) => centavos / 100;
const centavosDe = (reais) => Math.round(Number(reais) * 100);

/**
 * Calcula o preço de uma vaga a partir do valor total T e da capacidade C.
 *
 * @param {{ valorTotal: number|string, capacidade: number|string }} entrada
 *   valorTotal em reais (número ou string, vírgula decimal aceita, até 2 casas);
 *   capacidade inteira, incluindo a vaga do dono.
 * @returns {{ valido: true, valorTotal: number, capacidade: number,
 *             valorPorVaga: number, repasse: number, taxa: number, parteDono: number }
 *         | { valido: false, motivo: string, mensagem: string }}
 */
export function calcularPrecoVaga(entrada) {
  const { valorTotal, capacidade } = entrada || {};

  const c = vazio(capacidade) ? NaN : Number(capacidade);
  if (!Number.isInteger(c) || c < CAPACIDADE_MINIMA) return invalido(MOTIVOS_PRECO_INVALIDO.CAPACIDADE_MINIMA);

  const t = paraCentavos(valorTotal);
  if (!Number.isFinite(t)) return invalido(MOTIVOS_PRECO_INVALIDO.VALOR_TOTAL_INVALIDO);

  const repasse = dividirArredondando(t, c);
  if (repasse < 1) return invalido(MOTIVOS_PRECO_INVALIDO.REPASSE_MINIMO);

  const valorPorVaga = dividirArredondando(t * (100 + TAXA_COTEA_PERCENTUAL), 100 * c);
  const taxa = valorPorVaga - repasse;

  return {
    valido: true,
    valorTotal: paraReais(t),
    capacidade: c,
    valorPorVaga: paraReais(valorPorVaga),
    repasse: paraReais(repasse),
    taxa: paraReais(taxa),
    parteDono: paraReais(repasse),
  };
}

/**
 * Preço vigente gravado no grupo, para cobrança e exibição. Sem fallback:
 * só é válido se o grupo tem precoValido === true e o trio gravado é coerente.
 *
 * @param {object} grupo documento de `grupos`
 * @returns {{ valido: true, valorPorVaga: number, repasse: number, taxa: number }
 *         | { valido: false }}
 */
export function precoDoGrupo(grupo) {
  if (!grupo || grupo.precoValido !== true) return { valido: false };
  const valorPorVaga = Number(grupo.valorPorVaga);
  const repasse = Number(grupo.repassePorVaga);
  const taxa = Number(grupo.taxaPorVaga);
  if (![valorPorVaga, repasse, taxa].every(Number.isFinite)) return { valido: false };
  const v = centavosDe(valorPorVaga);
  const r = centavosDe(repasse);
  const x = centavosDe(taxa);
  if (v <= 0 || r < 1 || x < 0 || r + x !== v) return { valido: false };
  return { valido: true, valorPorVaga: paraReais(v), repasse: paraReais(r), taxa: paraReais(x) };
}

/**
 * Regra de redução de capacidade na edição (FR-007).
 *
 * @param {{ capacidade: number, membrosAtivos: number }} entrada
 *   membrosAtivos = membros NÃO-dono com status diferente de 'banido'.
 * @returns {{ valido: boolean, participantes: number, mensagem?: string }}
 */
export function validarNovaCapacidade(entrada) {
  const { capacidade, membrosAtivos } = entrada || {};
  const membros = Math.max(Math.trunc(Number(membrosAtivos) || 0), 0);
  const participantes = membros + VAGAS_DONO;
  if (Number(capacidade) >= participantes) return { valido: true, participantes };
  return {
    valido: false,
    participantes,
    mensagem: `Capacidade nao pode ficar abaixo dos ${participantes} participantes atuais (dono + membros).`,
  };
}

/**
 * Planeja a migração única dos grupos existentes (FR-015). Puro: não grava.
 *
 * @param {object[]} grupos documentos de `grupos`
 * @returns {Array<{ _id: any, acao: 'atualizar'|'inalterado'|'invalido',
 *                   set: object|null, motivo?: string }>}
 */
export function planejarMigracaoPrecos(grupos) {
  return (grupos || []).map((grupo) => {
    const preco = calcularPrecoVaga({ valorTotal: grupo.valorTotal, capacidade: grupo.capacidadeTotal });
    // Inválido: nunca inventa valorPorVaga/T/C; só marca e normaliza as reservadas.
    const alvo = preco.valido
      ? {
          valorPorVaga: preco.valorPorVaga,
          repassePorVaga: preco.repasse,
          taxaPorVaga: preco.taxa,
          precoValido: true,
          vagasReservadasAdmin: VAGAS_DONO,
        }
      : { precoValido: false, vagasReservadasAdmin: VAGAS_DONO };

    const diferente = Object.entries(alvo).some(([campo, valor]) => {
      const atual = grupo[campo];
      if (typeof valor === 'number') return atual == null || Number(atual) !== valor;
      return atual !== valor;
    });

    const acao = !preco.valido ? 'invalido' : diferente ? 'atualizar' : 'inalterado';
    return {
      _id: grupo._id,
      acao,
      set: diferente ? alvo : null,
      ...(preco.valido ? {} : { motivo: preco.motivo }),
    };
  });
}
