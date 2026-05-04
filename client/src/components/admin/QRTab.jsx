import { useState, useEffect } from 'react';
import { apiFetch } from '../../api';
import { Icon, P } from './shared';

const queueBasePath = (import.meta.env.BASE_URL || '/').replace(/\/$/, '');

function queuePath(path) {
  return `${queueBasePath}${path}`;
}

function queueUrl(path) {
  return new URL(queuePath(path), window.location.origin).toString();
}

function withClientId(url, clientId) {
  if (!clientId) return url;
  const nextUrl = new URL(url);
  nextUrl.searchParams.set('client_id', clientId);
  return nextUrl.toString();
}

function getClientIdFromToken() {
  const token = localStorage.getItem('adminToken');
  if (!token) return '';
  try {
    const encodedPayload = token.split('.')[1];
    const normalizedPayload = encodedPayload.replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(normalizedPayload.padEnd(Math.ceil(normalizedPayload.length / 4) * 4, '=')));
    return payload.clientId || payload.client_id || '';
  } catch {
    return '';
  }
}

export default function QRTab() {
  const [services, setServices] = useState([]);
  const [selectedService, setSelectedService] = useState('');
  const [customUrl, setCustomUrl] = useState('');
  const [qrData, setQrData] = useState(null);
  const [dashboardQr, setDashboardQr] = useState(null);
  const [loading, setLoading] = useState(false);
  const clientId = getClientIdFromToken();
  const dashboardUrl = withClientId(queueUrl('/dashboard'), clientId);
  const dashboardHref = `${queuePath('/dashboard')}${clientId ? `?client_id=${encodeURIComponent(clientId)}` : ''}`;

  useEffect(() => {
    apiFetch('/api/services/my?all=1').then(r => r?.json()).then(data => {
      if (data) setServices(data);
      generateQR(null);
    });
    fetch(`/api/qrcode?url=${encodeURIComponent(dashboardUrl)}`)
      .then(r => r.json()).then(setDashboardQr);
  }, []);

  const generateQR = async (serviceId) => {
    setLoading(true);
    let url = customUrl.trim();
    if (!url) {
      const visitorUrl = new URL(queueUrl('/visitor'));
      if (clientId) visitorUrl.searchParams.set('client_id', clientId);
      if (serviceId) visitorUrl.searchParams.set('service', serviceId);
      url = visitorUrl.toString();
    }
    const res = await fetch(`/api/qrcode?url=${encodeURIComponent(url)}`);
    const data = await res.json();
    setQrData(data);
    setLoading(false);
  };

  const printQR = () => {
    if (!qrData) return;
    const svcName = services.find(s => s.id === parseInt(selectedService))?.name || '';
    const win = window.open('', '_blank');
    win.document.write(`<html><head><title>QR-код</title>
      <style>body{font-family:sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:20px;text-align:center}
      img{max-width:300px}h1{font-size:1.5rem;margin-bottom:6px;color:#1e3a5f}p{color:#666;font-size:.9rem;margin:4px 0}</style>
      </head><body>
      <h1>Электронная очередь</h1>
      ${svcName ? `<p><strong>${svcName}</strong></p>` : ''}
      <p>Отсканируйте QR-код для получения талона</p>
      <img src="${qrData.qrcode}" />
      <p style="margin-top:12px;font-size:.7rem;color:#aaa">${qrData.url}</p>
      </body></html>`);
    win.document.close();
    win.print();
  };

  return (
    <div className="space-y-6 max-w-lg">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-4">
        <div>
          <label className="text-xs text-gray-500 font-medium mb-1.5 block">Привязка к услуге (необязательно)</label>
          <select value={selectedService}
            onChange={e => { setSelectedService(e.target.value); generateQR(e.target.value || null); }}
            className="w-full border border-gray-200 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="">Все услуги (посетитель выбирает)</option>
            {services.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-gray-500 font-medium mb-1.5 block">Своя ссылка (если отличается)</label>
          <div className="flex gap-2">
            <input type="url" value={customUrl} onChange={e => setCustomUrl(e.target.value)}
              placeholder={queueUrl('/visitor')}
              className="flex-1 border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono" />
            <button onClick={() => generateQR(selectedService || null)} disabled={loading}
              className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-4 py-2.5 rounded-xl font-medium">
              {loading ? '...' : 'Обновить'}
            </button>
          </div>
        </div>
      </div>

      {qrData && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 flex flex-col items-center gap-6">
          <div className="bg-white p-4 rounded-xl border-2 border-gray-100 shadow-inner">
            <img src={qrData.qrcode} alt="QR" className="w-64 h-64" />
          </div>
          <div className="text-center">
            <p className="text-xs text-gray-500 mb-1">Ссылка</p>
            <p className="font-mono text-xs text-blue-600 break-all">{qrData.url}</p>
          </div>
          <div className="flex gap-3 w-full">
            <button onClick={printQR}
              className="flex-1 flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-xl">
              <Icon d={P.print} /> Печать A4
            </button>
          </div>
        </div>
      )}

      <div className="bg-gray-950 rounded-2xl p-6 flex flex-col gap-5">
        <div>
          <h3 className="text-white font-semibold text-base">Табло для посетителей</h3>
          <p className="text-gray-400 text-sm mt-1">
            Откройте на экране в зоне ожидания — показывает текущий вызванный талон и очередь в реальном времени.
          </p>
        </div>
        <div className="flex gap-3">
          <a href={dashboardHref} target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white font-semibold px-4 py-2.5 rounded-xl text-sm transition">
            <Icon d={P.eye} cls="w-4 h-4" /> Открыть табло
          </a>
        </div>
        {dashboardQr && (
          <div className="flex gap-6 items-center flex-wrap">
            <div className="bg-white p-3 rounded-xl border border-gray-700 shrink-0">
              <img src={dashboardQr.qrcode} alt="Dashboard QR" className="w-32 h-32" />
            </div>
            <div className="min-w-0">
              <p className="text-gray-400 text-xs mb-1 uppercase tracking-wide">QR-код дашборда</p>
              <p className="font-mono text-xs text-blue-400 break-all">{dashboardQr.url}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
