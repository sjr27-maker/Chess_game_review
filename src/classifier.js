/**
 * classifier.js
 * Classifies moves based on centipawn loss (eval diff before/after move).
 */

export const CLASSIFICATION = {
  BRILLIANT: 'brilliant',
  GREAT:     'great',
  BEST:      'best',
  GOOD:      'good',
  INACCURACY:'inaccuracy',
  MISTAKE:   'mistake',
  MISS:      'miss',
  BLUNDER:   'blunder',
};

export const CLASS_META = {
  brilliant:  { label: 'Brilliant',  symbol: '!!', color: '#1baca6' },
  great:      { label: 'Great',      symbol: '!',  color: '#5c8bb0' },
  best:       { label: 'Best',       symbol: '★',  color: '#6fba3b' },
  good:       { label: 'Good',       symbol: '✓',  color: '#97b0c0' },
  inaccuracy: { label: 'Inaccuracy', symbol: '?!', color: '#e8c44a' },
  mistake:    { label: 'Mistake',    symbol: '?',  color: '#e87a20' },
  miss:       { label: 'Miss',       symbol: '✗',  color: '#e87a20' },
  blunder:    { label: 'Blunder',    symbol: '??', color: '#ca3431' },
};

export function classifyMove(evalBefore, evalAfter, wasBestMove) {
  const loss = evalBefore - evalAfter;

  if (wasBestMove || loss <= 10)  return CLASSIFICATION.BEST;
  if (loss < 0)                   return CLASSIFICATION.GREAT;
  if (loss <= 25)                 return CLASSIFICATION.GOOD;
  if (loss <= 50)                 return CLASSIFICATION.INACCURACY;
  if (loss <= 100)                return CLASSIFICATION.MISTAKE;
  if (loss <= 200)                return CLASSIFICATION.MISS;
  return CLASSIFICATION.BLUNDER;
}

export function computeAccuracy(cpLosses) {
  if (!cpLosses.length) return 100;
  const losses = cpLosses.map(l => Math.max(0, l));
  const avgLoss = losses.reduce((a, b) => a + b, 0) / losses.length;
  return Math.max(0, Math.min(100, Math.round((103.1668 * Math.exp(-0.04354 * avgLoss) - 3.1669) * 10) / 10));
}

export function getPhase(moveNum, totalMoves) {
  if (moveNum <= 10) return 'opening';
  if (moveNum >= totalMoves - 8) return 'endgame';
  return 'middlegame';
}

export function phaseAccuracy(moves) {
  const phases = { opening: [], middlegame: [], endgame: [] };
  const total = moves.length;
  moves.forEach((m, i) => {
    const phase = getPhase(Math.ceil((i + 1) / 2), Math.ceil(total / 2));
    if (m.cpLoss !== undefined) phases[phase].push(m.cpLoss);
  });
  const result = {};
  for (const [phase, losses] of Object.entries(phases)) {
    result[phase] = losses.length > 0 ? computeAccuracy(losses) : null;
  }
  return result;
}