// Limiter of authentication attempts.
//
// The application is published through a proxy, so every visitor of the site
// reaches the server from one address. Limiting by IP would therefore block
// the administrator of the service together with any other client, and normal
// successful logins would consume the budget. The limit is applied to the
// account name instead, and only failed attempts are counted.
const rateLimit = require("express-rate-limit");

const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;

function accountKey(req) {
	const raw = req && req.body && typeof req.body.username === "string"
		? req.body.username.trim().toLowerCase()
		: "";
	// An attempt without a name is counted separately from any account.
	return raw || "без-имени";
}

const loginLimiter = rateLimit({
	windowMs: WINDOW_MS,
	max: MAX_ATTEMPTS,
	standardHeaders: true,
	legacyHeaders: false,
	skipSuccessfulRequests: true,
	keyGenerator: accountKey,
	message: {
		error: "Слишком много попыток входа. Попробуйте через 15 минут.",
	},
});

module.exports = { loginLimiter, accountKey, WINDOW_MS, MAX_ATTEMPTS };
