const { S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');

// Allow either direct endpoint or just the account id (as in the working snippet)
const accountId = process.env.CLOUDFLARE_R2_ACCOUNT_ID || process.env.R2_ACCOUNT_ID || '';
const explicitEndpoint = process.env.CLOUDFLARE_R2_ENDPOINT || process.env.R2_ENDPOINT || '';
const endpoint = explicitEndpoint || (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : '');
const accessKeyId = process.env.CLOUDFLARE_R2_ACCESS_KEY_ID || process.env.R2_ACCESS_KEY_ID || '';
const secretAccessKey = process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY || process.env.R2_SECRET_ACCESS_KEY || '';
const bucket = process.env.CLOUDFLARE_R2_BUCKET || process.env.R2_BUCKET_NAME || '';
const publicBase = process.env.CLOUDFLARE_R2_PUBLIC_BASE_URL || process.env.R2_PUBLIC_BASE_URL || '';

function hasR2Config() {
  return Boolean(endpoint && accessKeyId && secretAccessKey && bucket && publicBase);
}

function missingR2Config() {
  const missing = [];
  if (!endpoint) missing.push('CLOUDFLARE_R2_ENDPOINT/R2_ENDPOINT ou R2_ACCOUNT_ID');
  if (!accessKeyId) missing.push('CLOUDFLARE_R2_ACCESS_KEY_ID/R2_ACCESS_KEY_ID');
  if (!secretAccessKey) missing.push('CLOUDFLARE_R2_SECRET_ACCESS_KEY/R2_SECRET_ACCESS_KEY');
  if (!bucket) missing.push('CLOUDFLARE_R2_BUCKET/R2_BUCKET_NAME');
  if (!publicBase) missing.push('CLOUDFLARE_R2_PUBLIC_BASE_URL/R2_PUBLIC_BASE_URL');
  return missing;
}

const r2Client = new S3Client({
  region: 'auto',
  endpoint,
  credentials: {
    accessKeyId,
    secretAccessKey,
  },
});

async function uploadToR2(key, body, contentType) {
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: body,
    ContentType: contentType || 'application/octet-stream',
  });
  await r2Client.send(command);
}

async function deleteFromR2(key) {
  const command = new DeleteObjectCommand({
    Bucket: bucket,
    Key: key,
  });
  await r2Client.send(command);
}

function getPublicUrl(key) {
  return `${publicBase.replace(/\/$/, '')}/${key}`;
}

module.exports = {
  r2Client,
  uploadToR2,
  deleteFromR2,
  getPublicUrl,
  hasR2Config,
  missingR2Config,
};
