const { db } = require('../database');

function today() {
  return new Date().toISOString().split('T')[0];
}

async function nextTicketNumber(d) {
  const idRow = await db.prepare("SELECT value FROM settings WHERE key='queue_reset_last_id'").get();
  const lastId = parseInt(idRow?.value || '0', 10);
  const row = lastId
    ? await db.prepare("SELECT MAX(number) AS max FROM tickets WHERE date=? AND id > ?").get(d, lastId)
    : await db.prepare("SELECT MAX(number) AS max FROM tickets WHERE date=?").get(d);
  return (row?.max || 0) + 1;
}

function parseTicket(t) {
  return t ? { ...t, field_values: t.field_values ? JSON.parse(t.field_values) : [] } : null;
}

async function getQueueState(clientId = null) {
  const d = today();
  if (clientId) {
    const current = await db.pool.query(`
      SELECT t.*, s.name AS service_name, s.avg_duration_minutes
      FROM tickets t LEFT JOIN services s ON t.service_id = s.id
      WHERE t.date = $1 AND t.status = 'called' AND t.client_id = $2
      ORDER BY t.called_at DESC LIMIT 1
    `, [d, clientId]);

    const waiting = await db.pool.query(`
      SELECT t.*, s.name AS service_name, s.avg_duration_minutes
      FROM tickets t LEFT JOIN services s ON t.service_id = s.id
      WHERE t.date = $1 AND t.status = 'waiting' AND t.client_id = $2
      ORDER BY t.is_priority DESC, t.created_at ASC
    `, [d, clientId]);

    return { current: parseTicket(current.rows[0] || null), waiting: waiting.rows.map(parseTicket) };
  }

  const current = await db.pool.query(`
    SELECT t.*, s.name AS service_name, s.avg_duration_minutes
    FROM tickets t LEFT JOIN services s ON t.service_id = s.id
    WHERE t.date = $1 AND t.status = 'called'
    ORDER BY t.called_at DESC LIMIT 1
  `, [d]);

  const waiting = await db.pool.query(`
    SELECT t.*, s.name AS service_name, s.avg_duration_minutes
    FROM tickets t LEFT JOIN services s ON t.service_id = s.id
    WHERE t.date = $1 AND t.status = 'waiting'
    ORDER BY t.is_priority DESC, t.created_at ASC
  `, [d]);

  return { current: parseTicket(current.rows[0] || null), waiting: waiting.rows.map(parseTicket) };
}

async function getPublicQueueState(clientId = null) {
  const state = await getQueueState(clientId);
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
