import { useState, useRef, useEffect } from 'react';
import { authHeaders } from '../../api';
import { Icon, P } from './shared';

const CHUNK_SIZE = 512 * 1024; // 512KB per chunk — stays safely under proxy limits

export function AdsUploadForm({ onUploaded, title = 'Загрузить рекламу', buttonLabel = 'Загрузить' }) {
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState('');
  const [progress, setProgress] = useState(0);
  const [form, setForm] = useState({ name: '', duration: '15', file: null });
  const [previewUrl, setPreviewUrl] = useState(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    return () => { if (previewUrl) URL.revokeObjectURL(previewUrl); };
  }, [previewUrl]);

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(URL.createObjectURL(file));
    setForm(prev => ({
      ...prev,
      file,
      name: prev.name || file.name.replace(/\.[^.]+$/, '').replace(/[_-]/g, ' '),
    }));
    setUploadErr('');
    setProgress(0);
  };

  const handleUpload = async () => {
    if (!form.file) { setUploadErr('Выберите файл'); return; }
    if (!form.name.trim()) { setUploadErr('Введите название'); return; }
    setUploading(true);
    setUploadErr('');
    setProgress(0);

    const file = form.file;
    const totalChunks = Math.max(1, Math.ceil(file.size / CHUNK_SIZE));
    const uploadId = Date.now().toString(36) + Math.random().toString(36).slice(2);

    try {
      for (let i = 0; i < totalChunks; i++) {
        const start = i * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, file.size);
        const chunkBlob = file.slice(start, end);

        const fd = new FormData();
        fd.append('chunk', chunkBlob, file.name);
        fd.append('uploadId', uploadId);
        fd.append('index', String(i));
        fd.append('total', String(totalChunks));
        fd.append('mimeType', file.type);
        fd.append('originalName', file.name);
        fd.append('name', form.name.trim());
        fd.append('duration', form.duration);

        const r = await fetch('/api/ads/chunk', {
          method: 'POST',
          headers: authHeaders(),
          body: fd,
        });

        if (!r) return;
        if (r.status === 401) { window.location.href = '/login'; return; }
        if (!r.ok) {
          const d = await r.json().catch(() => ({ error: 'Ошибка загрузки' }));
          throw new Error(d.error || 'Ошибка загрузки');
        }

        const result = await r.json();
        setProgress(Math.round(((i + 1) / totalChunks) * 100));

        if (result.done) {
          setForm({ name: '', duration: '15', file: null });
          if (fileInputRef.current) fileInputRef.current.value = '';
          setProgress(0);
          setPreviewUrl(null);
          onUploaded?.();
          return;
        }
      }
    } catch (e) {
      setUploadErr(e.message || 'Ошибка загрузки');
    } finally {
      setUploading(false);
    }
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
            <div className="mt-2 flex items-center gap-3">
              {previewUrl && (
                <div className="w-16 h-16 rounded-lg overflow-hidden flex-shrink-0 bg-gray-100 border border-gray-200">
                  {form.file.type.startsWith('video/')
                    ? <video src={previewUrl} className="w-full h-full object-cover" muted preload="metadata" />
                    : <img src={previewUrl} alt="preview" className="w-full h-full object-cover" />
                  }
                </div>
              )}
              <p className="text-xs text-gray-400">{form.file.name} · {(form.file.size / 1024 / 1024).toFixed(1)} МБ</p>
            </div>
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
        {uploading && progress > 0 && (
          <div className="space-y-1">
            <div className="flex justify-between text-xs text-gray-500">
              <span>Загрузка...</span>
              <span>{progress}%</span>
            </div>
            <div className="w-full bg-gray-100 rounded-full h-1.5">
              <div
                className="bg-blue-600 h-1.5 rounded-full transition-all duration-200"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}
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
