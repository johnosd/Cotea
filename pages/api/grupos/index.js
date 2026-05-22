import clientPromise from '../../../lib/mongodb';
import { Int32, Double } from 'mongodb';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]';
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

export default async function handler(req, res) {
  let adminId = null;
  let adminUser = null;
  try {
    const client = await clientPromise;
    const db = client.db(process.env.MONGODB_DB);

    if (req.method === 'GET') {
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
                  $filter: {
                    input: '$membros',
                    as: 'm',
                    cond: { $ne: ['$$m.status', 'banido'] },
                  },
                },
              },
              participantes: {
                $map: {
                  input: {
                    $filter: {
                      input: '$membros',
                      as: 'm',
                      cond: { $ne: ['$$m.status', 'banido'] },
                    },
                  },
                  as: 'm',
                  in: {
                    userId: { $toString: '$$m.userId' },
                    papel: '$$m.papel',
                    status: '$$m.status',
                  },
                },
              },
            },
          },
          { $project: { membros: 0 } },
        ])
        .toArray();
      return res.status(200).json(grupos);
    }

    if (req.method !== 'POST') {
      res.setHeader('Allow', ['GET', 'POST']);
      return res.status(405).end(`Metodo ${req.method} nao permitido`);
    }

    const {
      nome,
      capa,
      imageUrl = '',
      imageKey = '',
      valorTotal,
      valorPorVaga,
      descricao = '',
      subtitulo = '',
      acesso = 'imediato',
      tempoEntrega = '',
      confiabilidade = '',
      capacidadeTotal,
      categoria = '',
      vagasReservadasAdmin = 0,
      vagasDisponiveis,
      servicoPreAssinado = false,
      envioAutomaticoAcesso = false,
      filaEsperaAtiva = false,
      necessitaAnalise = false,
      observacoesInternas = '',
      status = 'ativo',
      statusDetalhado = 'em_formacao',
      tipoGrupo = 'publico',
      beneficios,
      fidelidadePeriodo,
      fidelidadeRenovacao,
      fidelidadeObservacoes,
      regras,
      faq,
      linkOficial = '',
    } = req.body || {};

    const session = await getServerSession(req, res, authOptions);
    if (!session || !session.user?.id) {
      return res.status(401).json({ error: 'Nao autenticado' });
    }
    if (!session.user.contaValidada) {
      return res.status(403).json({ error: 'Conta nao verificada. Confirme seu e-mail para criar grupos.' });
    }

    adminId = parseObjectId(getSessionUserId(session));
    if (!adminId) {
      return res.status(403).json({ error: 'Usuario da sessao invalido' });
    }

    adminUser = await db.collection('users').findOne({ _id: adminId });
    if (!adminUser) {
      return res.status(403).json({ error: 'Administrador nao encontrado' });
    }

    const valorTotalNumero = normalizarPreco(valorTotal);
    const valorPorVagaNumero = normalizarPreco(valorPorVaga);
    const capacidadeNumero = Math.trunc(parseNumero(capacidadeTotal));
    const vagasReservadasNumero = Math.trunc(parseNumero(vagasReservadasAdmin));

    if (!nome) {
      return res.status(400).json({ error: 'Nome e obrigatorio' });
    }
    if (!Number.isFinite(valorTotalNumero) || !Number.isFinite(valorPorVagaNumero)) {
      return res.status(400).json({ error: 'Valor total e valor por vaga sao obrigatorios' });
    }
    if (!Number.isFinite(capacidadeNumero) || capacidadeNumero <= 0) {
      return res.status(400).json({ error: 'Capacidade total deve ser maior que zero' });
    }
    if (!Number.isFinite(vagasReservadasNumero) || vagasReservadasNumero < 0) {
      return res.status(400).json({ error: 'Vagas reservadas do admin deve ser zero ou mais' });
    }
    if (vagasReservadasNumero > capacidadeNumero) {
      return res.status(400).json({ error: 'Vagas reservadas nao podem exceder a capacidade' });
    }
    if (!categoria || !CATEGORIAS_PERMITIDAS.includes(categoria)) {
      return res.status(400).json({ error: 'Categoria invalida' });
    }

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

    const adminNome = adminUser?.nome || adminUser?.name || adminUser?.email || 'Administrador';
    const adminAvatar = adminUser?.image || adminUser?.avatar || '';

    const novoGrupo = {
      nome,
      slug: slugify(nome),
      capa: imagemFinal,
      imageUrl: imageUrl || imagemFinal,
      imageKey,
      valorTotal: new Double(valorTotalNumero),
      valorPorVaga: new Double(valorPorVagaNumero),
      descricao,
      capacidadeTotal: new Int32(capacidadeNumero),
      vagasReservadasAdmin: new Int32(vagasReservadasNumero),
      vagasDisponiveis: new Int32(vagasDisponiveisNumero),
      servicoPreAssinado: Boolean(servicoPreAssinado),
      envioAutomaticoAcesso: Boolean(envioAutomaticoAcesso),
      filaEsperaAtiva: Boolean(filaEsperaAtiva),
      necessitaAnalise: Boolean(necessitaAnalise),
      observacoesInternas: observacoesInternas || '',
      subtitulo,
      acesso,
      tempoEntrega,
      confiabilidade,
      categoria,
      tipoGrupo,
      status,
      statusDetalhado,
      beneficios: beneficiosParsed,
      fidelidade: parseFidelidade({ fidelidadePeriodo, fidelidadeRenovacao, fidelidadeObservacoes }),
      regras: regrasParsed,
      faq: faqParsed,
      linkOficial: (linkOficial || '').trim(),
      status: status || 'ativo',
      createdAt: new Date(),
      updatedAt: new Date(),
      adminId,
      adminIdString: String(adminId),
      adminNome,
      adminEmail: adminUser?.email || '',
      adminAvatar,
      admin: {
        userId: adminId,
        nome: adminNome,
        email: adminUser?.email || '',
        avatar: adminAvatar,
      },
    };

    // Evita slug duplicado (retorna 409 ao inves de 500)
    const slugExistente = await db.collection('grupos').findOne({ slug: novoGrupo.slug });
    if (slugExistente) {
      return res.status(409).json({ error: 'Ja existe um grupo com este nome/slug' });
    }

    const resultado = await db.collection('grupos').insertOne(novoGrupo);

    // Insere o administrador como membro do grupo
    const fidelidadeAdmin = parseFidelidade({ fidelidadePeriodo, fidelidadeRenovacao, fidelidadeObservacoes });
    const fidelidadeMembro =
      fidelidadeAdmin && fidelidadeAdmin.periodoMeses
        ? {
            periodoMeses: new Int32(fidelidadeAdmin.periodoMeses),
            renovacaoAutomatica: Boolean(fidelidadeAdmin.renovacaoAutomatica),
            observacoes: fidelidadeAdmin.observacoes || '',
            proximaRenovacao: fidelidadeAdmin.proximaRenovacao || null,
          }
        : undefined;

    const membroAdmin = {
      grupoId: resultado.insertedId,
      userId: adminId,
      papel: 'admin',
      status: 'ativo',
      temCaucao: false,
      aguardandoEnvioAcesso: false,
      ...(fidelidadeMembro ? { fidelidade: fidelidadeMembro } : {}),
      dataEntrada: new Date(),
      createdAt: new Date(),
    };
    await db.collection('membrosGrupo').insertOne(membroAdmin);

    await logAudit({
      action: 'grupo.created',
      actorId: String(adminId),
      actorEmail: session.user.email,
      targetId: String(resultado.insertedId),
      targetCollection: 'grupos',
      details: { nome: novoGrupo.nome, categoria: novoGrupo.categoria, valorPorVaga: valorPorVagaNumero },
      ip: req.headers['x-forwarded-for'] || req.socket?.remoteAddress,
    });

    return res.status(201).json({ _id: resultado.insertedId, ...novoGrupo });
  } catch (error) {
    console.error('Erro na API /api/grupos:', error?.errInfo || error);
    if (error?.code === 11000) {
      return res.status(409).json({ error: 'Slug ou chave duplicada no cadastro do grupo' });
    }
    if (error?.code === 121) {
      const detalhes = error?.errInfo || null;
      console.error('Detalhes schema grupos:', JSON.stringify(detalhes, null, 2));
      return res.status(400).json({ error: 'Validacao do documento falhou', details: detalhes });
    }
    return res.status(500).json({ error: 'Erro interno no servidor' });
  }
}
