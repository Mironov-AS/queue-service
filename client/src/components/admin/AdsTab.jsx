import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../../api';
import { AdsUploadForm } from './AdsUploadForm';
import { AdsList, AdsEditModal, AdsDeleteModal } from './AdsList';

export default function AdsTab() {
  const [ads, setAds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState({ ticket_display_time: 10, dashboard_idle_time: 15, ads_before_dashboard: 0 });
  const [settingsSaved, setSettingsSaved] = useState(false);
  const [editModal, setEditModal] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(null);

  const loadAds = useCallback(async () => {
    setLoading(true);
    const r = await apiFetch('/api/ads/all');
    if (r?.ok) setAds(await r.json());
    setLoading(false);
  }, []);

  const loadSettings = useCallback(async () => {
    const r = await apiFetch('/api/settings/ads');
    if (r?.ok) setSettings(await r.json());
  }, []);

  useEffect(() => { loadAds(); loadSettings(); }, [loadAds, loadSettings]);

  const handleSaveSettings = async () => {
    const r = await apiFetch('/api/settings/ads', {
      method: 'PUT',
      body: JSON.stringify({
        ticket_display_time: parseInt(settings.ticket_display_time, 10) || 10,
        dashboard_idle_time: parseInt(settings.dashboard_idle_time, 10) || 15,
        ads_before_dashboard: parseInt(settings.ads_before_dashboard, 10) || 0,
      }),
    });
    if (r?.ok) {
      setSettingsSaved(true);
      setTimeout(() => setSettingsSaved(false), 2000);
    }
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

  const handleReorder = async (ad, idx, dir) => {
    const all = ads;
    if (dir === -1 && idx === 0) return;
    if (dir === 1 && idx === all.length - 1) return;
    const neighbor = all[idx + dir];
    await apiFetch(`/api/ads/${ad.id}`, { method: 'PUT', body: JSON.stringify({ order_index: neighbor.order_index + dir }) });
    loadAds();
  };

  return (
    <div className="space-y-6">
      {/* Display settings */}
      <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
        <h3 className="text-base font-bold text-gray-900 mb-1">Настройки показа</h3>
        <p className="text-xs text-gray-400 mb-4">
          {settings.ads_before_dashboard === 0 || settings.ads_before_dashboard === '0'
            ? 'Ротация: Реклама 1 → Реклама 2 → ... → Дашборд → Реклама 1 → ...'
            : settings.ads_before_dashboard == 1
              ? 'Ротация: Реклама 1 → Дашборд → Реклама 2 → Дашборд → ...'
              : `Ротация: после каждых ${settings.ads_before_dashboard} роликов показывается Дашборд`}
        </p>
        <div className="flex items-end gap-6 flex-wrap">
          <div>
            <label className="text-xs text-gray-500 font-medium mb-1 block">Реклам перед дашбордом</label>
            <input type="number" min="0" max="100"
              value={settings.ads_before_dashboard}
              onChange={e => setSettings(p => ({ ...p, ads_before_dashboard: e.target.value }))}
              className="w-28 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            <p className="text-xs text-gray-400 mt-1">0 — после всех роликов</p>
          </div>
          <div>
            <label className="text-xs text-gray-500 font-medium mb-1 block">Дашборд в ожидании (сек)</label>
            <input type="number" min="3" max="300"
              value={settings.dashboard_idle_time}
              onChange={e => setSettings(p => ({ ...p, dashboard_idle_time: e.target.value }))}
              className="w-28 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            <p className="text-xs text-gray-400 mt-1">Время показа очереди в ротации</p>
          </div>
          <div>
            <label className="text-xs text-gray-500 font-medium mb-1 block">Дашборд при вызове талона (сек)</label>
            <input type="number" min="3" max="300"
              value={settings.ticket_display_time}
              onChange={e => setSettings(p => ({ ...p, ticket_display_time: e.target.value }))}
              className="w-28 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            <p className="text-xs text-gray-400 mt-1">Реклама приостанавливается</p>
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

      <AdsUploadForm onUploaded={loadAds} />

      <AdsList
        ads={ads}
        loading={loading}
        showOwner={false}
        showReorder
        onToggle={handleToggle}
        onEdit={(ad) => setEditModal({ id: ad.id, name: ad.name, duration: String(ad.duration) })}
        onDelete={setDeleteConfirm}
        onReorder={handleReorder}
        listTitle="Рекламные кампании"
        emptyText="Рекламных кампаний пока нет"
      />

      {editModal && (
        <AdsEditModal
          ad={editModal}
          onClose={() => setEditModal(null)}
          onSave={(updated) => setEditModal(updated)}
          onConfirm={handleEditSave}
        />
      )}

      {deleteConfirm && (
        <AdsDeleteModal
          ad={deleteConfirm}
          onClose={() => setDeleteConfirm(null)}
          onConfirm={() => handleDelete(deleteConfirm.id)}
        />
      )}
    </div>
  );
}
