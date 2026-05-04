import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../../api';
import { Icon, P, Modal, ROLE_LABELS, ROLE_COLORS } from './shared';

export default function UsersTab() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ username: '', password: '', role: 'advertiser' });
  const [formErr, setFormErr] = useState('');
  const [creating, setCreating] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [resetPwModal, setResetPwModal] = useState(null);
  const [resetPw, setResetPw] = useState('');
  const [resetPwErr, setResetPwErr] = useState('');
  const [resetPwOk, setResetPwOk] = useState(false);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    const r = await apiFetch('/api/users');
    if (r?.ok) setUsers(await r.json());
    setLoading(false);
  }, []);

  useEffect(() => { loadUsers(); }, [loadUsers]);

  const handleCreate = async () => {
    setFormErr('');
    if (!form.username.trim()) { setFormErr('Введите логин'); return; }
    if (!form.password) { setFormErr('Введите пароль'); return; }
    setCreating(true);
    const r = await apiFetch('/api/users', {
      method: 'POST',
      body: JSON.stringify({ username: form.username.trim(), password: form.password, role: form.role }),
    });
    setCreating(false);
    if (!r) return;
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      setFormErr(d.error || 'Ошибка создания');
      return;
    }
    setForm({ username: '', password: '', role: 'advertiser' });
    loadUsers();
  };

  const handleDelete = async (id) => {
    await apiFetch(`/api/users/${id}`, { method: 'DELETE' });
    setDeleteConfirm(null);
    loadUsers();
  };

  const handleResetPw = async () => {
    setResetPwErr('');
    if (!resetPw || resetPw.length < 8) { setResetPwErr('Минимум 8 символов'); return; }
    const r = await apiFetch(`/api/users/${resetPwModal.id}/password`, {
      method: 'PUT',
      body: JSON.stringify({ password: resetPw }),
    });
    if (!r) return;
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      setResetPwErr(d.error || 'Ошибка');
      return;
    }
    setResetPwOk(true);
    setTimeout(() => { setResetPwModal(null); setResetPw(''); setResetPwOk(false); }, 1500);
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
        <h3 className="text-base font-bold text-gray-900 mb-1">Создать пользователя</h3>
        <p className="text-xs text-gray-400 mb-4">Рекламодатель может только загружать кампании. Оператор работает с очередью.</p>
        <div className="flex gap-3 flex-wrap">
          <div className="flex-1 min-w-36">
            <label className="text-xs text-gray-500 font-medium mb-1 block">Логин</label>
            <input type="text" value={form.username}
              onChange={e => setForm(p => ({ ...p, username: e.target.value }))}
              placeholder="Логин"
              autoComplete="off"
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div className="flex-1 min-w-36">
            <label className="text-xs text-gray-500 font-medium mb-1 block">Пароль</label>
            <input type="password" value={form.password}
              onChange={e => setForm(p => ({ ...p, password: e.target.value }))}
              placeholder="Минимум 8 символов"
              autoComplete="new-password"
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div className="w-44">
            <label className="text-xs text-gray-500 font-medium mb-1 block">Роль</label>
            <select value={form.role} onChange={e => setForm(p => ({ ...p, role: e.target.value }))}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="advertiser">Рекламодатель</option>
              <option value="operator">Оператор</option>
            </select>
          </div>
          <div className="flex items-end">
            <button onClick={handleCreate} disabled={creating}
              className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-semibold px-5 py-2 rounded-xl transition">
              {creating ? 'Создание...' : 'Создать'}
            </button>
          </div>
        </div>
        {formErr && <p className="text-red-500 text-sm mt-2">{formErr}</p>}
      </div>

      <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
        <h3 className="text-base font-bold text-gray-900 mb-4">
          Пользователи
          {users.length > 0 && (
            <span className="ml-2 bg-gray-100 text-gray-600 text-xs font-bold px-2 py-0.5 rounded-full">{users.length}</span>
          )}
        </h3>
        {loading ? (
          <div className="flex justify-center py-8"><svg className="animate-spin w-6 h-6 text-blue-500" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg></div>
        ) : (
          <div className="space-y-2">
            {users.map(u => (
              <div key={u.id} className="flex items-center gap-3 p-3 rounded-xl border border-gray-100 bg-gray-50">
                <div className="w-9 h-9 rounded-full bg-gray-200 flex items-center justify-center flex-shrink-0">
                  <Icon d={P.person} cls="w-5 h-5 text-gray-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-sm text-gray-900">{u.username}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ROLE_COLORS[u.role] || 'bg-gray-100 text-gray-600'}`}>
                      {ROLE_LABELS[u.role] || u.role}
                    </span>
                    {u.campaigns_total > 0 && (
                      <span className="text-xs text-gray-400">
                        {u.campaigns_total} кампани{u.campaigns_total === 1 ? 'я' : u.campaigns_total < 5 ? 'и' : 'й'}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5">{new Date(u.created_at).toLocaleDateString('ru-RU')}</p>
                </div>
                {u.role !== 'admin' && (
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={() => { setResetPwModal({ id: u.id, username: u.username }); setResetPw(''); setResetPwErr(''); setResetPwOk(false); }}
                      className="p-1.5 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition" title="Сбросить пароль">
                      <Icon d={P.settings} cls="w-4 h-4" />
                    </button>
                    <button onClick={() => setDeleteConfirm(u)}
                      className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition" title="Удалить">
                      <Icon d={P.trash} cls="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {deleteConfirm && (
        <Modal title="Удалить пользователя?" onClose={() => setDeleteConfirm(null)}>
          <div className="space-y-4">
            <p className="text-gray-600 text-sm">
              Удалить пользователя <span className="font-semibold">«{deleteConfirm.username}»</span>?
              Его аккаунт будет удалён, но загруженные кампании останутся.
            </p>
            <div className="flex gap-2">
              <button onClick={() => handleDelete(deleteConfirm.id)}
                className="flex-1 bg-red-600 hover:bg-red-700 text-white font-semibold py-2.5 rounded-xl transition">
                Удалить
              </button>
              <button onClick={() => setDeleteConfirm(null)}
                className="px-4 py-2.5 rounded-xl border border-gray-200 text-gray-600 hover:bg-gray-50 transition">
                Отмена
              </button>
            </div>
          </div>
        </Modal>
      )}

      {resetPwModal && (
        <Modal title={`Сбросить пароль: ${resetPwModal.username}`} onClose={() => setResetPwModal(null)}>
          <div className="space-y-4">
            <div>
              <label className="text-xs text-gray-500 font-medium mb-1 block">Новый пароль</label>
              <input type="password" value={resetPw}
                onChange={e => setResetPw(e.target.value)}
                placeholder="Минимум 8 символов"
                autoComplete="new-password"
                className="w-full border border-gray-200 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            {resetPwErr && <p className="text-red-500 text-sm">{resetPwErr}</p>}
            {resetPwOk && <p className="text-green-600 text-sm">Пароль изменён</p>}
            <div className="flex gap-2">
              <button onClick={handleResetPw}
                className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2.5 rounded-xl transition">
                Сохранить
              </button>
              <button onClick={() => setResetPwModal(null)}
                className="px-4 py-2.5 rounded-xl border border-gray-200 text-gray-600 hover:bg-gray-50 transition">
                Отмена
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
