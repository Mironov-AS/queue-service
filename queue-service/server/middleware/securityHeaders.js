// The public booking page alone can be embedded by third-party sites.
// All administrative and existing pages retain their previous SAMEORIGIN policy.
const bookingPage =
	/^\/booking\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/?$/i;
function securityHeaders(req, res, next) {
	const embeddable =
		(req.method === "GET" || req.method === "HEAD") &&
		bookingPage.test(req.path);
	res.setHeader("X-Content-Type-Options", "nosniff");
	if (!embeddable) res.setHeader("X-Frame-Options", "SAMEORIGIN");
	res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
	if (process.env.NODE_ENV === "production")
		res.setHeader(
			"Strict-Transport-Security",
			"max-age=31536000; includeSubDomains",
		);
	const policy =
		"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: *; media-src blob: *; connect-src 'self' ws: wss: *;";
	res.setHeader(
		"Content-Security-Policy",
		policy + (embeddable ? " frame-ancestors *;" : " frame-ancestors 'self';"),
	);
	next();
}
module.exports = { securityHeaders };
