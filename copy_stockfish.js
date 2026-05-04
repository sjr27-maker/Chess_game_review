/**
 * Copies Stockfish files from node_modules into assets/stockfish/
 * so the app works offline and survives node_modules deletion.
 * Run automatically via: npm install (postinstall hook)
 */
const fs   = require('fs');
const path = require('path');

const src  = path.join(__dirname, '..', 'node_modules', 'stockfish', 'src');
const dest = path.join(__dirname, '..', 'assets', 'stockfish');

if (!fs.existsSync(src)) {
  console.warn('[copy-stockfish] stockfish not in node_modules yet, skipping.');
  process.exit(0);
}

fs.mkdirSync(dest, { recursive: true });

const files = fs.readdirSync(src).filter(f =>
  f.endsWith('.js') || f.endsWith('.wasm')
);

for (const file of files) {
  fs.copyFileSync(path.join(src, file), path.join(dest, file));
  console.log(`[copy-stockfish] copied ${file}`);
}

console.log('[copy-stockfish] done → assets/stockfish/');