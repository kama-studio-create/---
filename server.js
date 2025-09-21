import 'dotenv/config';
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';

import { connectDB } from './db/database.js';
import GameEngine from './game/GameEngine.js';
import { init as initTelegramBot } from './bot/TelegramBot.js';

import playerRoutes from './routes/player.js';
import adminRoutes from './routes/admin.js';

const app = express();
const server = http.createServer(app);
const io = new Server(server, { 
  cors: { 
    origin: '*',
    methods: ['GET', 'POST']
  },
  transports: ['websocket', 'polling']
});

// Basic socket connection handler (BEFORE game engine)
io.on('connection', (socket) => {
  console.log('✅ Client connected:', socket.id);
  
  // Immediately confirm connection
  socket.emit('connected', { 
    status: 'connected',
    serverId: socket.id,
    timestamp: Date.now()
  });

  socket.on('disconnect', (reason) => {
    console.log('❌ Client disconnected:', socket.id, 'Reason:', reason);
  });

  socket.on('error', (error) => {
    console.error('Socket error for', socket.id, ':', error);
  });
});

app.use(express.json({ limit: '2mb' }));
app.use(cors());
app.use(helmet());
app.use(morgan('tiny'));

const limiter = rateLimit({
  windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max: Number(process.env.RATE_LIMIT_MAX_REQUESTS) || 100
});
app.use(limiter);

// static files
app.use(express.static('public'));

// API routes
app.use('/api/player', playerRoutes);
app.use('/api/admin', adminRoutes);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

// Main startup sequence
(async () => {
  try {
    console.log('🚀 Starting Aviator Game Server...');
    
    // 1. Connect to database first
    await connectDB();
    console.log('✅ Database connected');

    // 2. Initialize Telegram bot (non-blocking)
    initTelegramBot(process.env.BOT_TOKEN);
    console.log('✅ Telegram bot initialized');

    // 3. Create and start game engine
    const game = new GameEngine({ io });
    await game.startLoop();
    console.log('✅ Game engine started');

    // 4. Start HTTP server
    const PORT = process.env.PORT || 3000;
    const serverInstance = server.listen(PORT, () => {
      console.log(`🌐 Server listening on port ${PORT}`);
      console.log(`🎮 Game URL: http://localhost:${PORT}`);
      console.log('✅ All systems ready!');
    });

    // Graceful shutdown
    const shutdown = async () => {
      console.log('🛑 Shutting down gracefully...');
      try {
        await game.stopLoop();
        serverInstance.close(() => {
          console.log('✅ HTTP server closed');
          process.exit(0);
        });
      } catch (error) {
        console.error('Error during shutdown:', error);
        process.exit(1);
      }
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    process.on('uncaughtException', (error) => {
      console.error('Uncaught Exception:', error);
      shutdown();
    });

  } catch (err) {
    console.error('❌ Server startup failed:', err);
    process.exit(1);
  }
})();