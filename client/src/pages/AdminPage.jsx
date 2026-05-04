import { useState, useEffect, useRef, useMemo } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { apiFetch } from '../api';
import { Icon, P, Modal, TABS, ALL_SETTINGS_TABS, INACTIVITY_MS } from '../components/admin/shared';
import QueueTab from '../components/admin/QueueTab';
import ServicesTab from '../components/admin/ServicesTab';
import StatsTab from '../components/admin/StatsTab';
import QRTab from '../components/admin/QRTab';
import LogsTab from '../components/admin/LogsTab';
import SettingsTab from '../components/admin/SettingsTab';
import UsersTab from '../components/admin/UsersTab';
import AdsTab from '../components/admin/AdsTab';

// ─── Force Password Change ────────────────────────────────────────────────────

function ForcePasswordChange({ onDone }) {
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [error, setError] = useState('');

  const save = async () => {
    setError('');
    if (form.newPassword !== form.confirm) { setError('Пароли не совпадают'); return; }
    if (form.newPassword.length < 8) { setError('Минимум 8 символов'); return; }
    const r = await apiFetch('/api/settings/password', { method: 'PUT', body: JSON.stringify(form) });
    if (!r) return;
    const data = await r.json();
    if (!r.ok) { setError(data.error); return; }
    localStorage.removeItem('mustChangePassword');
    if (data.token) localStorage.setItem('adminToken', data.token);
    onDone();
  };

  return (
    <div className="space-y-3">
      {[
        { key: 'currentPassword', label: 'Текущий пароль (admin)' },
        { key: 'newPassword', label: 'Новый пароль' },
        { key: 'confirm', label: 'Повторите пароль' },
      ].map(f => (
        <div key={f.key}>
          <label className="text-xs text-gray-500 font-medium mb-1 block">{f.label}</label>
          <input type="password" value={form[f.key]}
            onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))}
            className="w-full border border-gray-200 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
      ))}
      {error && <p className="text-red-500 text-sm">{error}</p>}
      <button onClick={save}
        className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-xl">
        Установить пароль
      </button>
    </div>
  );
}

// ─── Admin Page ───────────────────────────────────────────────────────────────

export default function AdminPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  // Redirect to login if no token and no auth_token in URL
  const hasToken = localStorage.getItem('adminToken');
  const hasUrlToken = searchParams.get('auth_token');
  if (!hasToken && !hasUrlToken) {
    return <Navigate to="/login" replace />;
  }

  const currentUser = (() => { try { return JSON.parse(localStorage.getItem('adminUser')); } catch { return null; } })();
  const isAdmin = currentUser?.role === 'admin';
  const isAdvertiser = currentUser?.role === 'advertiser';
  const SETTINGS_TABS = ALL_SETTINGS_TABS.filter(t =>
    (!t.adminOnly || isAdmin) && (!t.advertiserHidden || !isAdvertiser)
  );
  const initialTab = searchParams.get('tab') || (isAdvertiser ? 'ads' : 'queue');
  const SETTINGS_IDS = SETTINGS_TABS.map(t => t.id);
  const [tab, setTab] = useState(isAdvertiser ? 'ads' : (SETTINGS_IDS.includes(initialTab) ? 'settings' : initialTab));
  const [settingsTab, setSettingsTab] = useState(SETTINGS_IDS.includes(initialTab) ? initialTab : (isAdvertiser ? 'ads' : 'services'));
  const [time, setTime] = useState(new Date());
  const [regOpen, setRegOpen] = useState(true);
  const inactivityTimer = useRef(null);

  const mustChange = localStorage.getItem('mustChangePassword');

  useEffect(() => {
    const resetTimer = () => {
      clearTimeout(inactivityTimer.current);
      inactivityTimer.current = setTimeout(() => {
        localStorage.removeItem('adminToken');
        localStorage.removeItem('adminUser');
        navigate('/login', { replace: true });
      }, INACTIVITY_MS);
    };
    const events = ['mousemove', 'keydown', 'click', 'touchstart'];
    events.forEach(e => window.addEventListener(e, resetTimer, { passive: true }));
    resetTimer();
    return () => {
      clearTimeout(inactivityTimer.current);
      events.forEach(e => window.removeEventListener(e, resetTimer));
    };
  }, [navigate]);

  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!isAdvertiser) {
      fetch('/api/settings/registration').then(r => r.json()).then(d => setRegOpen(d.open));
    }
  }, [isAdvertiser]);

  const toggleRegistration = async () => {
    const r = await apiFetch('/api/settings/registration', { method: 'PUT', body: JSON.stringify({ open: !regOpen }) });
    if (r) { const d = await r.json(); setRegOpen(d.open); }
  };

  const logout = () => {
    localStorage.removeItem('adminToken');
    localStorage.removeItem('adminUser');
    navigate('/login', { replace: true });
  };

  // ── Force password change overlay ──
  if (mustChange) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-8">
          <h2 className="text-xl font-bold text-gray-900 mb-2">Смените пароль</h2>
          <p className="text-sm text-gray-500 mb-6">Для продолжения необходимо установить новый пароль.</p>
          <ForcePasswordChange onDone={() => window.location.reload()} />
        </div>
      </div>
    );
  }

  // ── Advertiser simplified layout ──
  if (isAdvertiser) {
    return (
      <div className="min-h-screen bg-gray-50">
        <header className="bg-white border-b border-gray-100 shadow-sm sticky top-0 z-10">
          <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold text-gray-900">Рекламный кабинет</h1>
              <p className="text-xs text-gray-400">{currentUser?.username} · Рекламодатель</p>
            </div>
            <div className="flex items-center gap-3">
              <div className="text-right hidden sm:block">
                <div className="text-xl font-bold text-blue-600 tabular-nums">
                  {time.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>
              <div className="flex border-b-0 gap-1">
                {SETTINGS_TABS.map(t => (
                  <button key={t.id} onClick={() => setSettingsTab(t.id)}
                    className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium transition whitespace-nowrap ${
                      settingsTab === t.id
                        ? 'bg-blue-50 text-blue-600'
                        : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
                    }`}>
                    <Icon d={t.icon} cls="w-4 h-4" />
                    {t.label}
                  </button>
                ))}
              </div>
              <button onClick={logout}
                className="p-2 rounded-xl text-gray-400 hover:text-red-600 hover:bg-red-50 transition"
                title="Выйти">
                <Icon d={P.logout} cls="w-5 h-5" />
              </button>
            </div>
          </div>
        </header>
        <main className="max-w-4xl mx-auto px-4 py-6">
          {settingsTab === 'ads' && <AdsTab />}
          {settingsTab === 'reset' && <SettingsTab />}
        </main>
      </div>
    );
  }

  const queueBasePath = useMemo(() => (import.meta.env.BASE_URL || '/').replace(/\/$/, ''), []);
  const dashboardHref = useMemo(() => {
    const cid = currentUser?.clientId;
    return `${queueBasePath}/dashboard${cid ? `?client_id=${encodeURIComponent(cid)}` : ''}`;
  }, [queueBasePath, currentUser]);
  const dashboardFullUrl = useMemo(() => new URL(dashboardHref, window.location.origin).toString(), [dashboardHref]);
  const [linkCopied, setLinkCopied] = useState(false);
  const [showBoardMenu, setShowBoardMenu] = useState(false);
  const boardMenuRef = useRef(null);

  useEffect(() => {
    if (!showBoardMenu) return;
    const close = (e) => { if (boardMenuRef.current && !boardMenuRef.current.contains(e.target)) setShowBoardMenu(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [showBoardMenu]);

  const copyDashboardLink = () => {
    navigator.clipboard.writeText(dashboardFullUrl).then(() => {
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    });
  };

  // ── Admin / Operator full layout ──
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-100 shadow-sm sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900">Электронная очередь</h1>
            <p className="text-xs text-gray-400">Панель администратора</p>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={toggleRegistration}
              className={`flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-semibold border-2 transition ${
                regOpen
                  ? 'border-green-400 bg-green-50 text-green-700 hover:bg-green-100'
                  : 'border-red-300 bg-red-50 text-red-600 hover:bg-red-100'
              }`}>
              <span className={`w-2.5 h-2.5 rounded-full ${regOpen ? 'bg-green-500' : 'bg-red-500'}`} />
              {regOpen ? 'Запись открыта' : 'Запись закрыта'}
            </button>
            <div className="relative" ref={boardMenuRef}>
              <button onClick={() => setShowBoardMenu(v => !v)}
                title="Табло для зоны ожидания"
                className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold transition ${
                  showBoardMenu
                    ? 'bg-indigo-50 text-indigo-600 border-2 border-indigo-300'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200 border-2 border-transparent'
                }`}>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
                <span className="hidden sm:inline">Табло</span>
              </button>
              {showBoardMenu && (
                <div className="absolute right-0 top-full mt-2 w-80 bg-white rounded-2xl shadow-xl border border-gray-200 p-4 z-50 space-y-3">
                  <div>
                    <h4 className="text-sm font-bold text-gray-900">Табло для зоны ожидания</h4>
                    <p className="text-xs text-gray-500 mt-0.5">Откройте эту ссылку на экране в зоне ожидания клиентов. Табло показывает текущий вызванный талон и очередь в реальном времени.</p>
                  </div>
                  <div className="flex gap-2">
                    <a href={dashboardHref} target="_blank" rel="noopener noreferrer"
                      className="flex-1 flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2.5 rounded-xl text-sm transition">
                      <Icon d={P.eye} cls="w-4 h-4" />
                      Открыть табло
                    </a>
                    <button onClick={copyDashboardLink}
                      className={`flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition border-2 ${
                        linkCopied
                          ? 'bg-green-50 text-green-600 border-green-300'
                          : 'bg-gray-50 text-gray-600 hover:bg-gray-100 border-gray-200'
                      }`}>
                      {linkCopied ? (
                        <><Icon d={P.check} cls="w-4 h-4" /> Скопировано</>
                      ) : (
                        <><svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg> Ссылка</>
                      )}
                    </button>
                  </div>
                  <div className="bg-gray-50 rounded-xl px-3 py-2">
                    <p className="text-[11px] text-gray-400 break-all font-mono select-all">{dashboardFullUrl}</p>
                  </div>
                </div>
              )}
            </div>
            <div className="text-right hidden sm:block">
              <div className="text-2xl font-bold text-blue-600 tabular-nums">
                {time.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </div>
              <div className="text-xs text-gray-400">
                {time.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })}
              </div>
            </div>
            <button onClick={() => setTab(t => t === 'settings' ? 'queue' : 'settings')}
              title="Настройки"
              className={`p-2 rounded-xl transition ${tab === 'settings' ? 'text-blue-600 bg-blue-50' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'}`}>
              <Icon d={P.settings} cls="w-5 h-5" />
            </button>
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
        {tab === 'settings' && (
          <div className="space-y-4">
            <div className="flex gap-1 flex-wrap border-b border-gray-200 pb-0">
              {SETTINGS_TABS.map(t => (
                <button key={t.id} onClick={() => setSettingsTab(t.id)}
                  className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium rounded-t-xl border-b-2 transition whitespace-nowrap -mb-px ${
                    settingsTab === t.id
                      ? 'border-blue-600 text-blue-600 bg-white'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                  }`}>
                  <Icon d={t.icon} cls="w-4 h-4" />
                  {t.label}
                </button>
              ))}
            </div>
            {settingsTab === 'services'     && <ServicesTab />}
            {settingsTab === 'users'        && <UsersTab />}
            {settingsTab === 'ads'          && <AdsTab />}
            {settingsTab === 'stats'        && <StatsTab />}
            {settingsTab === 'qrcode'       && <QRTab />}
            {settingsTab === 'logs'         && <LogsTab />}
            {settingsTab === 'reset'        && <SettingsTab />}
          </div>
        )}
      </main>
    </div>
  );
}
