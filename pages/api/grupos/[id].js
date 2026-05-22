import clientPromise from '../../../lib/mongodb';
import { ObjectId, Int32, Double } from 'mongodb';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]';
import { deleteFromR2, hasR2Config } from '../../../lib/r2';
import { getSessionUserId } from '../../../lib/wallet';
import { logAudit } from '../../../lib/audit';
import {
  CATEGORIAS_PERMITIDAS,
  parseNumero,
  parseObjectId,
  parseLista,
  parseFaq,
  parseFidelidade,
  normalizarPreco,
  slugify,
} from '../../../lib/grupos-utils';

async function handleGet(grupoId, db, res) {
  const grupo = await db.collection('grupos').findOne({ _id: grupoId });
  if (!grupo) return res.status(404).json({ error: 'Grupo nao encontrado' });

  let adminIdResolved = null;
  if (grupo.adminId && ObjectId.isValid(grupo.adminId)) adminIdResolved = grupo.adminId;
  if (!adminIdResolved && grupo.adminIdString && ObjectId.isValid(grupo.adminIdString)) adminIdResolved = new ObjectId(grupo.adminIdString);

  const membroAdmin = await db.collection('membrosGrupo').findOne({ grupoId, papel: 'admin' });
  if (!adminIdResolved && membroAdmin?.userId) adminIdResolved = membroAdmin.userId;

  let adminUser = null;
  if (adminIdResolved && ObjectId.isValid(String(adminIdResolved))) {
    adminUser = await db.collection('users').findOne(
      { _id: new ObjectId(adminIdResolved) },
      { projection: { name: 1, nome: 1, email: 1, image: 1, avatar: 1 } }
    );
  }

  const adminNome = adminUser?.name || adminUser?.nome || grupo.adminNome || membroAdmin?.nome || adminUser?.email || grupo.admin?.nome || 'Administrador';
  const adminEmail = adminUser?.email || grupo.adminEmail || '';
  const adminAvatar = adminUser?.image || adminUser?.avatar || grupo.adminAvatar || '';
  const membrosAtivos = await db.collection('membrosGrupo').countDocuments({ grupoId, status: { $ne: 'banido' } });

  return res.status(200).json({
    ...grupo,
    adminId: adminIdResolved || grupo.adminId || null,
    adminIdString: adminIdResolved ? String(adminIdResolved) : grupo.adminIdString || null,
    adminNome, adminEmail, adminAvatar, membrosAtivos,
    admin: {
      id: adminIdResolved ? String(adminIdResolved) : grupo.adminIdString || null,
      nome: adminNome, email: adminEmail, avatar: adminAvatar,
    },
  });
}

async function handleDelete(grupoId, grupo, requesterId, session, req, db, res) {
  const resultado = await db.collection('grupos').deleteOne({ _id: grupoId });
  if (resultado.deletedCount === 0) return res.status(404).json({ error: 'Grupo nao encontrado' });

  await db.collection('membrosGrupo').deleteMany({ grupoId });

  if (hasR2Config()) {
    const safeKeyFromUrl = (url) => {
      try { return new URL(url).pathname.replace(/^\/+/, ''); } catch { return null; }
    };
    const r2Key = grupo.imageKey || safeKeyFromUrl(grupo.imageUrl) || safeKeyFromUrl(grupo.capa);
    if (r2Key) {
      try { await deleteFromR2(r2Key); } catch (err) {
        console.warn('Falha ao deletar imagem do R2 apos excluir grupo:', err?.message);
      }
    }
  }

  await logAudit({
    action: 'grupo.deleted', actorId: String(requesterId), actorEmail: session.user.email,
    targetId: String(grupoId), targetCollection: 'grupos',
    details: { nome: grupo.nome, categoria: grupo.categoria },
    ip: req.headers['x-forwarded-for'] || req.socket?.remoteAddress,
  });

  return res.status(200).json({ message: 'Grupo excluido com sucesso' });
}

async function handleUpdate(grupoId, grupo, requesterId, session, req, db, res) {
  const {
    nome, capa, imageUrl = '', imageKey = '', valorTotal, valorPorVaga,
    descricao = '', subtitulo = '', acesso = 'imediato', tempoEntrega = '',
    confiabilidade = '', capacidadeTotal, categoria = '', vagasReservadasAdmin = 0,
    vagasDisponiveis, servicoPreAssinado = false, envioAutomaticoAcesso = false,
    filaEsperaAtiva = false, necessitaAnalise = false, observacoesInternas = '',
    tipoGrupo = 'publico', status = 'ativo', statusDetalhado = 'em_formacao',
    beneficios, fidelidadePeriodo, fidelidadeRenovacao, fidelidadeObservacoes,
    regras, faq, linkOficial = '',
  } = req.body || {};

  const isSystemAdmin = session.user?.systemRole === 'admin';
  const categoriaEfetiva = isSystemAdmin ? categoria : (grupo.categoria || categoria);
  const acessoEfetivo = isSystemAdmin ? acesso : (grupo.acesso || acesso);
  const tempoEntregaEfetivo = isSystemAdmin ? tempoEntrega : (grupo.tempoEntrega || tempoEntrega);
  const tipoGrupoEfetivo = isSystemAdmin ? tipoGrupo : (grupo.tipoGrupo || tipoGrupo);
  const servicoPreAssinadoEfetivo = isSystemAdmin ? Boolean(servicoPreAssinado) : Boolean(grupo.servicoPreAssinado);
  const envioAutomaticoAcessoEfetivo = isSystemAdmin ? Boolean(envioAutomaticoAcesso) : Boolean(grupo.envioAutomaticoAcesso);
  const filaEsperaAtivaEfetiva = isSystemAdmin ? Boolean(filaEsperaAtiva) : Boolean(grupo.filaEsperaAtiva);
  const necessitaAnaliseEfetivo = isSystemAdmin ? Boolean(necessitaAnalise) : Boolean(grupo.necessitaAnalise);
  const observacoesInternasEfetiva = isSystemAdmin ? (observacoesInternas || '') : (grupo.observacoesInternas || '');

  const valorTotalNumero = normalizarPreco(valorTotal);
  const valorPorVagaNumero = normalizarPreco(valorPorVaga);
  const capacidadeNumero = Math.trunc(parseNumero(capacidadeTotal));
  const vagasReservadasNumero = Math.trunc(parseNumero(vagasReservadasAdmin));

  if (!nome) return res.status(400).json({ error: 'Nome e obrigatorio' });
  if (!Number.isFinite(valorTotalNumero) || !Number.isFinite(valorPorVagaNumero)) return res.status(400).json({ error: 'Valor total e valor por vaga sao obrigatorios' });
  if (!Number.isFinite(capacidadeNumero) || capacidadeNumero <= 0) return res.status(400).json({ error: 'Capacidade total deve ser maior que zero' });
  if (!Number.isFinite(vagasReservadasNumero) || vagasReservadasNumero < 0) return res.status(400).json({ error: 'Vagas reservadas do admin deve ser zero ou mais' });
  if (vagasReservadasNumero > capacidadeNumero) return res.status(400).json({ error: 'Vagas reservadas nao podem exceder a capacidade' });
  if (!categoriaEfetiva || !CATEGORIAS_PERMITIDAS.includes(categoriaEfetiva)) return res.status(400).json({ error: 'Categoria invalida' });

  const beneficiosParsed = parseLista(beneficios);
  const regrasParsed = parseLista(regras);
  const faqParsed = parseFaq(faq);

  if (beneficiosParsed.length > 30) return res.status(400).json({ error: 'Maximo de 30 beneficios permitidos' });
  if (beneficiosParsed.some((b) => String(b).length > 200)) return res.status(400).json({ error: 'Cada beneficio deve ter no maximo 200 caracteres' });
  if (regrasParsed.length > 30) return res.status(400).json({ error: 'Maximo de 30 regras permitidas' });
  if (regrasParsed.some((r) => String(r).length > 500)) return res.status(400).json({ error: 'Cada regra deve ter no maximo 500 caracteres' });
  if (faqParsed.length > 20) return res.status(400).json({ error: 'Maximo de 20 itens no FAQ permitidos' });

  const imagemFinal = imageUrl || capa || '';
  const vagasDisponiveisNumero =
    typeof vagasDisponiveis === 'number'
      ? Math.trunc(parseNumero(vagasDisponiveis))
      : Math.max(capacidadeNumero - vagasReservadasNumero, 0);

  const resultado = await db.collection('grupos').updateOne(
    { _id: grupoId },
    {
      $set: {
        nome, slug: slugify(nome), capa: imagemFinal, imageUrl: imageUrl || imagemFinal, imageKey,
        valorTotal: new Double(valorTotalNumero), valorPorVaga: new Double(valorPorVagaNumero), descricao,
        capacidadeTotal: new Int32(capacidadeNumero), vagasReservadasAdmin: new Int32(vagasReservadasNumero),
        vagasDisponiveis: new Int32(vagasDisponiveisNumero), subtitulo,
        acesso: acessoEfetivo, tempoEntrega: tempoEntregaEfetivo, confiabilidade,
        categoria: categoriaEfetiva, tipoGrupo: tipoGrupoEfetivo, status, statusDetalhado,
        servicoPreAssinado: servicoPreAssinadoEfetivo, envioAutomaticoAcesso: envioAutomaticoAcessoEfetivo,
        filaEsperaAtiva: filaEsperaAtivaEfetiva, necessitaAnalise: necessitaAnaliseEfetivo,
        observacoesInternas: observacoesInternasEfetiva,
        beneficios: beneficiosParsed, regras: regrasParsed, faq: faqParsed,
        fidelidade: parseFidelidade({ fidelidadePeriodo, fidelidadeRenovacao, fidelidadeObservacoes }),
        linkOficial: (linkOficial || '').trim(), updatedAt: new Date(),
      },
    }
  );

  if (resultado.matchedCount === 0) return res.status(404).json({ error: 'Grupo nao encontrado' });

  await logAudit({
    action: 'grupo.updated', actorId: String(requesterId), actorEmail: session.user.email,
    targetId: String(grupoId), targetCollection: 'grupos',
    details: { nome, status, categoria: categoriaEfetiva, valorPorVaga: valorPorVagaNumero },
    ip: req.headers['x-forwarded-for'] || req.socket?.remoteAddress,
  });

  return res.status(200).json({ message: 'Grupo atualizado com sucesso' });
}

export default async function handler(req, res) {
  try {
    const client = await clientPromise;
    const db = client.db(process.env.MONGODB_DB);
    const { id } = req.query;

    if (!ObjectId.isValid(id)) return res.status(400).json({ error: 'ID invalido' });
    const grupoId = new ObjectId(id);

    if (req.method === 'GET') return await handleGet(grupoId, db, res);

    // Autenticação e autorização compartilhadas entre DELETE e PUT
    const session = await getServerSession(req, res, authOptions);
    if (!session || !session.user?.id) return res.status(401).json({ error: 'Nao autenticado' });

    const requesterId = parseObjectId(getSessionUserId(session));
    if (!requesterId) return res.status(403).json({ error: 'Usuario da sessao invalido' });

    const grupo = await db.collection('grupos').findOne({ _id: grupoId });
    if (!grupo) return res.status(404).json({ error: 'Grupo nao encontrado' });

    const adminIdDoc = parseObjectId(grupo.adminId || grupo.adminIdString || grupo.admin?.userId);
    const membroAdmin = adminIdDoc && adminIdDoc.equals(requesterId)
      ? { userId: requesterId }
      : await db.collection('membrosGrupo').findOne({ grupoId, userId: requesterId, papel: 'admin', status: { $ne: 'banido' } });

    if (!membroAdmin) return res.status(403).json({ error: 'Apenas administradores podem alterar o grupo' });

    if (req.method === 'DELETE') return await handleDelete(grupoId, grupo, requesterId, session, req, db, res);
    if (req.method === 'PUT') return await handleUpdate(grupoId, grupo, requesterId, session, req, db, res);

    res.setHeader('Allow', ['GET', 'PUT', 'DELETE']);
    return res.status(405).end(`Metodo ${req.method} nao permitido`);
  } catch (error) {
    console.error('Erro na API /api/grupos/[id]:', error?.errInfo || error);
    if (error?.code === 121) return res.status(400).json({ error: 'Validacao do documento falhou', details: error.errInfo || null });
    return res.status(500).json({ error: 'Erro interno no servidor' });
  }
}
