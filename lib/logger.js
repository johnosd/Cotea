const isProd = process.env.NODE_ENV === 'production';

function format(level, message, error) {
  if (!isProd) return error ? [message, error] : [message];
  // Em produção: omite stack trace para não vazar detalhes internos nos logs
  if (error instanceof Error) {
    return [`${message} | ${error.message}`];
  }
  return [message];
}

export const logger = {
  info:  (msg, ...args) => console.log(msg, ...args),
  warn:  (msg, error)   => console.warn(...format('warn',  msg, error)),
  error: (msg, error)   => console.error(...format('error', msg, error)),
};
