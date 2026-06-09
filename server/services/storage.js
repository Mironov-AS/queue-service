const {
	S3Client,
	PutObjectCommand,
	DeleteObjectCommand,
	GetObjectCommand,
} = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const path = require("path");
const fs = require("fs");

const S3_BUCKET = process.env.AWS_S3_BUCKET || "";
const S3_REGION = process.env.AWS_REGION || "us-east-1";
const USE_S3 = !!(
	S3_BUCKET &&
	process.env.AWS_ACCESS_KEY_ID &&
	process.env.AWS_SECRET_ACCESS_KEY
);

const DATA_DIR = process.env.DATA_DIR || __dirname;
const UPLOADS_DIR = path.join(DATA_DIR, "uploads");

if (!USE_S3) {
	fs.mkdirSync(path.join(UPLOADS_DIR, "ads"), { recursive: true });
}

// ── S3 client (lazy init — only created when USE_S3 = true) ─────────────────
let s3 = null;
function getS3() {
	if (!s3) {
		s3 = new S3Client({
			region: S3_REGION,
			credentials: {
				accessKeyId: process.env.AWS_ACCESS_KEY_ID || "",
				secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "",
			},
			...(process.env.AWS_ENDPOINT_URL
				? {
						endpoint: process.env.AWS_ENDPOINT_URL,
						forcePathStyle: process.env.AWS_S3_FORCE_PATH_STYLE === "true",
					}
				: {}),
		});
	}
	return s3;
}

// ── Ad helpers (local/S3 — keep unchanged) ───────────────────────────────────

async function getAdUrl(fileKey) {
	if (!fileKey) return null;
	if (USE_S3) {
		return getSignedUrl(
			getS3(),
			new GetObjectCommand({ Bucket: S3_BUCKET, Key: fileKey }),
			{ expiresIn: 3600 },
		);
	}
	return `/queue/uploads/${fileKey}`;
}

async function deleteAdFile(fileKey) {
	if (!fileKey) return;
	if (USE_S3) {
		await getS3().send(
			new DeleteObjectCommand({ Bucket: S3_BUCKET, Key: fileKey }),
		);
	} else {
		const filePath = path.join(UPLOADS_DIR, fileKey);
		if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
	}
}

async function saveAdFile(key, buffer, mimetype) {
	if (USE_S3) {
		await getS3().send(
			new PutObjectCommand({
				Bucket: S3_BUCKET,
				Body: buffer,
				ContentType: mimetype,
				Key: key,
			}),
		);
	} else {
		const filePath = path.join(UPLOADS_DIR, key);
		fs.mkdirSync(path.dirname(filePath), { recursive: true });
		fs.writeFileSync(filePath, buffer);
	}
}

function makeAdKey(ext, mimetype) {
	const extension = ext || (mimetype.startsWith("video/") ? "mp4" : "jpg");
	return `ads/${Date.now()}_${Math.random().toString(36).slice(2)}.${extension}`;
}

// ── Logo helpers (PostgreSQL BYTEA — always in DB, no local/S3) ──────────────
// Logo is stored ONLY in the database as BYTEA.
// The settings table stores logo_key (filename) under 'dashboard_logo_key'.
// The binary blob is stored in logo_blobs (key, data BYTEA, mime_type).
// These functions delegate to database.js — no circular dependency since
// database.js does NOT require storage.js.
const {
	saveLogoData: _dbSaveLogoData,
	getLogoData: _dbGetLogoData,
	deleteLogoData: _dbDeleteLogoData,
} = require("../database");

function makeLogoKey(ext) {
	const extension = (ext || "png").toLowerCase().replace(/^\.+/, "");
	return `${Date.now()}_${Math.random().toString(36).slice(2)}.${extension}`;
}

async function saveLogoData(key, buffer, mimetype) {
	await _dbSaveLogoData(key, buffer, mimetype);
}

async function getLogoData(key) {
	return _dbGetLogoData(key);
}

async function deleteLogoData(key) {
	await _dbDeleteLogoData(key);
}

// getLogoUrl / deleteLogoFile / saveLogoFile — no longer used for logo.
// kept as no-ops so routes/settings.js doesn't break.
async function getLogoUrl(_fileKey) {
	return null; // logo served via /api/settings/logo/data
}

async function deleteLogoFile(_fileKey) {
	// no-op: deleteLogoData is called instead
}

async function saveLogoFile(_key, _buffer, _mimetype) {
	// no-op: saveLogoData is called instead
}

module.exports = {
	USE_S3,
	UPLOADS_DIR,
	getAdUrl,
	deleteAdFile,
	saveAdFile,
	makeAdKey,
	makeLogoKey,
	getLogoUrl,
	deleteLogoFile,
	saveLogoFile,
	// DB-based logo
	saveLogoData,
	getLogoData,
	deleteLogoData,
};
