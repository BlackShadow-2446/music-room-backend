import { Member, Track, ChatMessage, getRandomColor } from './models.js';
import { CONFIG } from '../config.js';

// Grace period before a disconnected user is fully removed from their room.
// This covers tab switches, app switches, screen locks, and brief network drops.
const DISCONNECT_GRACE_MS = 60_000; // 60 seconds grace period

class RoomStore {
  constructor() {
    this.rooms = new Map();           // roomCode => Room Object
    this.disconnectTimers = new Map(); // userId_roomCode => timer handle
  }

  // ─── Internal helpers ────────────────────────────────────────────────────────

  _gracePeriodKey(userId, roomCode) {
    return `${userId}::${roomCode}`;
  }

  /**
   * Cancel any pending removal timer for this user+room (called on reconnect).
   */
  cancelGracePeriod(userId, roomCode) {
    const key = this._gracePeriodKey(userId, roomCode);
    const timer = this.disconnectTimers.get(key);
    if (timer) {
      clearTimeout(timer);
      this.disconnectTimers.delete(key);
    }
  }

  /**
   * Start a grace-period timer. If the user doesn't reconnect within
   * DISCONNECT_GRACE_MS, they are permanently removed from the room.
   * The `onExpire` callback fires when (and only when) the timer runs out.
   */
  startGracePeriod(userId, roomCode, onExpire) {
    const key = this._gracePeriodKey(userId, roomCode);
    // Clear any existing timer for this key first
    this.cancelGracePeriod(userId, roomCode);

    const timer = setTimeout(() => {
      this.disconnectTimers.delete(key);
      onExpire();
    }, DISCONNECT_GRACE_MS);

    this.disconnectTimers.set(key, timer);
  }

  generateRoomCode() {
    // Generate a unique 6-digit alphanumeric room code (e.g. 749201 or 4A8K92)
    const chars = '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ';
    let code = '';
    do {
      code = '';
      for (let i = 0; i < CONFIG.CODE_LENGTH; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
      }
    } while (this.rooms.has(code));
    return code;
  }

  createRoom(hostUserId, hostSocketId, hostName, avatarColor) {
    const code = this.generateRoomCode();
    const host = new Member({
      id: hostUserId,
      socketId: hostSocketId,
      name: hostName || 'Host Member',
      avatarColor: avatarColor || getRandomColor(),
      orderIndex: 1, // First member is #1
      isHost: true,
    });

    const room = {
      code,
      hostId: hostUserId,
      isLocked: false,
      members: new Map([[hostUserId, host]]),
      nextOrderIndex: 2, // Next joining member will be #2
      currentTrack: null,
      isPlaying: false,
      currentTime: 0,
      lastSyncTimestamp: Date.now(),
      lastPlayedUserId: null,
      skipVotes: new Set(),
      chatMessages: [
        new ChatMessage({
          senderId: 'system',
          senderName: 'System',
          senderColor: '#6366f1',
          text: `Room ${code} created. Share the code to invite friends!`,
          type: 'system',
        }),
      ],
      createdAt: Date.now(),
    };

    this.rooms.set(code, room);
    return room;
  }

  getRoom(code) {
    if (!code) return null;
    return this.rooms.get(code.trim().toUpperCase()) || null;
  }

  joinRoom(code, userId, socketId, name, avatarColor) {
    const room = this.getRoom(code);
    if (!room) {
      throw new Error(`Room "${code}" not found. Please verify the 6-digit code.`);
    }

    if (room.isLocked && !room.members.has(userId)) {
      throw new Error('This room has been locked by the host.');
    }

    // Check if user is already in the room (reconnecting after tab switch / app switch / screen lock)
    if (room.members.has(userId)) {
      const existing = room.members.get(userId);
      existing.socketId = socketId;
      if (name) existing.name = name;
      // Cancel any pending removal grace timer — they're back!
      this.cancelGracePeriod(userId, code);
      return { room, member: existing, isReconnect: true };
    }

    // Capacity limit: strictly 10 members per room
    if (room.members.size >= CONFIG.MAX_ROOM_MEMBERS) {
      throw new Error(`Room is full! Maximum capacity is ${CONFIG.MAX_ROOM_MEMBERS} members.`);
    }

    const orderIndex = room.nextOrderIndex++;
    const newMember = new Member({
      id: userId,
      socketId,
      name: name || `Listener #${orderIndex}`,
      avatarColor: avatarColor || getRandomColor(),
      orderIndex,
      isHost: false,
    });

    room.members.set(userId, newMember);

    // Add system message
    this.addSystemMessage(room, `${newMember.name} joined as Member #${orderIndex}`);

    return { room, member: newMember, isReconnect: false };
  }

  leaveRoom(code, userId) {
    const room = this.getRoom(code);
    if (!room) return null;

    // Clear any pending disconnect grace timer since user explicitly left
    this.cancelGracePeriod(userId, code);

    const member = room.members.get(userId);
    if (!member) return null;

    room.members.delete(userId);
    room.skipVotes.delete(userId);

    this.addSystemMessage(room, `${member.name} left the room`);

    // If room is now empty, cleanup room
    if (room.members.size === 0) {
      this.rooms.delete(code);
      return null;
    }

    // If host left, migrate host to the next senior member (lowest orderIndex)
    if (room.hostId === userId) {
      const remaining = Array.from(room.members.values()).sort((a, b) => a.orderIndex - b.orderIndex);
      if (remaining.length > 0) {
        const newHost = remaining[0];
        newHost.isHost = true;
        room.hostId = newHost.id;
        this.addSystemMessage(room, `👑 ${newHost.name} is now the room Host`);
      }
    }

    return room;
  }

  /**
   * Called when a socket disconnects (tab switch, lock screen, app switch, network blip).
   * Instead of immediately removing the user, we start a 60-second grace period.
   * If they reconnect within that window (via room:join), the timer is cancelled and
   * they seamlessly resume their session with no visible disruption to the room.
   */
  disconnectUser(code, userId, onExpired) {
    const room = this.getRoom(code);
    if (!room || !room.members.has(userId)) return null;

    const member = room.members.get(userId);
    // Mark as temporarily away (keeps them in the room visually)
    member.isOnline = false;

    this.startGracePeriod(userId, code, () => {
      // Grace period expired without reconnect — remove user permanently
      const expiredRoom = this.leaveRoom(code, userId);
      if (typeof onExpired === 'function') {
        onExpired(expiredRoom);
      }
    });

    return room;
  }

  kickMember(code, hostUserId, targetUserId, reason) {
    const room = this.getRoom(code);
    if (!room) throw new Error('Room not found');

    if (room.hostId !== hostUserId) {
      throw new Error('Only the room Host can kick members');
    }

    if (targetUserId === hostUserId) {
      throw new Error('Host cannot kick themselves');
    }

    const target = room.members.get(targetUserId);
    if (!target) throw new Error('Member not found in room');

    room.members.delete(targetUserId);
    room.skipVotes.delete(targetUserId);

    this.addSystemMessage(
      room,
      `🚫 ${target.name} was removed by the Host${reason ? `: ${reason}` : ''}`
    );

    return { room, kickedMember: target };
  }

  toggleLock(code, hostUserId) {
    const room = this.getRoom(code);
    if (!room) throw new Error('Room not found');

    if (room.hostId !== hostUserId) {
      throw new Error('Only the room Host can lock or unlock the room');
    }

    room.isLocked = !room.isLocked;
    this.addSystemMessage(
      room,
      room.isLocked ? '🔒 Room is now locked to new members' : '🔓 Room is now unlocked'
    );
    return room;
  }

  /**
   * Round-Robin Interleaved Queue Computation:
   * Fair turn-by-turn playback (Member 1 -> Member 2 -> Member 3... -> Member 1).
   * Generates a flattened master queue from all members' queued songs,
   * starting from the member whose turn is next after room.lastPlayedUserId.
   */
  getInterleavedQueue(room) {
    // Get all members who currently have songs in their personal queue
    const membersWithTracks = Array.from(room.members.values())
      .filter((m) => m.userQueue && m.userQueue.length > 0)
      .sort((a, b) => a.orderIndex - b.orderIndex);

    if (membersWithTracks.length === 0) {
      return [];
    }

    // Determine starting index in the sorted list based on lastPlayedUserId
    let startIndex = 0;
    if (room.lastPlayedUserId) {
      const lastIndex = membersWithTracks.findIndex((m) => m.id === room.lastPlayedUserId);
      if (lastIndex !== -1) {
        startIndex = (lastIndex + 1) % membersWithTracks.length;
      }
    }

    // Reorder members in round-robin sequence starting at startIndex
    const orderedMembers = [
      ...membersWithTracks.slice(startIndex),
      ...membersWithTracks.slice(0, startIndex),
    ];

    // Interleave songs turn-by-turn
    const masterQueue = [];
    // Deep clone track queues to avoid mutating original arrays during preview
    const queues = orderedMembers.map((m) => [...m.userQueue]);

    let maxQueueLength = Math.max(...queues.map((q) => q.length));
    let turnCount = 1;

    for (let round = 0; round < maxQueueLength; round++) {
      for (let i = 0; i < orderedMembers.length; i++) {
        if (round < queues[i].length) {
          const track = queues[i][round];
          masterQueue.push({
            ...track,
            turnIndex: turnCount++,
            memberOrder: orderedMembers[i].orderIndex,
          });
        }
      }
    }

    return masterQueue;
  }

  /**
   * Adds a track to a member's queue.
   * If nothing is currently playing, starts playback immediately!
   */
  addTrack(code, userId, trackData) {
    const room = this.getRoom(code);
    if (!room) throw new Error('Room not found');

    const member = room.members.get(userId);
    if (!member) throw new Error('Member not found');

    const track = new Track({
      ...trackData,
      addedBy: {
        id: member.id,
        name: member.name,
        avatarColor: member.avatarColor,
        orderIndex: member.orderIndex,
      },
    });

    // If nothing is playing, play immediately!
    if (!room.currentTrack) {
      room.currentTrack = track;
      room.isPlaying = true;
      room.currentTime = 0;
      room.lastSyncTimestamp = Date.now();
      room.lastPlayedUserId = member.id;
      room.skipVotes.clear();
      this.addSystemMessage(room, `🎶 Now playing: ${track.title} (queued by ${member.name})`);
    } else {
      // Add to this member's personal queue
      member.userQueue.push(track);
      this.addSystemMessage(room, `➕ ${member.name} added "${track.title}" to the queue`);
    }

    return { room, track, masterQueue: this.getInterleavedQueue(room) };
  }

  removeTrack(code, userId, trackId) {
    const room = this.getRoom(code);
    if (!room) throw new Error('Room not found');

    const member = room.members.get(userId);
    const isHost = room.hostId === userId;

    let removed = false;
    let trackTitle = '';

    for (const m of room.members.values()) {
      if (m.id === userId || isHost) {
        const idx = m.userQueue.findIndex((t) => t.id === trackId);
        if (idx !== -1) {
          trackTitle = m.userQueue[idx].title;
          m.userQueue.splice(idx, 1);
          removed = true;
          break;
        }
      }
    }

    if (removed) {
      this.addSystemMessage(room, `🗑️ Removed "${trackTitle}" from the queue`);
    }

    return { room, masterQueue: this.getInterleavedQueue(room) };
  }

  /**
   * Advances playback to the next track in round-robin order.
   */
  advanceTrack(code, reason = 'natural') {
    const room = this.getRoom(code);
    if (!room) return null;

    const interleaved = this.getInterleavedQueue(room);

    if (interleaved.length === 0) {
      // No more tracks in queue
      room.currentTrack = null;
      room.isPlaying = false;
      room.currentTime = 0;
      room.lastSyncTimestamp = Date.now();
      room.skipVotes.clear();
      this.addSystemMessage(room, 'Queue finished. Add more tracks to keep the music going!');
      return { room, nextTrack: null, masterQueue: [] };
    }

    // Get the next scheduled track
    const nextTrack = interleaved[0];

    // Remove it from the corresponding user's queue
    const member = room.members.get(nextTrack.addedBy.id);
    if (member) {
      const idx = member.userQueue.findIndex((t) => t.id === nextTrack.id);
      if (idx !== -1) {
        member.userQueue.splice(idx, 1);
      }
    }

    room.currentTrack = nextTrack;
    room.isPlaying = true;
    room.currentTime = 0;
    room.lastSyncTimestamp = Date.now();
    room.lastPlayedUserId = nextTrack.addedBy.id;
    room.skipVotes.clear();

    const reasonLabel = reason === 'skip' ? '⏭️ Track skipped.' : '🎵 Auto-playing next turn:';
    this.addSystemMessage(room, `${reasonLabel} ${nextTrack.title} (Member #${nextTrack.addedBy.orderIndex}: ${nextTrack.addedBy.name})`);

    return { room, nextTrack, masterQueue: this.getInterleavedQueue(room) };
  }

  /**
   * Vote to skip current track.
   * Auto-skips when 50% or more room members vote "Skip".
   */
  voteSkip(code, userId) {
    const room = this.getRoom(code);
    if (!room || !room.currentTrack) {
      throw new Error('No track is currently playing');
    }

    if (!room.members.has(userId)) {
      throw new Error('You must be a room member to vote');
    }

    const member = room.members.get(userId);

    // Toggle vote
    let voted = false;
    if (room.skipVotes.has(userId)) {
      room.skipVotes.delete(userId);
      voted = false;
      this.addSystemMessage(room, `↩️ ${member.name} withdrew their skip vote`);
    } else {
      room.skipVotes.add(userId);
      voted = true;
      this.addSystemMessage(room, `🗳️ ${member.name} voted to skip (${room.skipVotes.size}/${Math.ceil(room.members.size * 0.5)} needed)`);
    }

    const totalMembers = room.members.size;
    const requiredVotes = Math.max(1, Math.ceil(totalMembers * (CONFIG.SKIP_THRESHOLD_PERCENT / 100)));
    const passed = room.skipVotes.size >= requiredVotes;

    if (passed) {
      this.addSystemMessage(room, `🎉 Skip vote passed with ${room.skipVotes.size} votes! Advancing turn...`);
      const result = this.advanceTrack(code, 'skip');
      return {
        ...result,
        skipped: true,
        votes: room.skipVotes.size,
        requiredVotes,
      };
    }

    return {
      room,
      skipped: false,
      votes: room.skipVotes.size,
      requiredVotes,
      voted,
      masterQueue: this.getInterleavedQueue(room),
    };
  }

  forceSkip(code, hostUserId) {
    const room = this.getRoom(code);
    if (!room) throw new Error('Room not found');

    if (room.hostId !== hostUserId) {
      throw new Error('Only the Host can force-skip tracks');
    }

    const host = room.members.get(hostUserId);
    this.addSystemMessage(room, `⚡ Host (${host ? host.name : 'Host'}) force-skipped the current track`);
    return this.advanceTrack(code, 'skip');
  }

  updatePlayback(code, action, time) {
    const room = this.getRoom(code);
    if (!room || !room.currentTrack) return null;

    if (action === 'play') {
      room.isPlaying = true;
      if (typeof time === 'number') room.currentTime = time;
      room.lastSyncTimestamp = Date.now();
    } else if (action === 'pause') {
      room.isPlaying = false;
      if (typeof time === 'number') room.currentTime = time;
      room.lastSyncTimestamp = Date.now();
    } else if (action === 'seek') {
      if (typeof time === 'number') {
        room.currentTime = time;
        room.lastSyncTimestamp = Date.now();
      }
    }

    return room;
  }

  getCurrentPlaybackTime(room) {
    if (!room || !room.currentTrack) return 0;
    if (!room.isPlaying) return room.currentTime;

    const elapsedSeconds = (Date.now() - room.lastSyncTimestamp) / 1000;
    const computedTime = room.currentTime + elapsedSeconds;

    if (room.currentTrack.duration > 0 && computedTime >= room.currentTrack.duration) {
      return room.currentTrack.duration;
    }
    return computedTime;
  }

  addChatMessage(code, senderId, text) {
    const room = this.getRoom(code);
    if (!room) return null;

    const member = room.members.get(senderId);
    if (!member) return null;

    const message = new ChatMessage({
      senderId: member.id,
      senderName: member.name,
      senderColor: member.avatarColor,
      isHost: member.isHost,
      text: (text || '').trim().slice(0, 500),
      type: 'user',
    });

    room.chatMessages.push(message);
    if (room.chatMessages.length > 100) {
      room.chatMessages.shift();
    }
    return message;
  }

  addSystemMessage(room, text) {
    const message = new ChatMessage({
      senderId: 'system',
      senderName: 'System',
      senderColor: '#6366f1',
      text,
      type: 'system',
    });
    room.chatMessages.push(message);
    if (room.chatMessages.length > 100) {
      room.chatMessages.shift();
    }
    return message;
  }

  /**
   * Serialize room state for client transmission
   */
  getPublicState(room) {
    if (!room) return null;

    const membersList = Array.from(room.members.values()).map((m) => ({
      id: m.id,
      name: m.name,
      avatarColor: m.avatarColor,
      orderIndex: m.orderIndex,
      isHost: m.isHost,
      isOnline: m.isOnline !== false,
      joinedAt: m.joinedAt,
      queuedCount: m.userQueue.length,
    }));

    const totalMembers = room.members.size;
    const requiredVotes = Math.max(1, Math.ceil(totalMembers * (CONFIG.SKIP_THRESHOLD_PERCENT / 100)));

    return {
      code: room.code,
      hostId: room.hostId,
      isLocked: room.isLocked,
      members: membersList,
      currentTrack: room.currentTrack,
      isPlaying: room.isPlaying,
      currentTime: this.getCurrentPlaybackTime(room),
      lastSyncTimestamp: room.lastSyncTimestamp,
      masterQueue: this.getInterleavedQueue(room),
      skipVotesCount: room.skipVotes.size,
      skipVotesRequired: requiredVotes,
      skipVoters: Array.from(room.skipVotes),
      chatMessages: room.chatMessages.slice(-50),
      createdAt: room.createdAt,
    };
  }
}

export const roomStore = new RoomStore();

