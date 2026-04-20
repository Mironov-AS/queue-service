import { useState, useEffect, useRef, useCallback } from 'react';
import socket from '../socket';

// ─── Ad Slideshow Display ─────────────────────────────────────────────────────

function AdsDisplay({ ads, currentAdIndex, onAdEnded, waiting, totalSlides }) {
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
        <div className="absolute bottom-5 left-6 bg-black/60 backdrop-blur-sm text-white px-8 py-4 rounded-2xl pointer-events-none">
          <span className="text-white/70 text-[2.625rem] leading-tight">В очереди: </span>
          <span className="text-[3.75rem] font-bold leading-tight">{waiting.length}</span>
        </div>
      )}

      {/* Bottom-right: slide dots (ads + dashboard slot) */}
      {totalSlides > 1 && (
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
          {/* Dashboard slot dot — always unlit since we're in ads mode */}
          <div className="w-2 h-2 rounded-full bg-white/20" />
        </div>
      )}
    </div>
  );
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────

export default function DashboardPage() {
  const [queue, setQueue] = useState({ current: null, waiting: [] });
  const [flash, setFlash] = useState(false);

  // Ads state
  const [ads, setAds] = useState([]);
  const [adSettings, setAdSettings] = useState({ ticket_display_time: 10, dashboard_idle_time: 15, ads_before_dashboard: 0 });

  // displayMode:
  //   'ads'    — full-screen ad slideshow (currentAdIndex = which ad)
  //   'queue'  — queue dashboard in idle rotation (will auto-switch to ads after dashboard_idle_time)
  //   'ticket' — queue dashboard because a ticket was just called (countdown active)
  const [displayMode, setDisplayMode] = useState('queue');
  const [currentAdIndex, setCurrentAdIndex] = useState(0);
  const [ticketCountdown, setTicketCountdown] = useState(0);

  // Refs for values needed in async callbacks
  const adsRef = useRef([]);
  const ticketDisplayTimeRef = useRef(10);
  const dashboardIdleTimeRef = useRef(15);
  const adsBeforeDashboardRef = useRef(0);
  const adsShownSinceDashboardRef = useRef(0);
  const currentAdIndexRef = useRef(0);
  const ticketTimerRef = useRef(null);
  const countdownTimerRef = useRef(null);
  const imageDurationTimerRef = useRef(null);
  const dashboardTimerRef = useRef(null);
  // Track last displayed ticket id to avoid duplicate triggers
  const currentTicketIdRef = useRef(null);

  // Keep refs in sync with state/settings
  useEffect(() => { adsRef.current = ads; }, [ads]);
  useEffect(() => {
    ticketDisplayTimeRef.current = adSettings.ticket_display_time;
    dashboardIdleTimeRef.current = adSettings.dashboard_idle_time;
    adsBeforeDashboardRef.current = adSettings.ads_before_dashboard ?? 0;
  }, [adSettings]);
  useEffect(() => { currentAdIndexRef.current = currentAdIndex; }, [currentAdIndex]);

  // Advance to next slide in rotation.
  // ads_before_dashboard=0 → show dashboard only after ALL ads finish (default)
  // ads_before_dashboard=N → show dashboard after every N ads
  const advanceSlide = useCallback(() => {
    adsShownSinceDashboardRef.current += 1;
    const nextIdx = currentAdIndexRef.current + 1;
    const adsBeforeDb = adsBeforeDashboardRef.current;
    const endOfAllAds = nextIdx >= adsRef.current.length;
    // Show dashboard when ads_before_dashboard ads have been shown, or when all ads are done (if ads_before_dashboard=0)
    const shouldShowDashboard = adsBeforeDb === 0 ? endOfAllAds : adsShownSinceDashboardRef.current >= adsBeforeDb;

    if (shouldShowDashboard) {
      adsShownSinceDashboardRef.current = 0;
      const resumeIdx = endOfAllAds ? 0 : nextIdx;
      setCurrentAdIndex(resumeIdx);
      currentAdIndexRef.current = resumeIdx;
      setDisplayMode('queue');
    } else {
      setCurrentAdIndex(nextIdx);
      currentAdIndexRef.current = nextIdx;
    }
  }, []);

  // After ticket display, resume rotation from the beginning
  const resumeRotation = useCallback(() => {
    adsShownSinceDashboardRef.current = 0;
    setCurrentAdIndex(0);
    currentAdIndexRef.current = 0;
    if (adsRef.current.length > 0) {
      setDisplayMode('ads');
    } else {
      setDisplayMode('queue');
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
        if (prev === 'queue' && data.length > 0) return 'ads';
        if (prev === 'ads' && data.length === 0) return 'queue';
        return prev;
      });
    } catch { /* network error — keep current state */ }
  }, []);

  const handleTicketCalled = useCallback((ticket) => {
    // Track ticket id to prevent duplicate triggers
    if (ticket?.id) {
      currentTicketIdRef.current = ticket.id;
      setQueue(prev => ({
        current: {
          ...ticket,
          field_values: Array.isArray(ticket.field_values)
            ? ticket.field_values
            : (ticket.field_values ? JSON.parse(ticket.field_values) : [])
        },
        waiting: prev.waiting.filter(t => t.id !== ticket.id)
      }));
    }

    // Clear all rotation timers — pause the slideshow
    clearTimeout(ticketTimerRef.current);
    clearInterval(countdownTimerRef.current);
    clearTimeout(imageDurationTimerRef.current);
    clearTimeout(dashboardTimerRef.current);

    // Flash animation
    setFlash(true);
    setTimeout(() => setFlash(false), 2000);

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

    // Resume rotation after N seconds
    ticketTimerRef.current = setTimeout(() => {
      clearInterval(countdownTimerRef.current);
      resumeRotation();
    }, displayTime * 1000);
  }, [resumeRotation]);

  // Mount: fetch data, set up socket
  useEffect(() => {
    fetch('/api/settings/ads')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data) {
          setAdSettings(data);
          ticketDisplayTimeRef.current = data.ticket_display_time;
          dashboardIdleTimeRef.current = data.dashboard_idle_time ?? 15;
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
          setQueue(q);
          if (q.current?.id && q.current.id !== currentTicketIdRef.current) {
            handleTicketCalled(q.current);
          }
        })
        .catch(() => {});

    refresh();
    const pollTimer = setInterval(refresh, 5000);

    // Socket events
    const onQueueUpdated = (q) => {
      setQueue(q);
      if (q.current?.id && q.current.id !== currentTicketIdRef.current) {
        handleTicketCalled(q.current);
      }
    };

    socket.on('queue:updated', onQueueUpdated);
    socket.on('ticket:called', handleTicketCalled);
    socket.on('ads:updated', fetchAds);
    socket.on('ads:config', (cfg) => {
      setAdSettings(prev => ({ ...prev, ...cfg }));
      if (cfg.ticket_display_time != null) ticketDisplayTimeRef.current = cfg.ticket_display_time;
      if (cfg.dashboard_idle_time != null) dashboardIdleTimeRef.current = cfg.dashboard_idle_time;
      if (cfg.ads_before_dashboard != null) adsBeforeDashboardRef.current = cfg.ads_before_dashboard;
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
      clearTimeout(dashboardTimerRef.current);
    };
  }, [fetchAds, handleTicketCalled]);

  // Image slideshow: advance to next slide after duration
  useEffect(() => {
    if (displayMode !== 'ads' || ads.length === 0) return;
    const ad = ads[currentAdIndex % ads.length];
    if (!ad || ad.file_type !== 'image') return;

    clearTimeout(imageDurationTimerRef.current);
    imageDurationTimerRef.current = setTimeout(() => {
      advanceSlide();
    }, (ad.duration || 15) * 1000);

    return () => clearTimeout(imageDurationTimerRef.current);
  }, [displayMode, currentAdIndex, ads, advanceSlide]);

  // Dashboard idle timer: show dashboard for dashboard_idle_time, then switch back to ads
  useEffect(() => {
    if (displayMode !== 'queue') return;
    clearTimeout(dashboardTimerRef.current);
    if (adsRef.current.length === 0) return; // No ads — stay in queue mode indefinitely
    dashboardTimerRef.current = setTimeout(() => {
      adsShownSinceDashboardRef.current = 0;
      setCurrentAdIndex(0);
      currentAdIndexRef.current = 0;
      setDisplayMode('ads');
    }, dashboardIdleTimeRef.current * 1000);
    return () => clearTimeout(dashboardTimerRef.current);
  }, [displayMode]);

  const handleAdEnded = useCallback(() => {
    advanceSlide();
  }, [advanceSlide]);

  // ── Render ──

  // Ads mode: full-screen slideshow
  if (displayMode === 'ads' && ads.length > 0) {
    return (
      <AdsDisplay
        ads={ads}
        currentAdIndex={currentAdIndex % ads.length}
        onAdEnded={handleAdEnded}
        waiting={queue.waiting}
        totalSlides={ads.length + 1}
      />
    );
  }

  // Queue/ticket mode: normal queue display
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
