import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import socket from '../socket';

export default function VisitorPage() {
  const [searchParams] = useSearchParams();
  const ticketId = searchParams.get('ticket');
  const preService = searchParams.get('service');
  const clientId = searchParams.get('client_id') || '';

  if (ticketId) return <TicketStatus ticketId={ticketId} clientId={clientId} />;
  return <GetTicket preService={preService} clientId={clientId} />;
}

// ─── Get Ticket ────────────────────────────────────────────────────────────────

const FIELD_INPUT_TYPES = { text: 'text', phone: 'tel', number: 'number', date: 'date', email: 'email' };

function GetTicket({ preService, clientId }) {
  const [services, setServices] = useState([]);
  const [selected, setSelected] = useState(preService || null);
  const [fields, setFields] = useState([]);
  const [fieldValues, setFieldValues] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [regOpen, setRegOpen] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    fetch('/api/settings/registration').then(r => r.json()).then(d => setRegOpen(d.open));
    const servicesUrl = clientId ? `/api/services?client_id=${encodeURIComponent(clientId)}` : '/api/services';
    fetch(servicesUrl).then(r => r.json()).then(data => {
      setServices(data);
      if (preService) {
        setSelected(preService);
      } else if (data.length === 1) {
        setSelected(String(data[0].id));
      } else {
        const def = data.find(s => s.is_default);
        if (def) setSelected(String(def.id));
      }
    });

    // Listen for real-time registration status changes
    const handler = (d) => setRegOpen(d.open);
    socket.on('registration:changed', handler);
    return () => socket.off('registration:changed', handler);
  }, [clientId, preService]);

  // Load fields whenever selected service changes
  useEffect(() => {
    if (!selected) { setFields([]); setFieldValues({}); return; }
    fetch(`/api/services/${selected}/fields`).then(r => r.json()).then(data => {
      setFields(data);
      // Init values object keyed by field id
      const init = {};
      data.forEach(f => { init[f.id] = ''; });
      setFieldValues(init);
    });
  }, [selected]);

  const getTicket = async () => {
    if (!selected) { setError('Выберите услугу'); return; }
    // Validate required fields
    for (const f of fields) {
      if (f.required && !fieldValues[f.id]?.trim()) {
        setError(`Поле «${f.label}» обязательно для заполнения`);
        return;
      }
    }
    setError('');
    setLoading(true);
    try {
      // Build field_values array with label + value
      const fvArray = fields.map(f => ({ field_id: f.id, label: f.label, value: fieldValues[f.id] || '' }))
        .filter(fv => fv.value.trim() !== '' || fields.find(f => f.id === fv.field_id)?.required);

      const res = await fetch('/api/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ service_id: selected, client_id: clientId || undefined, field_values: fvArray.length ? fvArray : undefined })
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Ошибка'); return; }
      const statusUrl = clientId
        ? `/visitor?ticket=${data.id}&client_id=${encodeURIComponent(clientId)}`
        : `/visitor?ticket=${data.id}`;
      navigate(statusUrl, { replace: true });
    } catch {
      setError('Ошибка соединения');
    } finally {
      setLoading(false);
    }
  };

  if (!regOpen) return (
    <div className="min-h-screen bg-gradient-to-br from-gray-600 to-gray-800 flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-sm text-center space-y-4">
        <div className="text-6xl">🔒</div>
        <p className="text-white text-2xl font-bold">Запись временно закрыта</p>
        <p className="text-gray-300 text-sm">Обратитесь к сотруднику</p>
        <a href="https://онлайнпро.рф" target="_blank" rel="noopener noreferrer"
          className="text-gray-400/50 hover:text-white text-xs transition mt-4 inline-block">
          Работает на базе ОнлайнПро.РФ
        </a>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-600 to-blue-900 flex flex-col items-center justify-center p-5">
      <div className="w-full max-w-sm">
        <div className="text-center mb-7">
          <div className="text-5xl mb-3">🎫</div>
          <h1 className="text-3xl font-black text-white">Электронная очередь</h1>
          <p className="text-blue-200 mt-1.5 text-sm">Получите талон для ожидания</p>
        </div>

        <div className="bg-white rounded-3xl shadow-2xl p-6 space-y-4">
          {services.length > 0 ? (
            <>
              {/* Service selection */}
              <div>
                {services.length === 1 ? (
                  <div className="flex items-center justify-between p-4 rounded-2xl border-2 border-blue-600 bg-blue-50">
                    <div>
                      <span className="font-semibold text-sm text-blue-700">{services[0].name}</span>
                      {services[0].description && <p className="text-xs text-gray-400 mt-0.5">{services[0].description}</p>}
                    </div>
                    {services[0].avg_duration_minutes > 0 && <span className="text-xs text-gray-400 shrink-0 ml-2">~{services[0].avg_duration_minutes} мин</span>}
                  </div>
                ) : (
                  <>
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Выберите услугу</p>
                    <div className="space-y-2">
                      {services.map(s => (
                        <button key={s.id} onClick={() => setSelected(String(s.id))}
                          className={`w-full flex items-center justify-between p-4 rounded-2xl border-2 text-left transition ${
                            selected === String(s.id) ? 'border-blue-600 bg-blue-50' : 'border-gray-100 hover:border-gray-200 active:bg-gray-50'
                          }`}>
                          <div>
                            <span className={`font-semibold text-sm ${selected === String(s.id) ? 'text-blue-700' : 'text-gray-800'}`}>
                              {s.name}
                            </span>
                            {s.description && <p className="text-xs text-gray-400 mt-0.5">{s.description}</p>}
                          </div>
                          {s.avg_duration_minutes > 0 && <span className="text-xs text-gray-400 shrink-0 ml-2">~{s.avg_duration_minutes} мин</span>}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>

              {/* Dynamic fields */}
              {fields.length > 0 && (
                <div className="space-y-3 border-t border-gray-100 pt-4">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Заполните данные</p>
                  {fields.map(f => (
                    <div key={f.id}>
                      <label className="block text-sm font-medium text-gray-700 mb-1.5">
                        {f.label}
                        {f.required && <span className="text-red-500 ml-1">*</span>}
                      </label>
                      <input
                        type={FIELD_INPUT_TYPES[f.field_type] || 'text'}
                        value={fieldValues[f.id] || ''}
                        onChange={e => setFieldValues(v => ({ ...v, [f.id]: e.target.value }))}
                        required={!!f.required}
                        className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        placeholder={`Введите ${f.label.toLowerCase()}`}
                      />
                    </div>
                  ))}
                </div>
              )}

              {error && <p className="text-red-500 text-sm text-center">{error}</p>}

              <button onClick={getTicket} disabled={!selected || loading}
                className="w-full bg-blue-600 hover:bg-blue-700 active:bg-blue-800 disabled:opacity-40 text-white font-bold py-4 rounded-2xl text-lg transition shadow-lg shadow-blue-200">
                {loading ? 'Получаем талон...' : 'Получить талон'}
              </button>
              <p className="text-center text-xs text-gray-400">
                Подойдите к стойке, когда вас вызовут
              </p>
            </>
          ) : (
            <div className="text-center py-10 text-gray-400">
              <div className="text-4xl mb-3">🔧</div>
              <p className="font-medium">Услуги временно недоступны</p>
              <p className="text-sm mt-1">Обратитесь к сотруднику</p>
            </div>
          )}
        </div>

        <div className="text-center mt-5">
          <a href="https://онлайнпро.рф" target="_blank" rel="noopener noreferrer"
            className="text-blue-300/50 hover:text-white text-xs transition">
            Работает на базе ОнлайнПро.РФ
          </a>
        </div>
      </div>
    </div>
  );
}

// ─── Ticket Status ─────────────────────────────────────────────────────────────

function TicketStatus({ ticketId, clientId }) {
  const [ticket, setTicket] = useState(null);
  const [queue, setQueue] = useState(null);
  const [called, setCalled] = useState(false);
  const [cancelDone, setCancelDone] = useState(false);
  const [showThankYou, setShowThankYou] = useState(false);
  const servedTimerRef = useRef(null);
  const navigate = useNavigate();

  const loadTicket = useCallback(async () => {
    const res = await fetch(`/api/tickets/${ticketId}`);
    if (!res.ok) { navigate('/visitor', { replace: true }); return; }
    const data = await res.json();
    setTicket(data);
    if (data.status === 'called') setCalled(true);
    if (data.status === 'waiting') setCalled(false);
    if (data.status === 'served' && !servedTimerRef.current) {
      servedTimerRef.current = setTimeout(() => setShowThankYou(true), 1 * 60 * 1000);
    }
  }, [ticketId, navigate]);

  const loadQueue = useCallback(() => {
    const queueUrl = clientId ? `/api/queue?client_id=${encodeURIComponent(clientId)}` : '/api/queue';
    fetch(queueUrl).then(r => r.json()).then(setQueue).catch(() => {});
  }, [clientId]);

  useEffect(() => {
    loadTicket();
    loadQueue();

    if (clientId) {
      socket.emit('join:client', { client_id: clientId });
      socket.on('connect', () => socket.emit('join:client', { client_id: clientId }));
    }

    const handleQueue = (q) => {
      setQueue(q);
      loadTicket();
    };
    const handleCalled = (t) => {
      if (String(t.id) === String(ticketId)) {
        setCalled(true);
        loadTicket();
        if (navigator.vibrate) navigator.vibrate([300, 100, 300, 100, 500]);
      }
    };

    socket.on('queue:updated', handleQueue);
    socket.on('ticket:called', handleCalled);

    // Polling fallback every 5s — keeps position current if socket event is missed
    const timer = setInterval(() => { loadTicket(); loadQueue(); }, 5000);

    return () => {
      socket.off('connect');
      socket.off('queue:updated', handleQueue);
      socket.off('ticket:called', handleCalled);
      clearInterval(timer);
      if (servedTimerRef.current) clearTimeout(servedTimerRef.current);
    };
  }, [ticketId, clientId, loadTicket, loadQueue]);

  const cancelTicket = async () => {
    if (!confirm('Отменить талон? Ваше место в очереди будет потеряно.')) return;
    await fetch(`/api/tickets/${ticketId}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'Отменён посетителем' })
    });
    setCancelDone(true);
  };

  if (!ticket) return (
    <div className="min-h-screen bg-gradient-to-br from-blue-600 to-blue-900 flex items-center justify-center">
      <div className="text-white text-xl animate-pulse">Загрузка...</div>
    </div>
  );

  if (cancelDone) return (
    <div className="min-h-screen bg-gradient-to-br from-gray-500 to-gray-700 flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-sm text-center space-y-5">
        <div className="text-5xl">✖️</div>
        <p className="text-white text-xl font-semibold">Талон отменён</p>
        <button onClick={() => navigate('/visitor', { replace: true })}
          className="bg-white text-gray-800 font-semibold px-8 py-3 rounded-2xl shadow">
          Получить новый талон
        </button>
        <a href="https://онлайнпро.рф" target="_blank" rel="noopener noreferrer"
          className="text-gray-300/50 hover:text-white text-xs transition mt-2 inline-block">
          Работает на базе ОнлайнПро.РФ
        </a>
      </div>
    </div>
  );

  if (ticket.status === 'served' && showThankYou) return (
    <div className="min-h-screen bg-gradient-to-br from-blue-600 to-blue-900 flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-sm text-center space-y-5">
        <div className="text-6xl">🙏</div>
        <p className="text-white text-2xl font-bold">Спасибо за визит!</p>
        <p className="text-blue-100 text-base">Благодарим вас за обращение.<br />Будем рады видеть вас снова!</p>
        <button onClick={() => navigate('/visitor', { replace: true })}
          className="bg-white text-blue-700 font-semibold px-8 py-3 rounded-2xl shadow">
          Получить новый талон
        </button>
        <a href="https://онлайнпро.рф" target="_blank" rel="noopener noreferrer"
          className="text-blue-300/50 hover:text-white text-xs transition mt-2 inline-block">
          Работает на базе ОнлайнПро.РФ
        </a>
      </div>
    </div>
  );

  if (called || ticket.status === 'called' || (ticket.status === 'served' && !showThankYou)) return (
    <div className="min-h-screen bg-gradient-to-br from-green-500 to-emerald-700 flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-sm text-center space-y-5">
        <div className="text-6xl animate-bounce">🔔</div>
        <div>
          <p className="text-white text-2xl font-black">Ваш номер вызван!</p>
          {ticket.window_number ? (
            <p className="text-green-100 mt-1">Подойдите к <span className="font-bold text-white">окну №{ticket.window_number}</span></p>
          ) : (
            <p className="text-green-100 mt-1">Пожалуйста, подойдите к специалисту</p>
          )}
        </div>
        <div className="bg-white rounded-3xl p-8 shadow-2xl">
          {ticket.window_number && (
            <div className="mb-4 pb-4 border-b border-gray-100">
              <p className="text-xs text-gray-400 uppercase tracking-wider" style={{ fontSize: 'clamp(0.6rem, 2vw, 0.75rem)' }}>Окно</p>
              <div className="font-black text-emerald-600 leading-none" style={{ fontSize: 'clamp(3rem, 12vw, 5rem)' }}>{ticket.window_number}</div>
            </div>
          )}
          <p className="text-xs text-gray-400 mb-1 uppercase tracking-wider">Ваш талон</p>
          <div className="text-8xl font-black text-green-600 leading-none">№{ticket.number}</div>
          <p className="mt-3 text-gray-600 font-medium">{ticket.service_name || 'Общая очередь'}</p>
        </div>
        <button onClick={() => navigate('/visitor', { replace: true })}
          className="text-green-100 text-sm underline mt-2">
          Получить новый талон
        </button>
        <div className="pt-2">
          <a href="https://онлайнпро.рф" target="_blank" rel="noopener noreferrer"
            className="text-green-200/60 hover:text-white text-xs transition">
            Работает на базе ОнлайнПро.РФ
          </a>
        </div>
      </div>
    </div>
  );

  // Waiting
  const pos = ticket.position || 0;
  const showWait = ticket.avg_duration_minutes > 0;
  const estimatedWait = showWait ? pos * ticket.avg_duration_minutes : null;
  const totalWaiting = queue?.waiting?.length || pos;
  const progressPct = totalWaiting > 1 ? Math.max(0, 100 - ((pos - 1) / totalWaiting) * 100) : (pos <= 1 ? 80 : 0);

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-600 to-blue-900 flex flex-col items-center justify-center p-5">
      <div className="w-full max-w-sm space-y-4">
        {/* Main ticket card */}
        <div className="bg-white rounded-3xl p-8 shadow-2xl text-center">
          <p className="text-xs text-gray-400 uppercase tracking-wider mb-1">Ваш талон</p>
          <div className="text-8xl font-black text-blue-600 leading-none">№{ticket.number}</div>
          <p className="mt-3 text-gray-600 font-medium text-lg">{ticket.service_name || 'Общая очередь'}</p>
          {Array.isArray(ticket.field_values) && ticket.field_values.length > 0 && (
            <div className="mt-4 pt-4 border-t border-gray-100 text-left space-y-1">
              {ticket.field_values.map((fv, i) => (
                <div key={i} className="flex justify-between text-sm">
                  <span className="text-gray-400">{fv.label}</span>
                  <span className="text-gray-700 font-medium ml-4 text-right">{fv.value || '—'}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Progress */}
        <div className="bg-white/15 backdrop-blur rounded-2xl p-5">
          <div className="flex justify-between items-center mb-2">
            <span className="text-blue-100 text-sm">Прогресс</span>
            <span className="text-white text-sm font-semibold">
              {pos <= 1 ? 'Почти ваша очередь!' : `Впереди: ${pos - 1}`}
            </span>
          </div>
          <div className="h-3 bg-white/20 rounded-full overflow-hidden">
            <div className="h-full bg-white rounded-full transition-all duration-500"
              style={{ width: `${progressPct}%` }} />
          </div>
        </div>

        {/* Stats */}
        <div className={`grid gap-3 ${showWait ? 'grid-cols-2' : 'grid-cols-1'}`}>
          <div className="bg-white/15 backdrop-blur rounded-2xl p-4 text-center">
            <p className="text-blue-100 text-xs mb-1">Позиция</p>
            <p className="text-3xl font-black text-white">{pos || '—'}</p>
          </div>
          {showWait && (
            <div className="bg-white/15 backdrop-blur rounded-2xl p-4 text-center">
              <p className="text-blue-100 text-xs mb-1">Ожидание</p>
              <p className="text-3xl font-black text-white">{pos > 0 ? `~${estimatedWait}м` : '—'}</p>
            </div>
          )}
        </div>

        {/* Currently being served */}
        {(() => {
          const currentArr = Array.isArray(queue?.current) ? queue.current : (queue?.current ? [queue.current] : []);
          if (!currentArr.length) return null;
          const showWindows = (queue?.windows_count || 1) > 1;
          return (
            <div className="bg-white/10 backdrop-blur rounded-2xl p-4">
              <p className="text-blue-200 text-xs mb-2 text-center">Сейчас обслуживается</p>
              <div className={currentArr.length > 1 ? 'space-y-2' : ''}>
                {currentArr.map(t => (
                  <div key={t.id || t.number} className="flex items-center justify-center gap-3">
                    {showWindows && t.window_number && (
                      <span className="text-blue-200 text-sm">Окно {t.window_number}:</span>
                    )}
                    <span className="text-2xl font-black text-white">№{t.number}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })()}

        <p className="text-center text-blue-200 text-xs py-1">
          Страница обновляется автоматически
        </p>

        {/* Cancel */}
        <button onClick={cancelTicket}
          className="w-full text-center text-blue-300 hover:text-white text-sm py-2 underline transition">
          Отменить талон
        </button>

        <div className="text-center pt-1">
          <a href="https://онлайнпро.рф" target="_blank" rel="noopener noreferrer"
            className="text-blue-300/50 hover:text-white text-xs transition">
            Работает на базе ОнлайнПро.РФ
          </a>
        </div>
      </div>
    </div>
  );
}
