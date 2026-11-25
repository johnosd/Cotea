// Regressão: POST /api/grupos/[id]/participar não pode inserir membro sem pagamento
// (bug b01-entrada-sem-pagamento). A rota está desativada (410) para todos os papéis
// e não toca em sessão nem banco.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ObjectId } from 'mongodb';
import { criarDbMemoria, criarRes } from '../helpers/db-grupos-memoria.js';

const estado = vi.hoisted(() => ({ db: null, session: null }));

vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => estado.session) }));
vi.mock('../../pages/api/auth/[...nextauth]', () => ({ authOptions: {} }));
vi.mock('../../lib/mongodb', () => ({
  default: Promise.resolve({ db: () => estado.db }),
  getDb: vi.fn(async () => estado.db),
}));

const { default: handler } = await import('../../pages/api/grupos/[id]/participar.js');
const { getServerSession } = await import('next-auth');

const grupoId = new ObjectId();
const userId = new ObjectId();

const chamar = async (method, session, body = {}) => {
  estado.session = session;
  const res = criarRes();
  await handler({ method, query: { id: String(grupoId) }, body, headers: {}, socket: {} }, res);
  return res;
};

beforeEach(() => {
  estado.db = criarDbMemoria();
  estado.db.collection('grupos').docs.push({
    _id: grupoId, nome: 'Canva Pro', capacidadeTotal: 4, valorTotal: 40,
    valorPorVaga: 10, repassePorVaga: 9.5, taxaPorVaga: 0.5, precoValido: true,
  });
  vi.mocked(getServerSession).mockClear();
});

describe('POST /api/grupos/[id]/participar (desativada)', () => {
  it('usuário validado comum recebe 410 e nenhum membro é criado', async () => {
    const res = await chamar('POST', { user: { id: String(userId), contaValidada: true, systemRole: 'user' } });
    expect(res.statusCode).toBe(410);
    expect(res.body.codigo).toBe('rota_desativada');
    expect(estado.db.collection('membrosGrupo').docs).toHaveLength(0);
  });

  it('staff adicionando outro userId também recebe 410 e nenhum membro é criado', async () => {
    const res = await chamar(
      'POST',
      { user: { id: String(new ObjectId()), contaValidada: true, systemRole: 'admin' } },
      { userId: String(userId) }
    );
    expect(res.statusCode).toBe(410);
    expect(estado.db.collection('membrosGrupo').docs).toHaveLength(0);
  });

  it('sem sessão e outros métodos também respondem 410, sem consultar sessão', async () => {
    for (const method of ['POST', 'GET']) {
      const res = await chamar(method, null);
      expect(res.statusCode).toBe(410);
    }
    expect(getServerSession).not.toHaveBeenCalled();
    expect(estado.db.collection('membrosGrupo').docs).toHaveLength(0);
  });
});
