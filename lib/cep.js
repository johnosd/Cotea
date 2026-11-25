// Consulta de CEP no servidor (004-cadastro-financeiro, FR-006/FR-007, D-06).
// Fonte: o mesmo serviço público já usado pela tela do perfil (ViaCEP).
// Nunca lança: falha de rede, timeout ou resposta inesperada viram INDISPONIVEL.
import { STATUS_CEP } from './cadastro-financeiro';

const INDISPONIVEL = Object.freeze({ status: STATUS_CEP.INDISPONIVEL });

/**
 * @param {string} cep 8 dígitos
 * @param {{ timeoutMs?: number, fetchImpl?: typeof fetch }} [opcoes]
 * @returns {Promise<{ status: 'encontrado', uf: string, cidade: string, bairro: string, rua: string }
 *                 | { status: 'nao_encontrado' } | { status: 'indisponivel' }>}
 */
export async function consultarCep(cep, opcoes = {}) {
  const { timeoutMs = 3000, fetchImpl = globalThis.fetch } = opcoes;
  const digitos = String(cep ?? '').replace(/\D/g, '');
  if (digitos.length !== 8 || typeof fetchImpl !== 'function') return { ...INDISPONIVEL };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`https://viacep.com.br/ws/${digitos}/json/`, { signal: controller.signal });
    if (!res || res.status !== 200) return { ...INDISPONIVEL };
    const data = await res.json();
    if (!data || typeof data !== 'object') return { ...INDISPONIVEL };
    if (data.erro === true || data.erro === 'true') return { status: STATUS_CEP.NAO_ENCONTRADO };
    if (!data.uf || !data.localidade) return { ...INDISPONIVEL };
    return {
      status: STATUS_CEP.ENCONTRADO,
      uf: String(data.uf),
      cidade: String(data.localidade),
      bairro: String(data.bairro || ''),
      rua: String(data.logradouro || ''),
    };
  } catch {
    return { ...INDISPONIVEL };
  } finally {
    clearTimeout(timer);
  }
}
