// Leitura e gravação do cadastro financeiro pelo próprio usuário
// (004-cadastro-financeiro, D-04/D-05). Separado do gate
// (lib/cadastro-financeiro-servidor.js) para que os testes dos handlers possam
// simular o gate sem afetar o salvamento (R-009).
// - salvarCadastroFinanceiro: única gravação de CPF/endereço pelo usuário,
//   usada pelo PUT /api/perfil/cadastro-financeiro e pelo POST /api/atualizarPerfil.
// - resumoCadastroFinanceiro: o que pode ser devolvido ao usuário (nunca o CPF completo).
import { ObjectId } from 'mongodb';
import { getDb } from './mongodb';
import { decryptCPF, encryptCPF, hashCPF } from './encryption';
import { mascararCPF } from './cpf-mascara';
import { consultarCep } from './cep';
import {
  avaliarCadastroFinanceiro,
  planejarCadastroFinanceiro,
  somenteDigitosCpf,
  validarCpf,
} from './cadastro-financeiro';

export const CODIGO_CPF_INDISPONIVEL = 'cpf_indisponivel';
export const MENSAGEM_CPF_INDISPONIVEL = 'CPF indisponivel. Se ele e seu, fale com o suporte.';
export const CODIGO_CADASTRO_INVALIDO = 'cadastro_invalido';

const CAMPOS_ENDERECO = ['cep', 'uf', 'cidade', 'bairro', 'rua', 'numero', 'complemento'];

function paraObjectId(id) {
  if (id instanceof ObjectId) return id;
  const s = String(id ?? '');
  return ObjectId.isValid(s) && s.length === 24 ? new ObjectId(s) : null;
}

/** Carrega o usuário do banco por _id (ObjectId; string como fallback legado). */
export async function carregarUsuario(userId, db) {
  const banco = db || (await getDb());
  const oid = paraObjectId(userId);
  const usuarios = banco.collection('users');
  if (oid) {
    const porObjectId = await usuarios.findOne({ _id: oid });
    if (porObjectId) return porObjectId;
  }
  return userId ? usuarios.findOne({ _id: String(userId) }) : null;
}

/** CPF do usuário em claro (só dígitos), ou '' quando ausente/ilegível. Aceita legado em texto puro. */
export function cpfClaroDoUsuario(usuario) {
  if (!usuario?.cpf) return '';
  try {
    return somenteDigitosCpf(decryptCPF(usuario.cpf) || '');
  } catch {
    return '';
  }
}

/** Corpo do GET /api/perfil/cadastro-financeiro (D-04: sem CPF completo). */
export function resumoCadastroFinanceiro(usuario) {
  const cpf = cpfClaroDoUsuario(usuario);
  const endereco = usuario?.endereco || null;
  const { completo, pendencias } = avaliarCadastroFinanceiro({ cpf, endereco });
  const cpfTravado = validarCpf(cpf);
  return {
    completo,
    pendencias,
    cpfTravado,
    cpfMascarado: cpfTravado ? mascararCPF(cpf) : '',
    endereco: endereco ? Object.fromEntries(CAMPOS_ENDERECO.map((c) => [c, String(endereco[c] ?? '')])) : null,
    cepConfirmado: Boolean(endereco?.cepConfirmado),
  };
}

/** Outra conta já usa este hash de CPF? (FR-003) */
export async function cpfEmUsoPorOutraConta(db, cpfHash, usuarioId) {
  if (!cpfHash) return false;
  const outro = await db.collection('users').findOne(
    { cpfHash, _id: { $ne: usuarioId } },
    { projection: { _id: 1 } },
  );
  return Boolean(outro);
}

const ehDuplicidade = (err) => err?.code === 11000 || err?.code === 11001;

/**
 * Salva CPF e/ou endereço do próprio usuário (D-05). Com qualquer erro, nada é gravado.
 * @param {{ userId: any, enviado: { cpf?: string, endereco?: object }, usuario?: object,
 *           consultar?: typeof consultarCep }} p
 * @returns {Promise<{ ok: true, resumo: object } |
 *                   { ok: false, http: number, codigo: string, error: string, campos?: object }>}
 */
export async function salvarCadastroFinanceiro({ userId, enviado = {}, usuario: usuarioCarregado, consultar = consultarCep }) {
  const db = await getDb();
  const usuario = usuarioCarregado || (await carregarUsuario(userId, db));
  if (!usuario) return { ok: false, http: 404, codigo: 'usuario_nao_encontrado', error: 'Usuario nao encontrado.' };

  const atual = { cpf: cpfClaroDoUsuario(usuario), endereco: usuario.endereco || null };
  const cepEnviado = somenteDigitosCpf(enviado.endereco?.cep);
  const cep = enviado.endereco !== undefined && cepEnviado.length === 8 ? await consultar(cepEnviado) : null;

  const plano = planejarCadastroFinanceiro({ atual, enviado, cep });
  if (!plano.ok) {
    return {
      ok: false,
      http: 400,
      codigo: CODIGO_CADASTRO_INVALIDO,
      error: plano.erros.cpf || plano.erros.endereco,
      campos: plano.erros,
    };
  }

  const set = {};
  if (plano.cpfParaGravar) {
    const cpfHash = hashCPF(plano.cpfParaGravar);
    if (await cpfEmUsoPorOutraConta(db, cpfHash, usuario._id)) {
      return { ok: false, http: 409, codigo: CODIGO_CPF_INDISPONIVEL, error: MENSAGEM_CPF_INDISPONIVEL };
    }
    set.cpf = encryptCPF(plano.cpfParaGravar);
    set.cpfHash = cpfHash;
  }
  if (plano.enderecoParaGravar) set.endereco = plano.enderecoParaGravar;

  if (Object.keys(set).length > 0) {
    try {
      await db.collection('users').updateOne({ _id: usuario._id }, { $set: set });
    } catch (err) {
      // Corrida entre duas contas com o mesmo CPF: o índice único cpfHash_unico decide.
      if (ehDuplicidade(err)) {
        return { ok: false, http: 409, codigo: CODIGO_CPF_INDISPONIVEL, error: MENSAGEM_CPF_INDISPONIVEL };
      }
      throw err;
    }
  }

  return { ok: true, resumo: resumoCadastroFinanceiro({ ...usuario, ...set }) };
}
