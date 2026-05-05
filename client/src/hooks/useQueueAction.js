import { useCallback } from 'react';
import { apiFetch } from '../api';

/**
 * Reusable async action hook for queue operations.
 * Replaces ~15 lines of identical try/catch/finally boilerplate per action.
 *
 * @param {object} options
 * @param {function} options.setLoading - setLoading state setter
 * @param {function} [options.defaultError] - default error message shown to user
 */
export function useQueueAction({ setLoading, defaultError = 'Ошибка' }) {
  return useCallback(async (url, method = 'POST', body, { onSuccess, onFinally, transformData } = {}) => {
    setLoading(true);
    try {
      const r = await apiFetch(url, {
        method,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      if (!r) return;
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        alert(d.error || defaultError);
      } else {
        const d = await r.json().catch(() => null);
        if (d) onSuccess?.(transformData ? transformData(d) : d);
      }
    } catch {
      alert('Ошибка соединения с сервером');
    } finally {
      setLoading(false);
      onFinally?.();
    }
  }, [setLoading, defaultError]);
}