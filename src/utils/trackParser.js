import axios from 'axios';

/**
 * Extracts YouTube Video ID from various YouTube URL formats.
 */
export function extractYouTubeId(url) {
  if (!url) return null;
  const regExp = /^.*(?:(?:youtu\.be\/|v\/|vi\/|u\/\w\/|embed\/|shorts\/)|(?:(?:watch)?\?v(?:i)?=|\&v(?:i)?=))([^#\&\?]*).*/;
  const match = url.trim().match(regExp);
  return (match && match[1].length === 11) ? match[1] : null;
}

/**
 * Checks if a URL points directly to an audio file.
 */
export function isDirectAudioUrl(url) {
  if (!url) return false;
  const cleanUrl = url.split('?')[0].toLowerCase();
  return /\.(mp3|wav|ogg|m4a|aac|flac)$/.test(cleanUrl) || url.includes('/audio/') || url.includes('.mp3');
}

/**
 * Parse a given song URL/input and return standardized track metadata.
 */
export async function parseTrackUrl(url, addedBy) {
  const trimmed = (url || '').trim();
  if (!trimmed) {
    throw new Error('Please provide a valid track URL or query');
  }

  const trackId = 'trk_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 7);

  // 1. YouTube Video
  const ytId = extractYouTubeId(trimmed);
  if (ytId) {
    let title = `YouTube Track (${ytId})`;
    let author = 'YouTube Creator';
    let thumbnail = `https://img.youtube.com/vi/${ytId}/hqdefault.jpg`;
    let duration = 0;

    try {
      // Use YouTube public oEmbed endpoint for free instant metadata without API key
      const oembedRes = await axios.get(
        `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${ytId}&format=json`,
        { timeout: 4000 }
      );
      if (oembedRes.data) {
        title = oembedRes.data.title || title;
        author = oembedRes.data.author_name || author;
        thumbnail = oembedRes.data.thumbnail_url || thumbnail;
      }
    } catch (err) {
      // Fallback works automatically
    }

    return {
      id: trackId,
      source: 'youtube',
      url: `https://www.youtube.com/watch?v=${ytId}`,
      mediaId: ytId,
      title,
      artist: author,
      thumbnail,
      duration, // In seconds, updated by client player upon metadata loaded
      addedBy: {
        id: addedBy.id,
        name: addedBy.name,
        avatarColor: addedBy.avatarColor,
        orderIndex: addedBy.orderIndex,
      },
      createdAt: Date.now(),
    };
  }

  // 2. Direct Audio Stream / MP3
  if (isDirectAudioUrl(trimmed) || trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    // If it's a direct audio file
    const urlParts = trimmed.split('?')[0].split('/');
    const filename = decodeURIComponent(urlParts[urlParts.length - 1]) || 'Direct Audio Stream';
    const cleanTitle = filename.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ');

    return {
      id: trackId,
      source: 'audio',
      url: trimmed,
      mediaId: trimmed,
      title: cleanTitle || 'Audio Track',
      artist: 'Web Stream',
      thumbnail: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=400&auto=format&fit=crop&q=80',
      duration: 0,
      addedBy: {
        id: addedBy.id,
        name: addedBy.name,
        avatarColor: addedBy.avatarColor,
        orderIndex: addedBy.orderIndex,
      },
      createdAt: Date.now(),
    };
  }

  throw new Error('Unsupported audio link. Please enter a valid YouTube video URL or direct audio stream.');
}

