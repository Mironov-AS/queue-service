import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../../api';
import { AdsUploadForm } from './AdsUploadForm';
import { AdsList, AdsEditModal, AdsDeleteModal } from './AdsList';

export default function MyCampaignsTab() {
  const [ads, setAds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editModal, setEditModal] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(null);

  const loadAds = useCallback(async () => {
    setLoading(true);
    const r = await apiFetch('/api/ads/all');
    if (r?.ok) setAds(await r.json());
    setLoading(false);
  }, []);

  useEffect(() => { loadAds(); }, [loadAds]);

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

  return (
    <div className="space-y-6">
      <AdsUploadForm
        onUploaded={loadAds}
        title="Добавить рекламную кампанию"
        buttonLabel="Загрузить кампанию"
      />

      <AdsList
        ads={ads}
        loading={loading}
        showOwner={false}
        showReorder={false}
        showStatusActions={false}
        onToggle={handleToggle}
        onEdit={(ad) => setEditModal({ id: ad.id, name: ad.name, duration: String(ad.duration) })}
        onDelete={setDeleteConfirm}
        listTitle="Мои кампании"
        emptyText="У вас нет рекламных кампаний"
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