// GET /api/admin/moderacao?visao=pendentes|revisao|aprovados — fila de moderação de grupos
// (005-aprovacao-grupos, US2/US3 · FR-008, FR-009, FR-027). Leitura para suporte e
// admin (PERMISSIONS.GROUPS_TAB); `podeDecidir` só para o admin do sistema.
// Contrato em sdd/specs/005-aprovacao-grupos/contracts/api-moderacao.md.
import { getServerSession } from 'next-auth';
import { ObjectId } from 'mongodb';
import { authOptions } from '../../auth/[...nextauth]';
import { getDb } from '../../../../lib/mongodb';
import { PERMISSIONS, hasRole } from '../../../../lib/authz';
import { carregarDatasExtras } from '../../../../lib/calendario-dados';
import { STATUS_GRUPO, vencimentoAprovacao } from '../../../../lib/moderacao';

const LIMITE_ITENS = 200;

const FILTROS = {
  pendentes: { status: STATUS_GRUPO.EM_APROVACAO },
  revisao: { status: STATUS_GRUPO.ATIVO, 'moderacao.revisaoPendente': true },
  // Grupos aprovados, para o cancelamento pelo Cotea (US5, FR-023).
  aprovados: { status: STATUS_GRUPO.ATIVO },
};

const ORDEM = {
  pendentes: { 'moderacao.enviadoEm': 1 },
  revisao: { 'moderacao.aprovacao.em': 1 },
  aprovados: { updatedAt: -1 },
};

const comoObjectId = (v) => {
  if (v instanceof ObjectId) return v;
  if (typeof v === 'string' && ObjectId.isValid(v)) return new ObjectId(v);
  return null;
};

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: 'Metodo nao permitido' });
  }

  try {
    const session = await getServerSession(req, res, authOptions);
    if (!session?.user) return res.status(401).json({ error: 'Nao autenticado' });
    if (!hasRole(session, PERMISSIONS.GROUPS_TAB)) return res.status(403).json({ error: 'Acesso negado' });

    const visao = Object.hasOwn(FILTROS, req.query?.visao) ? req.query.visao : 'pendentes';
    const db = await getDb();
    const col = db.collection('grupos');

    const [pendentes, revisao] = await Promise.all([
      col.countDocuments(FILTROS.pendentes),
      col.countDocuments(FILTROS.revisao),
    ]);

    const grupos = await col.find(FILTROS[visao]).sort(ORDEM[visao]).limit(LIMITE_ITENS).toArray();
    const datasExtras = visao === 'pendentes' && grupos.length ? await carregarDatasExtras(db) : [];

    const idsDonos = [...new Set(grupos.map((g) => String(comoObjectId(g.adminId) || comoObjectId(g.adminIdString) || '')).filter(Boolean))];
    const donos = idsDonos.length
      ? await db.collection('users')
        .find({ _id: { $in: idsDonos.map((i) => new ObjectId(i)) } }, { projection: { nome: 1, name: 1, email: 1 } })
        .toArray()
      : [];
    const donoPorId = new Map(donos.map((u) => [String(u._id), u]));

    const itens = grupos.map((g) => {
      const donoId = String(comoObjectId(g.adminId) || comoObjectId(g.adminIdString) || '');
      const u = donoPorId.get(donoId);
      const m = g.moderacao || {};
      return {
        _id: String(g._id),
        nome: g.nome, categoria: g.categoria, descricao: g.descricao, subtitulo: g.subtitulo,
        imageUrl: g.imageUrl || g.capa || '', linkOficial: g.linkOficial || '',
        valorTotal: g.valorTotal, valorPorVaga: g.valorPorVaga, repassePorVaga: g.repassePorVaga,
        taxaPorVaga: g.taxaPorVaga, capacidadeTotal: g.capacidadeTotal, acesso: g.acesso,
        necessitaAnalise: Boolean(g.necessitaAnalise), observacoesInternas: g.observacoesInternas || '',
        dono: {
          id: donoId || null,
          nome: u?.nome || u?.name || g.adminNome || 'Dono',
          email: u?.email || g.adminEmail || '', // tela restrita a staff
        },
        status: g.status,
        moderacao: {
          envio: m.envio ?? 0, enviadoEm: m.enviadoEm ?? null, aprovacao: m.aprovacao ?? null,
          ultimaDecisao: m.ultimaDecisao ?? null, historico: Array.isArray(m.historico) ? m.historico : [],
        },
        venceEm: visao === 'pendentes' ? vencimentoAprovacao(g, { datasExtras }) : null,
      };
    });

    return res.status(200).json({
      contagens: { pendentes, revisao },
      podeDecidir: hasRole(session, PERMISSIONS.MODERAR_GRUPOS),
      itens,
    });
  } catch (error) {
    console.error('Erro na API /api/admin/moderacao:', error);
    return res.status(500).json({ error: 'Erro interno no servidor' });
  }
}
