import { useState, useEffect } from 'react';
import { apiFetch } from '../../api';
import { ACTION_LABELS, ACTION_COLORS } from './shared';

export default function LogsTab() {
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
