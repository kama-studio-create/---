import { generateServerSeed, computeCrashMultiplier, hashServerSeed } from './ProvablyFair.js';
import { v4 as uuidv4 } from 'uuid';
import { User, Transaction, GameRound } from '../db/database.js';

class GameEngine {
  constructor({ io }) {
    this.io = io;
    this.running = false;
    this.round = null;
    this.betPhaseDuration = Number(process.env.BET_PHASE_DURATION) || 5000;
    this.gameDuration = Number(process.env.GAME_DURATION) || 30000;
    this.updateIntervalMs = 200;
    this.activeBets = new Map();

    // attach socket handlers
    this.io.on('connection', socket => this.handleSocket(socket));
  }

  handleSocket(socket) {
    console.log('Socket connected:', socket.id);
    socket.emit('connected', { message: 'Connected to Aviator server.' });

    socket.on('placeBet', async (data) => {
      try {
        const { telegramId, amount, clientSeed } = data;
        if (!this.round || this.round.phase !== 'betting') {
          return socket.emit('error', { code: 'no_betting_phase', message: 'Betting phase is not active.' });
        }
        if (!telegramId || !amount || amount <= 0) {
          return socket.emit('error', { code: 'invalid_bet', message: 'Invalid bet data.' });
        }

        // Check user balance
        const user = await User.findOne({ telegramId: Number(telegramId) });
        if (!user || user.balance < amount) {
          return socket.emit('error', { code: 'insufficient_balance', message: 'Not enough balance.' });
        }

        // Deduct bet amount
        user.balance -= amount;
        await user.save();

        const bet = { telegramId, amount, clientSeed: clientSeed || '', placedAt: Date.now(), cashedOut: false, payout: 0 };
        this.activeBets.set(String(telegramId), bet);

        await Transaction.create({ userId: user._id, type: 'bet', amount, meta: { roundId: this.round.id } });

        this.io.emit('game:betPlaced', bet);
      } catch (err) {
        console.error('Bet error:', err);
        socket.emit('error', { code: 'server_error', message: 'Server error placing bet.' });
      }
    });

    socket.on('cashOut', async (data) => {
      try {
        const { telegramId } = data;
        const bet = this.activeBets.get(String(telegramId));
        if (!bet) return socket.emit('error', { code: 'no_active_bet', message: 'No active bet.' });
        if (bet.cashedOut) return socket.emit('error', { code: 'already_cashed', message: 'Already cashed out.' });
        if (!this.round || this.round.phase !== 'running') return socket.emit('error', { code: 'not_running', message: 'Game not running.' });

        const payout = Math.round(bet.amount * (this.round.currentMultiplier || 1) * 100) / 100;
        bet.cashedOut = true;
        bet.payout = payout;
        this.activeBets.set(String(telegramId), bet);

        // Update user balance
        const user = await User.findOne({ telegramId: Number(telegramId) });
        if (user) {
          user.balance = (user.balance || 0) + payout;
          await user.save();
          await Transaction.create({ userId: user._id, type: 'cashout', amount: payout, meta: { telegramId, roundId: this.round.id } });
        }

        this.io.emit('game:cashOut', { telegramId, payout });
      } catch (err) {
        console.error('Cashout error:', err);
        socket.emit('error', { code: 'server_error', message: 'Server error cashing out.' });
      }
    });
  }

  async startLoop() {
    if (this.running) return;
    this.running = true;
    await this._startRound();
  }

  async stopLoop() {
    this.running = false;
    clearTimeout(this._roundTimeout);
    clearInterval(this._updateTimer);
  }

  async _startRound() {
    const serverSeed = generateServerSeed();
    const seedHash = hashServerSeed(serverSeed);

    this.round = {
      id: uuidv4(),
      serverSeed,
      seedHash,
      phase: 'betting',
      placedAt: Date.now(),
      currentMultiplier: 1,
      finalMultiplier: null
    };
    this.activeBets = new Map();

    this.io.emit('game:bettingPhase', { roundId: this.round.id, seedHash, betPhase: this.betPhaseDuration });

    this._roundTimeout = setTimeout(() => this._takeoff(), this.betPhaseDuration);
  }

  _takeoff() {
    if (!this.round) return;
    this.round.phase = 'running';
    const { multiplier } = computeCrashMultiplier(this.round.serverSeed, '');

    this.round.finalMultiplier = multiplier;
    this.io.emit('game:takeoff', { roundId: this.round.id });

    const startTs = Date.now();
    const duration = this.gameDuration;
    this.round.currentMultiplier = 1;

    this._updateTimer = setInterval(async () => {
      const elapsed = Date.now() - startTs;
      const progress = Math.min(1, elapsed / duration);
      const cur = 1 + (this.round.finalMultiplier - 1) * progress;
      this.round.currentMultiplier = Math.round(cur * 100) / 100;

      this.io.emit('game:multiplierUpdate', { roundId: this.round.id, multiplier: this.round.currentMultiplier });

      if (elapsed >= duration || this.round.currentMultiplier >= this.round.finalMultiplier) {
        clearInterval(this._updateTimer);
        this._crashRound();
      }
    }, this.updateIntervalMs);
  }

  async _crashRound() {
    const round = this.round;
    round.phase = 'crashed';
    round.crashedAt = new Date();

    this.io.emit('game:crashed', { roundId: round.id, finalMultiplier: round.finalMultiplier, serverSeed: round.serverSeed });

    try {
      await GameRound.create({
        roundId: round.id,
        serverSeedHash: hashServerSeed(round.serverSeed),
        serverSeed: round.serverSeed,
        finalMultiplier: round.finalMultiplier,
        crashedAt: round.crashedAt
      });
    } catch (err) {
      console.error('Failed to save round', err);
    }

    for (const [telegramId, bet] of this.activeBets.entries()) {
      try {
        const user = await User.findOne({ telegramId: Number(telegramId) });
        if (!user) continue;
        if (bet.cashedOut) {
          // Already credited on cashout
          await Transaction.create({ userId: user._id, type: 'win', amount: bet.payout, meta: { roundId: round.id, bet: bet.amount } });
        } else {
          await Transaction.create({ userId: user._id, type: 'loss', amount: bet.amount, meta: { roundId: round.id } });
        }
      } catch (err) {
        console.error('Error settling bet', err);
      }
    }

    setTimeout(() => this._startRound(), 3000);
  }
}

export default GameEngine;