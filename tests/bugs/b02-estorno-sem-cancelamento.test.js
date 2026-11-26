// Regressão B-02: ninguém recebe o dinheiro de volta mantendo a vaga. Reescrito na
// 006-checkout-caucao (T014): a rota de estorno pedida pelo cliente deixou de existir
// (410), porque não há mais "pago sem participação". A regra pura segue protegida: a
// migração do checkout antigo só devolve fatura paga que não virou participação.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ObjectId } from 'mongodb';
import { criarRes } from '../helpers/db-grupos-memoria.js';
import { avaliarEstorno, MOTIVO_ESTORNO } from '../../lib/estorno.js';
import handler from '../../pages/api/assinaturas/refund.js';

describe('avaliarEstorno — regra pura', () => {
  it('nega para qualquer registro de membro, inclusive banido', () => {
    expect(avaliarEstorno({ invoice: {}, membro: { status: 'ativo' } })).toEqual({ permitido: false, motivo: MOTIVO_ESTORNO.MEMBRO_DO_GRUPO });
    expect(avaliarEstorno({ invoice: {}, membro: { status: 'banido' } }).permitido).toBe(false);
  });

  it('nega fatura já vinculada a uma entrada (entrou e saiu)', () => {
    expect(avaliarEstorno({ invoice: { membroId: new ObjectId() }, membro: null })).toEqual({ permitido: false, motivo: MOTIVO_ESTORNO.FATURA_VINCULADA });
    expect(avaliarEstorno({ invoice: { vinculadoEm: new Date() }, membro: null }).permitido).toBe(false);
  });

  it('permite quando não é membro e a fatura não foi vinculada', () => {
    expect(avaliarEstorno({ invoice: {}, membro: null })).toEqual({ permitido: true });
  });
});

describe('POST /api/assinaturas/refund (desativada)', () => {
  const banco = vi.fn();
  beforeEach(() => banco.mockClear());

  it.each(['POST', 'GET', 'DELETE'])('%s responde 410 sem ler sessão, corpo ou banco', async (method) => {
    const res = criarRes();
    const req = {
      method,
      headers: {},
      socket: {},
      get body() { banco(); return { invoiceId: 'inv-1' }; },
    };
    await handler(req, res);
    expect(res.statusCode).toBe(410);
    expect(res.body.codigo).toBe('rota_desativada');
    expect(banco).not.toHaveBeenCalled();
  });
});
