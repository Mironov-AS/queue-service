import { useState, useEffect, useRef, useCallback } from 'react';
import socket from '../socket';

// ─── Ad Slideshow Display ─────────────────────────────────────────────────────

function AdsDisplay({ ads, currentAdIndex, onAdEnded, waiting }) {
  const ad = ads[currentAdIndex % ads.length];
  if (!ad || !ad.url) return null;

  return (
    <div className="fixed inset-0 bg-black select-none overflow-hidden">
      {/* Media */}
      {ad.file_type === 'video' ? (
        <video
          key={ad.id + '_' + ad.url}
          className="w-full h-full object-contain"
          src={ad.url}
          autoPlay
          muted
          playsInline
          onEnded={onAdEnded}
          onError={onAdEnded}
        />
      ) : (
        <img
          key={ad.id}
          className="w-full h-full object-contain"
          src={ad.url}
          alt={ad.name}
        />
      )}

      {/* Top: clock */}
      <div className="absolute top-5 right-6 pointer-events-none">
        <Clock cls="text-white/50 text-lg font-mono" />
      </div>

      {/* Bottom-left: waiting count */}
      {waiting.length > 0 && (
        <div className="absolute bottom-5 left-6 bg-black/60 backdrop-blur-sm text-white px-4 py-2 rounded-2xl pointer-events-none">
          <span className="text-white/70 text-sm">В очереди: </span>
          <span className="text-xl font-bold">{waiting.length}</span>
        </div>
      )}

      {/* Bottom-right: slide dots */}
      {ads.length > 1 && (
        <div className="absolute bottom-6 right-6 flex gap-1.5 pointer-events-none">
          {ads.map((_, i) => (
            <div
              key={i}
              className={`rounded-full transition-all ${
                i === currentAdIndex % ads.length
                  ? 'w-5 h-2 bg-white'
                  : 'w-2 h-2 bg-white/30'
              }`}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────

export default function DashboardPage() {
  const [queue, setQueue] = useState({ current: null, waiting: [] });
  const [flash, setFlash] = useState(false);
  const [prevNumber, setPrevNumber] = useState(null);

  // Ads state
  const [ads, setAds] = useState([]);
  const [adSettings, setAdSettings] = useState({ ticket_display_time: 10 });
  // displayMode: 'idle' | 'ads' | 'ticket'
  const [displayMode, setDisplayMode] = useState('idle');
  const [currentAdIndex, setCurrentAdIndex] = useState(0);
  const [ticketCountdown, setTicketCountdown] = useState(0);

  // Refs for values needed in async callbacks
  const adsRef = useRef([]);
  const ticketDisplayTimeRef = useRef(10);
  const ticketTimerRef = useRef(null);
  const countdownTimerRef = useRef(null);
  const imageDurationTimerRef = useRef(null);
  // Track last displayed ticket id to avoid duplicate triggers
  const currentTicketIdRef = useRef(null);

  // Keep refs in sync
  useEffect(() => { adsRef.current = ads; }, [ads]);
  useEffect(() => { ticketDisplayTimeRef.current = adSettings.ticket_display_time; }, [adSettings]);

  const switchToAdsOrIdle = useCallback(() => {
    if (adsRef.current.length > 0) {
      setDisplayMode('ads');
    } else {
      setDisplayMode('idle');
    }
  }, []);

  const fetchAds = useCallback(async () => {
    try {
      const r = await fetch('/api/ads');
      if (!r.ok) return;
      const data = await r.json();
      setAds(data);
      adsRef.current = data;
      setDisplayMode(prev => {
        if (prev === 'idle' && data.length > 0) return 'ads';
        if (prev === 'ads' && data.length === 0) return 'idle';
        return prev;
      });
    } catch { /* network error — keep current state */ }
  }, []);

  const handleTicketCalled = useCallback((ticket) => {
    // Track ticket id to prevent duplicate triggers from queue:updated
    if (ticket?.id) currentTicketIdRef.current = ticket.id;

    // Clear existing timers
    clearTimeout(ticketTimerRef.current);
    clearInterval(countdownTimerRef.current);
    clearTimeout(imageDurationTimerRef.current);

    // Flash animation
    setFlash(true);
    setTimeout(() => setFlash(false), 2000);
    setPrevNumber(prev => prev !== ticket?.number ? prev : prev);

    const displayTime = ticketDisplayTimeRef.current;
    setDisplayMode('ticket');
    setTicketCountdown(displayTime);

    // Countdown ticker
    let cnt = displayTime;
    countdownTimerRef.current = setInterval(() => {
      cnt--;
      setTicketCountdown(cnt);
      if (cnt <= 0) clearInterval(countdownTimerRef.current);
    }, 1000);

    // Return to ads after N seconds
    ticketTimerRef.current = setTimeout(() => {
      clearInterval(countdownTimerRef.current);
      switchToAdsOrIdle();
    }, displayTime * 1000);
  }, [switchToAdsOrIdle]);

  // Mount: fetch data, set up socket
  useEffect(() => {
    // Fetch settings
    fetch('/api/settings/ads')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data) {
          setAdSettings(data);
          ticketDisplayTimeRef.current = data.ticket_display_time;
        }
      })
      .catch(() => {});

    fetchAds();

    // Refresh ads every 30 min (presigned URLs expire in 1h)
    const adsInterval = setInterval(fetchAds, 30 * 60 * 1000);

    // Queue polling fallback
    const refresh = () =>
      fetch('/api/queue')
        .then(r => r.json())
        .then(q => {
          setQueue(prev => {
            if (q.current?.number !== prev.current?.number) {
              setPrevNumber(prev.current?.number || null);
            }
            return q;
          });
          // Fallback: switch to ticket mode if a new ticket was called
          // (handles page reload or missed ticket:called socket event)
          if (q.current?.id && q.current.id !== currentTicketIdRef.current) {
            handleTicketCalled(q.current);
          }
        })
        .catch(() => {});

    refresh();
    const pollTimer = setInterval(refresh, 5000);

    // Socket events
    const onQueueUpdated = (q) => {
      setQueue(prev => {
        if (q.current?.number !== prev.current?.number) {
          setPrevNumber(prev.current?.number || null);
        }
        return q;
      });
      // Fallback: switch to ticket mode if ticket:called was missed
      if (q.current?.id && q.current.id !== currentTicketIdRef.current) {
        handleTicketCalled(q.current);
      }
    };

    socket.on('queue:updated', onQueueUpdated);
    socket.on('ticket:called', handleTicketCalled);
    socket.on('ads:updated', fetchAds);
    socket.on('ads:config', (cfg) => {
      setAdSettings(prev => ({ ...prev, ...cfg }));
      ticketDisplayTimeRef.current = cfg.ticket_display_time ?? ticketDisplayTimeRef.current;
    });

    return () => {
      socket.off('queue:updated', onQueueUpdated);
      socket.off('ticket:called', handleTicketCalled);
      socket.off('ads:updated', fetchAds);
      socket.off('ads:config');
      clearInterval(pollTimer);
      clearInterval(adsInterval);
      clearTimeout(ticketTimerRef.current);
      clearInterval(countdownTimerRef.current);
      clearTimeout(imageDurationTimerRef.current);
    };
  }, [fetchAds, handleTicketCalled]);

  // Image slideshow: advance after duration
  useEffect(() => {
    if (displayMode !== 'ads' || ads.length === 0) return;
    const ad = ads[currentAdIndex % ads.length];
    if (!ad || ad.file_type !== 'image') return;

    clearTimeout(imageDurationTimerRef.current);
    imageDurationTimerRef.current = setTimeout(() => {
      setCurrentAdIndex(prev => (prev + 1) % ads.length);
    }, (ad.duration || 15) * 1000);

    return () => clearTimeout(imageDurationTimerRef.current);
  }, [displayMode, currentAdIndex, ads]);

  const handleAdEnded = useCallback(() => {
    setCurrentAdIndex(prev => (prev + 1) % Math.max(adsRef.current.length, 1));
  }, []);

  // ── Render ──

  // Ads mode: full-screen slideshow
  if (displayMode === 'ads' && ads.length > 0) {
    return (
      <AdsDisplay
        ads={ads}
        currentAdIndex={currentAdIndex % ads.length}
        onAdEnded={handleAdEnded}
        waiting={queue.waiting}
      />
    );
  }

  // Ticket mode or idle: normal queue display
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-slate-100 to-blue-100 flex flex-col p-6 gap-6 select-none">
      {/* Header */}
      <div className="relative flex items-center justify-between">
        <h1 className="text-slate-600 text-2xl font-bold tracking-widest uppercase">
          Электронная очередь
        </h1>
        <div className="flex items-center gap-4">
          {displayMode === 'ticket' && ticketCountdown > 0 && (
            <div className="bg-blue-100 text-blue-600 text-sm font-semibold px-3 py-1 rounded-full">
              Реклама через {ticketCountdown} с
            </div>
          )}
          <Clock cls="text-slate-400 text-lg font-mono" />
        </div>
      </div>

      {/* Current ticket */}
      <div
        className={`flex-none rounded-3xl p-8 flex flex-col items-center justify-center transition-all duration-500 ${
          flash
            ? 'bg-emerald-500 shadow-[0_0_80px_rgba(16,185,129,0.5)]'
            : queue.current
            ? 'bg-blue-600 shadow-[0_8px_40px_rgba(37,99,235,0.35)]'
            : 'bg-white/70 border border-slate-200 shadow-sm'
        }`}
        style={{ minHeight: '38vh' }}
      >
        {queue.current ? (
          <>
            <p className="text-white/70 text-sm uppercase tracking-[0.3em] font-medium mb-2">
              Приглашается
            </p>
            <div
              className={`font-black leading-none text-white transition-all duration-300 ${flash ? 'scale-110' : 'scale-100'}`}
              style={{ fontSize: 'clamp(6rem, 20vw, 14rem)' }}
            >
              №{queue.current.number}
            </div>
            {queue.current.service_name && (
              <p className="text-white/80 text-xl font-medium mt-4 text-center">
                {queue.current.service_name}
              </p>
            )}
            {Array.isArray(queue.current.field_values) &&
              queue.current.field_values.filter(fv => fv.value).length > 0 && (
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
          <div
            className="grid gap-3"
            style={{
              gridTemplateColumns: `repeat(auto-fill, minmax(${queue.waiting.length <= 6 ? '180px' : '140px'}, 1fr))`,
            }}
          >
            {queue.waiting.map((t, i) => {
              const filledFields = Array.isArray(t.field_values)
                ? t.field_values.filter(fv => fv.value)
                : [];
              return (
                <div
                  key={t.id}
                  className={`rounded-2xl flex flex-col items-center justify-center py-5 px-3 transition-all ${
                    i === 0
                      ? 'bg-blue-100 border border-blue-300 shadow-sm'
                      : 'bg-white/80 border border-slate-200 shadow-sm'
                  }`}
                >
                  <span
                    className={`font-black leading-none ${i === 0 ? 'text-blue-700' : 'text-slate-700'} ${
                      queue.waiting.length <= 6 ? 'text-5xl' : 'text-4xl'
                    }`}
                  >
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

      {/* Slogan + Phone */}
      <div className="fixed bottom-6 left-0 right-0 flex flex-col items-center gap-1 pointer-events-none">
        <p className="text-slate-500 text-2xl font-semibold leading-snug">Разработка электронной очереди:</p>
        <p className="text-blue-600 text-3xl font-bold">+7 (916) 158 68 26</p>
      </div>

      {/* Logo */}
      <div className="fixed bottom-6 right-6 pointer-events-none">
        <img src="/logo.png" alt="Логотип" className="h-[156px] w-auto object-contain" />
      </div>
    </div>
  );
}

function Clock({ cls = 'text-slate-400 text-lg font-mono' }) {
  const [time, setTime] = useState(() =>
    new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
  );
  useEffect(() => {
    const t = setInterval(() => {
      setTime(new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }));
    }, 1000);
    return () => clearInterval(t);
  }, []);
  return <span className={cls}>{time}</span>;
}
