import { useState, useEffect } from 'react';
import socket from '../socket';

export default function DashboardPage() {
  const [queue, setQueue] = useState({ current: null, waiting: [] });
  const [prevNumber, setPrevNumber] = useState(null);
  const [flash, setFlash] = useState(false);

  const applyUpdate = (q, prev) => {
    if (q.current?.number !== prev.current?.number) {
      setPrevNumber(prev.current?.number || null);
      setFlash(true);
      setTimeout(() => setFlash(false), 2000);
    }
    return q;
  };

  useEffect(() => {
    const refresh = () =>
      fetch('/api/queue').then(r => r.json()).then(q => setQueue(prev => applyUpdate(q, prev)));

    refresh();

    // Socket for instant updates
    socket.on('queue:updated', (q) => setQueue(prev => applyUpdate(q, prev)));

    // Polling fallback every 5 s (covers missed socket events)
    const timer = setInterval(refresh, 5000);

    return () => {
      socket.off('queue:updated');
      clearInterval(timer);
    };
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-slate-100 to-blue-100 flex flex-col p-6 gap-6 select-none">
      {/* Header */}
      <div className="relative flex items-center justify-between">
        <h1 className="text-slate-600 text-2xl font-bold tracking-widest uppercase">
          Электронная очередь
        </h1>
        <div className="text-slate-400 text-sm tabular-nums">
          <Clock />
        </div>
      </div>

      {/* Current ticket */}
      <div className={`flex-none rounded-3xl p-8 flex flex-col items-center justify-center transition-all duration-500 ${
        flash ? 'bg-emerald-500 shadow-[0_0_80px_rgba(16,185,129,0.5)]' : queue.current ? 'bg-blue-600 shadow-[0_8px_40px_rgba(37,99,235,0.35)]' : 'bg-white/70 border border-slate-200 shadow-sm'
      }`}
        style={{ minHeight: '38vh' }}>
        {queue.current ? (
          <>
            <p className="text-white/70 text-sm uppercase tracking-[0.3em] font-medium mb-2">
              Приглашается
            </p>
            <div className={`font-black leading-none text-white transition-all duration-300 ${flash ? 'scale-110' : 'scale-100'}`}
              style={{ fontSize: 'clamp(6rem, 20vw, 14rem)' }}>
              №{queue.current.number}
            </div>
            {queue.current.service_name && (
              <p className="text-white/80 text-xl font-medium mt-4 text-center">{queue.current.service_name}</p>
            )}
            {Array.isArray(queue.current.field_values) && queue.current.field_values.filter(fv => fv.value).length > 0 && (
              <div className="mt-4 flex flex-wrap justify-center gap-x-6 gap-y-1">
                {queue.current.field_values.filter(fv => fv.value).map((fv, i) => (
                  <div key={i} className="text-white/80 text-base text-center">
                    <span className="text-white/50 text-sm">{fv.label}: </span>
                    <span className="font-semibold">{fv.value}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <p className="text-slate-400 text-2xl font-medium">Ожидание вызова</p>
        )}
      </div>

      {/* Waiting list */}
      <div className="flex-1 flex flex-col min-h-0">
        <div className="flex items-center gap-3 mb-4">
          <p className="text-slate-500 text-xs uppercase tracking-[0.25em] font-semibold">В очереди</p>
          {queue.waiting.length > 0 && (
            <span className="bg-blue-100 text-blue-600 text-xs font-bold px-2.5 py-0.5 rounded-full border border-blue-200">
              {queue.waiting.length}
            </span>
          )}
        </div>

        {queue.waiting.length === 0 ? (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-slate-400 text-xl">Очередь пуста</p>
          </div>
        ) : (
          <div className="grid gap-3" style={{
            gridTemplateColumns: `repeat(auto-fill, minmax(${queue.waiting.length <= 6 ? '180px' : '140px'}, 1fr))`
          }}>
            {queue.waiting.map((t, i) => {
              const filledFields = Array.isArray(t.field_values) ? t.field_values.filter(fv => fv.value) : [];
              return (
                <div key={t.id}
                  className={`rounded-2xl flex flex-col items-center justify-center py-5 px-3 transition-all ${
                    i === 0 ? 'bg-blue-100 border border-blue-300 shadow-sm' : 'bg-white/80 border border-slate-200 shadow-sm'
                  }`}>
                  <span className={`font-black leading-none ${i === 0 ? 'text-blue-700' : 'text-slate-700'} ${
                    queue.waiting.length <= 6 ? 'text-5xl' : 'text-4xl'
                  }`}>
                    №{t.number}
                  </span>
                  {t.service_name && (
                    <span className="text-slate-500 text-xs mt-2 text-center leading-tight line-clamp-2">
                      {t.service_name}
                    </span>
                  )}
                  {filledFields.map((fv, j) => (
                    <span key={j} className="text-slate-600 text-xs mt-1 text-center leading-tight">
                      {fv.value}
                    </span>
                  ))}
                  {t.is_priority === 1 && (
                    <span className="mt-1.5 text-orange-500 text-xs">★</span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
      {/* Slogan + Phone — fixed bottom-center */}
      <div className="fixed bottom-6 left-0 right-0 flex flex-col items-center gap-1 pointer-events-none">
        <p className="text-slate-500 text-2xl font-semibold leading-snug">Разработка электронной очереди:</p>
        <p className="text-blue-600 text-3xl font-bold">+7 (916) 158 68 26</p>
      </div>
      {/* Logo — fixed bottom-right */}
      <div className="fixed bottom-6 right-6 pointer-events-none">
        <img src="/logo.png" alt="Логотип" className="h-[156px] w-auto object-contain" />
      </div>
    </div>
  );
}

function Clock() {
  const [time, setTime] = useState(() => new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }));
  useEffect(() => {
    const t = setInterval(() => {
      setTime(new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }));
    }, 1000);
    return () => clearInterval(t);
  }, []);
  return <span className="text-slate-400 text-lg font-mono">{time}</span>;
}
