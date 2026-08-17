const express = require("express");
const db = require("../database");
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

router.get("/:id/fields", (req, res) => {
	const id = parseId(req.params.id);
	if (!id) return res.status(400).json({ error: "Некорректный id" });
	const fields = db
		.prepare(
			"SELECT * FROM service_fields WHERE service_id = ? ORDER BY order_index ASC, id ASC",
		)
		.all(id);
	res.json(fields);
});

router.post("/:id/fields", requireAuth, (req, res) => {
	const id = parseId(req.params.id);
	if (!id) return res.status(400).json({ error: "Некорректный id" });
	const { label, field_type, required, require_check } = req.body;
	if (!label?.trim())
		return res.status(400).json({ error: "Название поля обязательно" });
	const ft =
		field_type && VALID_FIELD_TYPES.includes(field_type) ? field_type : "text";
	const maxOrder = db
		.prepare(
			"SELECT COALESCE(MAX(order_index), -1) AS m FROM service_fields WHERE service_id = ?",
		)
		.get(id);
	const r = db
		.prepare(
			"INSERT INTO service_fields (service_id, label, field_type, required, require_check, order_index) VALUES (?,?,?,?,?,?)",
		)
		.run(
			id,
			label.trim(),
			ft,
			required ? 1 : 0,
			require_check ? 1 : 0,
			maxOrder.m + 1,
		);
	res.json(
		db
			.prepare("SELECT * FROM service_fields WHERE id = ?")
			.get(r.lastInsertRowid),
	);
});

router.put("/:id", requireAuth, (req, res) => {
	const id = parseId(req.params.id);
	if (!id) return res.status(400).json({ error: "Некорректный id" });
	const { label, field_type, required, require_check, order_index } = req.body;
	const field = db.prepare("SELECT * FROM service_fields WHERE id = ?").get(id);
	if (!field) return res.status(404).json({ error: "Not found" });
	const ft = field_type
		? VALID_FIELD_TYPES.includes(field_type)
			? field_type
			: field.field_type
		: field.field_type;
	db.prepare(
		"UPDATE service_fields SET label=?, field_type=?, required=?, require_check=?, order_index=? WHERE id=?",
	).run(
		label ?? field.label,
		ft,
		required !== undefined ? (required ? 1 : 0) : field.required,
		require_check !== undefined
			? require_check
				? 1
				: 0
			: field.require_check || 0,
		order_index !== undefined ? order_index : field.order_index,
		id,
	);
	res.json(db.prepare("SELECT * FROM service_fields WHERE id = ?").get(id));
});

router.delete("/:id", requireAuth, (req, res) => {
	const id = parseId(req.params.id);
	if (!id) return res.status(400).json({ error: "Некорректный id" });
	db.prepare("DELETE FROM service_fields WHERE id = ?").run(id);
	res.json({ success: true });
});

// POST /api/service-fields/check-duplicate — проверить, есть ли активный талон с такими значениями доп.полей
router.post("/check-duplicate", (req, res) => {
	const { service_id, field_values } = req.body;

	if (
		!service_id ||
		!Array.isArray(field_values) ||
		field_values.length === 0
	) {
		return res.json({ duplicate: false, ticket: null });
	}

	// Получаем поля услуги с require_check = 1
	const checkFields = db
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
	const activeTickets = db
		.prepare(`
    SELECT t.*, s.name AS service_name 
    FROM tickets t 
    LEFT JOIN services s ON t.service_id = s.id 
    WHERE t.service_id = ? 
      AND t.date = ? 
      AND t.status IN ('waiting', 'called')
  `)
		.all(service_id, today);

	// Для каждого талона проверяем совпадение по всем проверяемым полям
	for (const ticket of activeTickets) {
		let ticketFields = [];
		if (ticket.field_values) {
			try {
				ticketFields = JSON.parse(ticket.field_values);
			} catch (e) {
				ticketFields = [];
			}
		}

		// Проверяем совпадение хотя бы по одному проверяемому полю
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
});

module.exports = router;
