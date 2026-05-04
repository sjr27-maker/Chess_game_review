/**
 * engine.js — Stockfish WASM wrapper with batch analysis support
 */

export class StockfishEngine {
  constructor() {
    this.ready = false;
    this.worker = null;
    this.onEval = null;
    this.onReady = null;
    this.onBestMove = null;
    this._init();
  }

  _init() {
    const workerCode = `
      const base = self.location.href.replace(/\/src\/.*$/, '');
      importScripts(base + '/assets/stockfish/stockfish.js');
      var sf;
      Stockfish().then(function(inst) {
        sf = inst;
        sf.addMessageListener(function(msg) { postMessage(msg); });
        postMessage('__ready__');
      });
      onmessage = function(e) { if (sf) sf.postMessage(e.data); };
    `;
    const blob = new Blob([workerCode], { type: 'application/javascript' });
    this.worker = new Worker(URL.createObjectURL(blob));
    this.worker.onmessage = (e) => this._handleMessage(e.data);
    this.worker.onerror = (e) => console.error('[Stockfish]', e);
  }

  _handleMessage(msg) {
    if (msg === '__ready__' || msg === 'readyok') {
      this.ready = true;
      if (this.onReady) this.onReady();
      return;
    }

    if (msg.startsWith('info') && msg.includes('score')) {
      const depthM = msg.match(/depth (\d+)/);
      const cpM    = msg.match(/score cp (-?\d+)/);
      const mateM  = msg.match(/score mate (-?\d+)/);
      const pvM    = msg.match(/ pv ([a-h][1-8][a-h][1-8][qrbn]?)/);

      const depth    = depthM ? parseInt(depthM[1]) : 0;
      const bestMove = pvM ? pvM[1] : null;
      let evalScore;

      if (mateM) {
        const m = parseInt(mateM[1]);
        evalScore = m > 0 ? 9999 : -9999;
      } else if (cpM) {
        evalScore = parseInt(cpM[1]);
      } else return;

      if (this.onEval) this.onEval({ evalCp: evalScore, depth, bestMove });
    }

    if (msg.startsWith('bestmove')) {
      const bm = msg.split(' ')[1];
      if (this.onBestMove) this.onBestMove(bm);
    }
  }

  send(cmd) { if (this.worker) this.worker.postMessage(cmd); }

  analyzePosition(fen, depth = 18) {
    this.send('stop');
    this.send('ucinewgame');
    this.send(`position fen ${fen}`);
    this.send(`go depth ${depth}`);
  }

  stop() { this.send('stop'); }
  destroy() { this.stop(); if (this.worker) this.worker.terminate(); }
}

/**
 * BatchAnalyzer: analyzes all positions in a game sequentially
 * Emits onProgress(moveIdx, evalCp, bestMoveUCI) for each position
 * Emits onComplete(evals[]) when done
 */
export class BatchAnalyzer {
  constructor(engine) {
    this.engine = engine;
    this.onProgress = null;  // (idx, evalCp, bestMove) => void
    this.onComplete = null;  // (evals) => void
    this._queue = [];
    this._results = [];
    this._current = -1;
    this._depth = 16;
    this._running = false;
  }

  analyze(fens, depth = 16) {
    this._queue = fens.map((fen, i) => ({ fen, i }));
    this._results = new Array(fens.length).fill(null);
    this._depth = depth;
    this._running = true;
    this._current = -1;

    this.engine.onBestMove = (bm) => this._onBestMove(bm);
    this.engine.onEval = ({ evalCp, depth: d, bestMove }) => {
      if (d >= this._depth - 2 && this._current >= 0) {
        this._results[this._current] = {
          evalCp,
          bestMove: bestMove || this._results[this._current]?.bestMove,
          depth: d
        };
      }
    };

    this._next();
  }

  _next() {
    if (!this._running || this._queue.length === 0) {
      this._running = false;
      if (this.onComplete) this.onComplete(this._results);
      return;
    }
    const { fen, i } = this._queue.shift();
    this._current = i;
    this.engine.analyzePosition(fen, this._depth);
  }

  _onBestMove(bm) {
    if (!this._running) return;
    const idx = this._current;
    if (this._results[idx]) {
      this._results[idx].bestMove = bm;
    } else {
      this._results[idx] = { evalCp: 0, bestMove: bm, depth: 0 };
    }
    if (this.onProgress) this.onProgress(idx, this._results[idx]);
    this._next();
  }

  stop() {
    this._running = false;
    this.engine.stop();
  }
}
