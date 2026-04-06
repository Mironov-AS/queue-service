import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import AdminPage from './pages/AdminPage';
import VisitorPage from './pages/VisitorPage';
import LoginPage from './pages/LoginPage';

function RequireAuth({ children }) {
  const token = localStorage.getItem('adminToken');
  const location = useLocation();
  if (!token) return <Navigate to="/login" state={{ from: location }} replace />;
  return children;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/admin" element={<RequireAuth><AdminPage /></RequireAuth>} />
        <Route path="/visitor" element={<VisitorPage />} />
        <Route path="/" element={<Navigate to="/visitor" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
