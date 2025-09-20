import express from 'express';
import { User, Withdraw, Deposit, Transaction } from '../db/database.js';

const router = express.Router();

// register/upsert user
router.post('/register', async (req, res) => {
  try {
    const { telegramId, username, firstName, lastName } = req.body;
    if (!telegramId) return res.status(400).json({ ok: false, error: 'telegramId required' });

    let user = await User.findOne({ telegramId });
    if (!user) {
      user = await User.create({ telegramId, username, firstName, lastName });
    } else {
      user.username = username || user.username;
      user.firstName = firstName || user.firstName;
      user.lastName = lastName || user.lastName;
      user.lastActive = new Date();
      await user.save();
    }
    res.json({ ok: true, user });
  } catch (err) {
    console.error('register error', err);
    res.status(500).json({ ok: false, error: 'server_error' });
  }
});

// profile
router.get('/profile/:id', async (req, res) => {
  try {
    const telegramId = Number(req.params.id);
    const user = await User.findOne({ telegramId });
    if (!user) return res.status(404).json({ ok: false, error: 'not_found' });
    res.json({ ok: true, user });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'server_error' });
  }
});

// bet (REST)
router.post('/bet', async (req, res) => {
  try {
    const { telegramId, amount } = req.body;
    if (!telegramId || !amount) return res.status(400).json({ ok: false, error: 'invalid' });

    const user = await User.findOne({ telegramId });
    if (!user) return res.status(404).json({ ok: false, error: 'user_not_found' });
    if (user.isBanned) return res.status(403).json({ ok: false, error: 'banned' });
    if (amount > user.balance) return res.status(400).json({ ok: false, error: 'insufficient' });

    user.balance -= amount;
    user.totalBets = (user.totalBets || 0) + 1;
    user.totalWagered = (user.totalWagered || 0) + amount;
    await user.save();

    await Transaction.create({ userId: user._id, type: 'bet', amount, meta: {} });

    res.json({ ok: true, balance: user.balance });
  } catch (err) {
    console.error('bet error', err);
    res.status(500).json({ ok: false, error: 'server_error' });
  }
});

// cashout (REST)
router.post('/cashout', async (req, res) => {
  try {
    const { telegramId, payout } = req.body;
    if (!telegramId || payout == null) return res.status(400).json({ ok: false, error: 'invalid' });

    const user = await User.findOne({ telegramId });
    if (!user) return res.status(404).json({ ok: false, error: 'not_found' });

    user.balance = (user.balance || 0) + Number(payout);
    await user.save();

    await Transaction.create({ userId: user._id, type: 'cashout', amount: payout, meta: {} });

    res.json({ ok: true, balance: user.balance });
  } catch (err) {
    console.error('cashout error', err);
    res.status(500).json({ ok: false, error: 'server_error' });
  }
});

// withdraw request
router.post('/withdraw', async (req, res) => {
  try {
    const { telegramId, amount, method, reference } = req.body;
    if (!telegramId || !amount) return res.status(400).json({ ok: false, error: 'invalid' });
    const user = await User.findOne({ telegramId });
    if (!user) return res.status(404).json({ ok: false, error: 'user_not_found' });
    if (user.balance < amount) return res.status(400).json({ ok: false, error: 'insufficient' });

    user.balance -= amount;
    await user.save();

    const withdraw = await Withdraw.create({ userId: user._id, amount, method, reference });
    await Transaction.create({ userId: user._id, type: 'withdraw_request', amount, meta: { withdrawId: withdraw._id } });

    res.json({ ok: true, message: 'withdraw_requested', request: withdraw });
  } catch (err) {
    console.error('withdraw error', err);
    res.status(500).json({ ok: false, error: 'server_error' });
  }
});

// deposit request
router.post('/deposit', async (req, res) => {
  try {
    const { telegramId, amount, reference } = req.body;
    if (!telegramId || !amount) return res.status(400).json({ ok: false, error: 'invalid' });
    const user = await User.findOne({ telegramId });
    if (!user) return res.status(404).json({ ok: false, error: 'user_not_found' });

    const deposit = await Deposit.create({ userId: user._id, amount, reference });
    await Transaction.create({ userId: user._id, type: 'deposit_request', amount, meta: { depositId: deposit._id } });

    res.json({ ok: true, message: 'deposit_requested', request: deposit });
  } catch (err) {
    console.error('deposit error', err);
    res.status(500).json({ ok: false, error: 'server_error' });
  }
});

// history
router.get('/history/:telegramId', async (req, res) => {
  try {
    const telegramId = Number(req.params.telegramId);
    const user = await User.findOne({ telegramId });
    if (!user) return res.status(404).json({ ok: false, error: 'user_not_found' });
    const tx = await Transaction.find({ userId: user._id }).sort({ createdAt: -1 }).limit(200).lean();
    res.json({ ok: true, history: tx });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'server_error' });
  }
});

// leaderboard
router.get('/leaderboard', async (req, res) => {
  try {
    const top = await User.find().sort({ totalWon: -1 }).limit(10).select('username telegramId totalWon balance').lean();
    res.json({ ok: true, leaderboard: top });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'server_error' });
  }
});

export default router;