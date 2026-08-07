import { useState, useEffect } from 'react';
import { apiFetch } from '../../api';
import { Icon, P, fmtDate } from './shared';

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

export default function StatsTab() {
  const [days, setDays] = useState(7);
  const [stats, setStats] = useState({ rows: [], daily: [] });

  useEffect(() => {
    apiFetch(`/api/stats?days=${days}`).then(r => r?.json()).then(d => d && setStats(d));
  }, [days]);

  const exportCSV = async () => {
    const res = await apiFetch(`/api/stats/export?days=${days}`);
    if (!res) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `queue_stats_${days}d.csv`; a.click();
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

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 font-semibold text-gray-700 text-sm">По дням</div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                {['Дата', 'Всего', 'Обслужено', 'Ср. ожидание'].map(h => (
                  <th key={h} className="px-4 py-3 text-gray-500 font-semibold text-left">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {stats.daily.length === 0 && (
                <tr><td colSpan={4} className="text-center py-8 text-gray-400">Нет данных</td></tr>
              )}
              {stats.daily.map(r => (
                <tr key={r.date} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium">{fmtDate(r.date)}</td>
                  <td className="px-4 py-3">{r.total}</td>
                  <td className="px-4 py-3 text-green-600 font-medium">{r.served}</td>
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
