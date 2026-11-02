import { roomStore } from '../state/RoomStore.js';

export function registerRoomHandlers(io, socket) {
  // 1. Create Room
  socket.on('room:create', ({ userId, userName, avatarColor }, callback) => {
    try {
      const room = roomStore.createRoom(userId, socket.id, userName, avatarColor);
      socket.join(room.code);
      socket.data.roomCode = room.code;
      socket.data.userId = userId;

      const publicState = roomStore.getPublicState(room);

      if (typeof callback === 'function') {
        callback({ success: true, room: publicState });
      }

      // Broadcast room update
      io.to(room.code).emit('room:state', publicState);
    } catch (err) {
      if (typeof callback === 'function') {
        callback({ success: false, error: err.message });
      }
    }
  });

  // 2. Join Room
  socket.on('room:join', ({ code, userId, userName, avatarColor }, callback) => {
    try {
      const cleanCode = (code || '').trim().toUpperCase();
      const { room, member } = roomStore.joinRoom(cleanCode, userId, socket.id, userName, avatarColor);

      socket.join(cleanCode);
      socket.data.roomCode = cleanCode;
      socket.data.userId = userId;

      const publicState = roomStore.getPublicState(room);

      if (typeof callback === 'function') {
        callback({ success: true, room: publicState, member });
      }

      io.to(cleanCode).emit('room:state', publicState);
      io.to(cleanCode).emit('room:member_joined', { member });
    } catch (err) {
      if (typeof callback === 'function') {
        callback({ success: false, error: err.message });
      }
    }
  });

  // 3. Leave Room
  socket.on('room:leave', ({ code, userId }, callback) => {
    try {
      const cleanCode = (code || socket.data.roomCode || '').trim().toUpperCase();
      const room = roomStore.leaveRoom(cleanCode, userId || socket.data.userId);

      socket.leave(cleanCode);
      socket.data.roomCode = null;

      if (room) {
        const publicState = roomStore.getPublicState(room);
        io.to(cleanCode).emit('room:state', publicState);
      }

      if (typeof callback === 'function') {
        callback({ success: true });
      }
    } catch (err) {
      if (typeof callback === 'function') {
        callback({ success: false, error: err.message });
      }
    }
  });

  // 4. Toggle Lock (Host Only)
  socket.on('room:toggle_lock', ({ code, userId }, callback) => {
    try {
      const cleanCode = (code || socket.data.roomCode || '').trim().toUpperCase();
      const room = roomStore.toggleLock(cleanCode, userId || socket.data.userId);
      const publicState = roomStore.getPublicState(room);

      io.to(cleanCode).emit('room:state', publicState);

      if (typeof callback === 'function') {
        callback({ success: true, isLocked: room.isLocked });
      }
    } catch (err) {
      if (typeof callback === 'function') {
        callback({ success: false, error: err.message });
      }
    }
  });

  // 5. Kick Member (Host Only)
  socket.on('room:kick_member', ({ code, hostUserId, targetUserId, reason }, callback) => {
    try {
      const cleanCode = (code || socket.data.roomCode || '').trim().toUpperCase();
      const { room, kickedMember } = roomStore.kickMember(
        cleanCode,
        hostUserId || socket.data.userId,
        targetUserId,
        reason
      );

      const publicState = roomStore.getPublicState(room);

      // Notify the kicked member directly
      if (kickedMember && kickedMember.socketId) {
        io.to(kickedMember.socketId).emit('room:kicked', {
          reason: reason || 'Removed by host',
        });
      }

      // Broadcast updated room state
      io.to(cleanCode).emit('room:state', publicState);

      if (typeof callback === 'function') {
        callback({ success: true });
      }
    } catch (err) {
      if (typeof callback === 'function') {
        callback({ success: false, error: err.message });
      }
    }
  });

  // Disconnect handling with 60s Grace Period
  // Tab switches, phone locks, and app switching will NOT kick the user out!
  socket.on('disconnect', () => {
    const { roomCode, userId } = socket.data;
    if (roomCode && userId) {
      const room = roomStore.disconnectUser(roomCode, userId, (expiredRoom) => {
        // Only broadcast removal after grace period expires
        if (expiredRoom) {
          const publicState = roomStore.getPublicState(expiredRoom);
          io.to(roomCode).emit('room:state', publicState);
        }
      });

      // Broadcast updated member online status (marks them as away, but keeps them in the room)
      if (room) {
        const publicState = roomStore.getPublicState(room);
        io.to(roomCode).emit('room:state', publicState);
      }
    }
  });
}

