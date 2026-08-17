const express = require("express");
const { db } = require("../database");
const { requireAuth } = require("../middleware/requireAuth");

const router = express.Router();

const VALID_FIELD_TYPES = [
	"text",
	"phone",
	"number",
	"date",
	"email",
	"textarea",
];

function parseId(val) {
	const id = parseInt(val, 10);
	return Number.isInteger(id) && id > 0 ? id : null;
}

router.get("/:id/fields", async (req, res, next) => {
	try {
		const id = parseId(req.params.id);
		if (!id) return res.status(400).json({ error: "Некорректный id" });
		const fields = await db
			.prepare(
				"SELECT * FROM service_fields WHERE service_id = ? ORDER BY order_index ASC, id ASC",
			)
			.all(id);
		res.json(fields);
	} catch (err) {
		next(err);
	}
});

router.post("/:id/fields", requireAuth, async (req, res, next) => {
	try {
		const id = parseId(req.params.id);
		if (!id) return res.status(400).json({ error: "Некорректный id" });
		const clientId = req.user.clientId || null;
		if (clientId) {
			const svc = await db
				.prepare("SELECT id FROM services WHERE id = ? AND client_id = ?")
				.get(id, clientId);
			if (!svc) return res.status(404).json({ error: "Услуга не найдена" });
		}
		const { label, field_type, required, require_check } = req.body;
		if (!label?.trim())
			return res.status(400).json({ error: "Название поля обязательно" });
		const ft =
			field_type && VALID_FIELD_TYPES.includes(field_type)
				? field_type
				: "text";
		const maxOrder = await db
			.prepare(
				"SELECT COALESCE(MAX(order_index), -1) AS m FROM service_fields WHERE service_id = ?",
			)
			.get(id);
		const { rows } = await db.pool.query(
			"INSERT INTO service_fields (service_id, label, field_type, required, require_check, order_index) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id",
			[
				id,
				label.trim(),
				ft,
				required ? 1 : 0,
				require_check ? 1 : 0,
				parseInt(maxOrder.m) + 1,
			],
		);
		const field = await db
			.prepare("SELECT * FROM service_fields WHERE id = ?")
			.get(rows[0].id);
		res.json(field);
	} catch (err) {
		next(err);
	}
});

router.put("/:id", requireAuth, async (req, res, next) => {
	try {
		const id = parseId(req.params.id);
		if (!id) return res.status(400).json({ error: "Некорректный id" });
		const { label, field_type, required, require_check, order_index } =
			req.body;
		const field = await db
			.prepare("SELECT * FROM service_fields WHERE id = ?")
			.get(id);
		if (!field) return res.status(404).json({ error: "Not found" });
		const clientId = req.user.clientId || null;
		if (clientId) {
			const svc = await db
				.prepare("SELECT id FROM services WHERE id = ? AND client_id = ?")
				.get(field.service_id, clientId);
			if (!svc) return res.status(403).json({ error: "Нет доступа" });
		}
		const ft = field_type
			? VALID_FIELD_TYPES.includes(field_type)
				? field_type
				: field.field_type
			: field.field_type;
		await db.pool.query(
			"UPDATE service_fields SET label=$1, field_type=$2, required=$3, require_check=$4, order_index=$5 WHERE id=$6",
			[
				label ?? field.label,
				ft,
				required !== undefined ? (required ? 1 : 0) : field.required,
				require_check !== undefined
					? require_check
						? 1
						: 0
					: field.require_check,
				order_index !== undefined ? order_index : field.order_index,
				id,
			],
		);
		const updated = await db
			.prepare("SELECT * FROM service_fields WHERE id = ?")
			.get(id);
		res.json(updated);
	} catch (err) {
		next(err);
	}
});

router.delete("/:id", requireAuth, async (req, res, next) => {
	try {
		const id = parseId(req.params.id);
		if (!id) return res.status(400).json({ error: "Некорректный id" });
		const field = await db
			.prepare("SELECT * FROM service_fields WHERE id = ?")
			.get(id);
		if (!field) return res.status(404).json({ error: "Not found" });
		const clientId = req.user.clientId || null;
		if (clientId) {
			const svc = await db
				.prepare("SELECT id FROM services WHERE id = ? AND client_id = ?")
				.get(field.service_id, clientId);
			if (!svc) return res.status(403).json({ error: "Нет доступа" });
		}
		await db.prepare("DELETE FROM service_fields WHERE id = ?").run(id);
		res.json({ success: true });
	} catch (err) {
		next(err);
	}
});

// POST /api/service-fields/check-duplicate — проверить, есть ли активный талон с такими значениями доп.полей
router.post("/check-duplicate", async (req, res, next) => {
	try {
		const { service_id, field_values, client_id } = req.body;

		if (
			!service_id ||
			!Array.isArray(field_values) ||
			field_values.length === 0
		) {
			return res.json({ duplicate: false, ticket: null });
		}

		// Получаем поля услуги с require_check = 1
		const checkFields = await db
			.prepare(
				"SELECT * FROM service_fields WHERE service_id = ? AND require_check = 1",
			)
			.all(service_id);

		if (checkFields.length === 0) {
			return res.json({ duplicate: false, ticket: null });
		}

		// Фильтруем только те значения, которые соответствуют полям с require_check
		const checkFieldIds = new Set(checkFields.map((f) => f.id));
		const valuesToCheck = field_values.filter((fv) =>
			checkFieldIds.has(fv.field_id),
		);

		if (valuesToCheck.length === 0) {
			return res.json({ duplicate: false, ticket: null });
		}

		// Находим все активные талоны (waiting или called) для этой услуги за сегодня
		const today = new Date().toISOString().split("T")[0];
		let query = `
      SELECT t.*, s.name AS service_name 
      FROM tickets t 
      LEFT JOIN services s ON t.service_id = s.id 
      WHERE t.service_id = ? 
        AND t.date = ? 
        AND t.status IN ('waiting', 'called')
    `;
		const params = [service_id, today];

		if (client_id) {
			query += " AND t.client_id = ?";
			params.push(client_id);
		}

		const activeTickets = await db.prepare(query).all(...params);

		// Для каждого талона проверяем совпадение по всем проверяемым полям
		for (const ticket of activeTickets) {
			const ticketFields = ticket.field_values
				? typeof ticket.field_values === "string"
					? JSON.parse(ticket.field_values)
					: ticket.field_values
				: [];

			// Проверяем, есть ли совпадение хотя бы по одному проверяемому полю
			let hasMatch = true;
			for (const checkField of valuesToCheck) {
				const ticketField = ticketFields.find(
					(fv) => Number(fv.field_id) === Number(checkField.field_id),
				);
				if (!ticketField) {
					hasMatch = false;
					break;
				}
				// Сравниваем значения (регистронезависимо для текста)
				const ticketValue = (ticketField.value || "")
					.toString()
					.toLowerCase()
					.trim();
				const checkValue = (checkField.value || "")
					.toString()
					.toLowerCase()
					.trim();

				if (ticketValue !== checkValue) {
					hasMatch = false;
					break;
				}
			}

			if (hasMatch) {
				return res.json({
					duplicate: true,
					ticket: {
						id: ticket.id,
						number: ticket.number,
						status: ticket.status,
						service_name: ticket.service_name,
						created_at: ticket.created_at,
					},
				});
			}
		}

		return res.json({ duplicate: false, ticket: null });
	} catch (err) {
		next(err);
	}
});

module.exports = router;
