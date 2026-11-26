import clientPromise from '../../../lib/mongodb';
import { ObjectId, Int32 } from 'mongodb';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]';
import { deleteFromR2, hasR2Config } from '../../../lib/r2';
import { getSessionUserId } from '../../../lib/wallet';
import { logAudit } from '../../../lib/audit';
import { montarRespostaGrupo } from '../../../lib/grupo-publico';
import { identificarVisaoGrupo } from '../../../lib/grupo-visao-servidor';
import { aposLotar, liquidarParticipacoesDoGrupo } from '../../../lib/checkout-servidor';
import { grupoJaLotou } from '../../../lib/checkout';
import {
  CODIGOS_MODERACAO, adminPodeEditar, donoPodeEditar, grupoEhPublico, podeVerGrupo, statusEfetivo,
} from '../../../lib/moderacao';
import {
  CATEGORIAS_PERMITIDAS,
  parseObjectId,
  parseLista,
  parseFaq,
  parseFidelidade,
  slugify,
  camposPrecoParaGravar,
  resumoPrecoAuditoria,
} from '../../../lib/grupos-utils';
import { calcularPrecoVaga, validarNovaCapacidade } from '../../../lib/preco';

const NAO_ENCONTRADO = { error: 'Grupo nao encontrado' };

const MENSAGENS_EDICAO_BLOQUEADA = {
  em_aprovacao: 'O grupo esta em aprovacao e nao pode ser editado agora. Aguarde a analise do Cotea.',
  rejeitado: 'O grupo foi rejeitado e nao pode mais ser editado.',
  cancelado: 'O grupo foi cancelado e nao pode mais ser editado.',
};

function edicaoBloqueada(grupo) {
  return {
    error: MENSAGENS_EDICAO_BLOQUEADA[statusEfetivo(grupo)] || 'O grupo nao pode ser alterado no estado atual.',
    codigo: CODIGOS_MODERACAO.EDICAO_BLOQUEADA,
  };
}

async function handleGet(grupoId, req, db, res) {
  const grupo = await db.collection('grupos').findOne({ _id: grupoId });
  if (!grupo) return res.status(404).json(NAO_ENCONTRADO);

  let adminIdResolved = null;
  if (grupo.adminId && ObjectId.isValid(grupo.adminId)) adminIdResolved = grupo.adminId;
  if (!adminIdResolved && grupo.adminIdString && ObjectId.isValid(grupo.adminIdString)) adminIdResolved = new ObjectId(grupo.adminIdString);

  const membroAdmin = await db.collection('membrosGrupo').findOne({ grupoId, papel: 'admin' });
  if (!adminIdResolved && membroAdmin?.userId) adminIdResolved = membroAdmin.userId;

  // Campos internos: staff (aba de grupos) ou dono/admin do grupo; falha de sessao = visao publica.
  const visao = await identificarVisaoGrupo({ req, res, db, grupoId, grupo, adminIdResolvido: adminIdResolved });

  // 005-aprovacao-grupos (FR-006, D-06): grupo nao publico so para staff, dono ou membro atual
  // nao banido; os demais recebem o mesmo 404 de grupo inexistente.
  if (!grupoEhPublico(grupo)) {
    const requesterId = parseObjectId(visao.userId);
    const ehMembroAtual = requesterId
      ? Boolean(await db.collection('membrosGrupo').findOne({ grupoId, userId: requesterId, status: { $ne: 'banido' } }))
      : false;
    if (!podeVerGrupo({ grupo, ehStaff: visao.staff, ehDono: visao.dono, ehMembroAtual })) {
      return res.status(404).json(NAO_ENCONTRADO);
    }
  }
  const completa = visao.completa;

  let adminUser = null;
  if (adminIdResolved && ObjectId.isValid(String(adminIdResolved))) {
    adminUser = await db.collection('users').findOne(
      { _id: new ObjectId(adminIdResolved) },
      { projection: { name: 1, nome: 1, email: 1, image: 1, avatar: 1 } }
    );
  }

  // E-mail do dono so serve de nome de exibicao na visao completa (nunca na publica).
  const adminNome = adminUser?.name || adminUser?.nome || grupo.adminNome || membroAdmin?.nome
    || (completa ? adminUser?.email : '') || grupo.admin?.nome || 'Administrador';
  const adminEmail = adminUser?.email || grupo.adminEmail || '';
  const adminAvatar = adminUser?.image || adminUser?.avatar || grupo.adminAvatar || '';
  const membrosAtivos = await db.collection('membrosGrupo').countDocuments({ grupoId, status: { $ne: 'banido' } });

  return res.status(200).json(montarRespostaGrupo(grupo, {
    adminIdResolvido: adminIdResolved, adminNome, adminEmail, adminAvatar, membrosAtivos, completa,
  }));
}

async function handleDelete(grupoId, grupo, requesterId, session, req, db, res) {
  // D-07: exclusão física só em grupo aprovado (fluxo atual até a V2-14). Pedido pendente usa
  // `desistir`; rejeitado/cancelado preservam o histórico.
  if (statusEfetivo(grupo) !== 'ativo') return res.status(409).json(edicaoBloqueada(grupo));

  // 006-checkout-caucao (logic §7). Depois de excluído não há como saber que o grupo
  // lotou: marca antes as mensalidades que já não voltam.
  if (grupoJaLotou(grupo)) {
    await db.collection('membrosGrupo').updateMany(
      { grupoId, 'retencao.situacao': 'retida' },
      { $set: { 'retencao.situacao': 'a_liberar' } }
    );
  }

  const resultado = await db.collection('grupos').deleteOne({
    _id: grupoId, status: grupo.status === undefined ? { $exists: false } : grupo.status,
  });
  if (resultado.deletedCount === 0) return res.status(404).json({ error: 'Grupo nao encontrado' });

  // Sem o grupo, nenhuma entrada passa. Quem tem caução é liquidado e removido; o que não
  // terminar fica órfão e a rotina `liquidacao-participacoes` completa.
  try {
    await liquidarParticipacoesDoGrupo({
      db, grupoId, motivo: 'grupo_excluido', porId: String(requesterId), remover: true,
    });
  } catch (erro) {
    console.error('Falha ao devolver caucoes do grupo excluido:', erro?.message || erro);
  }
  await db.collection('membrosGrupo').deleteMany({ grupoId, 'caucao.situacao': { $ne: 'bloqueada' } });

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
    // valorPorVaga, vagasReservadasAdmin e vagasDisponiveis do body sao ignorados:
    // o preco e as vagas sao sempre calculados no servidor (003-preco-por-vaga, D-04).
    nome, capa, imageUrl = '', imageKey = '', valorTotal,
    descricao = '', subtitulo = '', acesso = 'imediato', tempoEntrega = '',
    confiabilidade = '', capacidadeTotal, categoria = '',
    servicoPreAssinado = false, envioAutomaticoAcesso = false,
    filaEsperaAtiva = false, necessitaAnalise = false, observacoesInternas = '',
    // status, statusDetalhado e moderacao do body sao ignorados: o estado so muda pelas
    // acoes de moderacao (005-aprovacao-grupos, FR-003/D-07).
    tipoGrupo = 'publico',
    beneficios, fidelidadePeriodo, fidelidadeRenovacao, fidelidadeObservacoes,
    regras, faq, linkOficial = '',
  } = req.body || {};

  const isSystemAdmin = session.user?.systemRole === 'admin';

  // FR-019/D-07: dono edita so em ajustes ou ativo; admin do sistema fora dos estados finais.
  const podeEditar = isSystemAdmin ? adminPodeEditar(grupo) : donoPodeEditar(grupo);
  if (!podeEditar) return res.status(409).json(edicaoBloqueada(grupo));

  const categoriaEfetiva = isSystemAdmin ? categoria : (grupo.categoria || categoria);
  const acessoEfetivo = isSystemAdmin ? acesso : (grupo.acesso || acesso);
  const tempoEntregaEfetivo = isSystemAdmin ? tempoEntrega : (grupo.tempoEntrega || tempoEntrega);
  const tipoGrupoEfetivo = isSystemAdmin ? tipoGrupo : (grupo.tipoGrupo || tipoGrupo);
  const servicoPreAssinadoEfetivo = isSystemAdmin ? Boolean(servicoPreAssinado) : Boolean(grupo.servicoPreAssinado);
  const envioAutomaticoAcessoEfetivo = isSystemAdmin ? Boolean(envioAutomaticoAcesso) : Boolean(grupo.envioAutomaticoAcesso);
  const filaEsperaAtivaEfetiva = isSystemAdmin ? Boolean(filaEsperaAtiva) : Boolean(grupo.filaEsperaAtiva);
  const necessitaAnaliseEfetivo = isSystemAdmin ? Boolean(necessitaAnalise) : Boolean(grupo.necessitaAnalise);
  const observacoesInternasEfetiva = isSystemAdmin ? (observacoesInternas || '') : (grupo.observacoesInternas || '');

  const preco = calcularPrecoVaga({ valorTotal, capacidade: capacidadeTotal });

  if (!nome) return res.status(400).json({ error: 'Nome e obrigatorio' });
  if (!preco.valido) return res.status(400).json({ error: preco.mensagem, campo: preco.motivo });
  if (!categoriaEfetiva || !CATEGORIAS_PERMITIDAS.includes(categoriaEfetiva)) return res.status(400).json({ error: 'Categoria invalida' });

  const beneficiosParsed = parseLista(beneficios);
  const regrasParsed = parseLista(regras);
  const faqParsed = parseFaq(faq);

  if (beneficiosParsed.length > 30) return res.status(400).json({ error: 'Maximo de 30 beneficios permitidos' });
  if (beneficiosParsed.some((b) => String(b).length > 200)) return res.status(400).json({ error: 'Cada beneficio deve ter no maximo 200 caracteres' });
  if (regrasParsed.length > 30) return res.status(400).json({ error: 'Maximo de 30 regras permitidas' });
  if (regrasParsed.some((r) => String(r).length > 500)) return res.status(400).json({ error: 'Cada regra deve ter no maximo 500 caracteres' });
  if (faqParsed.length > 20) return res.status(400).json({ error: 'Maximo de 20 itens no FAQ permitidos' });

  // Participantes = membros nao-dono nao banidos + 1 (dono), lidos logo antes de gravar (D-06).
  const membrosAtivos = await db.collection('membrosGrupo').countDocuments({
    grupoId, papel: { $ne: 'admin' }, status: { $ne: 'banido' },
  });
  const capacidadeOk = validarNovaCapacidade({ capacidade: preco.capacidade, membrosAtivos });
  if (!capacidadeOk.valido) {
    return res.status(400).json({ error: capacidadeOk.mensagem, campo: 'capacidade_participantes' });
  }

  const imagemFinal = imageUrl || capa || '';
  const vagasDisponiveisNumero = Math.max(preco.capacidade - capacidadeOk.participantes, 0);
  const camposPreco = camposPrecoParaGravar(preco);

  // 006-checkout-caucao (FR-026): reduzir a capacidade pode lotar um grupo `apos_completar`.
  const agora = new Date();
  const lotaAgora = acessoEfetivo === 'apos_completar' && !grupoJaLotou(grupo)
    && preco.capacidade <= capacidadeOk.participantes;

  // Status no filtro: se uma decisao de moderacao mudou o grupo entre a leitura e a gravacao,
  // a edicao nao se aplica sobre o estado novo (R-006).
  // versaoParticipacao no filtro (D-13): se alguém entrou ou saiu depois da leitura, a
  // contagem de participantes envelheceu e a edição não se aplica.
  const resultado = await db.collection('grupos').updateOne(
    {
      _id: grupoId,
      status: grupo.status === undefined ? { $exists: false } : grupo.status,
      versaoParticipacao: grupo.versaoParticipacao === undefined ? { $exists: false } : grupo.versaoParticipacao,
    },
    {
      $set: {
        nome, slug: slugify(nome), capa: imagemFinal, imageUrl: imageUrl || imagemFinal, imageKey,
        ...camposPreco, descricao,
        vagasDisponiveis: new Int32(vagasDisponiveisNumero), subtitulo,
        acesso: acessoEfetivo, tempoEntrega: tempoEntregaEfetivo, confiabilidade,
        categoria: categoriaEfetiva, tipoGrupo: tipoGrupoEfetivo,
        servicoPreAssinado: servicoPreAssinadoEfetivo, envioAutomaticoAcesso: envioAutomaticoAcessoEfetivo,
        filaEsperaAtiva: filaEsperaAtivaEfetiva, necessitaAnalise: necessitaAnaliseEfetivo,
        observacoesInternas: observacoesInternasEfetiva,
        beneficios: beneficiosParsed, regras: regrasParsed, faq: faqParsed,
        fidelidade: parseFidelidade({ fidelidadePeriodo, fidelidadeRenovacao, fidelidadeObservacoes }),
        linkOficial: (linkOficial || '').trim(), updatedAt: agora,
        ...(lotaAgora ? { lotadoEm: agora, statusDetalhado: 'ativo' } : {}),
      },
    }
  );

  if (resultado.matchedCount === 0) {
    return res.status(409).json({
      error: 'O grupo mudou de estado enquanto voce editava. Atualize a pagina.', codigo: CODIGOS_MODERACAO.CONFLITO,
    });
  }

  if (lotaAgora) await aposLotar({ db, grupo: { ...grupo, nome } });

  await logAudit({
    action: 'grupo.updated', actorId: String(requesterId), actorEmail: session.user.email,
    targetId: String(grupoId), targetCollection: 'grupos',
    details: {
      nome, status: statusEfetivo(grupo), categoria: categoriaEfetiva,
      preco: { antes: resumoPrecoAuditoria(grupo), depois: resumoPrecoAuditoria(camposPreco) },
    },
    ip: req.headers['x-forwarded-for'] || req.socket?.remoteAddress,
  });

  return res.status(200).json({
    message: 'Grupo atualizado com sucesso',
    preco: { valorPorVaga: preco.valorPorVaga, repasse: preco.repasse, taxa: preco.taxa },
  });
}

export default async function handler(req, res) {
  try {
    const client = await clientPromise;
    const db = client.db(process.env.MONGODB_DB);
    const { id } = req.query;

    if (!ObjectId.isValid(id)) return res.status(400).json({ error: 'ID invalido' });
    const grupoId = new ObjectId(id);

    if (req.method === 'GET') return await handleGet(grupoId, req, db, res);

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
