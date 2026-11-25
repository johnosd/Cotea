// Máscara de CPF para telas e listagens administrativas (RN: CPF sempre
// mascarado; completo só ao financeiro na aprovação de saque).
// Módulo puro: sem imports de servidor, seguro em testes e no cliente.

export const CPF_MASCARA_PADRAO = '***.***.***-**';

// "12345678901" ou "123.456.789-01" -> "***.456.789-**".
// Vazio/nulo -> ''. Qualquer outra coisa (cifrado, tamanho errado) ->
// máscara cheia, sem nunca devolver o valor original.
export function mascararCPF(valor) {
  if (valor === null || valor === undefined || valor === '') return '';
  const digitos = String(valor).replace(/\D/g, '');
  if (digitos.length !== 11 || String(valor).includes(':')) return CPF_MASCARA_PADRAO;
  return `***.${digitos.slice(3, 6)}.${digitos.slice(6, 9)}-**`;
}
