import { useState, useEffect } from 'react';
import { apiFetch } from '../../api';
import { Icon, P } from './shared';

export default function SettingsTab() {
  const [resetDone, setResetDone] = useState(false);
  const [autoReset, setAutoReset] = useState({ enabled: false, time: '00:00' });
  const [autoResetSaved, setAutoResetSaved] = useState(false);
  const [windowsCount, setWindowsCount] = useState(1);
  const [windowsSaved, setWindowsSaved] = useState(false);

  useEffect(() => {
    apiFetch('/api/settings/auto-reset').then(r => r?.json()).then(d => { if (d) setAutoReset(d); });
    apiFetch('/api/settings/windows').then(r => r?.json()).then(d => { if (d) setWindowsCount(d.windows_count); });
  }, []);

  const saveAutoReset = async (patch) => {
    const next = { ...autoReset, ...patch };
    setAutoReset(next);
    const r = await apiFetch('/api/settings/auto-reset', { method: 'PUT', body: JSON.stringify(next) });
    if (r?.ok) { setAutoResetSaved(true); setTimeout(() => setAutoResetSaved(false), 2000); }
  };

  const resetQueue = async () => {
    if (!confirm('Сбросить всю очередь? Все ожидающие талоны будут отменены.')) return;
    await apiFetch('/api/queue/reset', { method: 'POST' });
    setResetDone(true);
    setTimeout(() => setResetDone(false), 3000);
  };

  const saveWindowsCount = async (val) => {
    const count = Math.max(1, Math.min(20, parseInt(val, 10) || 1));
    setWindowsCount(count);
    const r = await apiFetch('/api/settings/windows', { method: 'PUT', body: JSON.stringify({ windows_count: count }) });
    if (r?.ok) { setWindowsSaved(true); setTimeout(() => setWindowsSaved(false), 2000); }
  };

  return (
    <div className="space-y-6 max-w-md">
      {/* Windows count */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-4">
        <h3 className="font-semibold text-gray-800">Окна обслуживания</h3>
        <p className="text-sm text-gray-500">
          Укажите количество окон обслуживания. При нескольких окнах оператор выбирает номер окна при вызове талона, а посетители видят номер окна на дашборде.
        </p>
        <div className="flex items-center gap-3">
          <label className="text-sm font-medium text-gray-700">Количество окон</label>
          <input
            type="number"
            min={1}
            max={20}
            value={windowsCount}
            onChange={e => saveWindowsCount(e.target.value)}
            className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 w-20 text-center"
          />
          {windowsSaved && <span className="text-green-600 text-xs">Сохранено</span>}
        </div>
      </div>

      {/* Reset queue */}
      <div className="bg-white rounded-2xl shadow-sm border border-red-100 p-6 space-y-4">
        <h3 className="font-semibold text-gray-800">Сброс очереди</h3>
        <p className="text-sm text-gray-500">Все ожидающие талоны сегодняшнего дня будут отменены. Действие необратимо.</p>

        <div className="flex items-center gap-3">
          {resetDone && <p className="text-green-600 text-sm">Очередь сброшена</p>}
          <button onClick={resetQueue}
            className="flex items-center gap-2 text-sm text-red-600 border border-red-200 hover:bg-red-50 font-medium px-4 py-2.5 rounded-xl transition">
            <Icon d={P.repeat} cls="w-4 h-4" /> Сбросить сейчас
          </button>
        </div>

        <div className="border-t border-gray-100 pt-4 space-y-3">
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={autoReset.enabled}
                onChange={e => saveAutoReset({ enabled: e.target.checked })}
                className="w-4 h-4 accent-red-500 cursor-pointer"
              />
              <span className="text-sm font-medium text-gray-700">Автосброс</span>
            </label>
            <input
              type="time"
              value={autoReset.time}
              onChange={e => saveAutoReset({ time: e.target.value })}
              className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400 w-32"
            />
            {autoResetSaved && <span className="text-green-600 text-xs">Сохранено</span>}
          </div>
          <p className="text-xs text-gray-400">
            Очередь будет автоматически сброшена каждый день в указанное время.
          </p>
        </div>
      </div>
    </div>
  );
}
