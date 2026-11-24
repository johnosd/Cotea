// T037 — auditoria da falha definitiva independe da notificação (não travado).
// `lib/audit` é mockado só para não abrir conexão com o Mongo (o import valida env);
// a unidade sob teste é `criarAlertaAdmins`.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/audit', () => ({ logAudit: vi.fn(async () => {}) }));

import { logAudit } from '../../lib/audit';
import { criarAlertaAdmins } from '../../lib/rotinas/alertas.js';

const ADMINS = [{ _id: 'a1' }, { _id: 'a2' }];

function dbFalso({ admins = ADMINS, erroInsert = null, erroFind = null } = {}) {
  const insertMany = vi.fn(async () => {
    if (erroInsert) throw erroInsert;
  });
  const find = vi.fn(() => ({
    toArray: async () => {
      if (erroFind) throw erroFind;
      return admins;
    },
  }));
  return {
    insertMany,
    find,
    db: {
      collection: (nome) => {
        if (nome === 'users') return { find };
        if (nome === 'notificacoesUsuario') return { insertMany };
        throw new Error(`coleção inesperada: ${nome}`);
      },
    },
  };
}

const evento = { rotinaId: 'saude', chave: 'sonda:x', erro: 'falha simulada', tentativas: 5 };

describe('criarAlertaAdmins', () => {
  beforeEach(() => vi.clearAllMocks());

  it('notifica cada admin não bloqueado e audita', async () => {
    const { db, insertMany, find } = dbFalso();
    await criarAlertaAdmins(db)(evento);

    expect(find).toHaveBeenCalledWith({ systemRole: 'admin', isBlocked: { $ne: true } }, expect.anything());
    const docs = insertMany.mock.calls[0][0];
    expect(docs.map((d) => d.userId)).toEqual(['a1', 'a2']);
    expect(docs[0]).toMatchObject({ tipo: 'sistema', acao: '/admin?tab=rotinas', importante: true, lido: false });
    expect(logAudit).toHaveBeenCalledTimes(1);
    expect(logAudit.mock.calls[0][0]).toMatchObject({
      action: 'rotina.item_falha_definitiva',
      actorId: 'sistema',
      targetId: 'saude:sonda:x',
      details: { adminsNotificados: 2, notificacaoFalhou: false },
    });
  });

  it('sem admins: não insere notificação, mas audita', async () => {
    const { db, insertMany } = dbFalso({ admins: [] });
    await criarAlertaAdmins(db)(evento);
    expect(insertMany).not.toHaveBeenCalled();
    expect(logAudit.mock.calls[0][0].details).toMatchObject({ adminsNotificados: 0, notificacaoFalhou: false });
  });

  it('notificação falhando: audita mesmo assim e relança o erro original', async () => {
    const erro = new Error('banco fora');
    const { db } = dbFalso({ erroInsert: erro });
    await expect(criarAlertaAdmins(db)(evento)).rejects.toBe(erro);

    expect(logAudit).toHaveBeenCalledTimes(1);
    expect(logAudit.mock.calls[0][0]).toMatchObject({
      action: 'rotina.item_falha_definitiva',
      details: { rotinaId: 'saude', chave: 'sonda:x', tentativas: 5, adminsNotificados: 0, notificacaoFalhou: true },
    });
  });

  it('busca de admins falhando: também audita e relança', async () => {
    const erro = new Error('find falhou');
    const { db } = dbFalso({ erroFind: erro });
    await expect(criarAlertaAdmins(db)(evento)).rejects.toBe(erro);
    expect(logAudit).toHaveBeenCalledTimes(1);
    expect(logAudit.mock.calls[0][0].details.notificacaoFalhou).toBe(true);
  });
});
