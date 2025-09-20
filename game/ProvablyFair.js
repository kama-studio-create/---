import crypto from 'crypto';

export function generateServerSeed() {
  return crypto.randomBytes(32).toString('hex');
}

export function hashServerSeed(seed) {
  return crypto.createHash('sha256').update(seed).digest('hex');
}

export function computeCrashMultiplier(serverSeed, clientSeed = '') {
  const hmac = crypto.createHmac('sha256', serverSeed).update(clientSeed).digest('hex');
  const num = parseInt(hmac.slice(0, 13), 16);
  const e = num / Math.pow(16, 13);
  const raw = Math.max(1.0, (1.0 / (1.0 - e)));
  let multiplier = Math.min(raw, 1000);
  multiplier = Math.round(multiplier * 100) / 100;
  return { multiplier, hmac, serverSeedHash: hashServerSeed(serverSeed) };
}