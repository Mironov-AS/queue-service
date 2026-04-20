const db = require('../database');

function today() {
  return new Date().toISOString().split('T')[0];
}

function nextTicketNumber(d) {
  const idRow = db.prepare("SELECT value FROM settings WHERE key='queue_reset_last_id'").get();
  const lastId = parseInt(idRow?.value || '0', 10);
  const row = lastId
    ? db.prepare("SELECT MAX(number) AS max FROM tickets WHERE date=? AND id > ?").get(d, lastId)
    : db.prepare("SELECT MAX(number) AS max FROM tickets WHERE date=?").get(d);
  return (row?.max || 0) + 1;
}

function parseTicket(t) {
  return t ? { ...t, field_values: t.field_values ? JSON.parse(t.field_values) : [] } : null;
}

function getQueueState() {
  const d = today();
  const current = db.prepare(`
    SELECT t.*, s.name AS service_name, s.avg_duration_minutes
    FROM tickets t LEFT JOIN services s ON t.service_id = s.id
    WHERE t.date = ? AND t.status = 'called'
    ORDER BY t.called_at DESC LIMIT 1
  `).get(d);

  const waiting = db.prepare(`
    SELECT t.*, s.name AS service_name, s.avg_duration_minutes
    FROM tickets t LEFT JOIN services s ON t.service_id = s.id
    WHERE t.date = ? AND t.status = 'waiting'
    ORDER BY t.is_priority DESC, t.created_at ASC
  `).all(d);

  return { current: parseTicket(current), waiting: waiting.map(parseTicket) };
}

function getPublicQueueState() {
  const state = getQueueState();
  const stripPii = (t) => t ? {
    id: t.id, number: t.number, service_name: t.service_name,
    status: t.status, called_at: t.called_at, is_priority: t.is_priority
  } : null;
  const currentPublic = state.current ? {
    ...stripPii(state.current),
    field_values: state.current.field_values || []
  } : null;
  return {
    current: currentPublic,
    waiting: state.waiting.map(t => ({ ...stripPii(t), field_values: t.field_values || [] }))
  };
}

module.exports = { today, nextTicketNumber, getQueueState, getPublicQueueState };