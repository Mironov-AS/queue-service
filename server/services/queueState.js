const { db, getClientSetting } = require('../database');

function today() {
  return new Date().toISOString().split('T')[0];
}

async function nextTicketNumber(d, clientId = null) {
  const resetVal = await getClientSetting('queue_reset_last_id', clientId, '0');
  const lastId = parseInt(resetVal, 10);
  let row;
  if (clientId) {
    row = lastId
      ? await db.prepare("SELECT MAX(number) AS max FROM tickets WHERE date=? AND id > ? AND client_id=?").get(d, lastId, clientId)
      : await db.prepare("SELECT MAX(number) AS max FROM tickets WHERE date=? AND client_id=?").get(d, clientId);
  } else {
    row = lastId
      ? await db.prepare("SELECT MAX(number) AS max FROM tickets WHERE date=? AND id > ? AND client_id IS NULL").get(d, lastId)
      : await db.prepare("SELECT MAX(number) AS max FROM tickets WHERE date=? AND client_id IS NULL").get(d);
  }
  return (row?.max || 0) + 1;
}

function parseTicket(t) {
  return t ? { ...t, field_values: t.field_values ? JSON.parse(t.field_values) : [] } : null;
}

async function getWindowsCount(clientId) {
  const val = await getClientSetting('windows_count', clientId, '1');
  return Math.max(1, parseInt(val, 10) || 1);
}

async function getQueueState(clientId = null) {
  const windowsCount = await getWindowsCount(clientId);
  if (!clientId) return { current: [], waiting: [], windows_count: windowsCount };
  const d = today();

  const called = await db.pool.query(`
    SELECT t.*, s.name AS service_name, s.avg_duration_minutes
    FROM tickets t LEFT JOIN services s ON t.service_id = s.id
    WHERE t.date = $1 AND t.status = 'called' AND t.client_id = $2
    ORDER BY t.called_at DESC
  `, [d, clientId]);

  const waiting = await db.pool.query(`
    SELECT t.*, s.name AS service_name, s.avg_duration_minutes
    FROM tickets t LEFT JOIN services s ON t.service_id = s.id
    WHERE t.date = $1 AND t.status = 'waiting' AND t.client_id = $2
    ORDER BY t.is_priority DESC, t.created_at ASC
  `, [d, clientId]);

  return {
    current: called.rows.map(parseTicket),
    waiting: waiting.rows.map(parseTicket),
    windows_count: windowsCount,
  };
}

async function getActiveClientIds() {
  const d = today();
  const rows = await db.pool.query(
    "SELECT DISTINCT client_id FROM tickets WHERE date = $1 AND client_id IS NOT NULL AND status IN ('waiting', 'called')",
    [d]
  );
  return rows.rows.map(r => r.client_id);
}

async function getPublicQueueState(clientId = null) {
  const state = await getQueueState(clientId);
  const stripPii = (t) => t ? {
    id: t.id, number: t.number, service_name: t.service_name,
    status: t.status, called_at: t.called_at, is_priority: t.is_priority,
    window_number: t.window_number,
  } : null;
  return {
    current: state.current.map(t => ({
      ...stripPii(t),
      field_values: t.field_values || [],
    })),
    waiting: state.waiting.map(t => ({ ...stripPii(t), field_values: t.field_values || [] })),
    windows_count: state.windows_count,
  };
}

module.exports = { today, nextTicketNumber, getQueueState, getPublicQueueState, getActiveClientIds };
