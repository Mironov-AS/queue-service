import { useState, useEffect, useCallback, useRef } from 'react';
import { apiFetch, authHeaders } from '../../api';
import { Icon, P, Modal, AD_STATUS_LABELS, AD_STATUS_COLORS } from './shared';

export default function AdsTab() {
  const [ads, setAds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState('');
  const [settings, setSettings] = useState({ ticket_display_time: 10, s3_configured: false, storage_type: 'local' });
  const [settingsSaved, setSettingsSaved] = useState(false);
  const [editModal, setEditModal] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [form, setForm] = useState({ name: '', duration: '15', file: null });
  const fileInputRef = useRef(null);

  const loadAds = useCallback(async () => {
    setLoading(true);
    const r = await apiFetch('/api/ads/all');
    if (r?.ok) setAds(await r.json());
    setLoading(false);
  }, []);

  const loadSettings = useCallback(async () => {
    const r = await fetch('/api/settings/ads');
    if (r.ok) setSettings(await r.json());
  }, []);

  useEffect(() => { loadAds(); loadSettings(); }, [loadAds, loadSettings]);

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setForm(prev => ({
      ...prev,
      file,
      name: prev.name || file.name.replace(/\.[^.]+$/, '').replace(/[_-]/g, ' '),
    }));
    setUploadErr('');
  };

  const handleUpload = async () => {
    if (!form.file) { setUploadErr('Выберите файл'); return; }
    if (!form.name.trim()) { setUploadErr('Введите название'); return; }
    setUploading(true);
    setUploadErr('');
    const fd = new FormData();
    fd.append('file', form.file);
    fd.append('name', form.name.trim());
    fd.append('duration', form.duration);
    const r = await fetch('/api/ads', {
      method: 'POST',
      headers: authHeaders(),
      body: fd,
    });
    setUploading(false);
    if (!r) return;
    if (r.status === 401) { window.location.href = '/login'; return; }
    if (!r.ok) {
      const d = await r.json().catch(() => ({ error: 'Ошибка загрузки' }));
      setUploadErr(d.error || 'Ошибка загрузки');
      return;
    }
    setForm({ name: '', duration: '15', file: null });
    if (fileInputRef.current) fileInputRef.current.value = '';
    loadAds();
  };

  const handleToggle = async (ad) => {
    await apiFetch(`/api/ads/${ad.id}`, { method: 'PUT', body: JSON.stringify({ active: ad.active ? 0 : 1 }) });
    loadAds();
  };

  const handleDelete = async (id) => {
    await apiFetch(`/api/ads/${id}`, { method: 'DELETE' });
    setDeleteConfirm(null);
    loadAds();
  };

  const handleEditSave = async () => {
    if (!editModal) return;
    await apiFetch(`/api/ads/${editModal.id}`, {
      method: 'PUT',
      body: JSON.stringify({ name: editModal.name, duration: parseInt(editModal.duration, 10) || 15 }),
    });
    setEditModal(null);
    loadAds();
  };

  const handleStatus = async (id, status) => {
    await apiFetch(`/api/ads/${id}/status`, { method: 'PUT', body: JSON.stringify({ status }) });
    loadAds();
  };

  const handleSaveSettings = async () => {
    const r = await apiFetch('/api/settings/ads', {
      method: 'PUT',
      body: JSON.stringify({ ticket_display_time: parseInt(settings.ticket_display_time, 10) || 10 }),
    });
    if (r?.ok) {
      setSettingsSaved(true);
      setTimeout(() => setSettingsSaved(false), 2000);
    }
  };

  const isVideo = (ad) => ad.file_type === 'video';
  const pendingAds = ads.filter(a => a.status === 'pending');
  const otherAds = ads.filter(a => a.status !== 'pending');

  return (
    <div className="space-y-6">
      {/* Storage status banner */}
      {settings.storage_type === 'local' ? (
        <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4 flex gap-3">
          <span className="text-blue-500 text-xl flex-shrink-0">💾</span>
          <div>
            <p className="text-blue-800 font-semibold text-sm">Локальное хранилище</p>
            <p className="text-blue-700 text-xs mt-1">
              Файлы сохраняются на сервере. Для подключения S3 задайте переменные{' '}
              <code className="bg-blue-100 px-1 rounded">AWS_S3_BUCKET</code>,{' '}
              <code className="bg-blue-100 px-1 rounded">AWS_ACCESS_KEY_ID</code> и{' '}
              <code className="bg-blue-100 px-1 rounded">AWS_SECRET_ACCESS_KEY</code>.
            </p>
          </div>
        </div>
      ) : (
        <div className="bg-green-50 border border-green-200 rounded-2xl p-4 flex gap-3">
          <span className="text-green-500 text-xl flex-shrink-0">☁️</span>
          <div>
            <p className="text-green-800 font-semibold text-sm">S3 хранилище подключено</p>
            <p className="text-green-700 text-xs mt-1">Файлы хранятся в облачном S3-бакете.</p>
          </div>
        </div>
      )}

      {/* Display settings */}
      <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
        <h3 className="text-base font-bold text-gray-900 mb-4">Настройки показа</h3>
        <div className="flex items-end gap-4 flex-wrap">
          <div>
            <label className="text-xs text-gray-500 font-medium mb-1 block">
              Время показа талона после вызова (сек)
            </label>
            <input type="number" min="3" max="300"
              value={settings.ticket_display_time}
              onChange={e => setSettings(p => ({ ...p, ticket_display_time: e.target.value }))}
              className="w-28 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            <p className="text-xs text-gray-400 mt-1">Рекомендуется: 10–30 сек</p>
          </div>
        </div>
        <div className="flex items-center gap-2 pb-6 mt-4">
          <button onClick={handleSaveSettings}
            className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-4 py-2 rounded-xl transition">
            Сохранить
          </button>
          {settingsSaved && <span className="text-green-600 text-xs font-medium">Сохранено ✓</span>}
        </div>
      </div>

      {/* Upload form */}
      <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
        <h3 className="text-base font-bold text-gray-900 mb-4">Загрузить рекламу</h3>
        <div className="space-y-4">
          <div>
            <label className="text-xs text-gray-500 font-medium mb-1 block">
              Файл (MP4, WebM, JPEG, PNG, GIF, WebP — до 200 МБ)
            </label>
            <input ref={fileInputRef} type="file"
              accept="video/mp4,video/webm,video/ogg,video/quicktime,image/jpeg,image/png,image/gif,image/webp"
              onChange={handleFileChange}
              className="block w-full text-sm text-gray-600 file:mr-3 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 cursor-pointer" />
            {form.file && (
              <p className="text-xs text-gray-400 mt-1">{form.file.name} · {(form.file.size / 1024 / 1024).toFixed(1)} МБ</p>
            )}
          </div>
          <div className="flex gap-4 flex-wrap">
            <div className="flex-1 min-w-40">
              <label className="text-xs text-gray-500 font-medium mb-1 block">Название</label>
              <input type="text" value={form.name}
                onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                placeholder="Название рекламы"
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div className="w-32">
              <label className="text-xs text-gray-500 font-medium mb-1 block">Длительность (сек)</label>
              <input type="number" min="3" max="3600" value={form.duration}
                onChange={e => setForm(p => ({ ...p, duration: e.target.value }))}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              <p className="text-xs text-gray-400 mt-1">Для картинок</p>
            </div>
          </div>
          {uploadErr && <p className="text-red-500 text-sm">{uploadErr}</p>}
          <button onClick={handleUpload} disabled={uploading}
            className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition flex items-center gap-2">
            {uploading ? (
              <><svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>Загрузка...</>
            ) : (
              <><Icon d={P.download} cls="w-4 h-4 rotate-180" />Загрузить</>
            )}
          </button>
        </div>
      </div>

      {/* Pending campaigns — moderation queue */}
      {pendingAds.length > 0 && (
        <div className="bg-amber-50 rounded-2xl p-6 shadow-sm border border-amber-200">
          <h3 className="text-base font-bold text-amber-900 mb-4 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-amber-500 inline-block" />
            Ожидают проверки
            <span className="bg-amber-200 text-amber-800 text-xs font-bold px-2 py-0.5 rounded-full">{pendingAds.length}</span>
          </h3>
          <div className="space-y-3">
            {pendingAds.map(ad => (
              <div key={ad.id} className="flex items-center gap-4 p-4 rounded-xl border border-amber-200 bg-white">
                <div className="flex-shrink-0 w-20 h-14 rounded-lg overflow-hidden bg-gray-200 flex items-center justify-center">
                  {ad.url ? (
                    isVideo(ad)
                      ? <video src={ad.url} className="w-full h-full object-cover" muted preload="metadata" />
                      : <img src={ad.url} alt={ad.name} className="w-full h-full object-cover" />
                  ) : <Icon d={isVideo(ad) ? P.film : P.eye} cls="w-6 h-6 text-gray-400" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-sm text-gray-900 truncate">{ad.name}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${isVideo(ad) ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
                      {isVideo(ad) ? 'Видео' : 'Картинка'}
                    </span>
                    {ad.owner_username && (
                      <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">{ad.owner_username}</span>
                    )}
                  </div>
                  {!isVideo(ad) && <p className="text-xs text-gray-400 mt-0.5">{ad.duration} сек</p>}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button onClick={() => handleStatus(ad.id, 'approved')}
                    className="px-3 py-1.5 rounded-lg bg-green-600 hover:bg-green-700 text-white text-xs font-semibold transition">
                    Одобрить
                  </button>
                  <button onClick={() => handleStatus(ad.id, 'rejected')}
                    className="px-3 py-1.5 rounded-lg bg-red-100 hover:bg-red-200 text-red-700 text-xs font-semibold transition">
                    Отклонить
                  </button>
                  <button onClick={() => setDeleteConfirm(ad)}
                    className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition">
                    <Icon d={P.trash} cls="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* All ads list */}
      <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
        <h3 className="text-base font-bold text-gray-900 mb-4">
          Рекламные материалы
          {otherAds.length > 0 && (
            <span className="ml-2 bg-blue-100 text-blue-600 text-xs font-bold px-2 py-0.5 rounded-full">{otherAds.length}</span>
          )}
        </h3>
        {loading ? (
          <div className="flex justify-center py-8"><svg className="animate-spin w-6 h-6 text-blue-500" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg></div>
        ) : otherAds.length === 0 ? (
          <p className="text-gray-400 text-sm text-center py-8">Рекламных материалов нет</p>
        ) : (
          <div className="space-y-3">
            {otherAds.map((ad, idx) => (
              <div key={ad.id}
                className={`flex items-center gap-4 p-4 rounded-xl border transition ${ad.active && ad.status === 'approved' ? 'border-gray-200 bg-gray-50' : 'border-gray-100 bg-gray-50/50 opacity-60'}`}>
                <div className="flex-shrink-0 w-20 h-14 rounded-lg overflow-hidden bg-gray-200 flex items-center justify-center">
                  {ad.url ? (
                    isVideo(ad)
                      ? <video src={ad.url} className="w-full h-full object-cover" muted preload="metadata" />
                      : <img src={ad.url} alt={ad.name} className="w-full h-full object-cover" />
                  ) : <Icon d={isVideo(ad) ? P.film : P.eye} cls="w-6 h-6 text-gray-400" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-sm text-gray-900 truncate">{ad.name}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${isVideo(ad) ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
                      {isVideo(ad) ? 'Видео' : 'Картинка'}
                    </span>
                    {ad.status && (
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${AD_STATUS_COLORS[ad.status] || 'bg-gray-100 text-gray-600'}`}>
                        {AD_STATUS_LABELS[ad.status] || ad.status}
                      </span>
                    )}
                    {!isVideo(ad) && <span className="text-xs text-gray-400">{ad.duration} сек</span>}
                    {ad.owner_username && (
                      <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">{ad.owner_username}</span>
                    )}
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5">#{idx + 1} · {ad.active ? 'Показывается' : 'Отключено'}</p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button onClick={async () => { if (idx === 0) return; const prev = otherAds[idx - 1]; await apiFetch(`/api/ads/${ad.id}`, { method: 'PUT', body: JSON.stringify({ order_index: prev.order_index - 1 }) }); loadAds(); }}
                    disabled={idx === 0}
                    className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 disabled:opacity-30 transition" title="Выше">
                    <Icon d={P.up} cls="w-4 h-4" />
                  </button>
                  <button onClick={async () => { if (idx === otherAds.length - 1) return; const next = otherAds[idx + 1]; await apiFetch(`/api/ads/${ad.id}`, { method: 'PUT', body: JSON.stringify({ order_index: next.order_index + 1 }) }); loadAds(); }}
                    disabled={idx === otherAds.length - 1}
                    className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 disabled:opacity-30 transition" title="Ниже">
                    <Icon d={P.down} cls="w-4 h-4" />
                  </button>
                  {ad.status === 'rejected' && (
                    <button onClick={() => handleStatus(ad.id, 'approved')}
                      className="px-2 py-1 rounded-lg bg-green-100 hover:bg-green-200 text-green-700 text-xs font-semibold transition">
                      Одобрить
                    </button>
                  )}
                  {ad.status === 'approved' && (
                    <button onClick={() => handleStatus(ad.id, 'rejected')}
                      className="px-2 py-1 rounded-lg bg-red-50 hover:bg-red-100 text-red-600 text-xs font-semibold transition">
                      Откл.
                    </button>
                  )}
                  <button onClick={() => handleToggle(ad)}
                    className={`p-1.5 rounded-lg transition ${ad.active ? 'text-green-600 hover:bg-green-50' : 'text-gray-400 hover:bg-gray-100'}`}
                    title={ad.active ? 'Отключить' : 'Включить'}>
                    <Icon d={P.eye} cls="w-4 h-4" />
                  </button>
                  <button onClick={() => setEditModal({ id: ad.id, name: ad.name, duration: String(ad.duration) })}
                    className="p-1.5 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition" title="Редактировать">
                    <Icon d={P.edit} cls="w-4 h-4" />
                  </button>
                  <button onClick={() => setDeleteConfirm(ad)}
                    className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition" title="Удалить">
                    <Icon d={P.trash} cls="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {editModal && (
        <Modal title="Редактировать рекламу" onClose={() => setEditModal(null)}>
          <div className="space-y-4">
            <div>
              <label className="text-xs text-gray-500 font-medium mb-1 block">Название</label>
              <input type="text" value={editModal.name}
                onChange={e => setEditModal(p => ({ ...p, name: e.target.value }))}
                className="w-full border border-gray-200 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="text-xs text-gray-500 font-medium mb-1 block">Длительность (сек, только для картинок)</label>
              <input type="number" min="3" max="3600" value={editModal.duration}
                onChange={e => setEditModal(p => ({ ...p, duration: e.target.value }))}
                className="w-32 border border-gray-200 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div className="flex gap-2 pt-1">
              <button onClick={handleEditSave}
                className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2.5 rounded-xl transition">
                Сохранить
              </button>
              <button onClick={() => setEditModal(null)}
                className="px-4 py-2.5 rounded-xl border border-gray-200 text-gray-600 hover:bg-gray-50 transition">
                Отмена
              </button>
            </div>
          </div>
        </Modal>
      )}

      {deleteConfirm && (
        <Modal title="Удалить рекламу?" onClose={() => setDeleteConfirm(null)}>
          <div className="space-y-4">
            <p className="text-gray-600 text-sm">
              Удалить <span className="font-semibold">«{deleteConfirm.name}»</span>?
              Файл будет удалён из S3. Это действие необратимо.
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
    </div>
  );
}
