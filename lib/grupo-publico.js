// Montagem da resposta de GET /api/grupos/[id] (bug get-grupo-expoe-dados-internos).
// Módulo puro (sem mongodb/next-auth): a resposta pública é uma ALLOWLIST de
// campos; qualquer campo novo do documento fica de fora até ser listado aqui.
// Campos internos (observacoesInternas, necessitaAnalise, e-mails, participantesIds,
// imageKey...) só saem na visão completa, restrita a staff e a dono/admin do grupo.

export const CAMPOS_PUBLICOS_GRUPO = [
  '_id', 'nome', 'slug', 'capa', 'imageUrl', 'subtitulo', 'descricao',
  'categoria', 'tipoGrupo', 'status', 'statusDetalhado',
  'acesso', 'tempoEntrega', 'confiabilidade', 'linkOficial',
  'beneficios', 'regras', 'faq', 'fidelidade',
  // preço por vaga (cobrança em pages/assinatura/pagamento.js) e vagas
  'valorTotal', 'valorPorVaga', 'repassePorVaga', 'taxaPorVaga', 'precoValido',
  'capacidadeTotal', 'vagasReservadasAdmin', 'vagasDisponiveis',
  // características de vitrine do serviço
  'servicoPreAssinado', 'envioAutomaticoAcesso', 'filaEsperaAtiva',
  'createdAt', 'updatedAt',
];

/**
 * @param {object} grupo documento de `grupos`
 * @param {{ adminIdResolvido?: any, adminNome?: string, adminEmail?: string,
 *           adminAvatar?: string, membrosAtivos?: number, completa?: boolean }} contexto
 * @returns {object} resposta pública (allowlist) ou completa (staff/dono)
 */
export function montarRespostaGrupo(grupo, contexto = {}) {
  const {
    adminIdResolvido = null, adminNome = 'Administrador', adminEmail = '',
    adminAvatar = '', membrosAtivos = 0, completa = false,
  } = contexto;
  const adminIdTexto = adminIdResolvido ? String(adminIdResolvido) : grupo.adminIdString || null;

  if (completa) {
    return {
      ...grupo,
      adminId: adminIdResolvido || grupo.adminId || null,
      adminIdString: adminIdTexto,
      adminNome, adminEmail, adminAvatar, membrosAtivos,
      admin: { id: adminIdTexto, nome: adminNome, email: adminEmail, avatar: adminAvatar },
    };
  }

  const publica = {};
  for (const campo of CAMPOS_PUBLICOS_GRUPO) {
    if (grupo[campo] !== undefined) publica[campo] = grupo[campo];
  }
  return {
    ...publica,
    adminNome, adminAvatar, membrosAtivos,
    admin: { id: adminIdTexto, nome: adminNome, avatar: adminAvatar },
  };
}
