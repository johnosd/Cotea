// 005-aprovacao-grupos — regras puras de moderação (lib/moderacao.js): tabela de
// transições, texto, visibilidade, status legado, prazo e migração.
import { describe, it, expect } from 'vitest';
import { ObjectId } from 'mongodb';
import {
  ACOES_MODERACAO, CODIGOS_MODERACAO, FILTRO_GRUPOS_PUBLICOS, HISTORICO_MODERACAO_MAX, STATUS_GRUPO,
  adminPodeEditar, donoPodeEditar, grupoEhPublico, moderacaoInicial, planejarMigracaoModeracao,
  planejarTransicao, podeVerGrupo, statusEfetivo, vencimentoAprovacao,
} from '../../lib/moderacao.js';

const agora = new Date('2026-11-30T13:00:00Z');
const admin = { id: 'admin-1' };

const grupo = (status, moderacao = {}) => ({
  _id: new ObjectId(),
  nome: 'G',
  ...(status === undefined ? {} : { status }),
  moderacao: { envio: 1, enviadoEm: new Date('2026-11-27T13:00:00Z'), revisaoPendente: false, historico: [], ...moderacao },
});

const TEXTO = 'Corrija o link oficial';

// [acao, status de origem válido, status de destino, extra de moderacao, precisa de texto]
const TABELA = [
  ['aprovar', 'em_aprovacao', 'ativo', {}, false],
  ['pedir_ajuste', 'em_aprovacao', 'ajustes', {}, true],
  ['rejeitar', 'em_aprovacao', 'rejeitado', {}, true],
  ['aprovar_automatico', 'em_aprovacao', 'ativo', {}, false],
  ['confirmar_revisao', 'ativo', 'ativo', { revisaoPendente: true }, false],
  ['reprovar_revisao', 'ativo', 'cancelado', { revisaoPendente: true }, true],
  ['cancelar', 'ativo', 'cancelado', {}, true],
  ['reenviar', 'ajustes', 'em_aprovacao', {}, false],
  ['desistir', 'em_aprovacao', 'cancelado', {}, false],
  ['desistir', 'ajustes', 'cancelado', {}, false],
  ['encerrar', 'ativo', 'cancelado', {}, false],
];

const TODOS = Object.values(STATUS_GRUPO);

describe('planejarTransicao — tabela de transições (D-05)', () => {
  it.each(TABELA)('%s: %s → %s', (acao, de, para, extra, comTexto) => {
    const g = grupo(de, extra);
    const plano = planejarTransicao({ grupo: g, acao, texto: comTexto ? TEXTO : undefined, ator: admin, agora, envioEsperado: 1 });
    expect(plano.ok).toBe(true);
    expect(plano.filtro).toMatchObject({ _id: g._id, status: de });
    expect(plano.update.$set.status).toBe(para);
    expect(plano.update.$push['moderacao.historico'].$each[0]).toMatchObject({ acao, de, para });
    expect(plano.update.$push['moderacao.historico'].$slice).toBe(-HISTORICO_MODERACAO_MAX);
  });

  const origemValida = new Map();
  for (const [acao, de] of TABELA) origemValida.set(acao, [...(origemValida.get(acao) || []), de]);

  for (const [acao, validos] of origemValida) {
    const invalidos = TODOS.filter((s) => !validos.includes(s));
    it.each(invalidos)(`${acao} a partir de %s → 409 moderacao_conflito`, (de) => {
      const plano = planejarTransicao({ grupo: grupo(de, { revisaoPendente: true }), acao, texto: TEXTO, ator: admin, agora, envioEsperado: 1 });
      expect(plano).toMatchObject({ ok: false, http: 409, codigo: CODIGOS_MODERACAO.CONFLITO });
    });
  }

  it('confirmar/reprovar revisão sem revisão pendente → conflito', () => {
    for (const acao of ['confirmar_revisao', 'reprovar_revisao']) {
      const plano = planejarTransicao({ grupo: grupo('ativo'), acao, texto: TEXTO, ator: admin, agora });
      expect(plano.codigo).toBe(CODIGOS_MODERACAO.CONFLITO);
    }
  });

  it('aprovar_automatico exige o envio esperado e filtra por ele', () => {
    expect(planejarTransicao({ grupo: grupo('em_aprovacao', { envio: 2 }), acao: 'aprovar_automatico', ator: { automatico: true }, agora, envioEsperado: 1 }).codigo)
      .toBe(CODIGOS_MODERACAO.CONFLITO);
    const plano = planejarTransicao({ grupo: grupo('em_aprovacao', { envio: 2 }), acao: 'aprovar_automatico', ator: { automatico: true }, agora, envioEsperado: 2 });
    expect(plano.filtro['moderacao.envio']).toBe(2);
    expect(plano.update.$set['moderacao.revisaoPendente']).toBe(true);
    expect(plano.update.$set['moderacao.aprovacao']).toMatchObject({ tipo: 'automatica', porId: null });
    expect(plano.evento).toMatchObject({ automatico: true, porId: null });
  });

  it('reenviar incrementa o envio e reinicia enviadoEm', () => {
    const plano = planejarTransicao({ grupo: grupo('ajustes', { envio: 3 }), acao: 'reenviar', ator: { id: 'dono' }, agora });
    expect(plano.update.$set['moderacao.envio']).toBe(4);
    expect(plano.update.$set['moderacao.enviadoEm']).toBe(agora);
    expect(plano.evento.envio).toBe(4);
    expect(plano.notificar).toBeNull();
  });

  it('cancelamentos notificam dono e membros; decisões da fila só o dono; revisão confirmada ninguém', () => {
    const p = (acao, g) => planejarTransicao({ grupo: g, acao, texto: TEXTO, ator: admin, agora }).notificar;
    expect(p('cancelar', grupo('ativo'))).toBe('dono_e_membros');
    expect(p('reprovar_revisao', grupo('ativo', { revisaoPendente: true }))).toBe('dono_e_membros');
    expect(p('aprovar', grupo('em_aprovacao'))).toBe('dono');
    expect(p('confirmar_revisao', grupo('ativo', { revisaoPendente: true }))).toBeNull();
    expect(p('desistir', grupo('ajustes'))).toBeNull();
  });

  it('encerrar pelo dono (R-008): motivo opcional, origem dono, notifica só os membros', () => {
    const sem = planejarTransicao({ grupo: grupo('ativo'), acao: 'encerrar', ator: { id: 'dono' }, agora });
    expect(sem.ok).toBe(true);
    expect(sem.notificar).toBe('membros');
    expect(sem.update.$set['moderacao.cancelamento']).toMatchObject({ origem: 'dono', motivo: null, porId: 'dono' });
    const com = planejarTransicao({ grupo: grupo('ativo'), acao: 'encerrar', texto: ' fim da assinatura ', ator: { id: 'dono' }, agora });
    expect(com.update.$set['moderacao.cancelamento'].motivo).toBe('fim da assinatura');
    expect(planejarTransicao({ grupo: grupo('ativo'), acao: 'encerrar', texto: 'a'.repeat(1001), agora }).codigo).toBe('texto_longo');
  });

  it('cancelamento pelo Cotea grava origem cotea e motivo', () => {
    const plano = planejarTransicao({ grupo: grupo('ativo'), acao: 'cancelar', texto: `  ${TEXTO}  `, ator: admin, agora });
    expect(plano.update.$set['moderacao.cancelamento']).toMatchObject({ origem: 'cotea', motivo: TEXTO, porId: 'admin-1' });
  });

  it('grupo legado sem status: filtro por $exists false; sem moderacao grava o subdocumento inteiro', () => {
    const legado = { _id: new ObjectId(), nome: 'L', moderacao: null };
    const plano = planejarTransicao({ grupo: legado, acao: 'cancelar', texto: TEXTO, ator: admin, agora });
    expect(plano.filtro.status).toEqual({ $exists: false });
    expect(plano.update.$push).toBeUndefined();
    expect(plano.update.$set.moderacao).toMatchObject({ cancelamento: { origem: 'cotea' }, historico: [{ acao: 'cancelar' }] });
  });
});

describe('planejarTransicao — validação (ordem das checagens)', () => {
  it('ação desconhecida → 400 acao_invalida', () => {
    expect(planejarTransicao({ grupo: grupo('em_aprovacao'), acao: 'suspender', agora })).toMatchObject({ http: 400, codigo: 'acao_invalida' });
  });

  it.each([undefined, '', '   ', '\n\t'])('texto %j em ação que exige → 400 texto_obrigatorio', (texto) => {
    for (const acao of ['pedir_ajuste', 'rejeitar', 'cancelar']) {
      expect(planejarTransicao({ grupo: grupo('em_aprovacao'), acao, texto, agora }).codigo).toBe('texto_obrigatorio');
    }
  });

  it('1000 caracteres aceita; 1001 → texto_longo', () => {
    expect(planejarTransicao({ grupo: grupo('em_aprovacao'), acao: 'rejeitar', texto: 'a'.repeat(1000), ator: admin, agora }).ok).toBe(true);
    expect(planejarTransicao({ grupo: grupo('em_aprovacao'), acao: 'rejeitar', texto: 'a'.repeat(1001), ator: admin, agora }).codigo).toBe('texto_longo');
  });

  it('texto vazio é recusado antes do estado (mesmo com estado errado)', () => {
    expect(planejarTransicao({ grupo: grupo('cancelado'), acao: 'rejeitar', texto: ' ', agora }).codigo).toBe('texto_obrigatorio');
  });
});

describe('visibilidade, status legado e edição', () => {
  it('statusEfetivo: ausente = ativo', () => {
    expect(statusEfetivo({})).toBe('ativo');
    expect(statusEfetivo({ status: 'inativo' })).toBe('inativo');
    expect(grupoEhPublico({})).toBe(true);
    expect(grupoEhPublico({ status: 'inativo' })).toBe(false);
  });

  it('podeVerGrupo', () => {
    expect(podeVerGrupo({ grupo: { status: 'ativo' } })).toBe(true);
    expect(podeVerGrupo({ grupo: { status: 'em_aprovacao' } })).toBe(false);
    expect(podeVerGrupo({ grupo: { status: 'em_aprovacao' }, ehDono: true })).toBe(true);
    expect(podeVerGrupo({ grupo: { status: 'cancelado' }, ehMembroAtual: true })).toBe(true);
    expect(podeVerGrupo({ grupo: { status: 'rejeitado' }, ehStaff: true })).toBe(true);
    expect(podeVerGrupo({ grupo: null, ehStaff: true })).toBe(false);
  });

  it('donoPodeEditar / adminPodeEditar', () => {
    expect(TODOS.filter((s) => donoPodeEditar({ status: s }))).toEqual(['ajustes', 'ativo']);
    expect(TODOS.filter((s) => adminPodeEditar({ status: s }))).toEqual(['em_aprovacao', 'ajustes', 'ativo']);
    expect(donoPodeEditar({})).toBe(true);
  });

  it('FILTRO_GRUPOS_PUBLICOS inclui ativo e ausente', () => {
    expect(FILTRO_GRUPOS_PUBLICOS).toEqual({ $or: [{ status: 'ativo' }, { status: { $exists: false } }] });
  });
});

describe('moderacaoInicial e vencimentoAprovacao', () => {
  it('moderacaoInicial: envio 1, enviadoEm, histórico enviado', () => {
    const m = moderacaoInicial({ agora, ator: { id: 'dono' } });
    expect(m).toMatchObject({ envio: 1, enviadoEm: agora, revisaoPendente: false, aprovacao: null });
    expect(m.historico).toEqual([expect.objectContaining({ acao: 'enviado', para: 'em_aprovacao', porId: 'dono', envio: 1 })]);
  });

  it('sexta 10h → vence terça 23:59:59.999 (Brasília)', () => {
    const v = vencimentoAprovacao(grupo('em_aprovacao'));
    expect(v.toISOString()).toBe('2026-12-02T02:59:59.999Z');
  });

  it('feriado nacional no meio estende o prazo (Natal 2026, sexta)', () => {
    // quinta 24/12 10h → 25/12 feriado, 26-27 fim de semana → seg 28 e ter 29
    const g = grupo('em_aprovacao', { enviadoEm: new Date('2026-12-24T13:00:00Z') });
    expect(vencimentoAprovacao(g).toISOString()).toBe('2026-12-30T02:59:59.999Z');
  });

  it('datasExtras do calendário contam como não úteis', () => {
    const v = vencimentoAprovacao(grupo('em_aprovacao'), { datasExtras: ['2026-11-30'] });
    expect(v.toISOString()).toBe('2026-12-03T02:59:59.999Z');
  });

  it('fora de em_aprovacao ou sem enviadoEm → null', () => {
    expect(vencimentoAprovacao(grupo('ajustes'))).toBeNull();
    expect(vencimentoAprovacao({ status: 'em_aprovacao', moderacao: {} })).toBeNull();
  });
});

describe('planejarMigracaoModeracao (FR-029, D-02)', () => {
  it.each([
    [{ status: 'ativo' }, 'aprovado'],
    [{}, 'aprovado_sem_status'],
    [{ status: 'cancelado' }, 'cancelado'],
    [{ status: 'inativo' }, 'nao_classificado'],
    [{ status: 'ativo', moderacao: { envio: 1 } }, 'ja_migrado'],
  ])('%j → %s', (g, classe) => {
    expect(planejarMigracaoModeracao(g, agora).classe).toBe(classe);
  });

  it('aprovado legado: aprovacao legado, sem revisão; sem status grava ativo', () => {
    const r = planejarMigracaoModeracao({}, agora);
    expect(r.set.status).toBe('ativo');
    expect(r.set.moderacao).toMatchObject({ envio: 0, revisaoPendente: false, aprovacao: { tipo: 'legado', porId: null } });
    expect(planejarMigracaoModeracao({ status: 'ativo' }, agora).set.status).toBeUndefined();
    expect(planejarMigracaoModeracao({ status: 'inativo' }, agora).set).toBeNull();
  });
});

it('ACOES_MODERACAO não tem suspensão', () => {
  expect(Object.values(ACOES_MODERACAO)).not.toContain('suspender');
});
