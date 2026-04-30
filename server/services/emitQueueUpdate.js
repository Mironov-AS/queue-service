const { getQueueState, getPublicQueueState, getActiveClientIds } = require('./queueState');

let io;

function setIo(socketIo) {
  io = socketIo;
}

async function emitQueueUpdate(targetClientId = null) {
  if (!io) return;

  const clientIds = targetClientId ? [targetClientId] : await getActiveClientIds();

  for (const cid of clientIds) {
    const [adminState, publicState] = await Promise.all([
      getQueueState(cid),
      getPublicQueueState(cid),
    ]);
    io.to(`admin:${cid}`).emit('queue:updated', adminState);
    io.to(`public:${cid}`).emit('queue:updated', publicState);
  }
}

module.exports = { setIo, emitQueueUpdate };
