// Validação de destino de redirecionamento pós-login.
// Aceita só caminhos internos: evita redirecionamento aberto (//evil.com,
// /\evil.com, https://...) e laço de volta para a própria página de login.
export function destinoSeguro(callbackUrl) {
  const valor = Array.isArray(callbackUrl) ? callbackUrl[0] : callbackUrl;
  if (typeof valor !== 'string' || !valor.startsWith('/') || valor.startsWith('//') || valor.startsWith('/\\')) {
    return '/';
  }
  if (valor.startsWith('/auth/signin')) return '/';
  return valor;
}
