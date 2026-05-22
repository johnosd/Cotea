const REQUIRED = [
  'MONGODB_URI',
  'MONGODB_DB',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'JWT_SECRET',
  'EMAIL_USER',
  'EMAIL_PASS',
  'ENCRYPTION_KEY',
  'NEXT_PUBLIC_SITE_URL',
];

const missing = REQUIRED.filter((key) => !process.env[key]);

if (missing.length > 0) {
  throw new Error(
    `Variaveis de ambiente obrigatorias nao definidas: ${missing.join(', ')}\n` +
    'Verifique o arquivo .env.local'
  );
}

if (process.env.ENCRYPTION_KEY?.length !== 64) {
  throw new Error('ENCRYPTION_KEY deve ter exatamente 64 caracteres hex (32 bytes)');
}
