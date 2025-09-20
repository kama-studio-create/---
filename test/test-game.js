const { generateServerSeed, computeCrashMultiplier } = require('../game/ProvablyFair');

const seed = generateServerSeed();
const r = computeCrashMultiplier(seed, '');
console.log('seedHash:', r.serverSeedHash, 'multiplier:', r.multiplier);
if (r.multiplier >= 1) {
  console.log('Provably-fair test OK');
  process.exit(0);
} else {
  console.error('Provably-fair failed');
  process.exit(2);
}
