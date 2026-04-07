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
    <div className="min-h-screen bg-gray-950 flex flex-col p-6 gap-6 select-none">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-white text-2xl font-bold tracking-widest uppercase opacity-70">
          Электронная очередь
        </h1>
        <div className="text-gray-500 text-sm tabular-nums">
          <Clock />
        </div>
      </div>

      {/* Current ticket */}
      <div className={`flex-none rounded-3xl p-8 flex flex-col items-center justify-center transition-all duration-500 ${
        flash ? 'bg-green-500 shadow-[0_0_80px_rgba(34,197,94,0.6)]' : queue.current ? 'bg-blue-700' : 'bg-gray-800'
      }`}
        style={{ minHeight: '38vh' }}>
        {queue.current ? (
          <>
            <p className="text-white/60 text-sm uppercase tracking-[0.3em] font-medium mb-2">
              Приглашается
            </p>
            <div className={`font-black leading-none text-white transition-all duration-300 ${flash ? 'scale-110' : 'scale-100'}`}
              style={{ fontSize: 'clamp(6rem, 20vw, 14rem)' }}>
              №{queue.current.number}
            </div>
            {queue.current.service_name && (
              <p className="text-white/70 text-xl font-medium mt-4 text-center">{queue.current.service_name}</p>
            )}
            {Array.isArray(queue.current.field_values) && queue.current.field_values.filter(fv => fv.value).length > 0 && (
              <div className="mt-4 flex flex-wrap justify-center gap-x-6 gap-y-1">
                {queue.current.field_values.filter(fv => fv.value).map((fv, i) => (
                  <div key={i} className="text-white/70 text-base text-center">
                    <span className="text-white/40 text-sm">{fv.label}: </span>
                    <span className="font-semibold">{fv.value}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <p className="text-white/40 text-2xl font-medium">Ожидание вызова</p>
        )}
      </div>

      {/* Waiting list */}
      <div className="flex-1 flex flex-col min-h-0">
        <div className="flex items-center gap-3 mb-4">
          <p className="text-gray-400 text-xs uppercase tracking-[0.25em] font-semibold">В очереди</p>
          {queue.waiting.length > 0 && (
            <span className="bg-blue-600/30 text-blue-300 text-xs font-bold px-2.5 py-0.5 rounded-full">
              {queue.waiting.length}
            </span>
          )}
        </div>

        {queue.waiting.length === 0 ? (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-gray-600 text-xl">Очередь пуста</p>
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
                    i === 0 ? 'bg-blue-600/30 border border-blue-500/50' : 'bg-gray-800/80'
                  }`}>
                  <span className={`font-black leading-none text-white ${
                    queue.waiting.length <= 6 ? 'text-5xl' : 'text-4xl'
                  }`}>
                    №{t.number}
                  </span>
                  {t.service_name && (
                    <span className="text-gray-400 text-xs mt-2 text-center leading-tight line-clamp-2">
                      {t.service_name}
                    </span>
                  )}
                  {filledFields.map((fv, j) => (
                    <span key={j} className="text-gray-300 text-xs mt-1 text-center leading-tight">
                      {fv.value}
                    </span>
                  ))}
                  {t.is_priority === 1 && (
                    <span className="mt-1.5 text-orange-400 text-xs">★</span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
      {/* Logo — fixed bottom-right */}
      <img src="/logo.png" alt="Логотип"
        className="fixed bottom-6 right-6 h-40 w-auto object-contain opacity-90 pointer-events-none" />
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
  return <span className="text-gray-400 text-lg font-mono">{time}</span>;
}
