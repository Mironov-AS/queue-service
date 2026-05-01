import { Icon, P, Modal } from './shared';

export function AdsList({
  ads,
  loading,
  onToggle,
  onEdit,
  onDelete,
  onReorder,
  showOwner,
  showReorder,
  listTitle,
  emptyText,
}) {
  const isVideo = (ad) => ad.file_type === 'video';

  return (
    <>
      <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
        <h3 className="text-base font-bold text-gray-900 mb-4">
          {listTitle || 'Рекламные материалы'}
          {ads.length > 0 && (
            <span className="ml-2 bg-blue-100 text-blue-600 text-xs font-bold px-2 py-0.5 rounded-full">{ads.length}</span>
          )}
        </h3>
        {loading ? (
          <div className="flex justify-center py-8"><svg className="animate-spin w-6 h-6 text-blue-500" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg></div>
        ) : ads.length === 0 ? (
          <p className="text-gray-400 text-sm text-center py-8">{emptyText || 'Рекламных материалов нет'}</p>
        ) : (
          <div className="space-y-3">
            {ads.map((ad, idx) => (
              <div key={ad.id}
                className={`flex items-center gap-4 p-4 rounded-xl border transition ${ad.active ? 'border-gray-200 bg-gray-50' : 'border-gray-100 bg-gray-50/50 opacity-60'}`}>
                <AdThumbnail ad={ad} isVideo={isVideo} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-sm text-gray-900 truncate">{ad.name}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${isVideo(ad) ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
                      {isVideo(ad) ? 'Видео' : 'Картинка'}
                    </span>
                    {!isVideo(ad) && <span className="text-xs text-gray-400">{ad.duration} сек</span>}
                    {showOwner && ad.owner_username && (
                      <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">{ad.owner_username}</span>
                    )}
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5">
                    #{idx + 1} · {ad.active ? 'Показывается на дашборде ожидания' : 'Отключено'}
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {showReorder && onReorder && (
                    <>
                      <button onClick={() => onReorder(ad, idx, -1)}
                        disabled={idx === 0}
                        className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 disabled:opacity-30 transition" title="Выше">
                        <Icon d={P.up} cls="w-4 h-4" />
                      </button>
                      <button onClick={() => onReorder(ad, idx, 1)}
                        disabled={idx === ads.length - 1}
                        className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 disabled:opacity-30 transition" title="Ниже">
                        <Icon d={P.down} cls="w-4 h-4" />
                      </button>
                    </>
                  )}
                  {onToggle && (
                    <button onClick={() => onToggle(ad)}
                      className={`p-1.5 rounded-lg transition ${ad.active ? 'text-green-600 hover:bg-green-50' : 'text-gray-400 hover:bg-gray-100'}`}
                      title={ad.active ? 'Отключить' : 'Включить'}>
                      <Icon d={P.eye} cls="w-4 h-4" />
                    </button>
                  )}
                  {onEdit && (
                    <button onClick={() => onEdit(ad)}
                      className="p-1.5 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition" title="Редактировать">
                      <Icon d={P.edit} cls="w-4 h-4" />
                    </button>
                  )}
                  {onDelete && (
                    <button onClick={() => onDelete(ad)}
                      className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition" title="Удалить">
                      <Icon d={P.trash} cls="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function AdThumbnail({ ad, isVideo }) {
  if (ad.url) {
    return (
      <div className="w-16 h-16 rounded-lg overflow-hidden flex-shrink-0 bg-gray-100">
        {isVideo(ad)
          ? <video src={ad.url} className="w-full h-full object-cover" muted preload="metadata" />
          : <img src={ad.url} alt={ad.name} className="w-full h-full object-cover" />
        }
      </div>
    );
  }
  return (
    <div className="w-16 h-16 rounded-lg flex-shrink-0 bg-gray-100 flex items-center justify-center">
      <Icon d={isVideo(ad) ? P.film : P.eye} cls="w-6 h-6 text-gray-400" />
    </div>
  );
}

export function AdsEditModal({ ad, onClose, onSave, onConfirm }) {
  if (!ad) return null;
  return (
    <Modal title="Редактировать рекламу" onClose={onClose}>
      <div className="space-y-4">
        <div>
          <label className="text-xs text-gray-500 font-medium mb-1 block">Название</label>
          <input type="text" value={ad.name}
            onChange={e => onSave({ ...ad, name: e.target.value })}
            className="w-full border border-gray-200 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <div>
          <label className="text-xs text-gray-500 font-medium mb-1 block">Длительность (сек, только для картинок)</label>
          <input type="number" min="3" max="3600" value={ad.duration}
            onChange={e => onSave({ ...ad, duration: e.target.value })}
            className="w-32 border border-gray-200 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <div className="flex gap-2 pt-1">
          <button onClick={onConfirm}
            className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2.5 rounded-xl transition">
            Сохранить
          </button>
          <button onClick={onClose}
            className="px-4 py-2.5 rounded-xl border border-gray-200 text-gray-600 hover:bg-gray-50 transition">
            Отмена
          </button>
        </div>
      </div>
    </Modal>
  );
}

export function AdsDeleteModal({ ad, onClose, onConfirm }) {
  if (!ad) return null;
  return (
    <Modal title="Удалить рекламу?" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-gray-600 text-sm">
          Удалить <span className="font-semibold">«{ad.name}»</span>?
          Файл будет удалён. Это действие необратимо.
        </p>
        <div className="flex gap-2">
          <button onClick={onConfirm}
            className="flex-1 bg-red-600 hover:bg-red-700 text-white font-semibold py-2.5 rounded-xl transition">
            Удалить
          </button>
          <button onClick={onClose}
            className="px-4 py-2.5 rounded-xl border border-gray-200 text-gray-600 hover:bg-gray-50 transition">
            Отмена
          </button>
        </div>
      </div>
    </Modal>
  );
}
