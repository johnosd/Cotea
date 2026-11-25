import clientPromise from '../../../lib/mongodb';
import { Int32 } from 'mongodb';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]';
import { getSessionUserId } from '../../../lib/wallet';
import { logAudit } from '../../../lib/audit';
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
import { calcularPrecoVaga, VAGAS_DONO } from '../../../lib/preco';
import { verificarCadastroFinanceiro } from '../../../lib/cadastro-financeiro-servidor';

async function handleList(db, res) {
  const grupos = await db
    .collection('grupos')
    .aggregate([
      {
        $lookup: {
          from: 'membrosGrupo',
          localField: '_id',
          foreignField: 'grupoId',
          as: 'membros',
        },
      },
      {
        $addFields: {
          membrosAtivos: {
            $size: {
              $filter: { input: '$membros', as: 'm', cond: { $ne: ['$$m.status', 'banido'] } },
            },
          },
          participantes: {
            $map: {
              input: {
                $filter: { input: '$membros', as: 'm', cond: { $ne: ['$$m.status', 'banido'] } },
              },
              as: 'm',
              in: { userId: { $toString: '$$m.userId' }, papel: '$$m.papel', status: '$$m.status' },
            },
          },
        },
      },
      { $project: { membros: 0 } },
    ])
    .toArray();
  return res.status(200).json(grupos);
}

async function handleCreate(req, res, db) {
  const {
    // valorPorVaga, vagasReservadasAdmin e vagasDisponiveis do body sao ignorados:
    // o preco e as vagas sao sempre calculados no servidor (003-preco-por-vaga, D-04).
    nome, capa, imageUrl = '', imageKey = '', valorTotal,
    descricao = '', subtitulo = '', acesso = 'imediato', tempoEntrega = '',
    confiabilidade = '', capacidadeTotal, categoria = '',
    servicoPreAssinado = false, envioAutomaticoAcesso = false,
    filaEsperaAtiva = false, necessitaAnalise = false, observacoesInternas = '',
    status = 'ativo', statusDetalhado = 'em_formacao', tipoGrupo = 'publico',
    beneficios, fidelidadePeriodo, fidelidadeRenovacao, fidelidadeObservacoes,
    regras, faq, linkOficial = '',
  } = req.body || {};

  const session = await getServerSession(req, res, authOptions);
  if (!session || !session.user?.id) return res.status(401).json({ error: 'Nao autenticado' });
  if (!session.user.contaValidada) return res.status(403).json({ error: 'Conta nao verificada. Confirme seu e-mail para criar grupos.' });

  const adminId = parseObjectId(getSessionUserId(session));
  if (!adminId) return res.status(403).json({ error: 'Usuario da sessao invalido' });

  const adminUser = await db.collection('users').findOne({ _id: adminId });
  if (!adminUser) return res.status(403).json({ error: 'Administrador nao encontrado' });

  // B-05: usuario bloqueado nao cria grupos (regras-negocio-v2, Bloqueado / Fluxo 18).
  // O banco e a fonte de verdade: o isBlocked do JWT so e ressincronizado a cada updateAge.
  // Apenas a criacao e barrada; pagamento, participacao e saque seguem permitidos.
  if (adminUser.isBlocked === true || session.user.isBlocked === true) {
    return res.status(403).json({ error: 'Conta bloqueada. Voce nao pode criar grupos. Procure o suporte.' });
  }

  // 004-cadastro-financeiro (D-03): cadastro financeiro completo antes de qualquer efeito.
  const verificacao = await verificarCadastroFinanceiro(adminId);
  if (!verificacao.ok) return res.status(verificacao.http).json(verificacao.body);

  const preco = calcularPrecoVaga({ valorTotal, capacidade: capacidadeTotal });

  if (!nome) return res.status(400).json({ error: 'Nome e obrigatorio' });
  if (!preco.valido) return res.status(400).json({ error: preco.mensagem, campo: preco.motivo });
  if (!categoria || !CATEGORIAS_PERMITIDAS.includes(categoria)) return res.status(400).json({ error: 'Categoria invalida' });

  const beneficiosParsed = parseLista(beneficios);
  const regrasParsed = parseLista(regras);
  const faqParsed = parseFaq(faq);

  if (beneficiosParsed.length > 30) return res.status(400).json({ error: 'Maximo de 30 beneficios permitidos' });
  if (beneficiosParsed.some((b) => String(b).length > 200)) return res.status(400).json({ error: 'Cada beneficio deve ter no maximo 200 caracteres' });
  if (regrasParsed.length > 30) return res.status(400).json({ error: 'Maximo de 30 regras permitidas' });
  if (regrasParsed.some((r) => String(r).length > 500)) return res.status(400).json({ error: 'Cada regra deve ter no maximo 500 caracteres' });
  if (faqParsed.length > 20) return res.status(400).json({ error: 'Maximo de 20 itens no FAQ permitidos' });

  const imagemFinal = imageUrl || capa || '';
  const vagasDisponiveisNumero = Math.max(preco.capacidade - VAGAS_DONO, 0);

  const adminNome = adminUser?.nome || adminUser?.name || adminUser?.email || 'Administrador';
  const adminAvatar = adminUser?.image || adminUser?.avatar || '';

  const novoGrupo = {
    nome, slug: slugify(nome), capa: imagemFinal, imageUrl: imageUrl || imagemFinal, imageKey,
    ...camposPrecoParaGravar(preco), descricao,
    vagasDisponiveis: new Int32(vagasDisponiveisNumero),
    servicoPreAssinado: Boolean(servicoPreAssinado), envioAutomaticoAcesso: Boolean(envioAutomaticoAcesso),
    filaEsperaAtiva: Boolean(filaEsperaAtiva), necessitaAnalise: Boolean(necessitaAnalise),
    observacoesInternas: observacoesInternas || '', subtitulo, acesso, tempoEntrega, confiabilidade,
    categoria, tipoGrupo, status: status || 'ativo', statusDetalhado,
    beneficios: beneficiosParsed, regras: regrasParsed, faq: faqParsed,
    fidelidade: parseFidelidade({ fidelidadePeriodo, fidelidadeRenovacao, fidelidadeObservacoes }),
    linkOficial: (linkOficial || '').trim(),
    createdAt: new Date(), updatedAt: new Date(),
    adminId, adminIdString: String(adminId), adminNome, adminEmail: adminUser?.email || '', adminAvatar,
    admin: { userId: adminId, nome: adminNome, email: adminUser?.email || '', avatar: adminAvatar },
  };

  const slugExistente = await db.collection('grupos').findOne({ slug: novoGrupo.slug });
  if (slugExistente) return res.status(409).json({ error: 'Ja existe um grupo com este nome/slug' });

  const resultado = await db.collection('grupos').insertOne(novoGrupo);

  const fidelidadeAdmin = parseFidelidade({ fidelidadePeriodo, fidelidadeRenovacao, fidelidadeObservacoes });
  const fidelidadeMembro = fidelidadeAdmin?.periodoMeses
    ? {
        periodoMeses: new Int32(fidelidadeAdmin.periodoMeses),
        renovacaoAutomatica: Boolean(fidelidadeAdmin.renovacaoAutomatica),
        observacoes: fidelidadeAdmin.observacoes || '',
        proximaRenovacao: fidelidadeAdmin.proximaRenovacao || null,
      }
    : undefined;

  await db.collection('membrosGrupo').insertOne({
    grupoId: resultado.insertedId, userId: adminId, papel: 'admin', status: 'ativo',
    temCaucao: false, aguardandoEnvioAcesso: false,
    ...(fidelidadeMembro ? { fidelidade: fidelidadeMembro } : {}),
    dataEntrada: new Date(), createdAt: new Date(),
  });

  await logAudit({
    action: 'grupo.created', actorId: String(adminId), actorEmail: session.user.email,
    targetId: String(resultado.insertedId), targetCollection: 'grupos',
    details: { nome: novoGrupo.nome, categoria: novoGrupo.categoria, ...resumoPrecoAuditoria(novoGrupo) },
    ip: req.headers['x-forwarded-for'] || req.socket?.remoteAddress,
  });

  return res.status(201).json({ _id: resultado.insertedId, ...novoGrupo });
}

export default async function handler(req, res) {
  try {
    const client = await clientPromise;
    const db = client.db(process.env.MONGODB_DB);

    if (req.method === 'GET') return await handleList(db, res);
    if (req.method === 'POST') return await handleCreate(req, res, db);

    res.setHeader('Allow', ['GET', 'POST']);
    return res.status(405).end(`Metodo ${req.method} nao permitido`);
  } catch (error) {
    console.error('Erro na API /api/grupos:', error?.errInfo || error);
    if (error?.code === 11000) return res.status(409).json({ error: 'Slug ou chave duplicada no cadastro do grupo' });
    if (error?.code === 121) {
      console.error('Detalhes schema grupos:', JSON.stringify(error?.errInfo, null, 2));
      return res.status(400).json({ error: 'Validacao do documento falhou', details: error.errInfo || null });
    }
    return res.status(500).json({ error: 'Erro interno no servidor' });
  }
}
