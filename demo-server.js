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
  cors: { origin: '*' }
});

// Middleware
app.use(express.json({ limit: '2mb' }));
app.use(cors());
app.use(helmet());
app.use(morgan('tiny'));

const limiter = rateLimit({
  windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max: Number(process.env.RATE_LIMIT_MAX_REQUESTS) || 100
});
app.use(limiter);

// Static files
app.use(express.static('public'));

// Routes
app.use('/api/player', playerRoutes);
app.use('/api/admin', adminRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

// Startup sequence
(async () => {
  try {
    console.log('🚀 Starting Aviator Game Server...');

    // 1. Connect DB
    await connectDB();
    console.log('✅ Database connected');

    // 2. Start Telegram bot (non-blocking)
    if (process.env.BOT_TOKEN) {
      initTelegramBot(process.env.BOT_TOKEN);
      console.log('✅ Telegram bot initialized');
    }

    // 3. Start GameEngine (manages socket.io)
    const game = new GameEngine({ io });
    await game.startLoop();
    console.log('✅ Game engine started');

    // 4. Start server
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
        console.error('❌ Error during shutdown:', error);
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
