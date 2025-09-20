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
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.json({ limit: '2mb' }));
app.use(cors());
app.use(helmet());
app.use(morgan('tiny'));

const limiter = rateLimit({
  windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max: Number(process.env.RATE_LIMIT_MAX_REQUESTS) || 100
});
app.use(limiter);

// static
app.use(express.static('public'));

// API routes
app.use('/api/player', playerRoutes);
app.use('/api/admin', adminRoutes);

// connect DB and start engine
(async () => {
  try {
    // Connect to database
    await connectDB();
  } catch (err) {
    console.error('DB connect error', err);
    process.exit(1);
  }

  // initialize Telegram bot (non-blocking)
  initTelegramBot(process.env.BOT_TOKEN);

  // start game engine (attaches to io)
  const game = new GameEngine({ io });
  await game.startLoop();

  // start HTTP server
  const PORT = process.env.PORT || 3000;
  const serverInstance = server.listen(PORT, () => console.log(`Server listening on ${PORT}`));

  // graceful shutdown
  const shutdown = async () => {
    console.log('Shutting down...');
    await game.stopLoop();
    serverInstance.close(() => {
      console.log('HTTP server closed.');
      process.exit(0);
    });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

})();