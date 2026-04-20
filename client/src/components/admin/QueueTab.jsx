import { useState, useEffect, useCallback } from 'react';
import socket from '../../socket';
import { apiFetch } from '../../api';
import { Icon, P, Modal, STATUS_LABELS, STATUS_COLORS, FIELD_INPUT_TYPES_ADMIN, fmtTime } from './shared';

// ─── Transfer Modal ───────────────────────────────────────────────────────────

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

// ─── Manual Reg Modal ─────────────────────────────────────────────────────────

function ManualRegModal({ services, onClose, onCreated }) {
  const defaultService = services.find(s => s.is_default) || (services.length === 1 ? services[0] : null);
  const [serviceId, setServiceId] = useState(defaultService ? String(defaultService.id) : '');
  const [serviceFields, setServiceFields] = useState([]);
  const [fieldValues, setFieldValues] = useState({});
  const [done, setDone] = useState(null);
  const [error, setError] = useState('');

  const selectedService = services.find(s => String(s.id) === String(serviceId)) || null;

  const loadFields = (sid) => {
    if (!sid) { setServiceFields([]); setFieldValues({}); return; }
    fetch(`/api/services/${sid}/fields`)
      .then(r => r.json())
      .then(data => {
        setServiceFields(data);
        const init = {};
        data.forEach(f => { init[f.id] = ''; });
        setFieldValues(init);
      });
  };

  useEffect(() => { loadFields(serviceId); }, [serviceId]);

  const submit = async () => {
    setError('');
    if (!serviceId) { setError('Выберите услугу'); return; }
    for (const f of serviceFields) {
      if (f.required && !fieldValues[f.id]?.trim()) {
        setError(`Поле «${f.label}» обязательно для заполнения`);
        return;
      }
    }
    const fvArray = serviceFields
      .map(f => ({ field_id: f.id, label: f.label, value: fieldValues[f.id] || '' }))
      .filter(fv => fv.value.trim() !== '');

    const is_priority = selectedService?.priority > 0 ? 1 : 0;
    const body = { service_id: serviceId, is_priority, field_values: fvArray.length ? fvArray : undefined };
    const r = await apiFetch('/api/tickets/manual', { method: 'POST', body: JSON.stringify(body) });
    if (!r) return;
    const data = await r.json();
    if (!r.ok) { setError(data.error); return; }
    setDone(data);
    onCreated?.();
  };

  const reset = () => {
    const sid = defaultService ? String(defaultService.id) : '';
    setDone(null);
    setServiceId(sid);
    setError('');
    loadFields(sid);
  };

  if (done) return (
    <Modal title="Талон выдан" onClose={onClose}>
      <div className="text-center space-y-4 py-4">
        <div className="text-6xl font-black text-blue-600">№{done.number}</div>
        <div className="text-gray-600 font-medium">{done.service_name || '—'}</div>
        {done.is_priority === 1 && (
          <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-orange-700 bg-orange-50 px-3 py-1 rounded-full">
            <Icon d={P.priority} cls="w-3.5 h-3.5" /> Приоритетный
          </div>
        )}
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
          <button onClick={reset}
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
        <div>
          <label className="text-xs text-gray-500 font-medium mb-1 block">Услуга</label>
          <select value={serviceId} onChange={e => setServiceId(e.target.value)}
            className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
            <option value="">Выберите услугу...</option>
            {services.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>

        {selectedService?.priority > 0 && (
          <div className="flex items-center gap-2 text-sm text-orange-700 bg-orange-50 border border-orange-100 rounded-xl px-3 py-2">
            <Icon d={P.priority} cls="w-4 h-4 shrink-0" />
            Талон будет помечен как приоритетный
          </div>
        )}

        {serviceFields.length > 0 && serviceFields.map(f => (
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
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
          </div>
        ))}

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

// ─── Edit Ticket Modal ────────────────────────────────────────────────────────

function EditTicketModal({ ticket, services, onClose, onSaved }) {
  const [form, setForm] = useState({
    name: ticket.name || '',
    phone: ticket.phone || '',
    service_id: ticket.service_id ? String(ticket.service_id) : '',
    is_priority: !!ticket.is_priority,
    status: ticket.status || 'waiting',
  });
  const [serviceFields, setServiceFields] = useState([]);
  const [fieldValues, setFieldValues] = useState({});
  const [orphanedFields, setOrphanedFields] = useState([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const storedFv = Array.isArray(ticket.field_values) ? ticket.field_values : [];

    if (!form.service_id) {
      setServiceFields([]);
      const init = {};
      storedFv.forEach(fv => { init[`o_${fv.field_id}`] = fv.value || ''; });
      setFieldValues(init);
      setOrphanedFields(storedFv.filter(fv => fv.value));
      return;
    }

    fetch(`/api/services/${form.service_id}/fields`)
      .then(r => r.json())
      .then(fields => {
        setServiceFields(fields);
        const templateIds = new Set(fields.map(f => f.id));
        const init = {};
        fields.forEach(f => {
          const existing = storedFv.find(fv => Number(fv.field_id) === f.id);
          init[f.id] = existing ? existing.value : '';
        });
        const orphaned = storedFv.filter(fv => fv.value && !templateIds.has(Number(fv.field_id)));
        orphaned.forEach(fv => { init[`o_${fv.field_id}`] = fv.value || ''; });
        setFieldValues(init);
        setOrphanedFields(orphaned);
      });
  }, [form.service_id]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async () => {
    setError('');
    setSaving(true);

    const templateFv = serviceFields
      .map(f => ({ field_id: f.id, label: f.label, value: fieldValues[f.id] || '' }))
      .filter(fv => fv.value.trim() !== '');

    const orphanFv = orphanedFields
      .map(fv => ({ field_id: fv.field_id, label: fv.label, value: fieldValues[`o_${fv.field_id}`] ?? fv.value }))
      .filter(fv => fv.value?.trim() !== '');

    const body = {
      name: form.name || null,
      phone: form.phone || null,
      service_id: form.service_id ? parseInt(form.service_id) : null,
      is_priority: form.is_priority ? 1 : 0,
      status: form.status,
      field_values: [...templateFv, ...orphanFv],
    };

    const r = await apiFetch(`/api/tickets/${ticket.id}`, { method: 'PUT', body: JSON.stringify(body) });
    setSaving(false);
    if (!r) return;
    const data = await r.json();
    if (!r.ok) { setError(data.error || 'Ошибка сохранения'); return; }
    onSaved?.();
    onClose();
  };

  const hasFields = serviceFields.length > 0 || orphanedFields.length > 0;

  return (
    <Modal title={`Редактировать талон №${ticket.number}`} onClose={onClose}>
      <div className="space-y-3 max-h-[75vh] overflow-y-auto pr-1">
        <div>
          <label className="text-xs text-gray-500 font-medium mb-1 block">Услуга</label>
          <select value={form.service_id} onChange={e => setForm(f => ({ ...f, service_id: e.target.value }))}
            className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
            <option value="">Без услуги</option>
            {services.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>

        <div>
          <label className="text-xs text-gray-500 font-medium mb-1 block">Статус</label>
          <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}
            className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
            {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>

        {hasFields && (
          <div className="border-t border-gray-100 pt-3 space-y-3">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Поля услуги</p>
            {serviceFields.map(f => (
              <div key={f.id}>
                <label className="text-xs text-gray-600 font-medium mb-1 block">
                  {f.label}{f.required && <span className="text-red-500 ml-1">*</span>}
                </label>
                <input
                  type={FIELD_INPUT_TYPES_ADMIN[f.field_type] || 'text'}
                  value={fieldValues[f.id] || ''}
                  onChange={e => setFieldValues(v => ({ ...v, [f.id]: e.target.value }))}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
              </div>
            ))}
            {orphanedFields.map(fv => (
              <div key={`o_${fv.field_id}`}>
                <label className="text-xs text-gray-600 font-medium mb-1 block">{fv.label}</label>
                <input
                  type="text"
                  value={fieldValues[`o_${fv.field_id}`] ?? fv.value}
                  onChange={e => setFieldValues(v => ({ ...v, [`o_${fv.field_id}`]: e.target.value }))}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
              </div>
            ))}
          </div>
        )}

        {error && <p className="text-red-500 text-sm">{error}</p>}
        <div className="flex gap-2 pt-1">
          <button onClick={submit} disabled={saving}
            className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white font-semibold py-2.5 rounded-xl text-sm">
            {saving ? 'Сохранение...' : 'Сохранить'}
          </button>
          <button onClick={onClose} className="flex-1 border border-gray-200 rounded-xl py-2.5 text-gray-600 hover:bg-gray-50 text-sm">
            Отмена
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Queue Tab ────────────────────────────────────────────────────────────────

export default function QueueTab() {
  const [queue, setQueue] = useState({ current: null, waiting: [] });
  const [loading, setLoading] = useState(false);
  const [manualModal, setManualModal] = useState(false);
  const [callConfirm, setCallConfirm] = useState(null);
  const [services, setServices] = useState([]);
  const [filterStatus, setFilterStatus] = useState('');
  const [filterService, setFilterService] = useState('');
  const [allTickets, setAllTickets] = useState([]);
  const [showAll, setShowAll] = useState(false);
  const [editTicket, setEditTicket] = useState(null);

  useEffect(() => {
    apiFetch('/api/queue/full').then(r => r?.json()).then(d => d && setQueue(d));
    fetch('/api/services?all=1').then(r => r.json()).then(setServices);
    socket.on('queue:updated', setQueue);
    return () => { socket.off('queue:updated', setQueue); };
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
    try {
      const r = await apiFetch('/api/queue/next', { method: 'POST' });
      if (!r) return;
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        alert(d.error || 'Ошибка вызова талона');
      } else {
        const d = await r.json().catch(() => null);
        if (d) setQueue(d);
      }
    } catch (err) {
      console.error('callNext error:', err);
      alert('Ошибка соединения с сервером');
    } finally {
      setLoading(false);
    }
  };

  const callSpecific = async (ticket) => {
    if (queue.current) {
      setCallConfirm(ticket);
    } else {
      setLoading(true);
      try {
        const r = await apiFetch(`/api/queue/call/${ticket.id}`, { method: 'POST' });
        if (!r) return;
        if (!r.ok) {
          const d = await r.json().catch(() => ({}));
          alert(d.error || 'Ошибка вызова талона');
        } else {
          const d = await r.json().catch(() => null);
          if (d) setQueue(d);
        }
      } catch (err) {
        console.error('callSpecific error:', err);
        alert('Ошибка соединения с сервером');
      } finally {
        setLoading(false);
      }
    }
  };

  const doCallSpecific = async () => {
    if (!callConfirm) return;
    setLoading(true);
    try {
      const r = await apiFetch(`/api/queue/call/${callConfirm.id}`, { method: 'POST' });
      if (r && r.ok) {
        const d = await r.json().catch(() => null);
        if (d) setQueue(d);
      } else if (r && !r.ok) {
        const d = await r.json().catch(() => ({}));
        alert(d.error || 'Ошибка вызова талона');
      }
    } catch (err) {
      console.error('doCallSpecific error:', err);
      alert('Ошибка соединения с сервером');
    } finally {
      setCallConfirm(null);
      setLoading(false);
    }
  };

  const returnToQueue = async () => {
    setLoading(true);
    try {
      const r = await apiFetch('/api/queue/return', { method: 'POST' });
      if (!r) return;
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        alert(d.error || 'Ошибка');
      } else {
        const d = await r.json().catch(() => null);
        if (d) setQueue(d);
      }
    } catch (err) {
      console.error('returnToQueue error:', err);
      alert('Ошибка соединения с сервером');
    } finally {
      setLoading(false);
    }
  };

  const returnTicketById = async (ticket) => {
    setLoading(true);
    try {
      const r = await apiFetch(`/api/queue/return/${ticket.id}`, { method: 'POST' });
      if (!r) return;
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        alert(d.error || 'Ошибка');
      } else {
        const d = await r.json().catch(() => null);
        if (d) setQueue({ current: d.current, waiting: d.waiting });
        loadAllTickets();
      }
    } catch (err) {
      console.error('returnTicketById error:', err);
      alert('Ошибка соединения с сервером');
    } finally {
      setLoading(false);
    }
  };

  const returnAllToQueue = async () => {
    if (!window.confirm('Вернуть все талоны за сегодня в очередь? Все обслуженные и вызванные талоны получат статус "В ожидании".')) return;
    setLoading(true);
    try {
      const r = await apiFetch('/api/queue/return-all', { method: 'POST' });
      if (!r) return;
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        alert(d.error || 'Ошибка');
      } else {
        const d = await r.json().catch(() => null);
        if (d) setQueue({ current: d.current, waiting: d.waiting });
        loadAllTickets();
      }
    } catch (err) {
      console.error('returnAllToQueue error:', err);
      alert('Ошибка соединения с сервером');
    } finally {
      setLoading(false);
    }
  };

  const hasNext = queue.waiting.length > 0;

  return (
    <div className="space-y-5">
      {/* Current */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">Вызван талон</h3>
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
              <button onClick={() => setEditTicket(queue.current)} disabled={loading}
                className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-40 text-white font-semibold px-4 py-2.5 rounded-xl transition text-sm">
                <Icon d={P.edit} cls="w-4 h-4" /> Редактировать
              </button>
              <button onClick={returnToQueue} disabled={loading}
                className="flex items-center gap-2 bg-amber-500 hover:bg-amber-600 disabled:opacity-40 text-white font-semibold px-4 py-2.5 rounded-xl transition text-sm">
                <Icon d={P.returnQueue} cls="w-4 h-4" /> Вернуть в очередь
              </button>
              <button onClick={callNext} disabled={loading || !hasNext}
                className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white font-semibold px-4 py-2.5 rounded-xl transition text-sm">
                <Icon d={P.next} cls="w-4 h-4" /> Следующий
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
                  <div className="flex items-start gap-3">
                    <span className={`text-2xl font-black w-14 shrink-0 pt-0.5 ${i === 0 ? 'text-blue-700' : 'text-gray-700'}`}>№{t.number}</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-gray-700">{t.service_name || '—'}</div>
                      {(t.name || t.phone) && (
                        <div className="text-xs text-gray-500 mt-0.5">
                          {t.name}{t.name && t.phone ? ' · ' : ''}{t.phone}
                        </div>
                      )}
                      {filledFields.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5">
                          {filledFields.map((fv, j) => (
                            <div key={j} className="text-xs">
                              <span className="text-gray-400">{fv.label}:</span>
                              <span className="ml-1 font-medium text-gray-600">{fv.value}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0 pt-0.5">
                      {t.avg_duration_minutes > 0 && (
                        <span className="text-xs text-gray-400 flex items-center gap-1">
                          <Icon d={P.clock} cls="w-3.5 h-3.5" />~{(i + 1) * t.avg_duration_minutes} мин
                        </span>
                      )}
                      <button onClick={() => setEditTicket(t)} title="Редактировать талон"
                        className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-100 rounded-lg transition">
                        <Icon d={P.edit} cls="w-4 h-4" />
                      </button>
                      <button onClick={() => callSpecific(t)} disabled={loading}
                        className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-green-700 bg-green-50 hover:bg-green-100 rounded-lg disabled:opacity-40 transition" title="Вызвать этого клиента">
                        <Icon d={P.next} cls="w-3.5 h-3.5" /> Вызвать
                      </button>
                    </div>
                  </div>
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
          <div className="flex items-center gap-3">
            <button onClick={() => setShowAll(v => !v)} className="text-sm text-blue-600 hover:underline">
              {showAll ? 'Скрыть' : 'Показать'}
            </button>
          </div>
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
                    <th className="px-3 py-2 w-24"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {allTickets.length === 0 && (
                    <tr><td colSpan={6} className="text-center py-6 text-gray-400">Нет данных</td></tr>
                  )}
                  {allTickets.map(t => (
                    <tr key={t.id} className="hover:bg-gray-50 align-top">
                      <td className="px-3 py-2 font-bold text-gray-700">№{t.number}</td>
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
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1">
                          <button onClick={() => setEditTicket(t)} title="Редактировать"
                            className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition">
                            <Icon d={P.edit} cls="w-4 h-4" />
                          </button>
                          {t.status !== 'waiting' && (
                            <button onClick={() => returnTicketById(t)} disabled={loading} title="Вернуть в очередь"
                              className="p-1.5 text-gray-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition disabled:opacity-40">
                              <Icon d={P.returnQueue} cls="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* Modals */}
      {manualModal && (
        <ManualRegModal services={services} onClose={() => setManualModal(false)}
          onCreated={() => apiFetch('/api/queue').then(r => r?.json()).then(d => d && setQueue(d))} />
      )}

      {editTicket && (
        <EditTicketModal
          ticket={editTicket}
          services={services}
          onClose={() => setEditTicket(null)}
          onSaved={() => { loadAllTickets(); apiFetch('/api/queue/full').then(r => r?.json()).then(d => d && setQueue(d)); }}
        />
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
