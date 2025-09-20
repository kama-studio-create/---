import TelegramBotLib from 'node-telegram-bot-api';
import { User, Withdraw } from '../db/database.js';

let bot = null;

function init(token) {
  if (!token) {
    console.warn('BOT_TOKEN not provided; telegram bot disabled');
    return;
  }
  bot = new TelegramBotLib(token, { polling: true });

  bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const telegramId = chatId;
    const username = msg.from.username;
    const firstName = msg.from.first_name;
    const lastName = msg.from.last_name;

    let user = await User.findOne({ telegramId });
    if (!user) {
      user = await User.create({ telegramId, username, firstName, lastName });
    }
    bot.sendMessage(chatId, `Welcome ${firstName || username}! Your balance: ${user.balance}`);
  });

  bot.onText(/\/balance/, async (msg) => {
    const telegramId = msg.chat.id;
    const user = await User.findOne({ telegramId });
    if (!user) return bot.sendMessage(msg.chat.id, 'You are not registered. Send /start');
    bot.sendMessage(msg.chat.id, `Balance: ${user.balance}`);
  });

  bot.onText(/\/withdraws/, async (msg) => {
    if (msg.from.username !== process.env.ADMIN_TELEGRAM_USERNAME) return;
    const pending = await Withdraw.find({ status: 'pending' }).populate('userId', 'telegramId username');
    const txt = pending.map(p => `${p._id}: ${p.userId.username || p.userId.telegramId} - ${p.amount}`).join('\n') || 'no pending';
    bot.sendMessage(msg.chat.id, `Pending withdraws:\n${txt}`);
  });

  bot.on('polling_error', console.error);
}

export { init };
export const botRef = () => bot;