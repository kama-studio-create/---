import express from 'express';
import jwt from 'jsonwebtoken';
import { User, Withdraw, Deposit, Transaction, GameRound } from '../db/database.js';

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'dev_jwt_secret';
const ADMIN_SECRET = process.env.ADMIN_SECRET || 'admin_secret';

function adminAuth(req, res, next) {
  const hdr = req.headers.authorization || req.query.token;
  if (!hdr) return res.status(401).json({ ok: false, error: 'missing_auth' });
  const token = hdr.split ? (hdr.split(' ')[1] || hdr) : hdr;
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (!payload || payload.role !== 'admin') return res.status(403).json({ ok: false, error: 'forbidden' });
    req.admin = payload;
    next();
  } catch (err) {
    return res.status(401).json({ ok: false, error: 'invalid_token' });
  }
}

router.post('/login', (req, res) => {
  const { secret } = req.body;
  if (!secret || secret !== ADMIN_SECRET) return res.status(401).json({ ok: false, error: 'invalid' });
  const token = jwt.sign({ role: 'admin', name: 'admin' }, JWT_SECRET, { expiresIn: '12h' });
  res.json({ ok: true, token });
});

router.get('/users', adminAuth, async (req, res) => {
  const users = await User.find().limit(500).lean();
  res.json({ ok: true, users });
});

router.get('/withdraws', adminAuth, async (req, res) => {
  const requests = await Withdraw.find().populate('userId', 'telegramId username balance').sort({ createdAt: -1 }).lean();
  res.json({ ok: true, requests });
});

router.post('/withdraw/:id/approve', adminAuth, async (req, res) => {
  try {
    const reqId = req.params.id;
    const request = await Withdraw.findById(reqId).populate('userId');
    if (!request) return res.status(404).json({ ok: false, error: 'not_found' });
    if (request.status !== 'pending') return res.status(400).json({ ok: false, error: 'not_pending' });

    request.status = 'approved';
    await request.save();

    await Transaction.create({ userId: request.userId._id, type: 'withdraw_approved', amount: request.amount, meta: { withdrawId: request._id } });

    res.json({ ok: true, message: 'withdraw_approved' });
  } catch (err) {
    console.error('approve withdraw err', err);
    res.status(500).json({ ok: false, error: 'server_error' });
  }
});

router.post('/withdraw/:id/deny', adminAuth, async (req, res) => {
  try {
    const reqId = req.params.id;
    const request = await Withdraw.findById(reqId).populate('userId');
    if (!request) return res.status(404).json({ ok: false, error: 'not_found' });
    if (request.status !== 'pending') return res.status(400).json({ ok: false, error: 'not_pending' });

    request.status = 'denied';
    await request.save();

    const user = request.userId;
    user.balance = (user.balance || 0) + request.amount;
    await user.save();

    await Transaction.create({ userId: user._id, type: 'withdraw_denied_refund', amount: request.amount, meta: { withdrawId: request._id } });

    res.json({ ok: true, message: 'withdraw_denied_and_refunded' });
  } catch (err) {
    console.error('deny withdraw err', err);
    res.status(500).json({ ok: false, error: 'server_error' });
  }
});

router.get('/deposits', adminAuth, async (req, res) => {
  const requests = await Deposit.find().populate('userId', 'telegramId username balance').sort({ createdAt: -1 }).lean();
  res.json({ ok: true, requests });
});

router.post('/deposit/:id/approve', adminAuth, async (req, res) => {
  try {
    const id = req.params.id;
    const deposit = await Deposit.findById(id).populate('userId');
    if (!deposit) return res.status(404).json({ ok: false, error: 'not_found' });
    if (deposit.status !== 'pending') return res.status(400).json({ ok: false, error: 'not_pending' });

    deposit.status = 'approved';
    await deposit.save();

    const user = deposit.userId;
    user.balance = (user.balance || 0) + deposit.amount;
    await user.save();

    await Transaction.create({ userId: user._id, type: 'deposit_approved', amount: deposit.amount, meta: { depositId: deposit._id } });

    res.json({ ok: true, message: 'deposit_approved' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: 'server_error' });
  }
});

router.post('/deposit/:id/deny', adminAuth, async (req, res) => {
  try {
    const id = req.params.id;
    const deposit = await Deposit.findById(id);
    if (!deposit) return res.status(404).json({ ok: false, error: 'not_found' });
    if (deposit.status !== 'pending') return res.status(400).json({ ok: false, error: 'not_pending' });

    deposit.status = 'denied';
    await deposit.save();
    res.json({ ok: true, message: 'deposit_denied' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: 'server_error' });
  }
});

router.get('/transactions', adminAuth, async (req, res) => {
  const tx = await Transaction.find().sort({ createdAt: -1 }).limit(500).populate('userId', 'telegramId username').lean();
  res.json({ ok: true, transactions: tx });
});

router.get('/rounds', adminAuth, async (req, res) => {
  const rounds = await GameRound.find().sort({ createdAt: -1 }).limit(200).lean();
  res.json({ ok: true, rounds });
});

router.post('/users/:id/ban', adminAuth, async (req, res) => {
  const id = req.params.id;
  const user = await User.findById(id);
  if (!user) return res.status(404).json({ ok: false, error: 'not_found' });
  user.isBanned = true;
  await user.save();
  res.json({ ok: true, message: 'banned' });
});

router.post('/users/:id/unban', adminAuth, async (req, res) => {
  const id = req.params.id;
  const user = await User.findById(id);
  if (!user) return res.status(404).json({ ok: false, error: 'not_found' });
  user.isBanned = false;
  await user.save();
  res.json({ ok: true, message: 'unbanned' });
});

export default router;