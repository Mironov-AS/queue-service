const { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const path = require('path');
const fs = require('fs');

const S3_BUCKET = process.env.AWS_S3_BUCKET || '';
const S3_REGION = process.env.AWS_REGION || 'us-east-1';
const USE_S3 = !!(S3_BUCKET && process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY);

const DATA_DIR = process.env.DATA_DIR || __dirname;
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');

if (!USE_S3) {
  fs.mkdirSync(path.join(UPLOADS_DIR, 'ads'), { recursive: true });
}

const s3 = new S3Client({
  region: S3_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
  },
  ...(process.env.AWS_ENDPOINT_URL ? {
    endpoint: process.env.AWS_ENDPOINT_URL,
    forcePathStyle: process.env.AWS_S3_FORCE_PATH_STYLE === 'true',
  } : {}),
});

async function getAdUrl(fileKey) {
  if (!fileKey) return null;
  if (USE_S3) {
    return getSignedUrl(s3, new GetObjectCommand({ Bucket: S3_BUCKET, Key: fileKey }), { expiresIn: 3600 });
  }
  return `/uploads/${fileKey}`;
}

async function deleteAdFile(fileKey) {
  if (!fileKey) return;
  if (USE_S3) {
    await s3.send(new DeleteObjectCommand({ Bucket: S3_BUCKET, Key: fileKey }));
  } else {
    const filePath = path.join(UPLOADS_DIR, fileKey);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }
}

async function saveAdFile(key, buffer, mimetype, originalname) {
  if (USE_S3) {
    await s3.send(new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: key,
      Body: buffer,
      ContentType: mimetype,
    }));
  } else {
    const filePath = path.join(UPLOADS_DIR, key);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, buffer);
  }
}

function makeAdKey(ext, mimetype) {
  const extension = ext || (mimetype.startsWith('video/') ? 'mp4' : 'jpg');
  return `ads/${Date.now()}_${Math.random().toString(36).slice(2)}.${extension}`;
}

module.exports = { USE_S3, UPLOADS_DIR, getAdUrl, deleteAdFile, saveAdFile, makeAdKey };