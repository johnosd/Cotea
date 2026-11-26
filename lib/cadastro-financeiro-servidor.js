// Gate do cadastro financeiro completo no servidor (004-cadastro-financeiro,
// FR-011/FR-012/FR-015/FR-016, D-03). Única porta usada pelas ações financeiras:
// pay, pix/simulated/create, withdraw/create, wallet/pay e POST /api/grupos.
// Chamar logo depois das checagens de sessão/contaValidada/bloqueio e ANTES de
// qualquer leitura de grupo, validação de corpo, criação de carteira, fatura,
// pagamento, reserva ou lançamento.
// Este módulo expõe SÓ o gate (os testes dos handlers o simulam por inteiro);
// leitura/gravação do cadastro ficam em lib/cadastro-financeiro-perfil.js (R-009).
import { CODIGO_CADASTRO_INCOMPLETO, avaliarCadastroFinanceiro } from './cadastro-financeiro';
import { carregarUsuario, cpfClaroDoUsuario } from './cadastro-financeiro-perfil';

export const MENSAGEM_CADASTRO_INCOMPLETO = 'Complete seu cadastro financeiro (CPF e endereco) para continuar.';

const recusaIncompleto = (pendencias) => ({
  ok: false,
  http: 409,
  body: { error: MENSAGEM_CADASTRO_INCOMPLETO, codigo: CODIGO_CADASTRO_INCOMPLETO, pendencias },
});

/**
 * Recarrega o usuário do banco e avalia o cadastro financeiro.
 * @param {string|import('mongodb').ObjectId} userId
 * @returns {Promise<
 *   { ok: true, cpf: string, usuario: object } |
 *   { ok: false, http: number, body: { error: string, codigo: string, pendencias: string[] } }
 * >} `cpf` em claro (só dígitos), para PIX e saque (FR-015/FR-016).
 */
export async function verificarCadastroFinanceiro(userId) {
  const usuario = await carregarUsuario(userId);
  if (!usuario) return recusaIncompleto(['cpf', 'endereco']);
  const cpf = cpfClaroDoUsuario(usuario);
  const { completo, pendencias } = avaliarCadastroFinanceiro({ cpf, endereco: usuario.endereco || null });
  if (!completo) return recusaIncompleto(pendencias);
  return { ok: true, cpf, usuario };
}

