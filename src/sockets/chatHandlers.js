import { roomStore } from '../state/RoomStore.js';

export function registerChatHandlers(io, socket) {
  // Send in-room text chat message
  socket.on('chat:send', ({ code, userId, text }, callback) => {
    try {
      const cleanCode = (code || socket.data.roomCode || '').trim().toUpperCase();
      const message = roomStore.addChatMessage(cleanCode, userId || socket.data.userId, text);

      if (message) {
        io.to(cleanCode).emit('chat:new_message', { message });
        if (typeof callback === 'function') {
          callback({ success: true, message });
        }
      }
    } catch (err) {
      if (typeof callback === 'function') {
        callback({ success: false, error: err.message });
      }
    }
  });

  // Floating Emoji Reaction (🎵, 🔥, ❤️, 👏, 🚀, 🎧)
  socket.on('reaction:send', ({ code, userId, emoji, userName }) => {
    const cleanCode = (code || socket.data.roomCode || '').trim().toUpperCase();
    if (!cleanCode || !emoji) return;

    const reactionPayload = {
      id: 'react_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 6),
      emoji,
      userId: userId || socket.data.userId,
      userName: userName || 'Listener',
      timestamp: Date.now(),
      // Add random x position between 15% and 85% for natural floating distribution
      xPos: Math.floor(Math.random() * 70) + 15,
    };

    io.to(cleanCode).emit('room:reaction', reactionPayload);
  });
}

