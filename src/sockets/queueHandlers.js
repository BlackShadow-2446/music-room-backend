import { roomStore } from '../state/RoomStore.js';
import { parseTrackUrl } from '../utils/trackParser.js';

export function registerQueueHandlers(io, socket) {
  // Add Track by URL or pre-parsed track payload
  socket.on('queue:add', async ({ code, userId, url, trackData }, callback) => {
    try {
      const cleanCode = (code || socket.data.roomCode || '').trim().toUpperCase();
      const room = roomStore.getRoom(cleanCode);
      if (!room) throw new Error('Room not found');

      const member = room.members.get(userId || socket.data.userId);
      if (!member) throw new Error('Member not found');

      let parsedTrack = trackData;

      if (!parsedTrack && url) {
        parsedTrack = await parseTrackUrl(url, member);
      }

      if (!parsedTrack) {
        throw new Error('No track data or URL provided');
      }

      const result = roomStore.addTrack(cleanCode, member.id, parsedTrack);
      const publicState = roomStore.getPublicState(result.room);

      io.to(cleanCode).emit('room:state', publicState);

      if (typeof callback === 'function') {
        callback({ success: true, track: result.track });
      }
    } catch (err) {
      if (typeof callback === 'function') {
        callback({ success: false, error: err.message });
      }
    }
  });

  // Remove Track from queue
  socket.on('queue:remove', ({ code, userId, trackId }, callback) => {
    try {
      const cleanCode = (code || socket.data.roomCode || '').trim().toUpperCase();
      const result = roomStore.removeTrack(cleanCode, userId || socket.data.userId, trackId);
      const publicState = roomStore.getPublicState(result.room);

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
}

