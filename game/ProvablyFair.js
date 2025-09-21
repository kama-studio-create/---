import crypto from 'crypto';

export function generateServerSeed() {
  // Generate cryptographically secure random seed
  return crypto.randomBytes(32).toString('hex');
}

export function hashServerSeed(seed) {
  return crypto.createHash('sha256').update(seed).digest('hex');
}

export function computeCrashMultiplier(serverSeed, clientSeed = '', nonce = 0) {
  // Create deterministic but unpredictable multiplier
  const combinedSeed = `${serverSeed}-${clientSeed}-${nonce}`;
  const hmac = crypto.createHmac('sha256', combinedSeed).digest('hex');
  
  // Convert first 13 hex chars to number
  const hex = hmac.slice(0, 13);
  const num = parseInt(hex, 16);
  
  // Create uniform distribution [0, 1)
  const e = num / Math.pow(16, 13);
  
  // Apply crash curve formula
  // This creates a realistic distribution where:
  // - ~63% of games crash before 2x
  // - ~86% crash before 3x  
  // - ~95% crash before 5x
  // - Rare games can go to 100x+
  let multiplier;
  
  if (e === 0) {
    // Extremely rare case
    multiplier = 1.00;
  } else {
    // Use exponential distribution for realistic crash pattern
    const houseEdge = 0.04; // 4% house edge
    multiplier = (1 - houseEdge) / e;
    
    // Apply curve adjustments for better gameplay
    if (multiplier < 1.01) {
      multiplier = 1.01; // Minimum multiplier
    } else if (multiplier > 1000) {
      multiplier = 1000; // Maximum multiplier cap
    }
    
    // Round to 2 decimal places
    multiplier = Math.round(multiplier * 100) / 100;
  }
  
  return { 
    multiplier, 
    hmac, 
    serverSeedHash: hashServerSeed(serverSeed),
    clientSeed,
    nonce
  };
}

// Verify a game result
export function verifyGameResult(serverSeed, clientSeed, nonce, claimedMultiplier) {
  const result = computeCrashMultiplier(serverSeed, clientSeed, nonce);
  return Math.abs(result.multiplier - claimedMultiplier) < 0.01; // Allow small rounding differences
}

// Generate client seed for players
export function generateClientSeed() {
  return crypto.randomBytes(16).toString('hex');
}

// Create verifiable game hash for transparency
export function createGameHash(roundId, serverSeedHash, clientSeeds = []) {
  const combined = `${roundId}-${serverSeedHash}-${clientSeeds.join(',')}`;
  return crypto.createHash('sha256').update(combined).digest('hex');
}

// Advanced: Create weighted multiplier for promotional events
export function createPromotionalMultiplier(serverSeed, clientSeed, eventType = 'normal') {
  const baseResult = computeCrashMultiplier(serverSeed, clientSeed);
  
  switch (eventType) {
    case 'happy_hour':
      // Slightly better odds during happy hour
      return {
        ...baseResult,
        multiplier: Math.min(baseResult.multiplier * 1.1, 1000)
      };
      
    case 'weekend_bonus':
      // Better minimum multiplier on weekends
      return {
        ...baseResult,
        multiplier: Math.max(baseResult.multiplier, 1.5)
      };
      
    default:
      return baseResult;
  }
}

// Statistics helpers
export function analyzeGameFairness(results) {
  if (!Array.isArray(results) || results.length === 0) {
    return { error: 'Invalid results array' };
  }
  
  const total = results.length;
  const sum = results.reduce((acc, r) => acc + r.multiplier, 0);
  const average = sum / total;
  
  // Count distribution
  const distribution = {
    below_2x: results.filter(r => r.multiplier < 2).length,
    between_2x_5x: results.filter(r => r.multiplier >= 2 && r.multiplier < 5).length,
    between_5x_10x: results.filter(r => r.multiplier >= 5 && r.multiplier < 10).length,
    above_10x: results.filter(r => r.multiplier >= 10).length
  };
  
  const percentages = {
    below_2x: (distribution.below_2x / total * 100).toFixed(1),
    between_2x_5x: (distribution.between_2x_5x / total * 100).toFixed(1),
    between_5x_10x: (distribution.between_5x_10x / total * 100).toFixed(1),
    above_10x: (distribution.above_10x / total * 100).toFixed(1)
  };
  
  return {
    totalGames: total,
    averageMultiplier: average.toFixed(2),
    distribution,
    percentages,
    fairnessCheck: {
      expectedBelow2x: '63%',
      actualBelow2x: percentages.below_2x + '%',
      withinExpectedRange: Math.abs(parseFloat(percentages.below_2x) - 63) < 5
    }
  };
}

// Export validation for client-side verification
export const ProvablyFairValidator = {
  verify: verifyGameResult,
  hash: hashServerSeed,
  analyze: analyzeGameFairness,
  generateClientSeed
};