const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const rateLimit = require("express-rate-limit");
const { db } = require("../database");
const { getJwtSecret } = require("../config");
const { requireAuth } = require("../middleware/requireAuth");

const router = express.Router();

const loginLimiter = rateLimit({
	windowMs: 15 * 60 * 1000,
	max: 10,
	standardHeaders: true,
	legacyHeaders: false,
	message: { error: "Слишком много попыток входа. Попробуйте через 15 минут." },
});

router.post("/login", loginLimiter, async (req, res, next) => {
	try {
		// Support both username+password (queue-service UI) and email+password (main app)
		const { username, email, password } = req.body;
		const loginKey = username || email; // treat email as username for DB lookup
		if (
			!loginKey ||
			!password ||
			typeof loginKey !== "string" ||
			typeof password !== "string"
		) {
			return res.status(400).json({ error: "Логин и пароль обязательны" });
		}
		const user = await db
			.prepare("SELECT * FROM users WHERE username = ?")
			.get(loginKey);
		if (!user || !bcrypt.compareSync(password, user.password_hash)) {
			return res.status(401).json({ error: "Неверный логин или пароль" });
		}
		const secret = await getJwtSecret();
		const token = jwt.sign(
			{ id: user.id, username: user.username, role: user.role },
			secret,
			{ expiresIn: "24h" },
		);
		await db
			.prepare(
				"INSERT INTO action_logs (user_id, username, action) VALUES (?,?,?)",
			)
			.run(user.id, user.username, "user.login");
		res.json({
			token,
			user: { id: user.id, username: user.username, role: user.role },
		});
	} catch (err) {
		next(err);
	}
});

router.get("/me", requireAuth, (req, res) => {
	res.json(req.user);
});

module.exports = router;
