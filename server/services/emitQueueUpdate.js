const { getQueueState, getPublicQueueState } = require('./queueState');

let io;

function setIo(socketIo) {
  io = socketIo;
}

async function emitQueueUpdate() {
  if (!io) return;
  const [adminState, publicState] = await Promise.all([
    getQueueState(),
    getPublicQueueState(),
  ]);
  io.to('admins').emit('queue:updated', adminState);
  io.except('admins').emit('queue:updated', publicState);
}

module.exports = { setIo, emitQueueUpdate };
