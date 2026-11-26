/**
 * Operações do checkout v2 no banco (feature 006-checkout-caucao): entrada atômica,
 * liquidação de participação e liberação da mensalidade retida.
 * Algoritmos em sdd/specs/006-checkout-caucao/logic/checkout.md.
 *
 * ATENÇÃO (logic §7): este módulo importa o ledger e o banco. Quem roda sem banco
 * (lib/moderacao-servidor.js) deve carregá-lo com `await import(...)`.
 *
 * Dentro das transações: uma operação por vez, sempre com `{ session }`, sem engolir
 * erro do driver (o withTransaction precisa dele para repetir).
 */
import { randomUUID } from 'crypto';
import { ObjectId } from 'mongodb';
import { getClient } from './mongodb';
import { ensureWallet } from './wallet';
import { obterLedger } from './ledger/servidor';
import { SaldoInsuficienteError } from './ledger/ledger';
import { INVOICE_STATUS, createInvoice } from './invoices';
import { logAudit } from './audit';
import { avaliarEntradaNoGrupo } from './grupo-entrada';
import { donoDoGrupo } from './moderacao-servidor';
import { STATUS_GRUPO } from './moderacao';
import {
  calcularResumoEntrada, pernasDaEntrada, pernasDaLiquidacao, planejarLiquidacao,
} from './checkout';

/** Participações tratadas por requisição; o resto fica para a rotina (constitution: lote com limite). */
export const LIMITE_IMEDIATO = 25;
const MAX_TENTATIVAS_LIQUIDACAO = 4;
const STATUS_ENCERRADOS = [STATUS_GRUPO.CANCELADO, STATUS_GRUPO.REJEITADO];
const SITUACOES_RETENCAO_PENDENTE = ['retida', 'a_liberar'];

/** Recusa decidida dentro da transação: aborta tudo e vira a resposta HTTP. */
export class RecusaEntrada extends Error {
  constructor(http, body, resumoAtual = null) {
    super(body.codigo);
    this.name = 'RecusaEntrada';
    this.http = http;
    this.body = body;
    this.resumoAtual = resumoAtual;
  }
}

const formatarReais = (valor) => `R$ ${Number(valor).toFixed(2).replace('.', ',')}`;

/** Depois do commit nada desfaz a operação nem muda a resposta (D-11). */
async function emSeguranca(rotulo, fn) {
  try {
    await fn();
  } catch (erro) {
    console.error(`Checkout: falha em ${rotulo}:`, erro?.message || erro);
  }
}

/** Notificação interna com `_id` determinístico: repetir o evento não duplica. */
async function notificar(db, { id, userId, titulo, mensagem, grupoId, importante = false }) {
  try {
    await db.collection('notificacoesUsuario').insertOne({
      _id: id,
      userId,
      titulo,
      mensagem,
      tipo: 'grupo',
      acao: `/grupos/${grupoId}`,
      lido: false,
      data: new Date(),
      importante,
    });
  } catch (erro) {
    if (erro?.code !== 11000) throw erro;
  }
}

async function idDoDono(db, grupo) {
  const dono = donoDoGrupo(grupo);
  if (dono) return dono;
  const membroDono = await db.collection('membrosGrupo').findOne({ grupoId: grupo._id, papel: 'admin' });
  return membroDono?.userId || null;
}

/**
 * Resposta para uma `chave` já usada por este usuário (logic §5), ou null.
 * @returns {Promise<null | { http: number, body: object }>}
 */
export async function buscarEntradaPorChave({ db, userId, grupoId, chave }) {
  const fatura = await db.collection('invoices').findOne({ userId: String(userId), 'entrada.chave': chave });
  if (!fatura) return null;
  const participacaoId = fatura.entrada?.participacaoId;
  const membro = String(fatura.grupoId) === String(grupoId) && ObjectId.isValid(participacaoId)
    ? await db.collection('membrosGrupo').findOne({ _id: new ObjectId(participacaoId) })
    : null;
  if (!membro) {
    return {
      http: 409,
      body: {
        error: 'Esta confirmacao ja foi usada. Inicie um novo pagamento.',
        codigo: 'confirmacao_ja_utilizada',
      },
    };
  }
  return {
    http: 200,
    body: {
      status: INVOICE_STATUS.PAGA,
      repetida: true,
      grupoId: String(grupoId),
      invoiceId: fatura._id,
      participacaoId,
      total: fatura.amount,
    },
  };
}

/**
 * Entrada em grupo (FR-015): uma operação do ledger com a trava do grupo, a
 * participação e a fatura na MESMA transação.
 *
 * @param {{ db: object, grupo: object, userId: string, walletId: string, resumo: object,
 *           dados: { chave: string, vinculo: string, aceiteRegras: { versao: string } },
 *           ator?: { email?: string|null, ip?: string|null } }} p
 *   `resumo` = calcularResumoEntrada que o usuário confirmou.
 * @returns {Promise<{ criada: boolean, invoiceId?: string, participacaoId?: string }>}
 *   criada: false = a mesma chave já tinha sido processada.
 * @throws {RecusaEntrada|import('./ledger/ledger').SaldoInsuficienteError}
 */
export async function registrarEntrada({ db, grupo, userId, walletId, resumo, dados, ator = {} }) {
  const grupoId = grupo._id;
  const participacaoId = new ObjectId();
  const invoiceId = randomUUID();
  const usuario = new ObjectId(String(userId));
  const ledger = await obterLedger();
  let confirmado = null; // resumo reavaliado sob a trava (vale o da última tentativa)

  const operacao = await ledger.registrarOperacao({
    operacaoId: `entrada_grupo:${userId}:${dados.chave}`,
    source: 'entrada_grupo',
    referenceId: invoiceId,
    descricao: `Entrada no grupo ${grupo.nome || grupoId}`,
    pernas: pernasDaEntrada({ walletId, grupoId, participacaoId, resumo }),
    extra: async ({ sessao, lancamentos }) => {
      const opcoes = { session: sessao };
      const agora = new Date();

      // Trava do grupo (D-02): duas transações que mexem nas participações conflitam
      // aqui, e a perdedora repete já enxergando a vencedora.
      const atual = await db.collection('grupos').findOneAndUpdate(
        { _id: grupoId },
        { $inc: { versaoParticipacao: 1 } },
        { ...opcoes, returnDocument: 'after' }
      );
      if (!atual) {
        throw new RecusaEntrada(409, { error: 'Grupo indisponivel para novas entradas', codigo: 'grupo_indisponivel' });
      }
      const membros = await db.collection('membrosGrupo').find({ grupoId }, opcoes).toArray();
      const impedimento = avaliarEntradaNoGrupo({ grupo: atual, userId, membros });
      if (impedimento) {
        throw new RecusaEntrada(impedimento.http, { error: impedimento.error, codigo: impedimento.codigo });
      }
      confirmado = calcularResumoEntrada({ grupo: atual, membros });
      if (!confirmado.valido) {
        throw new RecusaEntrada(409, { error: 'Preco indisponivel para este grupo', codigo: 'preco_indisponivel' });
      }
      if (confirmado.versaoResumo !== resumo.versaoResumo) {
        throw new RecusaEntrada(
          409,
          { error: 'As condicoes da entrada mudaram. Confira o resumo e confirme de novo.', codigo: 'resumo_desatualizado' },
          confirmado
        );
      }

      if (confirmado.completaGrupo) {
        // Nunca grava `status`: é o estado de moderação (005).
        await db.collection('grupos').updateOne(
          { _id: grupoId },
          { $set: { lotadoEm: agora, statusDetalhado: 'ativo', updatedAt: agora } },
          opcoes
        );
      }

      const aceite = { versao: dados.aceiteRegras.versao, em: agora };
      const { fidelidadeMeses } = confirmado;
      await db.collection('membrosGrupo').insertOne({
        _id: participacaoId,
        grupoId,
        userId: usuario,
        papel: 'membro',
        status: 'ativo',
        aguardandoEnvioAcesso: true,
        dataEntrada: agora,
        createdAt: agora,
        invoiceId,
        mensalidade: confirmado.mensalidade,
        valorPago: confirmado.total,
        pagamentoStatus: INVOICE_STATUS.PAGA,
        pagamentoData: agora,
        vinculo: dados.vinculo,
        aceiteRegras: aceite,
        temCaucao: true,
        caucao: { valor: confirmado.caucao, situacao: 'bloqueada' },
        ...(confirmado.retemMensalidade
          ? { retencao: { valor: (Math.round(confirmado.mensalidade * 100) + Math.round(confirmado.taxa * 100)) / 100, situacao: 'retida' } }
          : {}),
        ...(fidelidadeMeses ? { fidelidade: { periodoMeses: fidelidadeMeses } } : {}),
      }, opcoes);

      await createInvoice({
        _id: invoiceId,
        userId,
        grupoId: String(grupoId),
        amount: confirmado.total,
        composicao: {
          repasseDono: confirmado.repasse,
          taxaCotea: confirmado.taxaCotea,
          caucao: confirmado.caucao,
          taxaPagamento: confirmado.taxa,
        },
        status: INVOICE_STATUS.PAGA,
        description: `Entrada no grupo ${grupo.nome || ''}`.trim(),
        metadata: { grupoNome: grupo.nome || '', origem: 'checkout_v2' },
        walletId,
        ledgerId: lancamentos[0]._id,
        paidAt: agora,
        entrada: {
          chave: dados.chave,
          participacaoId: String(participacaoId),
          mensalidade: confirmado.mensalidade,
          caucao: confirmado.caucao,
          taxaPagamento: confirmado.taxa,
          retida: confirmado.retemMensalidade,
          fidelidadeMeses,
          vinculo: dados.vinculo,
          aceite,
        },
      }, opcoes);
    },
  });

  if (!operacao.criada) return { criada: false };

  if (confirmado.completaGrupo) await aposLotar({ db, grupo });

  const nomeGrupo = grupo.nome || '';
  await emSeguranca('notificacao de entrada', async () => {
    const dono = await idDoDono(db, grupo);
    if (dono) {
      await notificar(db, {
        id: `checkout:entrada:${participacaoId}:dono`,
        userId: dono,
        titulo: 'Novo membro no grupo',
        mensagem: `Um novo membro entrou no grupo ${nomeGrupo}. Confira os detalhes e envie o acesso.`,
        grupoId,
      });
    }
    const prazo = confirmado.retemMensalidade
      ? 'O dono tem ate 5 dias para enviar o acesso depois que o grupo lotar.'
      : 'O dono tem ate 5 dias para enviar o acesso.';
    await notificar(db, {
      id: `checkout:entrada:${participacaoId}:membro`,
      userId: usuario,
      titulo: 'Entrada confirmada',
      mensagem: `Voce entrou no grupo ${nomeGrupo}: ${formatarReais(confirmado.total)} (mensalidade ${formatarReais(confirmado.mensalidade)} + caucao ${formatarReais(confirmado.caucao)}). ${prazo}`,
      grupoId,
      importante: true,
    });
  });
  await emSeguranca('auditoria de entrada', () => logAudit({
    action: 'assinatura.paid',
    actorId: String(userId),
    actorEmail: ator.email,
    targetId: invoiceId,
    targetCollection: 'invoices',
    details: {
      grupoId: String(grupoId),
      grupoNome: nomeGrupo,
      participacaoId: String(participacaoId),
      amount: confirmado.total,
      caucao: confirmado.caucao,
      retida: confirmado.retemMensalidade,
      ledgerId: String(operacao.lancamentos[0]._id),
    },
    ip: ator.ip,
  }));

  return { criada: true, invoiceId, participacaoId: String(participacaoId) };
}

/** A participação (ou o grupo) mudou entre o plano e a transação: refazer o plano. */
class PlanoDesatualizado extends Error {}

const NADA_DEVOLVIDO = Object.freeze({ caucao: 0, mensalidade: 0, total: 0 });

const mesmoPlano = (a, b) => ['caucao', 'retido', 'mensalidade', 'total', 'liberada'].every((k) => a[k] === b[k]);

/** `encerramento` na fatura de entrada: gravado uma vez, histórico da participação (FR-012). */
async function encerrarFatura(db, membro, { motivo, porId, devolvido, em }, opcoes) {
  if (!membro.invoiceId) return;
  await db.collection('invoices').updateOne(
    { _id: membro.invoiceId, encerramento: { $exists: false } },
    {
      $set: {
        encerramento: {
          em,
          motivo,
          porId: porId ? String(porId) : null,
          caucaoDevolvida: devolvido.caucao,
          mensalidadeDevolvida: devolvido.mensalidade,
        },
        updatedAt: em,
      },
    },
    opcoes
  );
}

/**
 * Remove quem não tem dinheiro a receber. Em transação com a trava do grupo: sem ela,
 * uma entrada em curso poderia contar como presente quem acabou de sair.
 */
async function removerSemMovimento(db, membro, { motivo, porId }) {
  const client = await getClient();
  const session = client.startSession();
  try {
    await session.withTransaction(async () => {
      await db.collection('grupos').updateOne(
        { _id: membro.grupoId },
        { $inc: { versaoParticipacao: 1 } },
        { session }
      );
      await db.collection('membrosGrupo').deleteOne({ _id: membro._id }, { session });
      await encerrarFatura(db, membro, { motivo, porId, devolvido: NADA_DEVOLVIDO, em: new Date() }, { session });
    });
  } finally {
    await session.endSession();
  }
}

/**
 * Liquida UMA participação (logic §6). Um só `operacaoId` por participação, usado por
 * todos os caminhos (saída, cancelamento, exclusão, rotina): devolve exatamente uma vez.
 * `remover: true` apaga o documento do membro; senão ele fica, marcado como devolvido.
 *
 * @returns {Promise<{ encontrada: boolean, devolvido: { caucao: number, mensalidade: number, total: number } }>}
 */
export async function liquidarParticipacao({ db, membroId, motivo, porId = null, remover = false }) {
  const membros = db.collection('membrosGrupo');

  for (let tentativa = 0; tentativa < MAX_TENTATIVAS_LIQUIDACAO; tentativa += 1) {
    const membro = await membros.findOne({ _id: membroId });
    if (!membro) return { encontrada: false, devolvido: { ...NADA_DEVOLVIDO } };
    const grupo = await db.collection('grupos').findOne({ _id: membro.grupoId });
    const plano = planejarLiquidacao({ membro, grupo });

    if (!plano.temMovimento) {
      if (remover) await removerSemMovimento(db, membro, { motivo, porId });
      return { encontrada: true, devolvido: { ...NADA_DEVOLVIDO } };
    }

    const devolvido = { caucao: plano.caucao, mensalidade: plano.mensalidade, total: plano.total };
    const wallet = await ensureWallet(String(membro.userId));
    const ledger = await obterLedger();
    let operacao;
    try {
      operacao = await ledger.registrarOperacao({
        operacaoId: `liquidacao_participacao:${membroId}`,
        source: 'liquidacao_participacao',
        referenceId: String(membroId),
        descricao: `Devolucao de participacao no grupo ${grupo?.nome || membro.grupoId}`,
        pernas: pernasDaLiquidacao({
          walletId: wallet._id, grupoId: membro.grupoId, participacaoId: membroId, plano,
        }),
        extra: async ({ sessao }) => {
          const opcoes = { session: sessao };
          const agora = new Date();
          const grupoAtual = await db.collection('grupos').findOneAndUpdate(
            { _id: membro.grupoId },
            { $inc: { versaoParticipacao: 1 } },
            { ...opcoes, returnDocument: 'after' }
          );
          const atual = await membros.findOne({ _id: membroId }, opcoes);
          if (!atual || !mesmoPlano(planejarLiquidacao({ membro: atual, grupo: grupoAtual }), plano)) {
            throw new PlanoDesatualizado();
          }
          if (remover) {
            await membros.deleteOne({ _id: membroId }, opcoes);
          } else {
            await membros.updateOne({ _id: membroId }, {
              $set: {
                temCaucao: false,
                ...(plano.caucao > 0 ? { 'caucao.situacao': 'devolvida', 'caucao.devolvidaEm': agora } : {}),
                ...(plano.retido > 0
                  ? { 'retencao.situacao': plano.liberada ? 'liberada' : 'devolvida', 'retencao.em': agora }
                  : {}),
              },
            }, opcoes);
          }
          await encerrarFatura(db, atual, { motivo, porId, devolvido, em: agora }, opcoes);
        },
      });
    } catch (erro) {
      // Saldo insuficiente aqui = a retenção foi liberada ao mesmo tempo: refazer o plano.
      if (erro instanceof PlanoDesatualizado || erro instanceof SaldoInsuficienteError) continue;
      throw erro;
    }
    // Operação já existente: o plano da próxima volta não terá movimento.
    if (!operacao.criada) continue;

    if (devolvido.total > 0) {
      await emSeguranca('notificacao de devolucao', () => notificar(db, {
        id: `checkout:devolucao:${membroId}`,
        userId: membro.userId,
        titulo: 'Valor devolvido ao seu saldo',
        mensagem: `${formatarReais(devolvido.total)} voltou para o seu saldo do grupo ${grupo?.nome || ''} (caucao ${formatarReais(devolvido.caucao)}${devolvido.mensalidade ? ` + mensalidade ${formatarReais(devolvido.mensalidade)}` : ''}).`,
        grupoId: membro.grupoId,
        importante: true,
      }));
    }
    await emSeguranca('auditoria de devolucao', () => logAudit({
      action: 'caucao.devolvida',
      actorId: porId || 'sistema',
      targetId: membro.invoiceId || String(membroId),
      targetCollection: membro.invoiceId ? 'invoices' : 'membrosGrupo',
      details: {
        grupoId: String(membro.grupoId),
        participacaoId: String(membroId),
        caucao: devolvido.caucao,
        mensalidade: devolvido.mensalidade,
        mensalidadeLiberada: plano.liberada ? plano.retido : 0,
        motivo,
        ledgerId: String(operacao.lancamentos[0]?._id),
      },
    }));
    return { encontrada: true, devolvido };
  }

  throw new Error(`Liquidacao da participacao ${membroId} nao estabilizou`);
}

/** Saída de um membro: liquida e remove a participação (logic §6). */
export async function encerrarParticipacao({ db, membroId, motivo, porId = null, remover = true }) {
  // Lido antes: depois da liquidacao o documento pode nao existir mais.
  const membro = await db.collection('membrosGrupo').findOne({ _id: membroId });
  const resultado = await liquidarParticipacao({ db, membroId, motivo, porId, remover });
  if (resultado.encontrada && remover) {
    await emSeguranca('auditoria de saida', () => logAudit({
      action: 'grupo.saida',
      actorId: porId || 'sistema',
      targetId: String(membroId),
      targetCollection: 'membrosGrupo',
      details: {
        grupoId: String(membro?.grupoId || ''),
        userId: String(membro?.userId || ''),
        motivo,
        devolvido: resultado.devolvido,
      },
    }));
  }
  return resultado;
}

/**
 * Liquida as participações com caução de um grupo encerrado, cancelado ou excluído
 * (logic §7). Uma falha não impede as outras: a rotina completa o que sobrar.
 */
export async function liquidarParticipacoesDoGrupo({
  db, grupoId, motivo, porId = null, remover = false, limite = LIMITE_IMEDIATO,
}) {
  const pendentes = await db.collection('membrosGrupo')
    .find({ grupoId, 'caucao.situacao': 'bloqueada' })
    .limit(limite)
    .toArray();
  let falhas = 0;
  for (const membro of pendentes) {
    try {
      await liquidarParticipacao({ db, membroId: membro._id, motivo, porId, remover });
    } catch (erro) {
      falhas += 1;
      console.error(`Checkout: falha ao liquidar participacao ${membro._id}:`, erro?.message || erro);
    }
  }
  return { total: pendentes.length, falhas };
}

/**
 * Consome a mensalidade retida de UMA participação que já tem direito à liberação (grupo
 * lotado ou acesso enviado). Grupo encerrado ou excluído é assunto da liquidação.
 * @returns {Promise<boolean>} true se este chamador fez o lançamento
 */
export async function liberarParticipacao({ db, membroId }) {
  const membros = db.collection('membrosGrupo');
  const membro = await membros.findOne({ _id: membroId });
  if (!membro) return false;
  const grupo = await db.collection('grupos').findOne({ _id: membro.grupoId });
  if (!grupo || STATUS_ENCERRADOS.includes(grupo.status)) return false;
  const plano = planejarLiquidacao({ membro, grupo });
  if (!(plano.retido > 0 && plano.liberada)) return false;

  const wallet = await ensureWallet(String(membro.userId));
  const ledger = await obterLedger();
  let operacao;
  try {
    operacao = await ledger.registrarOperacao({
      operacaoId: `liberacao_retida:${membroId}`,
      source: 'liberacao_retida',
      referenceId: String(membroId),
      descricao: `Mensalidade liberada no grupo ${grupo.nome || grupo._id}`,
      pernas: pernasDaLiquidacao({
        walletId: wallet._id, grupoId: membro.grupoId, participacaoId: membroId,
        plano: { caucao: 0, retido: plano.retido, total: 0 },
      }),
      extra: async ({ sessao }) => {
        // Escrever o próprio documento faz a saída concorrente conflitar com esta transação.
        const r = await membros.updateOne(
          { _id: membroId, 'retencao.situacao': membro.retencao.situacao },
          { $set: { 'retencao.situacao': 'liberada', 'retencao.em': new Date() } },
          { session: sessao }
        );
        if (r.matchedCount === 0) throw new PlanoDesatualizado();
      },
    });
  } catch (erro) {
    // A saída chegou primeiro (liquidou a retenção): nada a fazer aqui.
    if (erro instanceof PlanoDesatualizado || erro instanceof SaldoInsuficienteError) return false;
    throw erro;
  }
  if (!operacao.criada) return false;

  await emSeguranca('auditoria de liberacao', () => logAudit({
    action: 'mensalidade.liberada',
    actorId: 'sistema',
    targetId: membro.invoiceId || String(membroId),
    targetCollection: membro.invoiceId ? 'invoices' : 'membrosGrupo',
    details: { grupoId: String(membro.grupoId), participacaoId: String(membroId), valor: plano.retido },
  }));
  return true;
}

/**
 * Libera as retenções de um grupo que já têm direito (logic §8). Uma falha não impede as
 * outras: a rotina completa o que sobrar.
 */
export async function liberarRetencoes({ db, grupoId, limite = LIMITE_IMEDIATO }) {
  const grupo = await db.collection('grupos').findOne({ _id: grupoId });
  if (!grupo) return { liberadas: 0, falhas: 0 };
  const pendentes = await db.collection('membrosGrupo')
    .find({ grupoId, 'retencao.situacao': { $in: SITUACOES_RETENCAO_PENDENTE } })
    .toArray();
  const liberaveis = pendentes
    .filter((membro) => planejarLiquidacao({ membro, grupo }).liberada)
    .slice(0, limite);

  let liberadas = 0;
  let falhas = 0;
  for (const membro of liberaveis) {
    try {
      if (await liberarParticipacao({ db, membroId: membro._id })) liberadas += 1;
    } catch (erro) {
      falhas += 1;
      console.error(`Checkout: falha ao liberar retencao ${membro._id}:`, erro?.message || erro);
    }
  }
  return { liberadas, falhas };
}

/**
 * Efeitos de um grupo `apos_completar` que acabou de lotar (por entrada ou por redução de
 * capacidade): libera as mensalidades retidas e avisa dono e membros (FR-020, FR-026).
 * Chamar depois do commit que gravou `lotadoEm`.
 */
export async function aposLotar({ db, grupo }) {
  await emSeguranca('liberacao das retencoes', () => liberarRetencoes({ db, grupoId: grupo._id }));
  await emSeguranca('notificacao de grupo lotado', async () => {
    const nome = grupo.nome || '';
    const dono = await idDoDono(db, grupo);
    if (dono) {
      await notificar(db, {
        id: `checkout:lotado:${grupo._id}:${dono}`,
        userId: dono,
        titulo: 'Grupo formado',
        mensagem: `O grupo ${nome} atingiu a capacidade e esta pronto para liberar acesso aos membros.`,
        grupoId: grupo._id,
        importante: true,
      });
    }
    const membros = await db.collection('membrosGrupo').find({ grupoId: grupo._id }).toArray();
    for (const membro of membros) {
      if (membro.papel === 'admin' || membro.status === 'banido' || !membro.userId) continue;
      if (dono && String(membro.userId) === String(dono)) continue;
      await notificar(db, {
        id: `checkout:lotado:${grupo._id}:${membro.userId}`,
        userId: membro.userId,
        titulo: 'Grupo formado',
        mensagem: `O grupo ${nome} lotou. O dono tem ate 5 dias para enviar o acesso.`,
        grupoId: grupo._id,
        importante: true,
      });
    }
  });
}
