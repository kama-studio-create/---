import mongoose from "mongoose";

let User, Withdraw, Deposit, Transaction, Settings, GameRound;

export const connectDB = async () => {
  const useDb = process.env.USE_DB !== "false"; // default true
  if (!useDb) {
    console.log("⚠️ Skipping MongoDB (USE_DB=false). Running in demo mode.");
    createStubs();
    return;
  }

  try {
    const mongoURI = process.env.MONGODB_URI || process.env.DATABASE_URL;
    if (!mongoURI) {
      throw new Error("MONGODB_URI or DATABASE_URL not found in .env");
    }

    console.log("Connecting to MongoDB...");
    await mongoose.connect(mongoURI);
    console.log("✅ MongoDB connected successfully!");

    // Define schemas only if DB is active
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

    const withdrawSchema = new mongoose.Schema({
      userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      amount: Number,
      method: String,
      reference: String,
      status: { type: String, enum: ["pending", "approved", "denied"], default: "pending" },
    }, { timestamps: true });

    const depositSchema = new mongoose.Schema({
      userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      amount: Number,
      reference: String,
      status: { type: String, enum: ["pending", "approved", "denied"], default: "pending" },
    }, { timestamps: true });

    const transactionSchema = new mongoose.Schema({
      userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      type: { type: String, enum: ["bet", "win", "deposit", "withdraw", "cashout", "loss"], required: true },
      amount: Number,
      meta: { type: mongoose.Schema.Types.Mixed, default: {} },
    }, { timestamps: true });

    const settingsSchema = new mongoose.Schema({
      minBet: { type: Number, default: 1 },
      maxBet: { type: Number, default: 1000 },
      crashMultiplier: { type: Number, default: 2 },
    }, { timestamps: true });

    const gameRoundSchema = new mongoose.Schema({
      roundId: { type: String, required: true, unique: true },
      serverSeedHash: String,
      serverSeed: String,
      finalMultiplier: Number,
      crashedAt: Date,
    }, { timestamps: true });

    // Register models
    User = mongoose.model("User", userSchema);
    Withdraw = mongoose.model("Withdraw", withdrawSchema);
    Deposit = mongoose.model("Deposit", depositSchema);
    Transaction = mongoose.model("Transaction", transactionSchema);
    Settings = mongoose.model("Settings", settingsSchema);
    GameRound = mongoose.model("GameRound", gameRoundSchema);

  } catch (error) {
    console.error("❌ DB connect error:", error.message);
    console.log("⚠️ Falling back to demo mode (no DB).");
    createStubs();
  }
};

function createStubs() {
  const stub = {
    findOne: async () => null,
    create: async () => null,
    save: async () => null,
  };
  User = Withdraw = Deposit = Transaction = Settings = GameRound = stub;
}

export { User, Withdraw, Deposit, Transaction, Settings, GameRound };
