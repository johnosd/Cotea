// Regras puras do checkout v2 (006-checkout-caucao, T008 — logic §2 a §6).
import { describe, it, expect } from 'vitest';
import {
  REGRAS_CAUCAO, VINCULOS, calcularResumoEntrada, chaveValida, dividirPagamento, grupoJaLotou,
  pernasDaEntrada, pernasDaLiquidacao, planejarLiquidacao, rotuloVinculo, validarDadosEntrada,
} from '../../lib/checkout.js';
import { motivoGrupoCheio, ocupacaoDoGrupo } from '../../lib/grupo-entrada.js';

const grupo = (extra = {}) => ({
  precoValido: true, valorPorVaga: 10.5, repassePorVaga: 10, taxaPorVaga: 0.5,
  capacidadeTotal: 3, acesso: 'imediato', statusDetalhado: 'em_formacao', ...extra,
});
const dono = { papel: 'admin', status: 'ativo' };
const membro = { papel: 'membro', status: 'ativo' };

describe('ocupação e lotação', () => {
  it('o dono ocupa 1 vaga mesmo sem documento; banidos não ocupam', () => {
    expect(ocupacaoDoGrupo([])).toBe(1);
    expect(ocupacaoDoGrupo([dono])).toBe(1);
    expect(ocupacaoDoGrupo([dono, membro, { papel: 'membro', status: 'banido' }])).toBe(2);
  });

  it('grupo sem documento do dono não aceita um membro a mais', () => {
    expect(motivoGrupoCheio({ capacidadeTotal: 2 }, [membro])?.codigo).toBe('grupo_cheio');
    expect(motivoGrupoCheio({ capacidadeTotal: 2 }, [dono])).toBeNull();
  });

  it('lotado por lotadoEm ou pelo formato legado, só para apos_completar', () => {
    expect(grupoJaLotou(null)).toBe(false);
    expect(grupoJaLotou({ lotadoEm: new Date() })).toBe(true);
    expect(grupoJaLotou({ acesso: 'apos_completar', statusDetalhado: 'ativo' })).toBe(true);
    expect(grupoJaLotou({ acesso: 'imediato', statusDetalhado: 'ativo' })).toBe(false);
    expect(grupoJaLotou({ acesso: 'apos_completar', statusDetalhado: 'em_formacao' })).toBe(false);
  });
});

describe('calcularResumoEntrada', () => {
  it('mensalidade + caução iguais, taxa zero e total somado em centavos', () => {
    const r = calcularResumoEntrada({ grupo: grupo({ fidelidade: { periodoMeses: 6 } }), membros: [dono] });
    expect(r).toMatchObject({
      valido: true, mensalidade: 10.5, caucao: 10.5, taxa: 0, total: 21, repasse: 10, taxaCotea: 0.5,
      aposCompletar: false, retemMensalidade: false, completaGrupo: false, fidelidadeMeses: 6,
    });
  });

  it('preço inválido não gera valores', () => {
    expect(calcularResumoEntrada({ grupo: grupo({ precoValido: false }) })).toEqual({ valido: false });
  });

  it('apos_completar: retém até a penúltima vaga; quem completa não fica retido', () => {
    const g = grupo({ acesso: 'apos_completar' });
    expect(calcularResumoEntrada({ grupo: g, membros: [dono] })).toMatchObject({ retemMensalidade: true, completaGrupo: false });
    expect(calcularResumoEntrada({ grupo: g, membros: [dono, membro] })).toMatchObject({ retemMensalidade: false, completaGrupo: true });
  });

  it('grupo que já lotou não retém, mesmo com vaga reaberta', () => {
    const g = grupo({ acesso: 'apos_completar', lotadoEm: new Date() });
    expect(calcularResumoEntrada({ grupo: g, membros: [dono] })).toMatchObject({ retemMensalidade: false, completaGrupo: false });
  });

  it('versaoResumo muda com preço, retenção e fidelidade; não muda com outro membro no grupo imediato', () => {
    const base = calcularResumoEntrada({ grupo: grupo(), membros: [dono] }).versaoResumo;
    expect(calcularResumoEntrada({ grupo: grupo(), membros: [dono, membro] }).versaoResumo).toBe(base);
    for (const diferente of [
      grupo({ valorPorVaga: 21, repassePorVaga: 20, taxaPorVaga: 1 }),
      grupo({ acesso: 'apos_completar' }),
      grupo({ fidelidade: { periodoMeses: 1 } }),
    ]) {
      expect(calcularResumoEntrada({ grupo: diferente, membros: [dono] }).versaoResumo).not.toBe(base);
    }
    expect(base).toContain(REGRAS_CAUCAO.versao);
  });
});

describe('divisão e validação', () => {
  it('saldo primeiro, PIX pela diferença, sem resíduo de ponto flutuante', () => {
    expect(dividirPagamento({ total: 21, disponivel: 5 })).toEqual({ valorSaldo: 5, valorPix: 16 });
    expect(dividirPagamento({ total: 21, disponivel: 30 })).toEqual({ valorSaldo: 21, valorPix: 0 });
    expect(dividirPagamento({ total: 21, disponivel: 0 })).toEqual({ valorSaldo: 0, valorPix: 21 });
    expect(dividirPagamento({ total: 21, disponivel: -3 })).toEqual({ valorSaldo: 0, valorPix: 21 });
    expect(dividirPagamento({ total: 0.3, disponivel: 0.1 })).toEqual({ valorSaldo: 0.1, valorPix: 0.2 });
  });

  it('chave, vínculo e aceite, nesta ordem', () => {
    const ok = { chave: 'abcdefgh-1234', vinculo: 'familia', aceiteRegras: { versao: REGRAS_CAUCAO.versao } };
    expect(validarDadosEntrada(ok)).toBeNull();
    expect(validarDadosEntrada({}).codigo).toBe('chave_invalida');
    for (const chave of ['curta', 'com espaco aqui', 'x'.repeat(81), 12345678, null]) {
      expect(chaveValida(chave), String(chave)).toBe(false);
    }
    expect(validarDadosEntrada({ ...ok, vinculo: 'colega', aceiteRegras: undefined }).codigo).toBe('vinculo_invalido');
    expect(validarDadosEntrada({ ...ok, aceiteRegras: { versao: 'x' } }).codigo).toBe('aceite_obrigatorio');
    expect(VINCULOS.map((v) => v.id)).toEqual(['amigo', 'familia', 'conhecido', 'desconhecido']);
    expect(rotuloVinculo('familia')).toBe('Família');
    expect(rotuloVinculo('x')).toBe('');
  });
});

describe('pernas e liquidação', () => {
  const ids = { walletId: 'w', grupoId: 'g', participacaoId: 'p' };
  const forma = (pernas) => pernas.map((p) => [p.type, p.categoria, p.valor]);

  it('entrada: um débito do total e crédito da caução; retenção quando for o caso', () => {
    const resumo = { total: 21, caucao: 10.5, mensalidade: 10.5, taxa: 0, retemMensalidade: false };
    expect(forma(pernasDaEntrada({ ...ids, resumo }))).toEqual([['debit', 'pessoal', 21], ['credit', 'caucao', 10.5]]);
    const retida = pernasDaEntrada({ ...ids, resumo: { ...resumo, retemMensalidade: true } });
    expect(forma(retida)).toEqual([['debit', 'pessoal', 21], ['credit', 'caucao', 10.5], ['credit', 'retido_entrada', 10.5]]);
    for (const p of retida) expect(p).toMatchObject({ organizacaoId: null, grupoId: 'g', participacaoId: 'p', walletId: 'w' });
  });

  const comRetencao = (extra = {}) => ({
    aguardandoEnvioAcesso: true,
    caucao: { valor: 10.5, situacao: 'bloqueada' },
    retencao: { valor: 10.5, situacao: 'retida' },
    ...extra,
  });

  it('retenção ainda não liberada volta com a caução num só crédito', () => {
    const plano = planejarLiquidacao({ membro: comRetencao(), grupo: grupo({ acesso: 'apos_completar' }) });
    expect(plano).toEqual({ caucao: 10.5, retido: 10.5, liberada: false, mensalidade: 10.5, total: 21, temMovimento: true });
    expect(forma(pernasDaLiquidacao({ ...ids, plano }))).toEqual([
      ['debit', 'caucao', 10.5], ['debit', 'retido_entrada', 10.5], ['credit', 'pessoal', 21],
    ]);
  });

  it('acesso enviado, grupo lotado ou a_liberar: a retenção é consumida', () => {
    const casos = [
      { membro: comRetencao({ aguardandoEnvioAcesso: false }), grupo: grupo({ acesso: 'apos_completar' }) },
      { membro: comRetencao(), grupo: grupo({ acesso: 'apos_completar', lotadoEm: new Date() }) },
      { membro: comRetencao({ retencao: { valor: 10.5, situacao: 'a_liberar' } }), grupo: null },
    ];
    for (const caso of casos) {
      const plano = planejarLiquidacao(caso);
      expect(plano).toMatchObject({ liberada: true, mensalidade: 0, total: 10.5, retido: 10.5 });
      expect(forma(pernasDaLiquidacao({ ...ids, plano }))).toEqual([
        ['debit', 'caucao', 10.5], ['debit', 'retido_entrada', 10.5], ['credit', 'pessoal', 10.5],
      ]);
    }
  });

  it('grupo excluído sem ter lotado devolve tudo', () => {
    expect(planejarLiquidacao({ membro: comRetencao(), grupo: null })).toMatchObject({ liberada: false, total: 21 });
  });

  it('sem caução (membro antigo) ou já liquidado: nenhum movimento e nenhuma perna', () => {
    const casos = [
      { papel: 'membro', aguardandoEnvioAcesso: true },
      comRetencao({ caucao: { valor: 10.5, situacao: 'devolvida' }, retencao: { valor: 10.5, situacao: 'liberada' } }),
    ];
    for (const m of casos) {
      const plano = planejarLiquidacao({ membro: m, grupo: grupo() });
      expect(plano).toMatchObject({ temMovimento: false, total: 0 });
      expect(pernasDaLiquidacao({ ...ids, plano })).toEqual([]);
    }
  });
});
