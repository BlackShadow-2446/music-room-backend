import { registerRoomHandlers } from './roomHandlers.js';
import { registerPlayerHandlers } from './playerHandlers.js';
import { registerQueueHandlers } from './queueHandlers.js';
import { registerChatHandlers } from './chatHandlers.js';

export function setupSockets(io) {
  io.on('connection', (socket) => {
    // Register domain handlers
    registerRoomHandlers(io, socket);
    registerPlayerHandlers(io, socket);
    registerQueueHandlers(io, socket);
    registerChatHandlers(io, socket);
  });
}

