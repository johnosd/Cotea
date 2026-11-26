// POST /api/assinaturas/pay — entrada em grupo numa única operação (006-checkout-caucao):
// cobra mensalidade + caução do saldo, cria a participação e a fatura. Idempotente pela
// `chave` gerada na tela. Contrato em sdd/specs/006-checkout-caucao/contracts/api-entrada.md.
//
// A ORDEM das checagens é parte do contrato (inclusive das features 004 e 005). Nenhum
// valor vem do cliente: `versaoResumo` e `saldoVisto` só detectam que o resumo envelheceu.
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]';
import { getDb } from '../../../lib/mongodb';
import { calculateBalances, ensureWallet, getSessionUserId } from '../../../lib/wallet';
import { verificarCadastroFinanceiro } from '../../../lib/cadastro-financeiro-servidor';
import { parseObjectId } from '../../../lib/grupos-utils';
import { getClientIp } from '../../../lib/ratelimit';
import { avaliarEntradaNoGrupo } from '../../../lib/grupo-entrada';
import {
  calcularResumoEntrada, chaveValida, montarResumoParaTela, validarDadosEntrada,
} from '../../../lib/checkout';
import { RecusaEntrada, buscarEntradaPorChave, registrarEntrada } from '../../../lib/checkout-servidor';
import { SaldoInsuficienteError } from '../../../lib/ledger/ledger';

const centavos = (valor) => Math.round(Number(valor) * 100);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Metodo nao permitido' });
  }

  try {
    const session = await getServerSession(req, res, authOptions);
    const userId = getSessionUserId(session);
    if (!session || !userId) {
      return res.status(401).json({ error: 'Nao autenticado' });
    }
    if (!session.user.contaValidada) {
      return res.status(403).json({ error: 'Conta nao verificada. Confirme seu e-mail para assinar grupos.' });
    }

    // 004-cadastro-financeiro (D-03): cadastro financeiro completo antes de qualquer efeito.
    const verificacao = await verificarCadastroFinanceiro(userId);
    if (!verificacao.ok) return res.status(verificacao.http).json(verificacao.body);

    const grupoId = parseObjectId(String(req.body?.grupoId || '').trim());
    if (!grupoId) {
      return res.status(400).json({ error: 'grupoId obrigatorio e invalido' });
    }
    const { chave, vinculo, aceiteRegras, versaoResumo, saldoVisto } = req.body || {};

    const db = await getDb();
    // Repetição da mesma confirmação (FR-016): responde o que já aconteceu.
    const responderRepetida = async () => {
      if (!chaveValida(chave)) return false;
      const anterior = await buscarEntradaPorChave({ db, userId, grupoId, chave });
      if (!anterior) return false;
      res.status(anterior.http).json(anterior.body);
      return true;
    };
    if (await responderRepetida()) return undefined;
    // Antes de qualquer recusa, reconsulta: uma requisição gêmea pode ter acabado de
    // concluir (e por isso "já é membro" ou "o saldo mudou").
    const recusar = async (http, body) => {
      if (await responderRepetida()) return undefined;
      return res.status(http).json(body);
    };

    const grupo = await db.collection('grupos').findOne({ _id: grupoId });
    if (!grupo) return await recusar(404, { error: 'Grupo nao encontrado' });

    const membros = await db.collection('membrosGrupo').find({ grupoId }).toArray();
    const impedimento = avaliarEntradaNoGrupo({ grupo, userId, membros });
    if (impedimento) {
      return await recusar(impedimento.http, { error: impedimento.error, codigo: impedimento.codigo });
    }

    const resumo = calcularResumoEntrada({ grupo, membros });
    if (!resumo.valido) {
      return await recusar(409, { error: 'Preco indisponivel para este grupo', codigo: 'preco_indisponivel' });
    }

    const problema = validarDadosEntrada({ chave, vinculo, aceiteRegras });
    if (problema) return await recusar(400, problema);

    const wallet = await ensureWallet(userId);
    const lerSaldo = async () => (await calculateBalances(wallet._id)).available;
    const saldo = await lerSaldo();
    const desatualizado = async (resumoAtual) => recusar(409, {
      error: 'As condicoes da entrada mudaram. Confira o resumo e confirme de novo.',
      codigo: 'resumo_desatualizado',
      resumo: montarResumoParaTela(resumoAtual, await lerSaldo()),
    });
    const semSaldo = async () => recusar(402, {
      error: 'Saldo insuficiente para a entrada.',
      codigo: 'saldo_insuficiente',
      resumo: montarResumoParaTela(resumo, await lerSaldo()),
    });

    if (versaoResumo !== resumo.versaoResumo || centavos(saldoVisto) !== centavos(saldo)) {
      return await desatualizado(resumo);
    }
    if (centavos(saldo) < centavos(resumo.total)) return await semSaldo();

    let entrada;
    try {
      entrada = await registrarEntrada({
        db, grupo, userId, walletId: wallet._id, resumo,
        dados: { chave, vinculo, aceiteRegras },
        ator: { email: session.user.email, ip: getClientIp(req) },
      });
    } catch (erro) {
      if (erro instanceof RecusaEntrada) {
        return erro.resumoAtual ? await desatualizado(erro.resumoAtual) : await recusar(erro.http, erro.body);
      }
      if (erro instanceof SaldoInsuficienteError) return await semSaldo();
      // Índice único de membrosGrupo: outra entrada do mesmo usuário venceu.
      if (erro?.code === 11000) {
        return await recusar(409, { error: 'Voce ja participa deste grupo', codigo: 'ja_membro' });
      }
      throw erro;
    }

    if (!entrada.criada) {
      // A operação desta chave já existia: nada foi cobrado agora.
      return await recusar(409, {
        error: 'Esta confirmacao ja foi usada. Inicie um novo pagamento.',
        codigo: 'confirmacao_ja_utilizada',
      });
    }

    return res.status(200).json({
      status: 'paga',
      repetida: false,
      grupoId: String(grupoId),
      invoiceId: entrada.invoiceId,
      participacaoId: entrada.participacaoId,
      total: resumo.total,
      saldoAposDebito: await lerSaldo(),
    });
  } catch (error) {
    console.error('Erro ao registrar entrada no grupo:', error);
    return res.status(500).json({ error: 'Erro interno ao processar a entrada' });
  }
}
