// Moderação de grupos públicos (005-aprovacao-grupos). Módulo PURO: sem
// mongodb, next-auth nem I/O. Tabela de transições, validação de texto,
// visibilidade, prazo da aprovação automática e planejamento da migração.
// Ver sdd/specs/005-aprovacao-grupos/logic/moderacao.md e data-model.md.
// Extensão explícita: o script de migração (Node ESM) importa este módulo diretamente.
import { vencimentoDiasUteis } from './calendario.js';

/** Valores de `grupos.status` (D-01). `ativo` = aprovado e público. */
export const STATUS_GRUPO = Object.freeze({
  EM_APROVACAO: 'em_aprovacao',
  AJUSTES: 'ajustes',
  REJEITADO: 'rejeitado',
  ATIVO: 'ativo',
  CANCELADO: 'cancelado',
});

/** Rótulos para telas (dono, admin, Meus Grupos). */
export const ROTULOS_STATUS_GRUPO = Object.freeze({
  em_aprovacao: 'Em aprovação',
  ajustes: 'Ajustes solicitados',
  rejeitado: 'Rejeitado',
  ativo: 'Aprovado',
  cancelado: 'Cancelado',
});

/** Estados finais: nada reabre (FR-013, FR-025). */
export const STATUS_FINAIS = Object.freeze([STATUS_GRUPO.REJEITADO, STATUS_GRUPO.CANCELADO]);

/** Ações de moderação (D-03). `aprovar_automatico` só pela rotina. */
export const ACOES_MODERACAO = Object.freeze({
  APROVAR: 'aprovar',
  PEDIR_AJUSTE: 'pedir_ajuste',
  REJEITAR: 'rejeitar',
  APROVAR_AUTOMATICO: 'aprovar_automatico',
  CONFIRMAR_REVISAO: 'confirmar_revisao',
  REPROVAR_REVISAO: 'reprovar_revisao',
  CANCELAR: 'cancelar',
  REENVIAR: 'reenviar',
  DESISTIR: 'desistir',
  // Dono encerra grupo aprovado (ativo → cancelado), como o botão atual da tela de edição;
  // reembolsos ficam para a V2-14 (decisão do usuário no execute, R-008).
  ENCERRAR: 'encerrar',
});

/** Ações do admin do sistema (rota /api/admin/grupos/[id]/moderacao). */
export const ACOES_ADMIN = Object.freeze([
  ACOES_MODERACAO.APROVAR, ACOES_MODERACAO.PEDIR_AJUSTE, ACOES_MODERACAO.REJEITAR,
  ACOES_MODERACAO.CONFIRMAR_REVISAO, ACOES_MODERACAO.REPROVAR_REVISAO, ACOES_MODERACAO.CANCELAR,
]);

/** Ações do dono (rota /api/grupos/[id]/moderacao). */
export const ACOES_DONO = Object.freeze([ACOES_MODERACAO.REENVIAR, ACOES_MODERACAO.DESISTIR, ACOES_MODERACAO.ENCERRAR]);

/** Ações que exigem texto (FR-012, FR-013, FR-018, FR-023). */
export const ACOES_COM_TEXTO = Object.freeze([
  ACOES_MODERACAO.PEDIR_AJUSTE, ACOES_MODERACAO.REJEITAR,
  ACOES_MODERACAO.REPROVAR_REVISAO, ACOES_MODERACAO.CANCELAR,
]);

/** `$match` dos grupos públicos (status efetivo `ativo`, D-02/D-06): GET /api/grupos e SSR da home. */
export const FILTRO_GRUPOS_PUBLICOS = Object.freeze({
  $or: [{ status: STATUS_GRUPO.ATIVO }, { status: { $exists: false } }],
});

/** Ações com texto opcional (motivo do encerramento pelo dono). */
export const ACOES_TEXTO_OPCIONAL = Object.freeze([ACOES_MODERACAO.ENCERRAR]);

export const PRAZO_APROVACAO_DIAS_UTEIS = 2;
export const TEXTO_MODERACAO_MAX = 1000;
export const HISTORICO_MODERACAO_MAX = 100;

/** Códigos de erro devolvidos em `{ error, codigo }` (contracts/api-moderacao.md). */
export const CODIGOS_MODERACAO = Object.freeze({
  ACAO_INVALIDA: 'acao_invalida',
  TEXTO_OBRIGATORIO: 'texto_obrigatorio',
  TEXTO_LONGO: 'texto_longo',
  CONFLITO: 'moderacao_conflito',
  EDICAO_BLOQUEADA: 'edicao_bloqueada_moderacao',
});

const TODAS_ACOES = Object.values(ACOES_MODERACAO);
const { EM_APROVACAO, AJUSTES, REJEITADO, ATIVO, CANCELADO } = STATUS_GRUPO;

/** `status` ausente conta como `ativo` (legado; mesmo critério de lib/grupo-entrada.js, D-02). */
export function statusEfetivo(grupo) {
  return grupo?.status ?? ATIVO;
}

/** true só para grupo aprovado e não cancelado (status efetivo `ativo`). */
export function grupoEhPublico(grupo) {
  return statusEfetivo(grupo) === ATIVO;
}

/**
 * Quem vê um grupo (FR-006): público → todos; não público → staff (GROUPS_TAB),
 * dono ou membro atual não banido.
 * @param {{ grupo: object, ehStaff?: boolean, ehDono?: boolean, ehMembroAtual?: boolean }} p
 */
export function podeVerGrupo({ grupo, ehStaff = false, ehDono = false, ehMembroAtual = false } = {}) {
  if (!grupo) return false;
  return grupoEhPublico(grupo) || Boolean(ehStaff) || Boolean(ehDono) || Boolean(ehMembroAtual);
}

/** Status em que o dono (não admin do sistema) pode editar pelo PUT (FR-019). */
export function donoPodeEditar(grupo) {
  return [AJUSTES, ATIVO].includes(statusEfetivo(grupo));
}

/** Status em que o admin do sistema pode editar pelo PUT (D-07): qualquer um não final. */
export function adminPodeEditar(grupo) {
  return !STATUS_FINAIS.includes(statusEfetivo(grupo));
}

/** Texto de ajuste/motivo: trim; '' quando ausente. */
export function normalizarTexto(texto) {
  return String(texto ?? '').trim();
}

const idTexto = (id) => (id == null ? null : String(id));

const eventoHistorico = ({ acao, de, para, texto = null, porId = null, automatico = false, envio, em }) => ({
  acao, de: de ?? null, para, texto: texto || null, porId: idTexto(porId), automatico: Boolean(automatico), envio, em,
});

/** Subdocumento `moderacao` de um grupo recém-criado (envio 1). */
export function moderacaoInicial({ agora, ator } = {}) {
  const em = agora instanceof Date ? agora : new Date();
  return {
    envio: 1,
    enviadoEm: em,
    revisaoPendente: false,
    aprovacao: null,
    revisao: null,
    ultimaDecisao: null,
    cancelamento: null,
    historico: [eventoHistorico({ acao: 'enviado', de: null, para: EM_APROVACAO, porId: ator?.id, envio: 1, em })],
  };
}

/** Instante de vencimento da aprovação automática do envio atual (calendário 001), ou null. */
export function vencimentoAprovacao(grupo, { datasExtras = [] } = {}) {
  if (grupo?.status !== EM_APROVACAO) return null;
  const enviadoEm = grupo?.moderacao?.enviadoEm;
  if (!enviadoEm) return null;
  const evento = new Date(enviadoEm);
  if (Number.isNaN(evento.getTime())) return null;
  return vencimentoDiasUteis(evento, PRAZO_APROVACAO_DIAS_UTEIS, { datasExtras });
}

const falha = (http, codigo, error) => ({ ok: false, http, codigo, error });

const MENSAGEM_CONFLITO = 'O grupo nao esta mais no estado esperado para esta acao. Atualize a pagina.';

/**
 * Origem válida de cada ação (D-05). `de`: status aceitos; `extra(grupo, p)`:
 * condição adicional checada na leitura e repetida no filtro (`filtroExtra`).
 */
const ORIGENS = {
  aprovar: { de: [EM_APROVACAO], para: ATIVO },
  pedir_ajuste: { de: [EM_APROVACAO], para: AJUSTES },
  rejeitar: { de: [EM_APROVACAO], para: REJEITADO },
  aprovar_automatico: {
    de: [EM_APROVACAO], para: ATIVO,
    extra: (g, p) => (g.moderacao?.envio ?? 0) === p.envioEsperado,
    filtroExtra: (p) => ({ 'moderacao.envio': p.envioEsperado }),
  },
  confirmar_revisao: {
    de: [ATIVO], para: ATIVO,
    extra: (g) => g.moderacao?.revisaoPendente === true,
    filtroExtra: () => ({ 'moderacao.revisaoPendente': true }),
  },
  reprovar_revisao: {
    de: [ATIVO], para: CANCELADO,
    extra: (g) => g.moderacao?.revisaoPendente === true,
    filtroExtra: () => ({ 'moderacao.revisaoPendente': true }),
  },
  cancelar: { de: [ATIVO], para: CANCELADO },
  reenviar: { de: [AJUSTES], para: EM_APROVACAO },
  desistir: { de: [EM_APROVACAO, AJUSTES], para: CANCELADO },
  encerrar: { de: [ATIVO], para: CANCELADO },
};

const NOTIFICAR = {
  aprovar: 'dono',
  pedir_ajuste: 'dono',
  rejeitar: 'dono',
  aprovar_automatico: 'dono',
  reprovar_revisao: 'dono_e_membros',
  cancelar: 'dono_e_membros',
  encerrar: 'membros',
};

/** Campos de `moderacao` (relativos) que cada ação grava, além do histórico. */
function camposDaAcao(acao, { envio, texto, porId, agora }) {
  const decisao = { acao, texto: texto || null, porId, em: agora };
  const cancelamentoCotea = { origem: 'cotea', motivo: texto || null, porId, em: agora };
  switch (acao) {
    case 'aprovar':
      return { aprovacao: { tipo: 'manual', em: agora, porId }, revisaoPendente: false, ultimaDecisao: decisao };
    case 'pedir_ajuste':
    case 'rejeitar':
      return { ultimaDecisao: decisao };
    case 'aprovar_automatico':
      return { aprovacao: { tipo: 'automatica', em: agora, porId: null }, revisaoPendente: true, ultimaDecisao: { ...decisao, porId: null } };
    case 'confirmar_revisao':
      return { revisaoPendente: false, revisao: { porId, em: agora, resultado: 'confirmada' } };
    case 'reprovar_revisao':
      return {
        revisaoPendente: false, revisao: { porId, em: agora, resultado: 'reprovada' },
        cancelamento: cancelamentoCotea, ultimaDecisao: decisao,
      };
    case 'cancelar':
      return { revisaoPendente: false, cancelamento: cancelamentoCotea, ultimaDecisao: decisao };
    case 'reenviar':
      return { envio: envio + 1, enviadoEm: agora, ultimaDecisao: decisao };
    case 'desistir':
      return { cancelamento: { origem: 'dono', motivo: null, porId, em: agora }, ultimaDecisao: decisao };
    case 'encerrar':
      return { revisaoPendente: false, cancelamento: { origem: 'dono', motivo: texto || null, porId, em: agora }, ultimaDecisao: decisao };
    default:
      return {};
  }
}

/**
 * Planeja uma transição (logic/moderacao.md §2). Não grava nada.
 * @param {{ grupo: object, acao: string, texto?: string, ator?: { id?: string|null, automatico?: boolean },
 *           agora?: Date, envioEsperado?: number }} p
 * @returns {{ ok: false, http: number, codigo: string, error: string }
 *         | { ok: true, filtro: object, update: object, evento: object, notificar: 'dono' | 'dono_e_membros' | 'membros' | null }}
 */
export function planejarTransicao({ grupo, acao, texto, ator = {}, agora = new Date(), envioEsperado } = {}) {
  // 1. ação conhecida
  if (!TODAS_ACOES.includes(acao)) return falha(400, CODIGOS_MODERACAO.ACAO_INVALIDA, 'Acao de moderacao invalida');

  // 2. texto (antes do estado)
  const exigeTexto = ACOES_COM_TEXTO.includes(acao);
  const textoNorm = exigeTexto || ACOES_TEXTO_OPCIONAL.includes(acao) ? normalizarTexto(texto) : '';
  if (exigeTexto && !textoNorm) {
    return falha(400, CODIGOS_MODERACAO.TEXTO_OBRIGATORIO, 'Informe o motivo ou as pendencias');
  }
  if (textoNorm.length > TEXTO_MODERACAO_MAX) {
    return falha(400, CODIGOS_MODERACAO.TEXTO_LONGO, `O texto deve ter no maximo ${TEXTO_MODERACAO_MAX} caracteres`);
  }

  // 3. estado de origem (checagem antecipada; a garantia é o filtro)
  if (!grupo) return falha(404, 'grupo_nao_encontrado', 'Grupo nao encontrado');
  const regra = ORIGENS[acao];
  const atual = statusEfetivo(grupo);
  const params = { envioEsperado };
  if (!regra.de.includes(atual) || (regra.extra && !regra.extra(grupo, params))) {
    return falha(409, CODIGOS_MODERACAO.CONFLITO, MENSAGEM_CONFLITO);
  }

  const automatico = Boolean(ator?.automatico);
  const porId = automatico ? null : idTexto(ator?.id);
  const envioAtual = grupo.moderacao?.envio ?? 0;
  const campos = camposDaAcao(acao, { envio: envioAtual, texto: textoNorm, porId, agora });
  const envioDepois = campos.envio ?? envioAtual;

  const evento = eventoHistorico({
    acao, de: grupo.status ?? null, para: regra.para, texto: textoNorm || null,
    porId, automatico, envio: envioDepois, em: agora,
  });

  // Filtro: status de origem exatamente como está gravado (legado sem status → $exists: false).
  const filtroStatus = grupo.status === undefined ? { $exists: false } : grupo.status;
  const filtro = {
    _id: grupo._id,
    status: filtroStatus,
    ...(regra.filtroExtra ? regra.filtroExtra(params) : {}),
  };

  const $set = { status: regra.para, updatedAt: agora };
  let update;
  if (grupo.moderacao && typeof grupo.moderacao === 'object') {
    for (const [campo, valor] of Object.entries(campos)) $set[`moderacao.${campo}`] = valor;
    update = { $set, $push: { 'moderacao.historico': { $each: [evento], $slice: -HISTORICO_MODERACAO_MAX } } };
    // Sem moderacao.envio gravado (documento parcial), garante o campo.
    if (grupo.moderacao.envio === undefined && campos.envio === undefined) $set['moderacao.envio'] = envioAtual;
  } else {
    // Grupo legado ainda não migrado (moderacao ausente/null): grava o subdocumento inteiro.
    $set.moderacao = {
      envio: envioAtual, enviadoEm: null, revisaoPendente: false, aprovacao: null,
      revisao: null, ultimaDecisao: null, cancelamento: null,
      ...campos,
      historico: [evento],
    };
    update = { $set };
  }

  return { ok: true, filtro, update, evento, notificar: NOTIFICAR[acao] ?? null };
}

/**
 * Migração dos grupos existentes (data-model.md §Migração, FR-029/D-02). Só
 * grupos sem `moderacao`. Retorna a classificação e o `$set` a aplicar (ou null).
 */
export function planejarMigracaoModeracao(grupo, agora = new Date()) {
  if (grupo?.moderacao && typeof grupo.moderacao === 'object') return { classe: 'ja_migrado', set: null };
  const historico = (para) => [eventoHistorico({ acao: 'migrado', de: grupo?.status ?? null, para, envio: 0, em: agora })];
  const base = {
    envio: 0, enviadoEm: null, revisaoPendente: false, aprovacao: null,
    revisao: null, ultimaDecisao: null, cancelamento: null,
  };
  const aprovadoLegado = { ...base, aprovacao: { tipo: 'legado', em: agora, porId: null }, historico: historico(ATIVO) };

  if (grupo?.status === ATIVO) return { classe: 'aprovado', set: { moderacao: aprovadoLegado } };
  if (grupo?.status === undefined || grupo?.status === null) {
    return { classe: 'aprovado_sem_status', set: { status: ATIVO, moderacao: aprovadoLegado } };
  }
  if (grupo.status === CANCELADO) {
    return {
      classe: 'cancelado',
      set: { moderacao: { ...base, cancelamento: { origem: 'dono', motivo: null, porId: null, em: agora }, historico: historico(CANCELADO) } },
    };
  }
  return { classe: 'nao_classificado', set: null };
}
