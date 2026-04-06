import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import socket from '../socket';
import { apiFetch, authHeaders } from '../api';

// ─── Tiny helpers ─────────────────────────────────────────────────────────────

const Icon = ({ d, cls = 'w-5 h-5' }) => (
  <svg className={cls} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d={d} />
  </svg>
);

const P = {
  queue: 'M4 6h16M4 10h16M4 14h8',
  services: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2',
  stats: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z',
  qr: 'M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z',
  log: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
  settings: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z',
  next: 'M13 9l3 3m0 0l-3 3m3-3H8m13 0a9 9 0 11-18 0 9 9 0 0118 0z',
  repeat: 'M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15',
  skip: 'M13 5l7 7-7 7M5 5l7 7-7 7',
  cancel: 'M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z',
  transfer: 'M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4',
  plus: 'M12 4v16m8-8H4',
  edit: 'M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z',
  trash: 'M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16',
  person: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z',
  logout: 'M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1',
  check: 'M5 13l4 4L19 7',
  print: 'M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z',
  clock: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z',
  download: 'M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4',
  eye: 'M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z',
  priority: 'M5 3l14 9-14 9V3z',
  fields: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01',
  up: 'M5 15l7-7 7 7',
  down: 'M19 9l-7 7-7-7',
  star: 'M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z',
};

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d + 'T00:00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' });
}

function fmtTime(dt) {
  if (!dt) return '—';
  return new Date(dt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

const STATUS_LABELS = { waiting: 'Ожидает', called: 'Вызван', served: 'Обслужен', skipped: 'Пропущен', cancelled: 'Отменён' };
const STATUS_COLORS = {
  waiting: 'bg-blue-100 text-blue-800',
  called: 'bg-green-100 text-green-800',
  served: 'bg-gray-100 text-gray-600',
  skipped: 'bg-amber-100 text-amber-800',
  cancelled: 'bg-red-100 text-red-700',
};

// ─── Modal ────────────────────────────────────────────────────────────────────

function Modal({ title, onClose, children }) {
  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-gray-900">{title}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

const SKIP_REASONS = ['Не явился', 'Отказался от услуги', 'Ушёл из очереди', 'Другая причина'];
const CANCEL_REASONS = ['Отмена по запросу', 'Дублирующий талон', 'Техническая ошибка', 'Другая причина'];

// ─── Queue Tab ────────────────────────────────────────────────────────────────

function QueueTab() {
  const [queue, setQueue] = useState({ current: null, waiting: [] });
  const [loading, setLoading] = useState(false);
  const [skipModal, setSkipModal] = useState(false);
  const [cancelModal, setCancelModal] = useState(false);
  const [transferModal, setTransferModal] = useState(null);
  const [manualModal, setManualModal] = useState(false);
  const [callConfirm, setCallConfirm] = useState(null);
  const [skipReason, setSkipReason] = useState('');
  const [cancelReason, setCancelReason] = useState('');
  const [services, setServices] = useState([]);
  const [filterStatus, setFilterStatus] = useState('');
  const [filterService, setFilterService] = useState('');
  const [allTickets, setAllTickets] = useState([]);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    fetch('/api/queue').then(r => r.json()).then(setQueue);
    fetch('/api/services?all=1').then(r => r.json()).then(setServices);
    socket.on('queue:updated', setQueue);
    return () => socket.off('queue:updated', setQueue);
  }, []);

  const loadAllTickets = useCallback(async () => {
    const params = new URLSearchParams();
    if (filterStatus) params.set('status', filterStatus);
    if (filterService) params.set('service_id', filterService);
    const r = await apiFetch(`/api/tickets?${params}`);
    if (r) setAllTickets(await r.json());
  }, [filterStatus, filterService]);

  useEffect(() => {
    if (showAll) loadAllTickets();
  }, [showAll, filterStatus, filterService, loadAllTickets, queue]);

  const callNext = async () => {
    setLoading(true);
    await apiFetch('/api/queue/next', { method: 'POST' });
    setLoading(false);
  };

  const complete = async () => {
    await apiFetch('/api/queue/complete', { method: 'POST' });
  };

  const repeat = async () => {
    await apiFetch('/api/queue/repeat', { method: 'POST' });
  };

  const doSkip = async () => {
    await apiFetch('/api/queue/skip', {
      method: 'POST', body: JSON.stringify({ reason: skipReason })
    });
    setSkipModal(false); setSkipReason('');
  };

  const doCancel = async () => {
    await apiFetch('/api/queue/cancel-current', {
      method: 'POST', body: JSON.stringify({ reason: cancelReason })
    });
    setCancelModal(false); setCancelReason('');
  };

  const callSpecific = async (ticket) => {
    if (queue.current) {
      setCallConfirm(ticket);
    } else {
      setLoading(true);
      await apiFetch(`/api/queue/call/${ticket.id}`, { method: 'POST' });
      setLoading(false);
    }
  };

  const doCallSpecific = async () => {
    if (!callConfirm) return;
    setLoading(true);
    await apiFetch(`/api/queue/call/${callConfirm.id}`, { method: 'POST' });
    setCallConfirm(null);
    setLoading(false);
  };

  const doTransfer = async (ticketId, serviceId) => {
    await apiFetch(`/api/tickets/${ticketId}/transfer`, {
      method: 'PUT', body: JSON.stringify({ service_id: serviceId })
    });
    setTransferModal(null);
  };

  const resetQueue = async () => {
    if (!confirm('Сбросить всю очередь?')) return;
    await apiFetch('/api/queue/reset', { method: 'POST' });
  };

  const hasNext = queue.waiting.length > 0;

  return (
    <div className="space-y-5">
      {/* Current */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">Сейчас обслуживается</h3>
        {queue.current ? (
          <div className="flex flex-wrap items-start gap-4">
            <div className="flex-1 min-w-0">
              <div className="text-6xl font-black text-blue-600 leading-none">№{queue.current.number}</div>
              <div className="mt-2 text-gray-700 font-medium">{queue.current.service_name || '—'}</div>
              {queue.current.name && <div className="text-sm text-gray-500 mt-1">{queue.current.name}</div>}
              {queue.current.phone && <div className="text-sm text-gray-400">{queue.current.phone}</div>}
              {Array.isArray(queue.current.field_values) && queue.current.field_values.filter(fv => fv.value).length > 0 && (
                <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5">
                  {queue.current.field_values.filter(fv => fv.value).map((fv, i) => (
                    <div key={i} className="text-sm">
                      <span className="text-gray-400 text-xs">{fv.label}:</span>
                      <span className="ml-1 font-medium text-gray-700">{fv.value}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <button onClick={callNext} disabled={loading || !hasNext}
                className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white font-semibold px-4 py-2.5 rounded-xl transition text-sm">
                <Icon d={P.next} cls="w-4 h-4" /> Следующий
              </button>
              <button onClick={complete}
                className="flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white font-semibold px-4 py-2.5 rounded-xl transition text-sm">
                <Icon d={P.check} cls="w-4 h-4" /> Завершить
              </button>
              <button onClick={repeat}
                className="flex items-center gap-2 bg-indigo-100 hover:bg-indigo-200 text-indigo-800 font-semibold px-4 py-2.5 rounded-xl transition text-sm">
                <Icon d={P.repeat} cls="w-4 h-4" /> Повторить
              </button>
              <button onClick={() => setSkipModal(true)}
                className="flex items-center gap-2 bg-amber-100 hover:bg-amber-200 text-amber-800 font-semibold px-4 py-2.5 rounded-xl transition text-sm">
                <Icon d={P.skip} cls="w-4 h-4" /> Пропустить
              </button>
              <button onClick={() => setCancelModal(true)}
                className="flex items-center gap-2 bg-red-100 hover:bg-red-200 text-red-800 font-semibold px-4 py-2.5 rounded-xl transition text-sm">
                <Icon d={P.cancel} cls="w-4 h-4" /> Отменить
              </button>
              <button onClick={() => setTransferModal(queue.current)}
                className="flex items-center gap-2 bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold px-4 py-2.5 rounded-xl transition text-sm">
                <Icon d={P.transfer} cls="w-4 h-4" /> Перевести
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-4">
            <div className="text-gray-400 flex-1">Никого нет</div>
            <button onClick={callNext} disabled={loading || !hasNext}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white font-semibold px-5 py-3 rounded-xl transition">
              <Icon d={P.next} /> Пригласить первого
            </button>
          </div>
        )}
      </div>

      {/* Waiting */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
            В очереди — {queue.waiting.length}
          </h3>
          <div className="flex gap-2">
            <button onClick={() => setManualModal(true)}
              className="flex items-center gap-1.5 text-sm bg-blue-50 hover:bg-blue-100 text-blue-700 font-medium px-3 py-1.5 rounded-lg">
              <Icon d={P.plus} cls="w-4 h-4" /> Ручная регистрация
            </button>
            {queue.waiting.length > 0 && (
              <button onClick={resetQueue} className="text-sm text-red-400 hover:text-red-600 flex items-center gap-1 px-3 py-1.5">
                <Icon d={P.repeat} cls="w-4 h-4" /> Сбросить всех
              </button>
            )}
          </div>
        </div>

        {queue.waiting.length === 0 ? (
          <p className="text-center text-gray-400 py-8">Очередь пуста</p>
        ) : (
          <div className="space-y-2 max-h-[32rem] overflow-y-auto">
            {queue.waiting.map((t, i) => {
              const filledFields = Array.isArray(t.field_values) ? t.field_values.filter(fv => fv.value) : [];
              return (
                <div key={t.id} className={`px-4 py-3 rounded-xl ${i === 0 ? 'bg-blue-50 border border-blue-200' : 'bg-gray-50'}`}>
                  <div className="flex items-center gap-3">
                    {t.is_priority && <Icon d={P.priority} cls="w-4 h-4 text-orange-500 shrink-0" />}
                    <span className={`text-2xl font-black w-14 shrink-0 ${i === 0 ? 'text-blue-700' : 'text-gray-700'}`}>№{t.number}</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-gray-700 truncate">{t.service_name || '—'}</div>
                      {t.name && <div className="text-xs text-gray-500 truncate">{t.name}</div>}
                    </div>
                    <span className="text-xs text-gray-400 flex items-center gap-1 shrink-0">
                      <Icon d={P.clock} cls="w-3.5 h-3.5" />~{(i + 1) * (t.avg_duration_minutes || 5)} мин
                    </span>
                    <button onClick={() => callSpecific(t)} disabled={loading}
                      className="p-1.5 text-gray-300 hover:text-green-600 rounded shrink-0" title="Вызвать этого клиента">
                      <Icon d={P.next} cls="w-4 h-4" />
                    </button>
                    <button onClick={() => setTransferModal(t)} className="p-1.5 text-gray-300 hover:text-blue-500 rounded shrink-0">
                      <Icon d={P.transfer} cls="w-4 h-4" />
                    </button>
                  </div>
                  {filledFields.length > 0 && (
                    <div className="mt-2 ml-[4.25rem] flex flex-wrap gap-x-4 gap-y-1">
                      {filledFields.map((fv, j) => (
                        <div key={j} className="text-xs">
                          <span className="text-gray-400">{fv.label}:</span>
                          <span className="ml-1 font-medium text-gray-600">{fv.value}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* All tickets toggle */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Все талоны за сегодня</h3>
          <button onClick={() => setShowAll(v => !v)} className="text-sm text-blue-600 hover:underline">
            {showAll ? 'Скрыть' : 'Показать'}
          </button>
        </div>
        {showAll && (
          <>
            <div className="flex flex-wrap gap-2 mb-3">
              <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
                className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-400">
                <option value="">Все статусы</option>
                {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              <select value={filterService} onChange={e => setFilterService(e.target.value)}
                className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-400">
                <option value="">Все услуги</option>
                {services.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100">
                    <th className="text-left px-3 py-2 text-gray-500 font-medium">№</th>
                    <th className="text-left px-3 py-2 text-gray-500 font-medium">Услуга</th>
                    <th className="text-left px-3 py-2 text-gray-500 font-medium">Имя</th>
                    <th className="text-left px-3 py-2 text-gray-500 font-medium">Статус</th>
                    <th className="text-left px-3 py-2 text-gray-500 font-medium">Получен</th>
                    <th className="text-left px-3 py-2 text-gray-500 font-medium">Вызван</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {allTickets.length === 0 && (
                    <tr><td colSpan={6} className="text-center py-6 text-gray-400">Нет данных</td></tr>
                  )}
                  {allTickets.map(t => (
                    <tr key={t.id} className="hover:bg-gray-50 align-top">
                      <td className="px-3 py-2 font-bold text-gray-700">
                        {t.is_priority ? '★ ' : ''}№{t.number}
                      </td>
                      <td className="px-3 py-2 text-gray-600">{t.service_name || '—'}</td>
                      <td className="px-3 py-2 text-gray-500">
                        <div>{t.name || '—'}</div>
                        {Array.isArray(t.field_values) && t.field_values.length > 0 && (
                          <div className="mt-1 space-y-0.5">
                            {t.field_values.map((fv, i) => (
                              <div key={i} className="text-xs text-gray-400">
                                <span className="font-medium text-gray-500">{fv.label}:</span> {fv.value || '—'}
                              </div>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[t.status] || ''}`}>
                          {STATUS_LABELS[t.status] || t.status}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-gray-400 tabular-nums">{fmtTime(t.created_at)}</td>
                      <td className="px-3 py-2 text-gray-400 tabular-nums">{fmtTime(t.called_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* Modals */}
      {skipModal && (
        <Modal title="Пропустить посетителя" onClose={() => setSkipModal(false)}>
          <div className="space-y-3">
            <p className="text-sm text-gray-500">Укажите причину пропуска:</p>
            {SKIP_REASONS.map(r => (
              <label key={r} className="flex items-center gap-3 cursor-pointer">
                <input type="radio" name="skip_reason" value={r} checked={skipReason === r}
                  onChange={e => setSkipReason(e.target.value)} className="text-blue-600" />
                <span className="text-sm">{r}</span>
              </label>
            ))}
            <input type="text" value={skipReason} onChange={e => setSkipReason(e.target.value)}
              placeholder="Или введите свою причину..."
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
            <div className="flex gap-2 pt-2">
              <button onClick={doSkip}
                className="flex-1 bg-amber-500 hover:bg-amber-600 text-white font-semibold py-2.5 rounded-xl">
                Пропустить
              </button>
              <button onClick={() => setSkipModal(false)}
                className="flex-1 border border-gray-200 rounded-xl py-2.5 text-gray-600 hover:bg-gray-50">
                Отмена
              </button>
            </div>
          </div>
        </Modal>
      )}

      {cancelModal && (
        <Modal title="Отменить талон" onClose={() => setCancelModal(false)}>
          <div className="space-y-3">
            <p className="text-sm text-gray-500">Укажите причину отмены:</p>
            {CANCEL_REASONS.map(r => (
              <label key={r} className="flex items-center gap-3 cursor-pointer">
                <input type="radio" name="cancel_reason" value={r} checked={cancelReason === r}
                  onChange={e => setCancelReason(e.target.value)} className="text-blue-600" />
                <span className="text-sm">{r}</span>
              </label>
            ))}
            <input type="text" value={cancelReason} onChange={e => setCancelReason(e.target.value)}
              placeholder="Или введите свою причину..."
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
            <div className="flex gap-2 pt-2">
              <button onClick={doCancel}
                className="flex-1 bg-red-500 hover:bg-red-600 text-white font-semibold py-2.5 rounded-xl">
                Отменить талон
              </button>
              <button onClick={() => setCancelModal(false)}
                className="flex-1 border border-gray-200 rounded-xl py-2.5 text-gray-600 hover:bg-gray-50">
                Назад
              </button>
            </div>
          </div>
        </Modal>
      )}

      {transferModal && (
        <TransferModal
          ticket={transferModal}
          services={services}
          onTransfer={doTransfer}
          onClose={() => setTransferModal(null)}
        />
      )}

      {manualModal && (
        <ManualRegModal services={services} onClose={() => setManualModal(false)} />
      )}

      {callConfirm && (
        <Modal title={`Вызвать талон №${callConfirm.number}`} onClose={() => setCallConfirm(null)}>
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              Сейчас обслуживается <strong>№{queue.current?.number}</strong>. Текущий посетитель будет отмечен как обслуженный, а <strong>№{callConfirm.number}</strong> вызван внеочередно.
            </p>
            <div className="flex gap-2">
              <button onClick={doCallSpecific}
                className="flex-1 bg-green-600 hover:bg-green-700 text-white font-semibold py-2.5 rounded-xl">
                Вызвать
              </button>
              <button onClick={() => setCallConfirm(null)}
                className="flex-1 border border-gray-200 rounded-xl py-2.5 text-gray-600 hover:bg-gray-50">
                Отмена
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function TransferModal({ ticket, services, onTransfer, onClose }) {
  const [selectedService, setSelectedService] = useState('');
  return (
    <Modal title={`Перевести талон №${ticket.number}`} onClose={onClose}>
      <div className="space-y-3">
        <p className="text-sm text-gray-500">Выберите новую услугу:</p>
        <div className="space-y-2">
          {services.map(s => (
            <button key={s.id} onClick={() => setSelectedService(s.id)}
              className={`w-full text-left px-4 py-3 rounded-xl border-2 transition text-sm ${
                selectedService === s.id ? 'border-blue-500 bg-blue-50' : 'border-gray-100 hover:border-gray-200'
              }`}>
              {s.name}
            </button>
          ))}
        </div>
        <div className="flex gap-2 pt-2">
          <button onClick={() => selectedService && onTransfer(ticket.id, selectedService)} disabled={!selectedService}
            className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white font-semibold py-2.5 rounded-xl">
            Перевести
          </button>
          <button onClick={onClose} className="flex-1 border border-gray-200 rounded-xl py-2.5 text-gray-600 hover:bg-gray-50">
            Отмена
          </button>
        </div>
      </div>
    </Modal>
  );
}

const FIELD_INPUT_TYPES_ADMIN = { text: 'text', phone: 'tel', number: 'number', date: 'date', email: 'email' };

function ManualRegModal({ services, onClose }) {
  const [form, setForm] = useState({ service_id: '', name: '', phone: '', is_priority: false });
  const [serviceFields, setServiceFields] = useState([]);
  const [fieldValues, setFieldValues] = useState({});
  const [done, setDone] = useState(null);
  const [error, setError] = useState('');

  // Load service fields when service changes
  useEffect(() => {
    if (!form.service_id) { setServiceFields([]); setFieldValues({}); return; }
    fetch(`/api/services/${form.service_id}/fields`)
      .then(r => r.json())
      .then(data => {
        setServiceFields(data);
        const init = {};
        data.forEach(f => { init[f.id] = ''; });
        setFieldValues(init);
      });
  }, [form.service_id]);

  const submit = async () => {
    setError('');
    // Validate required fields
    for (const f of serviceFields) {
      if (f.required && !fieldValues[f.id]?.trim()) {
        setError(`Поле «${f.label}» обязательно для заполнения`);
        return;
      }
    }
    const fvArray = serviceFields
      .map(f => ({ field_id: f.id, label: f.label, value: fieldValues[f.id] || '' }))
      .filter(fv => fv.value.trim() !== '');

    const body = { ...form, field_values: fvArray.length ? fvArray : undefined };
    const r = await apiFetch('/api/tickets/manual', { method: 'POST', body: JSON.stringify(body) });
    if (!r) return;
    const data = await r.json();
    if (!r.ok) { setError(data.error); return; }
    setDone(data);
  };

  if (done) return (
    <Modal title="Талон выдан" onClose={onClose}>
      <div className="text-center space-y-4 py-4">
        <div className="text-6xl font-black text-blue-600">№{done.number}</div>
        <div className="text-gray-600 font-medium">{done.service_name || '—'}</div>
        {done.name && <div className="text-sm text-gray-500">{done.name}</div>}
        {done.phone && <div className="text-sm text-gray-400">{done.phone}</div>}
        {Array.isArray(done.field_values) && done.field_values.filter(fv => fv.value).length > 0 && (
          <div className="text-left bg-gray-50 rounded-xl px-4 py-3 space-y-1">
            {done.field_values.filter(fv => fv.value).map((fv, i) => (
              <div key={i} className="flex justify-between text-sm">
                <span className="text-gray-400">{fv.label}</span>
                <span className="text-gray-700 font-medium ml-3">{fv.value}</span>
              </div>
            ))}
          </div>
        )}
        <div className="flex gap-2 pt-1">
          <button onClick={() => { setDone(null); setForm({ service_id: '', name: '', phone: '', is_priority: false }); setFieldValues({}); }}
            className="flex-1 border border-gray-200 rounded-xl py-2.5 text-gray-600 hover:bg-gray-50 text-sm">
            Ещё один
          </button>
          <button onClick={onClose} className="flex-1 bg-blue-600 text-white font-semibold py-2.5 rounded-xl text-sm">
            Закрыть
          </button>
        </div>
      </div>
    </Modal>
  );

  return (
    <Modal title="Ручная регистрация" onClose={onClose}>
      <div className="space-y-3 max-h-[75vh] overflow-y-auto pr-1">
        {/* Service */}
        <div>
          <label className="text-xs text-gray-500 font-medium mb-1 block">Услуга</label>
          <select value={form.service_id} onChange={e => setForm(f => ({ ...f, service_id: e.target.value }))}
            className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
            <option value="">Без услуги</option>
            {services.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>

        {/* Service-specific fields */}
        {serviceFields.length > 0 && (
          <div className="space-y-2.5 bg-blue-50 rounded-xl p-3">
            <p className="text-xs font-semibold text-blue-600 uppercase tracking-wider">Поля услуги</p>
            {serviceFields.map(f => (
              <div key={f.id}>
                <label className="text-xs text-gray-600 font-medium mb-1 block">
                  {f.label}
                  {f.required && <span className="text-red-500 ml-1">*</span>}
                </label>
                <input
                  type={FIELD_INPUT_TYPES_ADMIN[f.field_type] || 'text'}
                  value={fieldValues[f.id] || ''}
                  onChange={e => setFieldValues(v => ({ ...v, [f.id]: e.target.value }))}
                  placeholder={`Введите ${f.label.toLowerCase()}`}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
                />
              </div>
            ))}
          </div>
        )}

        {/* General info */}
        <div>
          <label className="text-xs text-gray-500 font-medium mb-1 block">Имя посетителя (опционально)</label>
          <input type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            placeholder="Иванов Иван Иванович"
            className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
        </div>
        <div>
          <label className="text-xs text-gray-500 font-medium mb-1 block">Телефон (опционально)</label>
          <input type="tel" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
            placeholder="+7 900 000 00 00"
            className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
        </div>
        <label className="flex items-center gap-3 cursor-pointer py-1.5">
          <input type="checkbox" checked={form.is_priority} onChange={e => setForm(f => ({ ...f, is_priority: e.target.checked }))}
            className="w-4 h-4 rounded text-orange-500" />
          <span className="text-sm font-medium text-orange-700">Приоритетный (льготная категория)</span>
        </label>

        {error && <p className="text-red-500 text-sm">{error}</p>}
        <div className="flex gap-2 pt-1">
          <button onClick={submit}
            className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2.5 rounded-xl">
            Зарегистрировать
          </button>
          <button onClick={onClose} className="flex-1 border border-gray-200 rounded-xl py-2.5 text-gray-600 hover:bg-gray-50">
            Отмена
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Service Fields Modal ─────────────────────────────────────────────────────

const FIELD_TYPES = [
  { value: 'text', label: 'Текст' },
  { value: 'phone', label: 'Телефон' },
  { value: 'number', label: 'Число' },
  { value: 'date', label: 'Дата' },
  { value: 'email', label: 'Email' },
];

function ServiceFieldsModal({ service, onClose }) {
  const [fields, setFields] = useState([]);
  const [form, setForm] = useState({ label: '', field_type: 'text', required: false });
  const [editingId, setEditingId] = useState(null);
  const [error, setError] = useState('');

  const load = async () => {
    const r = await fetch(`/api/services/${service.id}/fields`);
    setFields(await r.json());
  };

  useEffect(() => { load(); }, [service.id]);

  const save = async () => {
    if (!form.label.trim()) { setError('Введите название поля'); return; }
    setError('');
    if (editingId) {
      await apiFetch(`/api/service-fields/${editingId}`, { method: 'PUT', body: JSON.stringify(form) });
      setEditingId(null);
    } else {
      await apiFetch(`/api/services/${service.id}/fields`, { method: 'POST', body: JSON.stringify(form) });
    }
    setForm({ label: '', field_type: 'text', required: false });
    load();
  };

  const startEdit = (f) => {
    setEditingId(f.id);
    setForm({ label: f.label, field_type: f.field_type, required: !!f.required });
    setError('');
  };

  const remove = async (id) => {
    await apiFetch(`/api/service-fields/${id}`, { method: 'DELETE' });
    load();
  };

  const move = async (field, dir) => {
    const idx = fields.findIndex(f => f.id === field.id);
    const swapIdx = idx + dir;
    if (swapIdx < 0 || swapIdx >= fields.length) return;
    const swap = fields[swapIdx];
    await Promise.all([
      apiFetch(`/api/service-fields/${field.id}`, { method: 'PUT', body: JSON.stringify({ order_index: swap.order_index }) }),
      apiFetch(`/api/service-fields/${swap.id}`, { method: 'PUT', body: JSON.stringify({ order_index: field.order_index }) }),
    ]);
    load();
  };

  return (
    <Modal title={`Поля формы — ${service.name}`} onClose={onClose}>
      <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
        {/* Current fields */}
        {fields.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-4">Нет дополнительных полей. Добавьте первое поле ниже.</p>
        ) : (
          <div className="space-y-2">
            {fields.map((f, i) => (
              <div key={f.id} className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border ${editingId === f.id ? 'border-blue-300 bg-blue-50' : 'border-gray-100 bg-gray-50'}`}>
                <div className="flex flex-col gap-0.5">
                  <button onClick={() => move(f, -1)} disabled={i === 0} className="text-gray-300 hover:text-gray-500 disabled:opacity-20">
                    <Icon d={P.up} cls="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => move(f, 1)} disabled={i === fields.length - 1} className="text-gray-300 hover:text-gray-500 disabled:opacity-20">
                    <Icon d={P.down} cls="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm text-gray-800 truncate">{f.label}</div>
                  <div className="text-xs text-gray-400 flex items-center gap-2 mt-0.5">
                    <span>{FIELD_TYPES.find(t => t.value === f.field_type)?.label || f.field_type}</span>
                    {f.required ? <span className="text-red-500 font-semibold">• обязательное</span> : <span>• необязательное</span>}
                  </div>
                </div>
                <div className="flex gap-1 shrink-0">
                  <button onClick={() => startEdit(f)} className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-100 rounded-lg">
                    <Icon d={P.edit} cls="w-4 h-4" />
                  </button>
                  <button onClick={() => remove(f.id)} className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-100 rounded-lg">
                    <Icon d={P.trash} cls="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Add/Edit form */}
        <div className="border-t border-gray-100 pt-4 space-y-3">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
            {editingId ? 'Редактировать поле' : 'Добавить поле'}
          </p>
          <input
            type="text"
            value={form.label}
            onChange={e => setForm(f => ({ ...f, label: e.target.value }))}
            placeholder="Название поля (например: ФИО, Номер документа)"
            className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            onKeyDown={e => e.key === 'Enter' && save()}
          />
          <div className="flex gap-2">
            <select
              value={form.field_type}
              onChange={e => setForm(f => ({ ...f, field_type: e.target.value }))}
              className="flex-1 border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {FIELD_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
            <label className="flex items-center gap-2 px-3 py-2.5 border border-gray-200 rounded-xl cursor-pointer hover:bg-gray-50 text-sm whitespace-nowrap">
              <input
                type="checkbox"
                checked={form.required}
                onChange={e => setForm(f => ({ ...f, required: e.target.checked }))}
                className="rounded"
              />
              Обязательное
            </label>
          </div>
          {error && <p className="text-red-500 text-sm">{error}</p>}
          <div className="flex gap-2">
            <button onClick={save}
              className="flex-1 flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2.5 rounded-xl text-sm">
              <Icon d={editingId ? P.check : P.plus} cls="w-4 h-4" />
              {editingId ? 'Сохранить' : 'Добавить поле'}
            </button>
            {editingId && (
              <button onClick={() => { setEditingId(null); setForm({ label: '', field_type: 'text', required: false }); }}
                className="px-4 border border-gray-200 rounded-xl text-gray-600 hover:bg-gray-50 text-sm">
                Отмена
              </button>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}

// ─── Services Tab ─────────────────────────────────────────────────────────────

function ServicesTab() {
  const [services, setServices] = useState([]);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: '', description: '', avg_duration_minutes: 5, priority: 0, daily_limit: '' });
  const [error, setError] = useState('');
  const [fieldsModal, setFieldsModal] = useState(null);

  const load = () => apiFetch('/api/services?all=1').then(r => r?.json()).then(d => d && setServices(d));
  useEffect(() => { load(); }, []);

  const save = async () => {
    if (!form.name.trim()) { setError('Введите название'); return; }
    setError('');
    const body = { ...form, daily_limit: form.daily_limit ? parseInt(form.daily_limit) : null };
    if (editing) {
      await apiFetch(`/api/services/${editing}`, { method: 'PUT', body: JSON.stringify(body) });
      setEditing(null);
    } else {
      await apiFetch('/api/services', { method: 'POST', body: JSON.stringify(body) });
    }
    setForm({ name: '', description: '', avg_duration_minutes: 5, priority: 0, daily_limit: '' });
    load();
  };

  const startEdit = (s) => {
    setEditing(s.id);
    setForm({ name: s.name, description: s.description || '', avg_duration_minutes: s.avg_duration_minutes, priority: s.priority || 0, daily_limit: s.daily_limit || '' });
    setError('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const toggle = async (s) => {
    await apiFetch(`/api/services/${s.id}/toggle`, { method: 'PUT' });
    load();
  };

  const remove = async (id) => {
    if (!confirm('Удалить услугу? Активные талоны останутся без услуги.')) return;
    await apiFetch(`/api/services/${id}`, { method: 'DELETE' });
    load();
  };

  const setDefault = async (s) => {
    await apiFetch(`/api/services/${s.id}/set-default`, { method: 'PUT' });
    load();
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">
          {editing ? 'Редактировать услугу' : 'Добавить услугу'}
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2">
            <input type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="Название услуги *"
              className="w-full border border-gray-200 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div className="sm:col-span-2">
            <input type="text" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              placeholder="Описание (необязательно)"
              className="w-full border border-gray-200 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Среднее время (мин)</label>
            <input type="number" min={1} max={120} value={form.avg_duration_minutes}
              onChange={e => setForm(f => ({ ...f, avg_duration_minutes: parseInt(e.target.value) || 1 }))}
              className="w-full border border-gray-200 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Приоритет (выше = первее)</label>
            <input type="number" min={0} max={100} value={form.priority}
              onChange={e => setForm(f => ({ ...f, priority: parseInt(e.target.value) || 0 }))}
              className="w-full border border-gray-200 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Лимит талонов в день (0 = нет лимита)</label>
            <input type="number" min={0} value={form.daily_limit}
              onChange={e => setForm(f => ({ ...f, daily_limit: e.target.value }))}
              placeholder="Без лимита"
              className="w-full border border-gray-200 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
        </div>
        {error && <p className="text-red-500 text-sm mt-2">{error}</p>}
        <div className="flex gap-2 mt-4">
          <button onClick={save}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold px-5 py-2.5 rounded-xl transition">
            <Icon d={editing ? P.check : P.plus} />
            {editing ? 'Сохранить' : 'Добавить'}
          </button>
          {editing && (
            <button onClick={() => { setEditing(null); setForm({ name: '', description: '', avg_duration_minutes: 5, priority: 0, daily_limit: '' }); }}
              className="px-4 py-2.5 border border-gray-200 rounded-xl hover:bg-gray-50 text-gray-700">
              Отмена
            </button>
          )}
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100">
              <th className="text-left px-5 py-3 text-gray-500 font-semibold">Услуга</th>
              <th className="text-center px-4 py-3 text-gray-500 font-semibold">Время</th>
              <th className="text-center px-4 py-3 text-gray-500 font-semibold">Приоритет</th>
              <th className="text-center px-4 py-3 text-gray-500 font-semibold">Лимит/день</th>
              <th className="text-center px-4 py-3 text-gray-500 font-semibold">Поля</th>
              <th className="text-center px-4 py-3 text-gray-500 font-semibold">По умолчанию</th>
              <th className="text-center px-4 py-3 text-gray-500 font-semibold">Статус</th>
              <th className="px-4 py-3 w-28"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {services.length === 0 && (
              <tr><td colSpan={6} className="text-center py-10 text-gray-400">Нет услуг</td></tr>
            )}
            {services.map(s => (
              <tr key={s.id} className={`hover:bg-gray-50 transition ${!s.enabled ? 'opacity-50' : ''}`}>
                <td className="px-5 py-4">
                  <div className="font-medium">{s.name}</div>
                  {s.description && <div className="text-xs text-gray-400 mt-0.5">{s.description}</div>}
                </td>
                <td className="px-4 py-4 text-center text-gray-600">
                  <span className="flex items-center justify-center gap-1">
                    <Icon d={P.clock} cls="w-4 h-4 text-gray-400" />{s.avg_duration_minutes} мин
                  </span>
                </td>
                <td className="px-4 py-4 text-center text-gray-600">{s.priority || 0}</td>
                <td className="px-4 py-4 text-center text-gray-500">{s.daily_limit || '∞'}</td>
                <td className="px-4 py-4 text-center">
                  <button onClick={() => setFieldsModal(s)}
                    className="inline-flex items-center gap-1.5 text-xs bg-purple-50 hover:bg-purple-100 text-purple-700 font-medium px-3 py-1.5 rounded-lg transition">
                    <Icon d={P.fields} cls="w-3.5 h-3.5" />
                    Поля
                  </button>
                </td>
                <td className="px-4 py-4 text-center">
                  <button onClick={() => setDefault(s)} title={s.is_default ? 'Снять метку' : 'Сделать по умолчанию'}
                    className={`inline-flex items-center justify-center w-8 h-8 rounded-full transition ${s.is_default ? 'text-amber-500 bg-amber-50 hover:bg-amber-100' : 'text-gray-300 hover:text-amber-400 hover:bg-amber-50'}`}>
                    <Icon d={P.star} cls="w-4 h-4" />
                  </button>
                </td>
                <td className="px-4 py-4 text-center">
                  <button onClick={() => toggle(s)}
                    className={`text-xs px-3 py-1 rounded-full font-medium ${s.enabled ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                    {s.enabled ? 'Активна' : 'Отключена'}
                  </button>
                </td>
                <td className="px-4 py-4">
                  <div className="flex gap-1 justify-end">
                    <button onClick={() => startEdit(s)} className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg">
                      <Icon d={P.edit} cls="w-4 h-4" />
                    </button>
                    <button onClick={() => remove(s.id)} className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg">
                      <Icon d={P.trash} cls="w-4 h-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {fieldsModal && (
        <ServiceFieldsModal service={fieldsModal} onClose={() => { setFieldsModal(null); load(); }} />
      )}
    </div>
  );
}

// ─── Statistics Tab ───────────────────────────────────────────────────────────

function BarChart({ data, maxVal }) {
  if (!data || data.length === 0) return null;
  const max = maxVal || Math.max(...data.map(d => d.value), 1);
  const barW = Math.max(20, Math.floor(480 / data.length) - 8);
  const H = 140, PAD_B = 40, PAD_T = 20, PAD_L = 30;
  const chartH = H - PAD_T - PAD_B;
  const totalW = data.length * (barW + 8) + PAD_L + 20;

  return (
    <div className="overflow-x-auto">
      <svg width={totalW} height={H} className="text-xs">
        {[0, 0.5, 1].map(f => {
          const y = PAD_T + chartH * (1 - f);
          return (
            <g key={f}>
              <line x1={PAD_L} x2={totalW} y1={y} y2={y} stroke="#f3f4f6" strokeWidth={1} />
              <text x={PAD_L - 4} y={y + 4} textAnchor="end" fill="#9ca3af" fontSize={10}>{Math.round(max * f)}</text>
            </g>
          );
        })}
        {data.map((d, i) => {
          const bh = Math.max(0, (d.value / max) * chartH);
          const x = PAD_L + i * (barW + 8);
          const y = PAD_T + chartH - bh;
          return (
            <g key={i}>
              <rect x={x} y={y} width={barW} height={bh} fill={d.color || '#3b82f6'} rx={3} opacity={0.85} />
              {d.value > 0 && (
                <text x={x + barW / 2} y={y - 4} textAnchor="middle" fill="#374151" fontSize={10} fontWeight="600">{d.value}</text>
              )}
              <text x={x + barW / 2} y={H - 6} textAnchor="middle" fill="#6b7280" fontSize={9}>
                {d.label?.length > 5 ? d.label.slice(0, 5) : d.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function StatsTab() {
  const [days, setDays] = useState(7);
  const [stats, setStats] = useState({ rows: [], daily: [] });

  useEffect(() => {
    apiFetch(`/api/stats?days=${days}`).then(r => r?.json()).then(d => d && setStats(d));
  }, [days]);

  const exportCSV = async () => {
    const token = localStorage.getItem('adminToken');
    window.open(`/api/stats/export?days=${days}&_t=${token}`, '_blank');
    // fallback: use anchor
    const res = await apiFetch(`/api/stats/export?days=${days}`);
    if (!res) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `queue_stats.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const chartData = [...stats.daily].reverse().map(d => ({
    label: d.date ? d.date.slice(5) : '',
    value: d.total,
    color: '#3b82f6',
  }));

  const chartServedData = [...stats.daily].reverse().map(d => ({
    label: d.date ? d.date.slice(5) : '',
    value: d.served,
    color: '#22c55e',
  }));

  // Aggregated by service
  const byService = {};
  for (const r of stats.rows) {
    if (!byService[r.service_name]) byService[r.service_name] = { total: 0, served: 0 };
    byService[r.service_name].total += r.total;
    byService[r.service_name].served += r.served;
  }
  const serviceChartData = Object.entries(byService).map(([name, v]) => ({
    label: name, value: v.total, color: '#8b5cf6'
  }));

  const totalToday = stats.daily[0]?.total || 0;
  const servedToday = stats.daily[0]?.served || 0;
  const totalPeriod = stats.daily.reduce((s, r) => s + r.total, 0);
  const servedPeriod = stats.daily.reduce((s, r) => s + r.served, 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2">
          {[7, 14, 30].map(d => (
            <button key={d} onClick={() => setDays(d)}
              className={`px-4 py-2 rounded-xl text-sm font-medium transition ${days === d ? 'bg-blue-600 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
              {d} дней
            </button>
          ))}
        </div>
        <button onClick={exportCSV}
          className="flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white font-medium px-4 py-2 rounded-xl text-sm transition">
          <Icon d={P.download} cls="w-4 h-4" /> Экспорт CSV
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: 'Сегодня всего', value: totalToday, color: 'bg-blue-50 text-blue-700' },
          { label: 'Сегодня обслужено', value: servedToday, color: 'bg-green-50 text-green-700' },
          { label: `За ${days} дней`, value: totalPeriod, color: 'bg-purple-50 text-purple-700' },
          { label: 'Обслужено за период', value: servedPeriod, color: 'bg-emerald-50 text-emerald-700' },
        ].map(c => (
          <div key={c.label} className={`${c.color} rounded-2xl p-4`}>
            <div className="text-3xl font-black">{c.value}</div>
            <div className="text-sm mt-1 opacity-80">{c.label}</div>
          </div>
        ))}
      </div>

      {/* Charts */}
      {chartData.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <h4 className="text-sm font-semibold text-gray-600 mb-3">Талонов получено</h4>
            <BarChart data={chartData} />
          </div>
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <h4 className="text-sm font-semibold text-gray-600 mb-3">Обслужено</h4>
            <BarChart data={chartServedData} />
          </div>
        </div>
      )}

      {serviceChartData.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <h4 className="text-sm font-semibold text-gray-600 mb-3">Распределение по услугам (всего за период)</h4>
          <BarChart data={serviceChartData} />
        </div>
      )}

      {/* Detail table */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 font-semibold text-gray-700 text-sm">По дням</div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                {['Дата','Всего','Обслужено','Пропущено','Отменено','Ср. ожидание'].map(h => (
                  <th key={h} className="px-4 py-3 text-gray-500 font-semibold text-left">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {stats.daily.length === 0 && (
                <tr><td colSpan={6} className="text-center py-8 text-gray-400">Нет данных</td></tr>
              )}
              {stats.daily.map(r => (
                <tr key={r.date} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium">{fmtDate(r.date)}</td>
                  <td className="px-4 py-3">{r.total}</td>
                  <td className="px-4 py-3 text-green-600 font-medium">{r.served}</td>
                  <td className="px-4 py-3 text-amber-600">{r.skipped}</td>
                  <td className="px-4 py-3 text-red-500">{r.cancelled}</td>
                  <td className="px-4 py-3 text-gray-500">{r.avg_wait_minutes ? `${r.avg_wait_minutes} мин` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─── QR Tab ───────────────────────────────────────────────────────────────────

function QRTab() {
  const [services, setServices] = useState([]);
  const [selectedService, setSelectedService] = useState('');
  const [customUrl, setCustomUrl] = useState('');
  const [qrData, setQrData] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch('/api/services?all=1').then(r => r.json()).then(data => {
      setServices(data);
      generateQR(null);
    });
  }, []);

  const generateQR = async (serviceId) => {
    setLoading(true);
    let url = customUrl.trim();
    if (!url) {
      url = window.location.origin + '/visitor';
      if (serviceId) url += `?service=${serviceId}`;
    }
    const res = await fetch(`/api/qrcode?url=${encodeURIComponent(url)}`);
    const data = await res.json();
    setQrData(data);
    setLoading(false);
  };

  const printQR = () => {
    if (!qrData) return;
    const svcName = services.find(s => s.id === parseInt(selectedService))?.name || '';
    const win = window.open('', '_blank');
    win.document.write(`<html><head><title>QR-код</title>
      <style>body{font-family:sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:20px;text-align:center}
      img{max-width:300px}h1{font-size:1.5rem;margin-bottom:6px;color:#1e3a5f}p{color:#666;font-size:.9rem;margin:4px 0}</style>
      </head><body>
      <h1>Электронная очередь</h1>
      ${svcName ? `<p><strong>${svcName}</strong></p>` : ''}
      <p>Отсканируйте QR-код для получения талона</p>
      <img src="${qrData.qrcode}" />
      <p style="margin-top:12px;font-size:.7rem;color:#aaa">${qrData.url}</p>
      </body></html>`);
    win.document.close();
    win.print();
  };

  return (
    <div className="space-y-6 max-w-lg">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-4">
        <div>
          <label className="text-xs text-gray-500 font-medium mb-1.5 block">Привязка к услуге (необязательно)</label>
          <select value={selectedService}
            onChange={e => { setSelectedService(e.target.value); generateQR(e.target.value || null); }}
            className="w-full border border-gray-200 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="">Все услуги (посетитель выбирает)</option>
            {services.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-gray-500 font-medium mb-1.5 block">Своя ссылка (если отличается)</label>
          <div className="flex gap-2">
            <input type="url" value={customUrl} onChange={e => setCustomUrl(e.target.value)}
              placeholder={window.location.origin + '/visitor'}
              className="flex-1 border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono" />
            <button onClick={() => generateQR(selectedService || null)} disabled={loading}
              className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-4 py-2.5 rounded-xl font-medium">
              {loading ? '...' : 'Обновить'}
            </button>
          </div>
        </div>
      </div>

      {qrData && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 flex flex-col items-center gap-6">
          <div className="bg-white p-4 rounded-xl border-2 border-gray-100 shadow-inner">
            <img src={qrData.qrcode} alt="QR" className="w-64 h-64" />
          </div>
          <div className="text-center">
            <p className="text-xs text-gray-500 mb-1">Ссылка</p>
            <p className="font-mono text-xs text-blue-600 break-all">{qrData.url}</p>
          </div>
          <div className="flex gap-3 w-full">
            <button onClick={printQR}
              className="flex-1 flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-xl">
              <Icon d={P.print} /> Печать A4
            </button>
            <a href={qrData.qrcode} download="queue-qrcode.png"
              className="flex-1 flex items-center justify-center gap-2 border border-gray-200 hover:bg-gray-50 text-gray-700 font-semibold py-3 rounded-xl">
              <Icon d={P.download} cls="w-5 h-5" /> Скачать
            </a>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Logs Tab ─────────────────────────────────────────────────────────────────

const ACTION_LABELS = {
  'user.login': 'Вход в систему',
  'ticket.called': 'Талон вызван',
  'ticket.called.repeat': 'Повтор вызова',
  'ticket.skipped': 'Талон пропущен',
  'ticket.cancelled': 'Талон отменён',
  'ticket.transferred': 'Перевод талона',
  'ticket.manual': 'Ручная регистрация',
  'service.created': 'Услуга создана',
  'service.updated': 'Услуга изменена',
  'service.deleted': 'Услуга удалена',
  'service.enabled': 'Услуга включена',
  'service.disabled': 'Услуга отключена',
  'queue.reset': 'Очередь сброшена',
  'settings.password_changed': 'Пароль изменён',
};

const ACTION_COLORS = {
  'user.login': 'text-blue-600 bg-blue-50',
  'ticket.called': 'text-green-700 bg-green-50',
  'ticket.skipped': 'text-amber-700 bg-amber-50',
  'ticket.cancelled': 'text-red-600 bg-red-50',
  'queue.reset': 'text-red-700 bg-red-50',
  'service.deleted': 'text-red-600 bg-red-50',
};

function LogsTab() {
  const [logs, setLogs] = useState([]);
  useEffect(() => {
    apiFetch('/api/logs?limit=200').then(r => r?.json()).then(d => d && setLogs(d));
  }, []);

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100">
        <h3 className="font-semibold text-gray-700">Журнал действий ({logs.length})</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100">
              <th className="text-left px-5 py-3 text-gray-500">Время</th>
              <th className="text-left px-4 py-3 text-gray-500">Пользователь</th>
              <th className="text-left px-4 py-3 text-gray-500">Действие</th>
              <th className="text-left px-4 py-3 text-gray-500">Детали</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {logs.length === 0 && (
              <tr><td colSpan={4} className="text-center py-10 text-gray-400">Нет записей</td></tr>
            )}
            {logs.map(l => {
              const clr = ACTION_COLORS[l.action] || 'text-gray-600 bg-gray-50';
              return (
                <tr key={l.id} className="hover:bg-gray-50">
                  <td className="px-5 py-2.5 text-gray-400 tabular-nums text-xs">
                    {l.created_at ? new Date(l.created_at).toLocaleString('ru-RU') : '—'}
                  </td>
                  <td className="px-4 py-2.5 font-medium text-gray-700">{l.username || '—'}</td>
                  <td className="px-4 py-2.5">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${clr}`}>
                      {ACTION_LABELS[l.action] || l.action}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-gray-500 text-xs">{l.details || '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Settings Tab ─────────────────────────────────────────────────────────────

function SettingsTab() {
  const [pwForm, setPwForm] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [pwError, setPwError] = useState('');
  const [pwOk, setPwOk] = useState(false);
  const navigate = useNavigate();

  const changePassword = async () => {
    setPwError(''); setPwOk(false);
    if (pwForm.newPassword !== pwForm.confirm) { setPwError('Пароли не совпадают'); return; }
    const r = await apiFetch('/api/settings/password', { method: 'PUT', body: JSON.stringify(pwForm) });
    if (!r) return;
    const data = await r.json();
    if (!r.ok) { setPwError(data.error); return; }
    setPwOk(true);
    setPwForm({ currentPassword: '', newPassword: '', confirm: '' });
  };

  const logout = () => {
    localStorage.removeItem('adminToken');
    localStorage.removeItem('adminUser');
    navigate('/login', { replace: true });
  };

  const user = (() => { try { return JSON.parse(localStorage.getItem('adminUser')); } catch { return null; } })();

  return (
    <div className="space-y-6 max-w-md">
      {/* User info */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center">
            <Icon d={P.person} cls="w-6 h-6 text-blue-600" />
          </div>
          <div>
            <div className="font-bold text-gray-900">{user?.username || 'admin'}</div>
            <div className="text-sm text-gray-400 capitalize">{user?.role || 'admin'}</div>
          </div>
          <button onClick={logout}
            className="ml-auto flex items-center gap-2 text-sm text-red-500 hover:text-red-700 px-3 py-2 rounded-xl hover:bg-red-50">
            <Icon d={P.logout} cls="w-4 h-4" /> Выйти
          </button>
        </div>
      </div>

      {/* Change password */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-4">
        <h3 className="font-semibold text-gray-800">Изменить пароль</h3>
        {[
          { key: 'currentPassword', label: 'Текущий пароль' },
          { key: 'newPassword', label: 'Новый пароль' },
          { key: 'confirm', label: 'Повторите новый пароль' },
        ].map(f => (
          <div key={f.key}>
            <label className="text-xs text-gray-500 font-medium mb-1 block">{f.label}</label>
            <input type="password" value={pwForm[f.key]}
              onChange={e => setPwForm(p => ({ ...p, [f.key]: e.target.value }))}
              className="w-full border border-gray-200 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
        ))}
        {pwError && <p className="text-red-500 text-sm">{pwError}</p>}
        {pwOk && <p className="text-green-600 text-sm">Пароль успешно изменён</p>}
        <button onClick={changePassword}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-xl">
          Сохранить пароль
        </button>
      </div>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const TABS = [
  { id: 'queue', label: 'Очередь', icon: P.queue },
  { id: 'services', label: 'Услуги', icon: P.services },
  { id: 'stats', label: 'Статистика', icon: P.stats },
  { id: 'qrcode', label: 'QR-коды', icon: P.qr },
  { id: 'logs', label: 'Журнал', icon: P.log },
  { id: 'settings', label: 'Настройки', icon: P.settings },
];

export default function AdminPage() {
  const [tab, setTab] = useState('queue');
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-100 shadow-sm sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900">Электронная очередь</h1>
            <p className="text-xs text-gray-400">Панель администратора</p>
          </div>
          <div className="text-right hidden sm:block">
            <div className="text-2xl font-bold text-blue-600 tabular-nums">
              {time.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </div>
            <div className="text-xs text-gray-400">
              {time.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })}
            </div>
          </div>
        </div>
        <div className="max-w-6xl mx-auto px-4 overflow-x-auto">
          <div className="flex gap-0.5 min-w-max">
            {TABS.map(t => (
              <button key={t.id} onClick={() => setTab(t.id)}
                className={`flex items-center gap-1.5 px-4 py-3 text-sm font-medium border-b-2 transition whitespace-nowrap ${
                  tab === t.id ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}>
                <Icon d={t.icon} cls="w-4 h-4" />
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6">
        {tab === 'queue' && <QueueTab />}
        {tab === 'services' && <ServicesTab />}
        {tab === 'stats' && <StatsTab />}
        {tab === 'qrcode' && <QRTab />}
        {tab === 'logs' && <LogsTab />}
        {tab === 'settings' && <SettingsTab />}
      </main>
    </div>
  );
}
