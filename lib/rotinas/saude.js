// Rotina de saúde (FR-009): valida o mecanismo de ponta a ponta sem efeito de
// negócio. Gera um "batimento" por hora e processa sondas de teste criadas por
// scripts/criar-sonda-rotina.js.

export const rotinaSaude = {
  id: 'saude',
  descricao: 'Verificação de funcionamento das rotinas (batimento horário e sondas de teste)',
  ativa: true,

  async buscarVencidos({ agora, contexto = {} }) {
    // Hora em UTC: só precisa ser única por hora; não é prazo de negócio.
    const itens = [{ chave: `batimento:${agora.toISOString().slice(0, 13)}`, dados: {} }];

    if (contexto.db) {
      const sondas = await contexto.db
        .collection('rotinaSaudeSondas')
        .find({ venceEm: { $lte: agora } }, { projection: { falhar: 1 } })
        .sort({ venceEm: 1 })
        .toArray();
      for (const sonda of sondas) {
        itens.push({ chave: `sonda:${sonda._id}`, dados: { falhar: Boolean(sonda.falhar) } });
      }
    }

    return itens;
  },

  async processarItem({ chave, dados = {}, contexto = {} }) {
    if (chave.startsWith('sonda:') && contexto.db) {
      // Revalida no momento de processar (FR-007): permite reexecutar após mudar `falhar` no banco.
      const sonda = await contexto.db.collection('rotinaSaudeSondas').findOne({ _id: chave.slice('sonda:'.length) });
      if (!sonda) return 'ignorado';
      if (sonda.falhar) throw new Error('falha simulada pela sonda');
      return 'concluido';
    }
    if (dados.falhar) throw new Error('falha simulada pela sonda');
    return 'concluido';
  },
};
