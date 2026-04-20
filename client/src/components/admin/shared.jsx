import { useEffect } from 'react';

// ─── Icon ─────────────────────────────────────────────────────────────────────

export const Icon = ({ d, cls = 'w-5 h-5' }) => (
  <svg className={cls} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d={d} />
  </svg>
);

export const P = {
  queue: 'M4 6h16M4 10h16M4 14h8',
  services: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2',
  stats: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z',
  qr: 'M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z',
  log: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
  settings: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z',
  next: 'M13 9l3 3m0 0l-3 3m3-3H8m13 0a9 9 0 11-18 0 9 9 0 0118 0z',
  repeat: 'M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15',
  returnQueue: 'M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6',
  skip: 'M13 5l7 7-7 7M5 5l7 7-7 7',
  cancel: 'M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z',
  transfer: 'M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4',
  plus: 'M12 4v16m8-8H4',
  edit: 'M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z',
  trash: 'M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16',
  person: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z',
  logout: 'M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1',
  check: 'M5 13l4 4L19 7',
  print: 'M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z',
  clock: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z',
  download: 'M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4',
  eye: 'M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z',
  priority: 'M5 3l14 9-14 9V3z',
  fields: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01',
  up: 'M5 15l7-7 7 7',
  down: 'M19 9l-7 7-7-7',
  star: 'M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z',
  film: 'M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z',
};

// ─── Format helpers ───────────────────────────────────────────────────────────

export function fmtDate(d) {
  if (!d) return '—';
  return new Date(d + 'T00:00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function fmtTime(dt) {
  if (!dt) return '—';
  return new Date(dt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

// ─── Constants ────────────────────────────────────────────────────────────────

export const STATUS_LABELS = { waiting: 'Ожидает', called: 'Вызван', served: 'Обслужен' };
export const STATUS_COLORS = {
  waiting: 'bg-blue-100 text-blue-800',
  called: 'bg-green-100 text-green-800',
  served: 'bg-gray-100 text-gray-600',
};

export const SKIP_REASONS = ['Не явился', 'Отказался от услуги', 'Ушёл из очереди', 'Другая причина'];
export const CANCEL_REASONS = ['Отмена по запросу', 'Дублирующий талон', 'Техническая ошибка', 'Другая причина'];

export const FIELD_INPUT_TYPES_ADMIN = { text: 'text', phone: 'tel', number: 'number', date: 'date', email: 'email' };
export const FIELD_TYPES = [
  { value: 'text', label: 'Текст' },
  { value: 'phone', label: 'Телефон' },
  { value: 'number', label: 'Число' },
  { value: 'date', label: 'Дата' },
  { value: 'email', label: 'Email' },
];

export const AD_STATUS_LABELS = { pending: 'На модерации', approved: 'Одобрено', rejected: 'Отклонено' };
export const AD_STATUS_COLORS = {
  pending: 'bg-amber-100 text-amber-700',
  approved: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
};

export const ACTION_LABELS = {
  'user.login': 'Вход в систему',
  'ticket.called': 'Талон вызван',
  'ticket.called.repeat': 'Повтор вызова',
  'ticket.returned': 'Возврат в очередь',
  'ticket.transferred': 'Перевод талона',
  'ticket.manual': 'Ручная регистрация',
  'service.created': 'Услуга создана',
  'service.updated': 'Услуга изменена',
  'service.deleted': 'Услуга удалена',
  'service.enabled': 'Услуга включена',
  'service.disabled': 'Услуга отключена',
  'queue.reset': 'Очередь сброшена',
  'settings.password_changed': 'Пароль изменён',
};

export const ACTION_COLORS = {
  'user.login': 'text-blue-600 bg-blue-50',
  'ticket.called': 'text-green-700 bg-green-50',
  'queue.reset': 'text-red-700 bg-red-50',
  'service.deleted': 'text-red-600 bg-red-50',
};

export const ROLE_LABELS = { admin: 'Администратор', operator: 'Оператор', advertiser: 'Рекламодатель' };
export const ROLE_COLORS = {
  admin: 'bg-purple-100 text-purple-700',
  operator: 'bg-blue-100 text-blue-700',
  advertiser: 'bg-amber-100 text-amber-700',
};

export const INACTIVITY_MS = 30 * 60 * 1000;

export const TABS = [
  { id: 'queue', label: 'Очередь', icon: P.queue },
];

export const ALL_SETTINGS_TABS = [
  { id: 'services',     label: 'Услуги',         icon: P.services, adminOnly: false, advertiserHidden: true  },
  { id: 'users',        label: 'Пользователи',   icon: P.person,   adminOnly: true,  advertiserHidden: true  },
  { id: 'ads',          label: 'Реклама (все)',   icon: P.film,     adminOnly: true,  advertiserHidden: true  },
  { id: 'my-campaigns', label: 'Мои кампании',   icon: P.film,     adminOnly: false, advertiserHidden: false },
  { id: 'stats',        label: 'Статистика',     icon: P.stats,    adminOnly: false, advertiserHidden: true  },
  { id: 'qrcode',       label: 'QR-коды',        icon: P.qr,       adminOnly: false, advertiserHidden: true  },
  { id: 'logs',         label: 'Журнал',         icon: P.log,      adminOnly: false, advertiserHidden: true  },
  { id: 'password',     label: 'Пароль',         icon: P.person,   adminOnly: false, advertiserHidden: false },
];

// ─── Modal ────────────────────────────────────────────────────────────────────

export function Modal({ title, onClose, children }) {
  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-gray-900">{title}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}
