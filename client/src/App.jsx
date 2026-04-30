import { BrowserRouter, Routes, Route, Navigate, useLocation, useSearchParams, useNavigate } from 'react-router-dom';
import { useEffect } from 'react';
import AdminPage from './pages/AdminPage';
import VisitorPage from './pages/VisitorPage';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';

function SyncAuthFromUrl() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  useEffect(() => {
    const token = searchParams.get('auth_token');
    if (token) {
      localStorage.setItem('adminToken', token);
      try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        const user = {
          id: payload.userId || payload.id,
          username: payload.email || payload.username,
          role: payload.role,
          clientId: payload.clientId || null,
        };
        localStorage.setItem('adminUser', JSON.stringify(user));
        navigate('/admin', { replace: true });
      } catch {
        navigate('/admin', { replace: true });
      }
    }
  }, [searchParams, navigate]);
  return null;
}

function RequireAuth({ children }) {
  const token = localStorage.getItem('adminToken');
  const location = useLocation();
  if (!token) return <Navigate to="/login" state={{ from: location }} replace />;
  return children;
}

export default function App() {
  const basename = import.meta.env.BASE_URL === '/' ? undefined : import.meta.env.BASE_URL.replace(/\/$/, '');
  return (
    <BrowserRouter basename={basename} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <SyncAuthFromUrl />
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/visitor" element={<VisitorPage />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/" element={<Navigate to="/visitor" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
