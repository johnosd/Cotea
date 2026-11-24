// Executor de rotinas agendadas (feature 001-rotinas-agendadas).
// PURO em relação ao banco: recebe o repositório por injeção (`repo`), para
// rodar com Mongo em produção (lib/rotinas/repositorio-mongo.js) e com o fake
// em memória nos testes (tests/helpers/repositorio-rotinas-memoria.js).
// Regras: sdd/specs/001-rotinas-agendadas/logic/executor.md

export const MAX_TENTATIVAS = 5;
export const LEASE_PADRAO_MS = 10 * 60 * 1000;
export const LIMITE_PADRAO = 500;
const ERRO_MAX = 500;

export const SITUACAO = Object.freeze({
  PROCESSANDO: 'processando',
  CONCLUIDO: 'concluido',
  IGNORADO: 'ignorado',
  FALHA: 'falha',
  FALHA_DEFINITIVA: 'falha_definitiva',
});

const mensagemDeErro = (erro) => String(erro?.message ?? erro).slice(0, ERRO_MAX);

function normalizarOpcoes(opcoes = {}) {
  if (!opcoes.repo) throw new TypeError('repo obrigatorio para executar rotinas');
  return {
    repo: opcoes.repo,
    agora: opcoes.agora instanceof Date ? opcoes.agora : new Date(),
    origem: opcoes.origem === 'manual' ? 'manual' : 'automatica',
    autorId: opcoes.autorId ?? null,
    alertar: typeof opcoes.alertar === 'function' ? opcoes.alertar : async () => {},
    contexto: opcoes.contexto ?? {},
    limite: Number.isInteger(opcoes.limite) && opcoes.limite > 0 ? opcoes.limite : LIMITE_PADRAO,
    leaseMs: Number.isFinite(opcoes.leaseMs) && opcoes.leaseMs > 0 ? opcoes.leaseMs : LEASE_PADRAO_MS,
    maxTentativas:
      Number.isInteger(opcoes.maxTentativas) && opcoes.maxTentativas > 0 ? opcoes.maxTentativas : MAX_TENTATIVAS,
    // Orçamento de tempo da passada (T035): ao estourar, não reivindica itens novos;
    // o restante fica para a próxima execução. null = sem limite de tempo.
    prazoMs: Number.isFinite(opcoes.prazoMs) && opcoes.prazoMs > 0 ? opcoes.prazoMs : null,
    relogio: typeof opcoes.relogio === 'function' ? opcoes.relogio : Date.now,
  };
}

/**
 * Reivindica e processa um item, atualizando os contadores.
 * @returns {Promise<string>} situação final do item nesta passada, ou 'pulado'.
 */
async function processarUmItem(rotina, item, cfg, contadores) {
  const { repo, agora, contexto, leaseMs, maxTentativas, alertar } = cfg;
  const rotinaId = rotina.id;
  const chave = String(item.chave);

  const claim = await repo.reivindicarItem({ rotinaId, chave, dados: item.dados ?? {}, agora, leaseMs });
  if (!claim.reivindicado) {
    contadores.pulados += 1;
    return 'pulado';
  }

  try {
    const retorno = await rotina.processarItem({ chave, dados: claim.registro?.dados ?? {}, agora, contexto });
    const situacao = retorno === SITUACAO.IGNORADO ? SITUACAO.IGNORADO : SITUACAO.CONCLUIDO;
    await repo.concluirItem({ rotinaId, chave, situacao, agora });
    if (situacao === SITUACAO.IGNORADO) contadores.ignorados += 1;
    else contadores.processados += 1;
    return situacao;
  } catch (erro) {
    const msg = mensagemDeErro(erro);
    const { tentativas, definitiva } = await repo.registrarFalhaItem({ rotinaId, chave, erro: msg, agora, maxTentativas });
    contadores.falhas += 1;
    if (definitiva) {
      try {
        await alertar({ rotinaId, chave, erro: msg, tentativas });
      } catch (erroAlerta) {
        console.error(`[rotinas] falha ao alertar sobre ${rotinaId}/${chave}:`, mensagemDeErro(erroAlerta));
      }
      return SITUACAO.FALHA_DEFINITIVA;
    }
    return SITUACAO.FALHA;
  }
}

const resultadoDe = (c) => {
  if (c.falhas === 0) return 'sucesso';
  return c.processados + c.ignorados > 0 ? 'parcial' : 'erro';
};

async function executarItens(rotina, itensFn, cfg) {
  const inicioRelogio = cfg.relogio();
  const execucaoId = await cfg.repo.iniciarExecucao({
    rotinaId: rotina.id,
    origem: cfg.origem,
    autorId: cfg.autorId,
    inicio: cfg.agora,
  });
  const contadores = { processados: 0, ignorados: 0, falhas: 0, pulados: 0 };
  const situacoes = [];

  let itens;
  try {
    itens = await itensFn();
  } catch (erro) {
    const erroMsg = mensagemDeErro(erro);
    await cfg.repo.finalizarExecucao(execucaoId, { fim: new Date(), resultado: 'erro', ...contadores, erro: erroMsg });
    return { execucaoId, resultado: 'erro', ...contadores, erro: erroMsg, situacoes };
  }

  // Sequencial de propósito (D-05): a concorrência que importa é entre execuções.
  const lista = (Array.isArray(itens) ? itens : []).slice(0, cfg.limite);
  let restantes = 0;
  for (let i = 0; i < lista.length; i += 1) {
    // O 1º item sempre é tentado, para a rotina nunca ficar sem progresso por causa do orçamento.
    if (cfg.prazoMs && i > 0 && cfg.relogio() - inicioRelogio >= cfg.prazoMs) {
      restantes = lista.length - i;
      break;
    }
    situacoes.push(await processarUmItem(rotina, lista[i], cfg, contadores));
  }

  const resultado = resultadoDe(contadores);
  await cfg.repo.finalizarExecucao(execucaoId, { fim: new Date(), resultado, ...contadores });
  // `cortada`/`restantes` só aparecem quando o orçamento de tempo interrompeu a passada.
  return { execucaoId, resultado, ...contadores, ...(restantes > 0 ? { cortada: true, restantes } : {}), situacoes };
}

/**
 * Executa uma passada da rotina.
 * @returns {Promise<{ execucaoId: string, resultado: 'sucesso'|'parcial'|'erro',
 *   processados: number, ignorados: number, falhas: number, pulados: number, erro?: string,
 *   cortada?: true, restantes?: number }>}
 */
export async function executarRotina(rotina, opcoes) {
  const cfg = normalizarOpcoes(opcoes);
  const { situacoes, ...resumo } = await executarItens(
    rotina,
    () => rotina.buscarVencidos({ agora: cfg.agora, contexto: cfg.contexto }),
    cfg
  );
  return resumo;
}

/**
 * Reexecução manual de um item (FR-018): reabre o item (zera tentativas) e o
 * processa com os `dados` gravados, respeitando a idempotência.
 * @returns {Promise<{ chave: string, situacao: string, reprocessado: boolean, execucaoId?: string }>}
 */
export async function reexecutarItem(rotina, chave, opcoes) {
  const cfg = normalizarOpcoes({ origem: 'manual', ...opcoes });
  const rotinaId = rotina.id;
  const registro = await cfg.repo.obterItem({ rotinaId, chave });
  if (!registro) {
    const erro = new Error('Item nao encontrado');
    erro.code = 'ITEM_NAO_ENCONTRADO';
    throw erro;
  }
  if (registro.situacao === SITUACAO.CONCLUIDO || registro.situacao === SITUACAO.IGNORADO) {
    return { chave, situacao: registro.situacao, reprocessado: false };
  }

  await cfg.repo.reabrirItem({ rotinaId, chave, agora: cfg.agora });
  const { execucaoId, situacoes } = await executarItens(rotina, async () => [{ chave, dados: registro.dados ?? {} }], cfg);
  const situacao = situacoes[0];
  if (situacao === 'pulado') {
    const atual = await cfg.repo.obterItem({ rotinaId, chave });
    return { chave, situacao: atual?.situacao ?? SITUACAO.PROCESSANDO, reprocessado: false, execucaoId };
  }
  return { chave, situacao, reprocessado: true, execucaoId };
}
