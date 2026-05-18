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
	fs.mkdirSync(path.join(UPLOADS_DIR, "logo"), { recursive: true });
}

const s3 = new S3Client({
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

// ── Ad helpers ────────────────────────────────────────────────────────────────

async function getAdUrl(fileKey) {
	if (!fileKey) return null;
	if (USE_S3) {
		return getSignedUrl(
			s3,
			new GetObjectCommand({ Bucket: S3_BUCKET, Key: fileKey }),
			{ expiresIn: 3600 },
		);
	}
	// SPA runs behind nginx at /queue/ — include prefix for browser access
	return `/queue/uploads/${fileKey}`;
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

async function saveAdFile(key, buffer, mimetype) {
	if (USE_S3) {
		await s3.send(
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

// ── Logo helpers ──────────────────────────────────────────────────────────────
// Logo is stored under uploads/logo/ subdirectory.
// makeLogoKey returns just the filename (e.g. "abc123.webp").
// saveLogoFile always writes to uploads/logo/.
// getLogoUrl returns /queue/uploads/logo/<filename>.
// deleteLogoFile always deletes from uploads/logo/.

function makeLogoKey(ext) {
	const extension = (ext || "png").toLowerCase().replace(/^\.+/, "");
	return `${Date.now()}_${Math.random().toString(36).slice(2)}.${extension}`;
}

async function getLogoUrl(fileKey) {
	if (!fileKey) return null;
	if (USE_S3) {
		return getSignedUrl(
			s3,
			new GetObjectCommand({ Bucket: S3_BUCKET, Key: `logo/${fileKey}` }),
			{ expiresIn: 3600 },
		);
	}
	// SPA runs behind nginx at /queue/ — include prefix for browser access
	return `/queue/uploads/logo/${fileKey}`;
}

async function deleteLogoFile(fileKey) {
	if (!fileKey) return;
	if (USE_S3) {
		await s3.send(
			new DeleteObjectCommand({ Bucket: S3_BUCKET, Key: `logo/${fileKey}` }),
		);
	} else {
		const filePath = path.join(UPLOADS_DIR, "logo", fileKey);
		if (fs.existsSync(filePath)) {
			fs.unlinkSync(filePath);
		}
	}
}

async function saveLogoFile(key, buffer, mimetype) {
	if (USE_S3) {
		await s3.send(
			new PutObjectCommand({
				Bucket: S3_BUCKET,
				Body: buffer,
				ContentType: mimetype,
				Key: `logo/${key}`,
			}),
		);
	} else {
		// key is just the filename — always save to uploads/logo/
		const filePath = path.join(UPLOADS_DIR, "logo", key);
		fs.mkdirSync(path.dirname(filePath), { recursive: true });
		fs.writeFileSync(filePath, buffer);
	}
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
};