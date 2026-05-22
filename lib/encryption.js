import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;

function getKey() {
  const hex = process.env.ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error('ENCRYPTION_KEY deve ter 64 caracteres hex (32 bytes)');
  }
  return Buffer.from(hex, 'hex');
}

/**
 * Criptografa um CPF. Retorna string vazia se o valor for vazio.
 * Formato de saída: "<iv_hex>:<tag_hex>:<ciphertext_hex>"
 */
export function encryptCPF(value) {
  if (!value) return '';
  const key = getKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * Descriptografa um CPF criptografado.
 * Retorna o valor original se não estiver no formato esperado (retrocompatibilidade).
 */
export function decryptCPF(value) {
  if (!value) return '';
  // Se não está no formato criptografado, retorna como está (dados legados)
  const parts = value.split(':');
  if (parts.length !== 3) return value;
  try {
    const key = getKey();
    const [ivHex, tagHex, ciphertextHex] = parts;
    const iv = Buffer.from(ivHex, 'hex');
    const tag = Buffer.from(tagHex, 'hex');
    const ciphertext = Buffer.from(ciphertextHex, 'hex');
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    return value;
  }
}
