import { io } from 'socket.io-client';

const socket = io('/', {
  path: '/socket.io',
  transports: ['websocket', 'polling'],
  auth: () => {
    const token = localStorage.getItem('adminToken');
    return token ? { token } : {};
  }
});

// Auto-logout if token is rejected by the server
socket.on('connect_error', (err) => {
  if (err.message === 'Недействительный токен' || err.data?.type === 'UnauthorizedError') {
    localStorage.removeItem('adminToken');
    localStorage.removeItem('adminUser');
    window.location.href = '/login';
  }
});

export default socket;
