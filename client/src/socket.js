import { io } from 'socket.io-client';

const socket = io('/', {
  path: '/socket.io',
  transports: ['websocket', 'polling'],
  auth: () => {
    const token = localStorage.getItem('adminToken');
    return token ? { token } : {};
  }
});

export default socket;
