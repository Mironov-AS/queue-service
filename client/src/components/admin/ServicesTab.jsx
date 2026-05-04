import { useState, useEffect } from 'react';
import { apiFetch } from '../../api';
import { Icon, P, Modal, FIELD_TYPES } from './shared';

// ─── Service Fields Modal ─────────────────────────────────────────────────────

function ServiceFieldsModal({ service, onClose }) {
  const [fields, setFields] = useState([]);
  const [form, setForm] = useState({ label: '', field_type: 'text', required: false });
  const [editingId, setEditingId] = useState(null);
  const [error, setError] = useState('');

  const load = async () => {
    const r = await fetch(`/api/services/${service.id}/fields`);
    setFields(await r.json());
  };

  useEffect(() => { load(); }, [service.id]);

  const save = async () => {
    if (!form.label.trim()) { setError('Введите название поля'); return; }
    setError('');
    if (editingId) {
      await apiFetch(`/api/service-fields/${editingId}`, { method: 'PUT', body: JSON.stringify(form) });
      setEditingId(null);
    } else {
      await apiFetch(`/api/services/${service.id}/fields`, { method: 'POST', body: JSON.stringify(form) });
    }
    setForm({ label: '', field_type: 'text', required: false });
    load();
  };

  const startEdit = (f) => {
    setEditingId(f.id);
    setForm({ label: f.label, field_type: f.field_type, required: !!f.required });
    setError('');
  };

  const remove = async (id) => {
    await apiFetch(`/api/service-fields/${id}`, { method: 'DELETE' });
    load();
  };

  const move = async (field, dir) => {
    const idx = fields.findIndex(f => f.id === field.id);
    const swapIdx = idx + dir;
    if (swapIdx < 0 || swapIdx >= fields.length) return;
    const swap = fields[swapIdx];
    await Promise.all([
      apiFetch(`/api/service-fields/${field.id}`, { method: 'PUT', body: JSON.stringify({ order_index: swap.order_index }) }),
      apiFetch(`/api/service-fields/${swap.id}`, { method: 'PUT', body: JSON.stringify({ order_index: field.order_index }) }),
    ]);
    load();
  };

  return (
    <Modal title={`Поля формы — ${service.name}`} onClose={onClose}>
      <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
        {fields.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-4">Нет дополнительных полей. Добавьте первое поле ниже.</p>
        ) : (
          <div className="space-y-2">
            {fields.map((f, i) => (
              <div key={f.id} className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border ${editingId === f.id ? 'border-blue-300 bg-blue-50' : 'border-gray-100 bg-gray-50'}`}>
                <div className="flex flex-col gap-0.5">
                  <button onClick={() => move(f, -1)} disabled={i === 0} className="text-gray-300 hover:text-gray-500 disabled:opacity-20">
                    <Icon d={P.up} cls="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => move(f, 1)} disabled={i === fields.length - 1} className="text-gray-300 hover:text-gray-500 disabled:opacity-20">
                    <Icon d={P.down} cls="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm text-gray-800 truncate">{f.label}</div>
                  <div className="text-xs text-gray-400 flex items-center gap-2 mt-0.5">
                    <span>{FIELD_TYPES.find(t => t.value === f.field_type)?.label || f.field_type}</span>
                    {f.required ? <span className="text-red-500 font-semibold">• обязательное</span> : <span>• необязательное</span>}
                  </div>
                </div>
                <div className="flex gap-1 shrink-0">
                  <button onClick={() => startEdit(f)} className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-100 rounded-lg">
                    <Icon d={P.edit} cls="w-4 h-4" />
                  </button>
                  <button onClick={() => remove(f.id)} className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-100 rounded-lg">
                    <Icon d={P.trash} cls="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="border-t border-gray-100 pt-4 space-y-3">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
            {editingId ? 'Редактировать поле' : 'Добавить поле'}
          </p>
          <input
            type="text"
            value={form.label}
            onChange={e => setForm(f => ({ ...f, label: e.target.value }))}
            placeholder="Название поля (например: ФИО, Номер документа)"
            className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            onKeyDown={e => e.key === 'Enter' && save()}
          />
          <div className="flex gap-2">
            <select
              value={form.field_type}
              onChange={e => setForm(f => ({ ...f, field_type: e.target.value }))}
              className="flex-1 border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {FIELD_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
            <label className="flex items-center gap-2 px-3 py-2.5 border border-gray-200 rounded-xl cursor-pointer hover:bg-gray-50 text-sm whitespace-nowrap">
              <input
                type="checkbox"
                checked={form.required}
                onChange={e => setForm(f => ({ ...f, required: e.target.checked }))}
                className="rounded"
              />
              Обязательное
            </label>
          </div>
          {error && <p className="text-red-500 text-sm">{error}</p>}
          <div className="flex gap-2">
            <button onClick={save}
              className="flex-1 flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2.5 rounded-xl text-sm">
              <Icon d={editingId ? P.check : P.plus} cls="w-4 h-4" />
              {editingId ? 'Сохранить' : 'Добавить поле'}
            </button>
            {editingId && (
              <button onClick={() => { setEditingId(null); setForm({ label: '', field_type: 'text', required: false }); }}
                className="px-4 border border-gray-200 rounded-xl text-gray-600 hover:bg-gray-50 text-sm">
                Отмена
              </button>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}

// ─── Services Tab ─────────────────────────────────────────────────────────────

export default function ServicesTab() {
  const [services, setServices] = useState([]);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: '', description: '', avg_duration_minutes: 5, priority: 0, daily_limit: '' });
  const [error, setError] = useState('');
  const [fieldsModal, setFieldsModal] = useState(null);

  const load = () => apiFetch('/api/services/my?all=1').then(r => r?.json()).then(d => d && setServices(d));
  useEffect(() => { load(); }, []);

  const save = async () => {
    if (!form.name.trim()) { setError('Введите название'); return; }
    setError('');
    const body = { ...form, daily_limit: form.daily_limit ? parseInt(form.daily_limit) : null };
    if (editing) {
      await apiFetch(`/api/services/${editing}`, { method: 'PUT', body: JSON.stringify(body) });
      setEditing(null);
    } else {
      await apiFetch('/api/services', { method: 'POST', body: JSON.stringify(body) });
    }
    setForm({ name: '', description: '', avg_duration_minutes: 5, priority: 0, daily_limit: '' });
    load();
  };

  const startEdit = (s) => {
    setEditing(s.id);
    setForm({ name: s.name, description: s.description || '', avg_duration_minutes: s.avg_duration_minutes, priority: s.priority || 0, daily_limit: s.daily_limit || '' });
    setError('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const toggle = async (s) => {
    await apiFetch(`/api/services/${s.id}/toggle`, { method: 'PUT' });
    load();
  };

  const remove = async (id) => {
    if (!confirm('Удалить услугу? Активные талоны останутся без услуги.')) return;
    await apiFetch(`/api/services/${id}`, { method: 'DELETE' });
    load();
  };

  const setDefault = async (s) => {
    await apiFetch(`/api/services/${s.id}/set-default`, { method: 'PUT' });
    load();
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">
          {editing ? 'Редактировать услугу' : 'Добавить услугу'}
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2">
            <input type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="Название услуги *"
              className="w-full border border-gray-200 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div className="sm:col-span-2">
            <input type="text" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              placeholder="Описание (необязательно)"
              className="w-full border border-gray-200 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Среднее время (мин, 0 = не отображать)</label>
            <input type="number" min={0} max={120} value={form.avg_duration_minutes}
              onChange={e => setForm(f => ({ ...f, avg_duration_minutes: Math.max(0, parseInt(e.target.value) || 0) }))}
              className="w-full border border-gray-200 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Приоритет (выше = первее)</label>
            <input type="number" min={0} max={100} value={form.priority}
              onChange={e => setForm(f => ({ ...f, priority: parseInt(e.target.value) || 0 }))}
              className="w-full border border-gray-200 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Лимит талонов в день (0 = нет лимита)</label>
            <input type="number" min={0} value={form.daily_limit}
              onChange={e => setForm(f => ({ ...f, daily_limit: e.target.value }))}
              placeholder="Без лимита"
              className="w-full border border-gray-200 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
        </div>
        {error && <p className="text-red-500 text-sm mt-2">{error}</p>}
        <div className="flex gap-2 mt-4">
          <button onClick={save}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold px-5 py-2.5 rounded-xl transition">
            <Icon d={editing ? P.check : P.plus} />
            {editing ? 'Сохранить' : 'Добавить'}
          </button>
          {editing && (
            <button onClick={() => { setEditing(null); setForm({ name: '', description: '', avg_duration_minutes: 5, priority: 0, daily_limit: '' }); }}
              className="px-4 py-2.5 border border-gray-200 rounded-xl hover:bg-gray-50 text-gray-700">
              Отмена
            </button>
          )}
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100">
              <th className="text-left px-5 py-3 text-gray-500 font-semibold">Услуга</th>
              <th className="text-center px-4 py-3 text-gray-500 font-semibold">Время</th>
              <th className="text-center px-4 py-3 text-gray-500 font-semibold">Приоритет</th>
              <th className="text-center px-4 py-3 text-gray-500 font-semibold">Лимит/день</th>
              <th className="text-center px-4 py-3 text-gray-500 font-semibold">Поля</th>
              <th className="text-center px-4 py-3 text-gray-500 font-semibold">По умолчанию</th>
              <th className="text-center px-4 py-3 text-gray-500 font-semibold">Статус</th>
              <th className="px-4 py-3 w-28"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {services.length === 0 && (
              <tr><td colSpan={6} className="text-center py-10 text-gray-400">Нет услуг</td></tr>
            )}
            {services.map(s => (
              <tr key={s.id} className={`hover:bg-gray-50 transition ${!s.enabled ? 'opacity-50' : ''}`}>
                <td className="px-5 py-4">
                  <div className="font-medium">{s.name}</div>
                  {s.description && <div className="text-xs text-gray-400 mt-0.5">{s.description}</div>}
                </td>
                <td className="px-4 py-4 text-center text-gray-600">
                  {s.avg_duration_minutes > 0 ? (
                    <span className="flex items-center justify-center gap-1">
                      <Icon d={P.clock} cls="w-4 h-4 text-gray-400" />{s.avg_duration_minutes} мин
                    </span>
                  ) : <span className="text-gray-400">—</span>}
                </td>
                <td className="px-4 py-4 text-center text-gray-600">{s.priority || 0}</td>
                <td className="px-4 py-4 text-center text-gray-500">{s.daily_limit || '∞'}</td>
                <td className="px-4 py-4 text-center">
                  <button onClick={() => setFieldsModal(s)}
                    className="inline-flex items-center gap-1.5 text-xs bg-purple-50 hover:bg-purple-100 text-purple-700 font-medium px-3 py-1.5 rounded-lg transition">
                    <Icon d={P.fields} cls="w-3.5 h-3.5" />
                    Поля
                  </button>
                </td>
                <td className="px-4 py-4 text-center">
                  <button onClick={() => setDefault(s)} title={s.is_default ? 'Снять метку' : 'Сделать по умолчанию'}
                    className={`inline-flex items-center justify-center w-8 h-8 rounded-full transition ${s.is_default ? 'text-amber-500 bg-amber-50 hover:bg-amber-100' : 'text-gray-300 hover:text-amber-400 hover:bg-amber-50'}`}>
                    <Icon d={P.star} cls="w-4 h-4" />
                  </button>
                </td>
                <td className="px-4 py-4 text-center">
                  <button onClick={() => toggle(s)}
                    className={`text-xs px-3 py-1 rounded-full font-medium ${s.enabled ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                    {s.enabled ? 'Активна' : 'Отключена'}
                  </button>
                </td>
                <td className="px-4 py-4">
                  <div className="flex gap-1 justify-end">
                    <button onClick={() => startEdit(s)} className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg">
                      <Icon d={P.edit} cls="w-4 h-4" />
                    </button>
                    <button onClick={() => remove(s.id)} className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg">
                      <Icon d={P.trash} cls="w-4 h-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {fieldsModal && (
        <ServiceFieldsModal service={fieldsModal} onClose={() => { setFieldsModal(null); load(); }} />
      )}
    </div>
  );
}
