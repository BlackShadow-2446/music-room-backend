import { roomStore } from '../state/RoomStore.js';

// Cache to prevent duplicate track advancement when multiple clients report track end simultaneously
const trackEndLocks = new Map(); // roomCode => lastAdvancementTimestamp

export function registerPlayerHandlers(io, socket) {
  // 1. Play / Pause / Seek Actions
  socket.on('player:action', ({ code, action, time }) => {
    const cleanCode = (code || socket.data.roomCode || '').trim().toUpperCase();
    const room = roomStore.getRoom(cleanCode);
    if (!room || !room.currentTrack) return;

    roomStore.updatePlayback(cleanCode, action, time);

    const currentTime = roomStore.getCurrentPlaybackTime(room);

    // Broadcast synchronized playback action to all room members
    io.to(cleanCode).emit('player:sync', {
      action,
      isPlaying: room.isPlaying,
      currentTime,
      lastSyncTimestamp: room.lastSyncTimestamp,
      triggeredBy: socket.data.userId,
    });
  });

  // 2. Client Periodic / Drift Sync Request
  socket.on('player:sync_request', ({ code }, callback) => {
    const cleanCode = (code || socket.data.roomCode || '').trim().toUpperCase();
    const room = roomStore.getRoom(cleanCode);
    if (!room || !room.currentTrack) {
      if (typeof callback === 'function') {
        callback({ isPlaying: false, currentTime: 0, currentTrack: null });
      }
      return;
    }

    const currentTime = roomStore.getCurrentPlaybackTime(room);
    if (typeof callback === 'function') {
      callback({
        isPlaying: room.isPlaying,
        currentTime,
        currentTrack: room.currentTrack,
        lastSyncTimestamp: room.lastSyncTimestamp,
      });
    }
  });

  // 3. Update Track Duration (Reported by client when media metadata is loaded)
  socket.on('player:update_duration', ({ code, duration }) => {
    const cleanCode = (code || socket.data.roomCode || '').trim().toUpperCase();
    const room = roomStore.getRoom(cleanCode);
    if (room && room.currentTrack && typeof duration === 'number' && duration > 0) {
      if (!room.currentTrack.duration || room.currentTrack.duration === 0) {
        room.currentTrack.duration = Math.round(duration);
        io.to(cleanCode).emit('player:duration_updated', {
          duration: room.currentTrack.duration,
        });
      }
    }
  });

  // 4. Track Finished Playing -> Auto-advance to next turn in round-robin queue
  socket.on('player:track_end', ({ code, trackId }) => {
    const cleanCode = (code || socket.data.roomCode || '').trim().toUpperCase();
    const room = roomStore.getRoom(cleanCode);
    if (!room || !room.currentTrack) return;

    // Verify it matches the currently playing track
    if (room.currentTrack.id !== trackId) return;

    // Throttle duplicate track_end triggers across multiple clients
    const now = Date.now();
    const lastAdvance = trackEndLocks.get(cleanCode) || 0;
    if (now - lastAdvance < 3000) {
      return; // Already advanced recently
    }
    trackEndLocks.set(cleanCode, now);

    const result = roomStore.advanceTrack(cleanCode, 'natural');
    if (result) {
      const publicState = roomStore.getPublicState(result.room);
      io.to(cleanCode).emit('room:state', publicState);
    }
  });

  // 5. Vote to Skip Track (>= 50% members needed)
  socket.on('player:vote_skip', ({ code, userId }, callback) => {
    try {
      const cleanCode = (code || socket.data.roomCode || '').trim().toUpperCase();
      const result = roomStore.voteSkip(cleanCode, userId || socket.data.userId);

      const publicState = roomStore.getPublicState(result.room);
      io.to(cleanCode).emit('room:state', publicState);

      if (typeof callback === 'function') {
        callback({
          success: true,
          skipped: result.skipped,
          votes: result.votes,
          requiredVotes: result.requiredVotes,
        });
      }
    } catch (err) {
      if (typeof callback === 'function') {
        callback({ success: false, error: err.message });
      }
    }
  });

  // 6. Host Force Skip
  socket.on('player:force_skip', ({ code, hostUserId }, callback) => {
    try {
      const cleanCode = (code || socket.data.roomCode || '').trim().toUpperCase();
      const result = roomStore.forceSkip(cleanCode, hostUserId || socket.data.userId);

      if (result) {
        const publicState = roomStore.getPublicState(result.room);
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
}

