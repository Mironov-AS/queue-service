import { useState, useRef } from 'react';
import { apiFetch, authHeaders } from '../../api';
import { Icon, P } from './shared';

export function AdsUploadForm({ onUploaded, title = 'Загрузить рекламу', buttonLabel = 'Загрузить' }) {
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState('');
  const [form, setForm] = useState({ name: '', duration: '15', file: null });
  const fileInputRef = useRef(null);

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
    onUploaded?.();
  };

  return (
    <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
      <h3 className="text-base font-bold text-gray-900 mb-4">{title}</h3>
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
            <><Icon d={P.download} cls="w-4 h-4 rotate-180" />{buttonLabel}</>
          )}
        </button>
      </div>
    </div>
  );
}