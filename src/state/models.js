/**
 * State Models and Data Structures for Music Rooms
 */

export class Member {
  constructor({ id, socketId, name, avatarColor, orderIndex, isHost = false }) {
    this.id = id;                     // Persistent user ID or socket ID
    this.socketId = socketId;
    this.name = name || `Listener #${orderIndex}`;
    this.avatarColor = avatarColor || getRandomColor();
    this.orderIndex = orderIndex;     // 1, 2, 3... order of joining the room
    this.isHost = isHost;
    this.joinedAt = Date.now();
    this.userQueue = [];             // List of Track objects added by this user
  }
}

export class Track {
  constructor({ id, source, url, mediaId, title, artist, thumbnail, duration, addedBy }) {
    this.id = id;
    this.source = source;             // 'youtube' | 'audio'
    this.url = url;
    this.mediaId = mediaId;
    this.title = title;
    this.artist = artist;
    this.thumbnail = thumbnail;
    this.duration = duration || 0;
    this.addedBy = addedBy;           // { id, name, avatarColor, orderIndex }
    this.createdAt = Date.now();
  }
}

export class ChatMessage {
  constructor({ id, senderId, senderName, senderColor, isHost, text, type = 'user', timestamp }) {
    this.id = id || 'msg_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 6);
    this.senderId = senderId;
    this.senderName = senderName;
    this.senderColor = senderColor;
    this.isHost = isHost || false;
    this.text = text;
    this.type = type;                 // 'user' | 'system'
    this.timestamp = timestamp || Date.now();
  }
}

export function getRandomColor() {
  const colors = [
    '#6366f1', // Indigo
    '#8b5cf6', // Violet
    '#ec4899', // Pink
    '#f43f5e', // Rose
    '#06b6d4', // Cyan
    '#10b981', // Emerald
    '#f59e0b', // Amber
    '#3b82f6', // Blue
    '#14b8a6', // Teal
  ];
  return colors[Math.floor(Math.random() * colors.length)];
}

