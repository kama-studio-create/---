// db/database.js
import mongoose from "mongoose";

// User Schema
const userSchema = new mongoose.Schema({
  telegramId: { type: String, required: true, unique: true },
  username: String,
  firstName: String,
  lastName: String,
  balance: { type: Number, default: 0 },
  referralCode: String,
  referredBy: String,
  totalBets: { type: Number, default: 0 },
  totalWagered: { type: Number, default: 0 },
  totalWon: { type: Number, default: 0 },
  isBanned: { type: Boolean, default: false },
  lastActive: { type: Date, default: Date.now },
}, { timestamps: true });

// Withdraw Schema
const withdrawSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  amount: Number,
  method: String,
  reference: String,
  status: { type: String, enum: ["pending", "approved", "denied"], default: "pending" },
}, { timestamps: true });

// Deposit Schema
const depositSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  amount: Number,
  reference: String,
  status: { type: String, enum: ["pending", "approved", "denied"], default: "pending" },
}, { timestamps: true });

// Transaction Schema
const transactionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  type: { type: String, enum: ["bet", "win", "deposit", "withdraw", "cashout", "loss", "withdraw_approved", "withdraw_denied_refund", "deposit_approved", "deposit_request", "withdraw_request"], required: true },
  amount: Number,
  meta: { type: mongoose.Schema.Types.Mixed, default: {} },
}, { timestamps: true });

// Settings Schema (admin can change game params)
const settingsSchema = new mongoose.Schema({
  minBet: { type: Number, default: 1 },
  maxBet: { type: Number, default: 1000 },
  crashMultiplier: { type: Number, default: 2 },
}, { timestamps: true });

// GameRound Schema (for storing game results)
const gameRoundSchema = new mongoose.Schema({
  roundId: { type: String, required: true, unique: true },
  serverSeedHash: String,
  serverSeed: String,
  finalMultiplier: Number,
  crashedAt: Date,
}, { timestamps: true });

// Register models
export const User = mongoose.model("User", userSchema);
export const Withdraw = mongoose.model("Withdraw", withdrawSchema);
export const Deposit = mongoose.model("Deposit", depositSchema);
export const Transaction = mongoose.model("Transaction", transactionSchema);
export const Settings = mongoose.model("Settings", settingsSchema);
export const GameRound = mongoose.model("GameRound", gameRoundSchema);

// Connection function
export const connectDB = async () => {
  try {
    // Check if environment variable is defined
    const mongoURI = process.env.MONGODB_URI || process.env.DATABASE_URL;
    
    if (!mongoURI) {
      throw new Error('MONGODB_URI or DATABASE_URL environment variable is not defined in .env file');
    }
    
    console.log('Connecting to MongoDB...');
    await mongoose.connect(mongoURI);
    console.log("✅ MongoDB connected successfully!");
  } catch (error) {
    console.error("❌ DB connect error:", error.message);
    process.exit(1);
  }
};