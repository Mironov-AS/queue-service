import { useState, useEffect, useCallback, useRef } from 'react';
import { apiFetch, authHeaders } from '../../api';
import { Icon, P, Modal, AD_STATUS_LABELS, AD_STATUS_COLORS } from './shared';

const Spinner = () => (
  <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
  </svg>
);

export default function MyCampaignsTab() {
  const [ads, setAds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState('');
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

  useEffect(() => { loadAds(); }, [loadAds]);

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

  const isVideo = (ad) => ad.file_type === 'video';

  return (
    <div className="space-y-6">
      {/* Upload form */}
      <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
        <h3 className="text-base font-bold text-gray-900 mb-1">Добавить рекламную кампанию</h3>
        <p className="text-xs text-gray-400 mb-4">Каждая кампания — один файл (видео или картинка)</p>
        <div className="space-y-4">
          <div>
            <label className="text-xs text-gray-500 font-medium mb-1 block">
              Файл (MP4, WebM, JPEG, PNG, GIF, WebP — до 200 МБ)
            </label>
            <input
              ref={fileInputRef}
              type="file"
              accept="video/mp4,video/webm,video/ogg,video/quicktime,image/jpeg,image/png,image/gif,image/webp"
              onChange={handleFileChange}
              className="block w-full text-sm text-gray-600 file:mr-3 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 cursor-pointer"
            />
            {form.file && (
              <p className="text-xs text-gray-400 mt-1">
                {form.file.name} · {(form.file.size / 1024 / 1024).toFixed(1)} МБ
              </p>
            )}
          </div>
          <div className="flex gap-4 flex-wrap">
            <div className="flex-1 min-w-40">
              <label className="text-xs text-gray-500 font-medium mb-1 block">Название кампании</label>
              <input
                type="text"
                value={form.name}
                onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                placeholder="Название рекламной кампании"
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="w-32">
              <label className="text-xs text-gray-500 font-medium mb-1 block">Длительность (сек)</label>
              <input
                type="number" min="3" max="3600"
                value={form.duration}
                onChange={e => setForm(p => ({ ...p, duration: e.target.value }))}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="text-xs text-gray-400 mt-1">Для картинок</p>
            </div>
          </div>
          {uploadErr && <p className="text-red-500 text-sm">{uploadErr}</p>}
          <button onClick={handleUpload} disabled={uploading}
            className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition flex items-center gap-2">
            {uploading ? <><Spinner />Загрузка...</> : <><Icon d={P.download} cls="w-4 h-4 rotate-180" />Загрузить кампанию</>}
          </button>
        </div>
      </div>

      {/* Campaigns list */}
      <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
        <h3 className="text-base font-bold text-gray-900 mb-4">
          Мои кампании
          {ads.length > 0 && (
            <span className="ml-2 bg-blue-100 text-blue-600 text-xs font-bold px-2 py-0.5 rounded-full">{ads.length}</span>
          )}
        </h3>

        {loading ? (
          <div className="flex justify-center py-8"><svg className="animate-spin w-6 h-6 text-blue-500" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg></div>
        ) : ads.length === 0 ? (
          <p className="text-gray-400 text-sm text-center py-8">У вас нет рекламных кампаний</p>
        ) : (
          <div className="space-y-3">
            {ads.map((ad) => (
              <div key={ad.id}
                className={`flex items-center gap-4 p-4 rounded-xl border transition ${ad.active ? 'border-gray-200 bg-gray-50' : 'border-gray-100 bg-gray-50/50 opacity-60'}`}>
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
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {ad.status === 'pending' ? 'Ожидает одобрения администратора' : ad.active ? 'Показывается' : 'Отключено'}
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {ad.status !== 'pending' && (
                    <button onClick={() => handleToggle(ad)}
                      className={`p-1.5 rounded-lg transition ${ad.active ? 'text-green-600 hover:bg-green-50' : 'text-gray-400 hover:bg-gray-100'}`}
                      title={ad.active ? 'Отключить' : 'Включить'}>
                      <Icon d={P.eye} cls="w-4 h-4" />
                    </button>
                  )}
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
        <Modal title="Редактировать кампанию" onClose={() => setEditModal(null)}>
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
        <Modal title="Удалить кампанию?" onClose={() => setDeleteConfirm(null)}>
          <div className="space-y-4">
            <p className="text-gray-600 text-sm">
              Удалить кампанию <span className="font-semibold">«{deleteConfirm.name}»</span>?
              Файл будет удалён. Это действие необратимо.
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
