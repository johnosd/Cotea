// Cadastro financeiro completo (004-cadastro-financeiro). Módulo PURO: sem I/O,
// sem lib/mongodb, sem criptografia — recebe CPF em claro e o resultado da
// consulta de CEP já pronto. Usado pelo servidor (perfil, gate das ações
// financeiras, correção pelo admin, migração) e pelas telas (validação auxiliar).
// Regras: ver sdd/specs/004-cadastro-financeiro/logic/cadastro.md.

/** Código estável da recusa por cadastro incompleto (FR-012), igual nas ações financeiras. */
export const CODIGO_CADASTRO_INCOMPLETO = 'cadastro_financeiro_incompleto';

/** Pendências possíveis, na ordem em que aparecem (FR-012). */
export const PENDENCIAS = { CPF: 'cpf', ENDERECO: 'endereco' };

/** As 27 UFs (FR-006). */
export const UFS = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA',
  'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
];

/** Status possíveis da consulta de CEP (lib/cep.js). */
export const STATUS_CEP = { ENCONTRADO: 'encontrado', NAO_ENCONTRADO: 'nao_encontrado', INDISPONIVEL: 'indisponivel' };

const CAMPOS_ENDERECO = ['cep', 'uf', 'cidade', 'bairro', 'rua', 'numero', 'complemento'];
const VARIANTES_SEM_NUMERO = new Set(['s/n', 'sn', 's.n.', 's.n', 's/nº', 's/no', 's/n°']);

const texto = (v) => (v == null ? '' : String(v)).trim();

/** Só os dígitos do CPF (string), ou '' se vazio. */
export function somenteDigitosCpf(cpf) {
  return (cpf == null ? '' : String(cpf)).replace(/\D/g, '');
}

/** CPF válido: 11 dígitos (pontuação ignorada), não repetido, dígitos verificadores corretos (FR-001/FR-002). */
export function validarCpf(cpf) {
  const d = somenteDigitosCpf(cpf);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const dv = (tamanho) => {
    let soma = 0;
    for (let i = 0; i < tamanho; i += 1) soma += Number(d[i]) * (tamanho + 1 - i);
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };
  return dv(9) === Number(d[9]) && dv(10) === Number(d[10]);
}

/** Primeiro problema do endereço (mensagem), ou null se válido. Não olha cepConfirmado (FR-007). */
function problemaEndereco(e) {
  if (!e) return 'Endereco obrigatorio para o cadastro financeiro.';
  if (somenteDigitosCpf(e.cep).length !== 8) return 'CEP deve ter 8 digitos.';
  if (!UFS.includes(texto(e.uf).toUpperCase())) return 'UF invalida.';
  if (!texto(e.cidade)) return 'Informe a cidade.';
  if (!texto(e.bairro)) return 'Informe o bairro.';
  if (!texto(e.rua)) return 'Informe a rua.';
  if (!texto(e.numero)) return 'Informe o numero (ou S/N).';
  return null;
}

/** Endereço válido segundo FR-006 (sem rede). */
export function enderecoValido(endereco) {
  return problemaEndereco(endereco) === null;
}

/**
 * Estado derivado (FR-001), sem rede: `{ cpf }` em claro (ou ''), `endereco` como gravado.
 * @returns {{ completo: boolean, pendencias: string[] }} pendências na ordem de PENDENCIAS.
 */
export function avaliarCadastroFinanceiro({ cpf, endereco }) {
  const pendencias = [];
  if (!validarCpf(cpf)) pendencias.push(PENDENCIAS.CPF);
  if (!enderecoValido(endereco)) pendencias.push(PENDENCIAS.ENDERECO);
  return { completo: pendencias.length === 0, pendencias };
}

function normalizarNumero(numero) {
  const n = texto(numero);
  return VARIANTES_SEM_NUMERO.has(n.replace(/\s/g, '').toLowerCase()) ? 'S/N' : n;
}

function normalizarEndereco(endereco = {}) {
  return {
    cep: somenteDigitosCpf(endereco.cep),
    uf: texto(endereco.uf).toUpperCase(),
    cidade: texto(endereco.cidade),
    bairro: texto(endereco.bairro),
    rua: texto(endereco.rua),
    numero: normalizarNumero(endereco.numero),
    complemento: texto(endereco.complemento),
  };
}

/**
 * Decide o que gravar num salvamento de CPF/endereço (perfil, formulário embutido).
 * @param {object} p
 * @param {{ cpf: string, endereco: object|null }} p.atual   CPF atual EM CLARO ('' se ausente) e endereço gravado.
 * @param {{ cpf?: string, endereco?: object }} p.enviado     o que o cliente mandou (endereco ausente = não mexe).
 * @param {{ status: string, uf?: string, cidade?: string, bairro?: string, rua?: string }|null} p.cep
 *        resultado da consulta do CEP ENVIADO (null quando o endereço não foi enviado).
 * @returns {{ ok: boolean, erros: { cpf?: string, endereco?: string },
 *             cpfParaGravar: string|null, enderecoParaGravar: object|null }}
 *   `cpfParaGravar`: dígitos do CPF novo, ou null para manter o atual.
 *   `enderecoParaGravar`: endereço normalizado com `cepConfirmado` (bool), ou null para manter.
 */
export function planejarCadastroFinanceiro({ atual = {}, enviado = {}, cep = null }) {
  const erros = {};
  let cpfParaGravar = null;
  let enderecoParaGravar = null;

  // CPF (FR-002, FR-005): travado quando o atual é válido — o enviado é ignorado.
  if (!validarCpf(atual.cpf)) {
    const d = somenteDigitosCpf(enviado.cpf);
    if (d !== '') {
      if (validarCpf(d)) cpfParaGravar = d;
      else erros.cpf = 'CPF invalido.';
    }
  }

  // Endereço (FR-006, FR-007, FR-009).
  if (enviado.endereco !== undefined) {
    const e = normalizarEndereco(enviado.endereco || {});
    const todosVazios = CAMPOS_ENDERECO.every((campo) => e[campo] === '');
    if (todosVazios) {
      if (enderecoValido(atual.endereco)) erros.endereco = 'Endereco obrigatorio para o cadastro financeiro.';
    } else if (e.cep.length !== 8) {
      erros.endereco = 'CEP deve ter 8 digitos.';
    } else if (cep?.status === STATUS_CEP.NAO_ENCONTRADO) {
      erros.endereco = 'CEP nao encontrado.';
    } else {
      let cepConfirmado = false;
      if (cep?.status === STATUS_CEP.ENCONTRADO) {
        // Cidade e UF valem as do CEP; rua e bairro são sempre os enviados.
        e.uf = texto(cep.uf).toUpperCase();
        e.cidade = texto(cep.cidade);
        cepConfirmado = true;
      }
      const problema = problemaEndereco(e);
      if (problema) erros.endereco = problema;
      else enderecoParaGravar = { ...e, cepConfirmado };
    }
  }

  const ok = Object.keys(erros).length === 0;
  return {
    ok,
    erros,
    cpfParaGravar: ok ? cpfParaGravar : null,
    enderecoParaGravar: ok ? enderecoParaGravar : null,
  };
}

/**
 * Migração dos CPFs existentes (FR-020). Recebe usuários com o CPF já descriptografado.
 * @param {Array<{ _id: any, cpfClaro: string, cpfCifrado: boolean, cpfHash?: string }>} usuarios
 * @param {{ hash: (cpf: string) => string }} deps
 * @returns {{ acoes: Array<{ _id: any, tipo: 'criptografar'|'marcar_invalido'|'definir_hash' }>,
 *             conflitos: Array<{ ids: any[] }>, resumo: object }}
 */
export function planejarMigracaoCpf(usuarios, deps) {
  throw new Error('not implemented');
}
