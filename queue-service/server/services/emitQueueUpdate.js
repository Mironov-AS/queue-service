const { getQueueState, getPublicQueueState } = require('./queueState');

let io;

function setIo(socketIo) {
  io = socketIo;
}

function emitQueueUpdate() {
  if (!io) return;
  io.to('admins').emit('queue:updated', getQueueState());
  io.except('admins').emit('queue:updated', getPublicQueueState());
}

module.exports = { setIo, emitQueueUpdate };