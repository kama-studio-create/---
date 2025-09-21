import { generateServerSeed, computeCrashMultiplier, hashServerSeed } from './ProvablyFair.js';
import { v4 as uuidv4 } from 'uuid';
import { User, Transaction, GameRound } from '../db/database.js';

class GameEngine {
  constructor({ io }) {
    this.io = io;
    this.running = false;
    this.round = null;
    this.betPhaseDuration = Number(process.env.BET_PHASE_DURATION) || 5000;
    this.updateIntervalMs = 50;
    this.activeBets = new Map();
    this.gameState = 'waiting';
    
    // Dynamic game parameters
    this.baseMultiplierSpeed = 0.02;
    this.maxMultiplier = 100;
    this.minGameDuration = 2000;
    this.maxGameDuration = 120000;
    
    // Statistics tracking
    this.roundStats = {
      totalRounds: 0,
      averageMultiplier: 0,
      recentMultipliers: []
    };

    console.log('🎮 GameEngine initialized');
}

  setupSocketHandlers() {
    this.io.on('connection', socket => {
        console.log('🎮 Game client connected:', socket.id);
        this.handleSocket(socket);
    });
  }

  handleSocket(socket) {
    socket.on('placeBet', async (data) => {
      try {
        const { telegramId, amount, clientSeed } = data;
        if (!this.round || this.round.phase !== 'betting') {
          return socket.emit('error', 'no_betting_phase');
        }
        if (!telegramId || !amount) {
          return socket.emit('error', 'invalid_bet');
        }

        // Validate user and balance in database
        const user = await User.findOne({ telegramId: Number(telegramId) });
        if (!user) {
          return socket.emit('error', 'user_not_found');
        }
        if (user.isBanned) {
          return socket.emit('error', 'user_banned');
        }
        if (user.balance < amount) {
          return socket.emit('error', 'insufficient_balance');
        }

        const minBet = Number(process.env.MIN_BET) || 10;
        const maxBet = Number(process.env.MAX_BET) || 10000;
        if (amount < minBet || amount > maxBet) {
          return socket.emit('error', 'invalid_bet_amount');
        }

        // Check if user already has a bet in this round
        if (this.activeBets.has(String(telegramId))) {
          return socket.emit('error', 'already_has_bet');
        }

        // Deduct balance and update user
        user.balance -= amount;
        user.totalBets = (user.totalBets || 0) + 1;
        user.totalWagered = (user.totalWagered || 0) + amount;
        await user.save();

        // Record bet transaction
        await Transaction.create({ 
          userId: user._id, 
          type: 'bet', 
          amount, 
          meta: { roundId: this.round.id } 
        });

        const bet = { 
          telegramId, 
          amount, 
          clientSeed: clientSeed || '', 
          placedAt: Date.now(), 
          cashedOut: false, 
          payout: 0,
          userId: user._id
        };
        
        this.activeBets.set(String(telegramId), bet);
        
        // Emit bet placed to all clients
        this.io.emit('game:betPlaced', { 
          telegramId, 
          amount, 
          username: user.username || user.firstName 
        });

        // Send success response to the betting user
        socket.emit('betPlaced', { 
          success: true, 
          newBalance: user.balance 
        });

      } catch (err) {
        console.error('Place bet error:', err);
        socket.emit('error', 'server_error');
      }
    });

    socket.on('cashOut', async (data) => {
      try {
        const { telegramId } = data;
        const bet = this.activeBets.get(String(telegramId));
        if (!bet) {
          return socket.emit('error', 'no_active_bet');
        }
        if (bet.cashedOut) {
          return socket.emit('error', 'already_cashed');
        }
        if (!this.round || this.round.phase !== 'running') {
          return socket.emit('error', 'not_running');
        }

        // Calculate payout
        const multiplier = this.round.currentMultiplier || 1;
        const payout = Math.round(bet.amount * multiplier * 100) / 100;
        
        // Update bet status
        bet.cashedOut = true;
        bet.payout = payout;
        bet.multiplier = multiplier;
        this.activeBets.set(String(telegramId), bet);

        // Update user balance in database
        const user = await User.findOne({ telegramId: Number(telegramId) });
        if (user) {
          user.balance = (user.balance || 0) + payout;
          user.totalWon = (user.totalWon || 0) + payout;
          await user.save();

          // Record cashout transaction
          await Transaction.create({ 
            userId: user._id, 
            type: 'win', 
            amount: payout, 
            meta: { 
              roundId: this.round.id, 
              betAmount: bet.amount,
              multiplier: multiplier
            } 
          });

          // Emit cashout to all clients
          this.io.emit('game:cashOut', { 
            telegramId, 
            payout,
            multiplier,
            username: user.username || user.firstName
          });

          // Send success response to the cashing out user
          socket.emit('cashedOut', { 
            success: true, 
            payout, 
            multiplier,
            newBalance: user.balance 
          });
        }

      } catch (err) {
        console.error('Cash out error:', err);
        socket.emit('error', 'server_error');
      }
    });
  }
 
  async startLoop() {
    if (this.running) return;
    this.running = true;
    console.log('🎮 Game engine started');
    
    // NOW attach socket handlers
    this.setupSocketHandlers();
    
    await this._startNewRound();
  }

  async stopLoop() {
    this.running = false;
    if (this._roundTimeout) clearTimeout(this._roundTimeout);
    if (this._updateTimer) clearInterval(this._updateTimer);
    console.log('🛑 Game engine stopped');
  }

  async _startNewRound() {
    if (!this.running) return;

    try {
      // Generate provably fair data
      const serverSeed = generateServerSeed();
      const seedHash = hashServerSeed(serverSeed);
      const { multiplier: targetMultiplier } = computeCrashMultiplier(serverSeed, '');

      // Create new round
      this.round = {
        id: uuidv4(),
        serverSeed,
        seedHash,
        targetMultiplier,
        currentMultiplier: 1.00,
        startTime: null,
        endTime: null,
        phase: 'betting',
        bettingStarted: Date.now()
      };

      // Clear previous bets
      this.activeBets.clear();
      this.gameState = 'betting';

      console.log(`🎯 Round ${this.round.id.slice(0, 8)} - Target: ${targetMultiplier.toFixed(2)}x`);

      // Notify clients about betting phase
      this.io.emit('game:bettingPhase', {
        roundId: this.round.id,
        seedHash: this.round.seedHash,
        bettingDuration: this.betPhaseDuration,
        timestamp: Date.now()
      });

      // Start flight after betting period
      this._roundTimeout = setTimeout(() => {
        this._startFlight();
      }, this.betPhaseDuration);

    } catch (error) {
      console.error('Error starting round:', error);
      // Retry after short delay
      setTimeout(() => this._startNewRound(), 2000);
    }
  }

  _startFlight() {
    if (!this.round || !this.running) return;

    this.round.phase = 'running';
    this.round.startTime = Date.now();
    this.gameState = 'flying';

    console.log(`🛫 Flight started - Round ${this.round.id.slice(0, 8)}`);

    // Notify clients
    this.io.emit('game:takeoff', {
      roundId: this.round.id,
      timestamp: this.round.startTime,
      targetMultiplier: this.round.targetMultiplier
    });

    // Start multiplier updates
    this._updateTimer = setInterval(() => {
      this._updateMultiplier();
    }, this.updateIntervalMs);
  }

  _updateMultiplier() {
    if (!this.round || this.gameState !== 'flying') return;

    const elapsed = Date.now() - this.round.startTime;
    
    // Dynamic speed calculation based on target multiplier
    const progressRatio = this._calculateProgress(elapsed);
    const newMultiplier = 1 + (this.round.targetMultiplier - 1) * progressRatio;
    
    this.round.currentMultiplier = Math.min(newMultiplier, this.round.targetMultiplier);

    // Broadcast update
    this.io.emit('game:multiplierUpdate', {
      roundId: this.round.id,
      multiplier: this.round.currentMultiplier,
      timestamp: Date.now()
    });

    // Check if we should crash
    if (this.round.currentMultiplier >= this.round.targetMultiplier * 0.999) {
      this._crashGame();
    }
  }

  _calculateProgress(elapsed) {
    // Dynamic curve based on target multiplier
    const { targetMultiplier } = this.round;
    
    // Lower multipliers = faster crash, higher multipliers = longer flight
    const baseDuration = this.minGameDuration + 
      Math.log(targetMultiplier) * 3000 + 
      Math.random() * 2000; // Add randomness
    
    const progress = elapsed / baseDuration;
    
    // Use exponential curve for realistic acceleration
    return Math.min(1, Math.pow(progress, 0.5 + Math.random() * 0.3));
  }

  async _crashGame() {
    if (!this.round || this.gameState !== 'flying') return;

    try {
      // Stop updates
      if (this._updateTimer) {
        clearInterval(this._updateTimer);
        this._updateTimer = null;
      }

      this.round.phase = 'crashed';
      this.round.endTime = Date.now();
      this.gameState = 'crashed';
      
      const finalMultiplier = this.round.targetMultiplier;
      const roundDuration = this.round.endTime - this.round.startTime;

      console.log(`💥 Crashed at ${finalMultiplier.toFixed(2)}x after ${roundDuration}ms`);

      // Update statistics
      this._updateStats(finalMultiplier);

      // Save round to database
      await GameRound.create({
        roundId: this.round.id,
        serverSeedHash: this.round.seedHash,
        serverSeed: this.round.serverSeed,
        finalMultiplier: finalMultiplier,
        crashedAt: this.round.endTime,
        duration: roundDuration,
        totalBets: this.activeBets.size,
        totalWagered: Array.from(this.activeBets.values()).reduce((sum, bet) => sum + bet.amount, 0)
      });

      // Notify clients with crashPoint property (frontend expects this)
      this.io.emit('game:crashed', {
        roundId: this.round.id,
        finalMultiplier: finalMultiplier,
        crashPoint: finalMultiplier,
        serverSeed: this.round.serverSeed,
        duration: roundDuration,
        timestamp: this.round.endTime
      });

      // Process losing bets
      await this._processLosingBets();

      // Start next round after delay
      setTimeout(() => {
        if (this.running) {
          this._startNewRound();
        }
      }, 3000);

    } catch (error) {
      console.error('Error in crash sequence:', error);
      // Ensure we continue with next round
      setTimeout(() => {
        if (this.running) {
          this._startNewRound();
        }
      }, 5000);
    }
  }

  async _processLosingBets() {
    const losingBets = Array.from(this.activeBets.values()).filter(bet => !bet.cashedOut);
    
    console.log(`💸 Processing ${losingBets.length} losing bets`);

    for (const bet of losingBets) {
      try {
        await Transaction.create({
          userId: bet.userId,
          type: 'loss',
          amount: bet.amount,
          meta: {
            roundId: this.round.id,
            finalMultiplier: this.round.targetMultiplier
          }
        });
      } catch (error) {
        console.error('Error processing losing bet:', error);
      }
    }
  }

  _updateStats(multiplier) {
    this.roundStats.totalRounds++;
    this.roundStats.recentMultipliers.unshift(multiplier);
    
    // Keep only last 100 rounds
    if (this.roundStats.recentMultipliers.length > 100) {
      this.roundStats.recentMultipliers.pop();
    }
    
    // Calculate average
    this.roundStats.averageMultiplier = 
      this.roundStats.recentMultipliers.reduce((sum, m) => sum + m, 0) / 
      this.roundStats.recentMultipliers.length;
  }

  // Get current game statistics
  getStats() {
    return {
      ...this.roundStats,
      activeBets: this.activeBets.size,
      currentRound: this.round?.id,
      gameState: this.gameState,
      uptime: process.uptime()
    };
  }

  // Admin functions
  async forceEndRound() {
    if (this.gameState === 'flying' && this.round) {
      console.log('🛑 Admin forced round end');
      await this._crashGame();
    }
  }

  async adjustMultiplier(newTarget) {
    if (this.gameState === 'flying' && this.round) {
      this.round.targetMultiplier = Math.max(1.01, Math.min(100, newTarget));
      console.log(`🎛️ Admin adjusted target to ${this.round.targetMultiplier}x`);
    }
  }
}

export default GameEngine;