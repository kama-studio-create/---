// Fixed admin authentication in routes/admin.js - replace the existing auth functions

import express from 'express';
import jwt from 'jsonwebtoken';
import { User, Withdraw, Deposit, Transaction, GameRound } from '../db/database.js';

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-jwt-key';
const ADMIN_SECRET = process.env.ADMIN_SECRET || 'admin123';

function adminAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    const token = req.query.token || (authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null);
    
    if (!token) {
      return res.status(401).json({ 
        success: false, 
        error: 'Access denied. No token provided.' 
      });
    }
    
    const decoded = jwt.verify(token, JWT_SECRET);
    if (!decoded || decoded.role !== 'admin') {
      return res.status(403).json({ 
        success: false, 
        error: 'Access denied. Admin privileges required.' 
      });
    }
    
    req.admin = decoded;
    next();
  } catch (err) {
    if (err.name === 'JsonWebTokenError') {
      return res.status(401).json({ 
        success: false, 
        error: 'Invalid token.' 
      });
    }
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ 
        success: false, 
        error: 'Token expired.' 
      });
    }
    return res.status(500).json({ 
      success: false, 
      error: 'Token verification failed.' 
    });
  }
}

// Admin login with proper validation
router.post('/login', async (req, res) => {
  try {
    const { secret } = req.body;
    
    if (!secret) {
      return res.status(400).json({ 
        success: false, 
        error: 'Admin secret is required' 
      });
    }
    
    if (secret !== ADMIN_SECRET) {
      return res.status(401).json({ 
        success: false, 
        error: 'Invalid admin credentials' 
      });
    }
    
    const token = jwt.sign(
      { 
        role: 'admin', 
        name: 'admin',
        loginTime: Date.now()
      }, 
      JWT_SECRET, 
      { expiresIn: '24h' }
    );
    
    res.json({ 
      success: true, 
      token,
      message: 'Admin login successful',
      expiresIn: '24h'
    });
    
  } catch (err) {
    console.error('Admin login error:', err);
    res.status(500).json({ 
      success: false, 
      error: 'Server error during login' 
    });
  }
});

// Verify token endpoint
router.get('/verify', adminAuth, (req, res) => {
  res.json({ 
    success: true, 
    admin: {
      role: req.admin.role,
      name: req.admin.name,
      loginTime: req.admin.loginTime
    },
    message: 'Token is valid' 
  });
});

// Dashboard stats
router.get('/stats', adminAuth, async (req, res) => {
  try {
    const [
      totalUsers,
      totalBets,
      totalWagered,
      pendingWithdraws,
      pendingDeposits,
      recentRounds
    ] = await Promise.all([
      User.countDocuments(),
      Transaction.countDocuments({ type: 'bet' }),
      Transaction.aggregate([
        { $match: { type: 'bet' } },
        { $group: { _id: null, total: { $sum: '$amount' } } }
      ]),
      Withdraw.countDocuments({ status: 'pending' }),
      Deposit.countDocuments({ status: 'pending' }),
      GameRound.find().sort({ createdAt: -1 }).limit(10).lean()
    ]);

    res.json({
      success: true,
      stats: {
        totalUsers,
        totalBets,
        totalWagered: totalWagered[0]?.total || 0,
        pendingWithdraws,
        pendingDeposits,
        recentRounds: recentRounds.length
      }
    });
  } catch (err) {
    console.error('Admin stats error:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch stats' });
  }
});

export default router;
export { adminAuth };