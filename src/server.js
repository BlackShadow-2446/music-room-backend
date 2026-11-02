import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { CONFIG } from './config.js';
import { setupSockets } from './sockets/index.js';
import { SAMPLE_TRACKS } from './utils/sampleTracks.js';
import { parseTrackUrl } from './utils/trackParser.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);

// Configure CORS
app.use(cors({
  origin: CONFIG.CLIENT_ORIGIN,
  methods: ['GET', 'POST'],
  credentials: true,
}));

app.use(express.json());

// Socket.io initialization with CORS
const io = new Server(server, {
  cors: {
    origin: CONFIG.CLIENT_ORIGIN,
    methods: ['GET', 'POST'],
    credentials: true,
  },
  // Generous timeouts so tab switches, app switching & screen locks
  // don't cause premature disconnections.
  // pingInterval: how often server pings the client (ms)
  // pingTimeout:  how long server waits for pong before disconnecting (ms)
  pingInterval: 25000,   // ping every 25s (was 10s)
  pingTimeout:  60000,   // wait 60s for pong (was 5s — far too aggressive)
  connectTimeout: 45000,
  // Allow upgrading transports so polling fallback works on mobile/locked screens
  transports: ['polling', 'websocket'],
  upgradeTimeout: 30000,
});

// Setup Real-time Sockets
setupSockets(io);

// REST API Endpoints
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'Collab Music Room Backend',
  });
});

// Curated sample tracks for quick test
app.get('/api/sample-tracks', (req, res) => {
  res.json(SAMPLE_TRACKS);
});

// Parse Track URL endpoint
app.post('/api/parse-track', async (req, res) => {
  try {
    const { url, addedBy } = req.body;
    const parsed = await parseTrackUrl(url, addedBy || { id: 'test', name: 'Tester', avatarColor: '#6366f1', orderIndex: 1 });
    res.json(parsed);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Serve frontend production build if available
const frontendDist = path.join(__dirname, '../../frontend/dist');
app.use(express.static(frontendDist));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/socket.io')) {
    return next();
  }
  res.sendFile(path.join(frontendDist, 'index.html'), (err) => {
    if (err) {
      res.status(200).send('Collab Music Room Backend is running. Start the frontend Vite dev server or build frontend to serve static files.');
    }
  });
});

// Start Server
const PORT = CONFIG.PORT;
server.listen(PORT, () => {
  console.log(`[MusicRoom Server] 🎵 Real-time backend listening on http://localhost:${PORT}`);
});

