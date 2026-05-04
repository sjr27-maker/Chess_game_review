/**
 * engine.js
 * Wraps Stockfish WASM via a Web Worker.
 * Uses the CDN build: https://cdn.jsdelivr.net/npm/stockfish.wasm/stockfish.js
 */

export class StockfishEngine {
  constructor() {
    this.ready = false;
    this.worker = null;
    this.onEval = null;   // callback(eval: number, depth: number, bestMove: string)
    this.onReady = null;
    this._resolvers = [];
    this._init();
  }

  _init() {
    // Load Stockfish via inline worker blob so we can intercept messages
    const workerCode = `
      importScripts('https://cdn.jsdelivr.net/npm/stockfish.wasm@0.10.0/stockfish.js');
      var sf;
      Stockfish().then(function(inst) {
        sf = inst;
        sf.addMessageListener(function(msg) { postMessage(msg); });
        postMessage('readyok_internal');
      });
      onmessage = function(e) {
        if (sf) sf.postMessage(e.data);
      };
    `;
    const blob = new Blob([workerCode], { type: 'application/javascript' });
    this.worker = new Worker(URL.createObjectURL(blob));

    this.worker.onmessage = (e) => this._handleMessage(e.data);
    this.worker.onerror = (e) => console.error('[Stockfish]', e);
  }

  _handleMessage(msg) {
    if (msg === 'readyok_internal' || msg === 'readyok') {
      this.ready = true;
      if (this.onReady) this.onReady();
      return;
    }

    // info depth 18 seldepth 28 multipv 1 score cp 45 nodes ... pv e2e4
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
        evalScore = m > 0 ? 999 : -999;
      } else if (cpM) {
        evalScore = parseInt(cpM[1]) / 100;
      } else return;

      if (this.onEval) this.onEval({ eval: evalScore, depth, bestMove });
    }

    // bestmove e2e4 ponder d7d5
    if (msg.startsWith('bestmove')) {
      const parts = msg.split(' ');
      const bm = parts[1];
      if (this.onBestMove) this.onBestMove(bm);
    }
  }

  send(cmd) {
    if (this.worker) this.worker.postMessage(cmd);
  }

  analyzePosition(fen, depth = 18) {
    this.send('stop');
    this.send('ucinewgame');
    this.send(`position fen ${fen}`);
    this.send(`go depth ${depth}`);
  }

  stop() {
    this.send('stop');
  }

  destroy() {
    this.stop();
    if (this.worker) this.worker.terminate();
  }
}