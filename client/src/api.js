export function authHeaders() {
  const token = localStorage.getItem('adminToken');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function apiFetch(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
      ...(options.headers || {})
    }
  });
  if (res.status === 401) {
    localStorage.removeItem('adminToken');
    localStorage.removeItem('adminUser');
    window.location.href = '/login';
    return null;
  }
  if (res.status === 403) {
    try {
      const data = await res.clone().json();
      if (data.must_change_password) {
        localStorage.setItem('mustChangePassword', 'true');
        window.location.href = '/admin';
        return null;
      }
    } catch { /* ignore */ }
  }
  return res;
}
