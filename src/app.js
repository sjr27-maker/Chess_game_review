/**
 * app.js — Chess Analyzer with full game review (chess.com style)
 */

import { PGNParser, splitGames } from './pgn-parser.js';
import { Chess, BoardRenderer } from './board.js';
import { StockfishEngine, BatchAnalyzer } from './engine.js';
import { classifyMove, computeAccuracy, phaseAccuracy, CLASS_META } from './classifier.js';

const REVIEW_DEPTH = 16;

class ChessAnalyzer {
  constructor() {
    this.parser   = new PGNParser();
    this.engine   = new StockfishEngine();
    this.analyzer = new BatchAnalyzer(this.engine);
    this.renderer = null;

    this.games       = [];
    this.currentGame = null;
    this.fens        = [];      // fen per half-move (index 0 = start)
    this.moveEvals   = [];      // { evalCp, bestMove } per fen position
    this.moveData    = [];      // enriched move objects after review
    this.cursor      = 0;
    this.reviewing   = false;

    this._initUI();
    this._initEngine();
    this._bindKeys();
  }

  // ─── Engine ──────────────────────────────────────────────────────────────

  _initEngine() {
    this.engine.onReady = () => {
      document.getElementById('engine-status').textContent = '● Stockfish ready';
      document.getElementById('engine-status').classList.add('ready');
      document.getElementById('btn-review').disabled = false;
    };

    this.analyzer.onProgress = (idx, result) => {
      const total = this.fens.length;
      const pct   = Math.round(((idx + 1) / total) * 100);
      this._setReviewProgress(pct, idx + 1, total);
      this.moveEvals[idx] = result;

      // Live update eval graph
      this._drawEvalGraph();
    };

    this.analyzer.onComplete = (results) => {
      this.moveEvals = results;
      this._classifyAllMoves();
      this._renderReviewPanel();
      this._drawEvalGraph();
      this.reviewing = false;
      document.getElementById('btn-review').disabled = false;
      document.getElementById('btn-review').textContent = '↺ Re-analyze';
      document.getElementById('review-progress').classList.add('hidden');
    };
  }

  // ─── UI Init ─────────────────────────────────────────────────────────────

  _initUI() {
    const boardEl = document.getElementById('board');
    this.renderer = new BoardRenderer(boardEl);
    this._drawBoard();

    // PGN load
    document.getElementById('btn-load-pgn').addEventListener('click', () => {
      const pgn = document.getElementById('pgn-input').value.trim();
      if (pgn) this._loadPGN(pgn);
    });

    const fileInput = document.getElementById('pgn-file');
    fileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => this._loadPGN(ev.target.result);
      reader.readAsText(file);
    });
    window.triggerFileOpen = () => fileInput.click();

    // Nav
    document.getElementById('btn-first').addEventListener('click', () => this._goto(0));
    document.getElementById('btn-prev').addEventListener('click',  () => this._goto(this.cursor - 1));
    document.getElementById('btn-next').addEventListener('click',  () => this._goto(this.cursor + 1));
    document.getElementById('btn-last').addEventListener('click',  () => this._goto(this.fens.length - 1));
    document.getElementById('btn-flip').addEventListener('click',  () => {
      this.renderer.flipped = !this.renderer.flipped;
      this._drawBoard();
    });

    // Review
    document.getElementById('btn-review').addEventListener('click', () => this._startReview());

    // Game select
    document.getElementById('game-select').addEventListener('change', (e) => {
      this._selectGame(parseInt(e.target.value));
    });

    // Eval graph click to navigate
    document.getElementById('eval-graph').addEventListener('click', (e) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const pct = x / rect.width;
      const idx = Math.round(pct * (this.fens.length - 1));
      this._goto(Math.max(0, Math.min(this.fens.length - 1, idx)));
    });
  }

  _bindKeys() {
    document.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return;
      if (e.key === 'ArrowLeft')  this._goto(this.cursor - 1);
      if (e.key === 'ArrowRight') this._goto(this.cursor + 1);
      if (e.key === 'ArrowUp')    this._goto(0);
      if (e.key === 'ArrowDown')  this._goto(this.fens.length - 1);
    });
  }

  // ─── PGN ─────────────────────────────────────────────────────────────────

  _loadPGN(text) {
    try {
      const gameTexts = splitGames(text);
      this.games = gameTexts.map(g => this.parser.parse(g));

      const sel = document.getElementById('game-select');
      sel.innerHTML = '';
      this.games.forEach((g, i) => {
        const opt = document.createElement('option');
        opt.value = i;
        opt.textContent = `${g.headers.White || '?'} vs ${g.headers.Black || '?'}`;
        sel.appendChild(opt);
      });

      this._selectGame(0);
      document.getElementById('pgn-panel').classList.add('hidden');
      document.getElementById('main-content').classList.remove('hidden');
    } catch (err) {
      alert('Failed to parse PGN: ' + err.message);
    }
  }

  _selectGame(idx) {
    this.currentGame = this.games[idx];
    this.moveEvals = [];
    this.moveData  = [];
    this._buildFENList();
    this._renderMoveList();
    this._renderHeaders();
    this._clearReviewPanel();
    this._drawEvalGraph();
    this._goto(0);
  }

  _buildFENList() {
    const chess = new Chess();
    this.fens = [chess.fen()];
    for (const move of this.currentGame.moves) {
      const result = chess.move(move.san);
      if (!result) { console.warn('Cannot apply:', move.san); break; }
      move.from = result.from;
      move.to   = result.to;
      move.fen  = chess.fen();
      this.fens.push(chess.fen());
    }
  }

  // ─── Review ──────────────────────────────────────────────────────────────

  _startReview() {
    if (this.reviewing) return;
    this.reviewing = true;
    this.moveEvals = new Array(this.fens.length).fill(null);
    document.getElementById('btn-review').disabled = true;
    document.getElementById('btn-review').textContent = 'Analyzing…';
    document.getElementById('review-progress').classList.remove('hidden');
    this._setReviewProgress(0, 0, this.fens.length);
    this.analyzer.analyze(this.fens, REVIEW_DEPTH);
  }

  _setReviewProgress(pct, done, total) {
    const bar  = document.getElementById('progress-bar-fill');
    const text = document.getElementById('progress-text');
    if (bar)  bar.style.width = pct + '%';
    if (text) text.textContent = `Analyzing… ${done}/${total} positions`;
  }

  _classifyAllMoves() {
    const moves = this.currentGame.moves;
    this.moveData = [];

    for (let i = 0; i < moves.length; i++) {
      const move    = moves[i];
      const evalIdx = i + 1; // eval after the move
      const prevIdx = i;     // eval before the move

      const prevResult = this.moveEvals[prevIdx];
      const curResult  = this.moveEvals[evalIdx];

      if (!prevResult || !curResult) {
        this.moveData.push({ ...move, classification: 'best', cpLoss: 0 });
        continue;
      }

      // Convert to mover's perspective
      // evalCp is always from white's perspective in our engine output
      const color = move.color; // 'w' or 'b'
      const sign  = color === 'w' ? 1 : -1;

      const evalBefore = sign * prevResult.evalCp / 100; // pawns, mover's POV before
      const evalAfter  = sign * curResult.evalCp  / 100; // pawns, from same mover's POV after

      // The engine's best move at prevIdx
      const engineBest = prevResult.bestMove;
      // Reconstruct what the actual move UCI would be
      const actualUCI  = this._moveToUCI(move);
      const wasBest    = engineBest && actualUCI && engineBest === actualUCI;

      const cpLoss    = Math.round((evalBefore - evalAfter) * 100); // in cp
      const classif   = classifyMove(evalBefore * 100, evalAfter * 100, wasBest);

      this.moveData.push({ ...move, classification: classif, cpLoss: Math.max(0, cpLoss), wasBest });
    }
  }

  _moveToUCI(move) {
    if (!move || move.from === undefined) return null;
    const files = 'abcdefgh';
    const from  = files[move.from % 8] + (8 - Math.floor(move.from / 8));
    const to    = files[move.to   % 8] + (8 - Math.floor(move.to   / 8));
    return from + to;
  }

  // ─── Review Panel ────────────────────────────────────────────────────────

  _renderReviewPanel() {
    const h = this.currentGame.headers;

    // Accuracy
    const whiteMoves = this.moveData.filter(m => m.color === 'w');
    const blackMoves = this.moveData.filter(m => m.color === 'b');
    const wAcc = computeAccuracy(whiteMoves.map(m => m.cpLoss));
    const bAcc = computeAccuracy(blackMoves.map(m => m.cpLoss));

    document.getElementById('white-accuracy').textContent = wAcc;
    document.getElementById('black-accuracy').textContent = bAcc;
    document.getElementById('white-name').textContent = h.White || 'White';
    document.getElementById('black-name').textContent = h.Black || 'Black';
    document.getElementById('white-rating').textContent = h.WhiteElo ? `(${h.WhiteElo})` : '';
    document.getElementById('black-rating').textContent = h.BlackElo ? `(${h.BlackElo})` : '';

    // Move classification counts
    const classifications = ['brilliant','great','best','good','inaccuracy','mistake','miss','blunder'];
    for (const cls of classifications) {
      const wCount = whiteMoves.filter(m => m.classification === cls).length;
      const bCount = blackMoves.filter(m => m.classification === cls).length;
      const wEl = document.getElementById(`w-${cls}`);
      const bEl = document.getElementById(`b-${cls}`);
      if (wEl) wEl.textContent = wCount;
      if (bEl) bEl.textContent = bCount;
    }

    // Phase accuracy
    const wPhase = phaseAccuracy(whiteMoves);
    const bPhase = phaseAccuracy(blackMoves);

    for (const phase of ['opening','middlegame','endgame']) {
      const wEl = document.getElementById(`w-phase-${phase}`);
      const bEl = document.getElementById(`b-phase-${phase}`);
      if (wEl) wEl.textContent = wPhase[phase] !== null ? wPhase[phase] : '—';
      if (bEl) bEl.textContent = bPhase[phase] !== null ? bPhase[phase] : '—';
    }

    document.getElementById('review-panel').classList.remove('hidden');
    document.getElementById('game-info').classList.add('hidden');

    // Re-render move list with classifications
    this._renderMoveList();
  }

  _clearReviewPanel() {
    document.getElementById('review-panel').classList.add('hidden');
    document.getElementById('game-info').classList.remove('hidden');
  }

  // ─── Eval Graph ──────────────────────────────────────────────────────────

  _drawEvalGraph() {
    const canvas = document.getElementById('eval-graph');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width  = canvas.offsetWidth;
    const H = canvas.height = canvas.offsetHeight;
    ctx.clearRect(0, 0, W, H);

    const evals = this.moveEvals.filter(Boolean);
    if (evals.length < 2) {
      // Draw empty state
      ctx.fillStyle = '#1c1c1c';
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#333';
      ctx.font = '11px monospace';
      ctx.fillText('Run analysis to see eval graph', W/2 - 90, H/2);
      return;
    }

    const allEvals = this.moveEvals.map(e => e ? Math.max(-1500, Math.min(1500, e.evalCp)) : 0);

    // Background
    ctx.fillStyle = '#141414';
    ctx.fillRect(0, 0, W, H);

    // Zero line
    const mid = H / 2;
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, mid);
    ctx.lineTo(W, mid);
    ctx.stroke();

    // Eval area fill
    const xStep = W / Math.max(1, allEvals.length - 1);

    const toY = (cp) => {
      const clamped = Math.max(-800, Math.min(800, cp));
      return mid - (clamped / 800) * mid;
    };

    // White area (above midline)
    ctx.beginPath();
    ctx.moveTo(0, mid);
    allEvals.forEach((cp, i) => ctx.lineTo(i * xStep, toY(cp)));
    ctx.lineTo((allEvals.length - 1) * xStep, mid);
    ctx.closePath();
    ctx.fillStyle = 'rgba(240, 217, 181, 0.85)';
    ctx.fill();

    // Black area (below midline)
    ctx.beginPath();
    ctx.moveTo(0, mid);
    allEvals.forEach((cp, i) => ctx.lineTo(i * xStep, toY(cp)));
    ctx.lineTo((allEvals.length - 1) * xStep, mid);
    ctx.closePath();
    ctx.fillStyle = 'rgba(30, 30, 30, 0.5)';
    ctx.fill();

    // Draw line
    ctx.beginPath();
    ctx.strokeStyle = '#c8a96e';
    ctx.lineWidth = 1.5;
    allEvals.forEach((cp, i) => {
      i === 0 ? ctx.moveTo(0, toY(cp)) : ctx.lineTo(i * xStep, toY(cp));
    });
    ctx.stroke();

    // Move classification dots
    if (this.moveData.length) {
      this.moveData.forEach((m, i) => {
        const evalIdx = i + 1;
        if (!this.moveEvals[evalIdx]) return;
        const cls = m.classification;
        if (!cls || cls === 'best' || cls === 'good') return; // only show notable
        const meta = CLASS_META[cls];
        if (!meta) return;
        const x = evalIdx * xStep;
        const y = toY(this.moveEvals[evalIdx].evalCp);
        ctx.beginPath();
        ctx.arc(x, y, 3.5, 0, Math.PI * 2);
        ctx.fillStyle = meta.color;
        ctx.fill();
      });
    }

    // Cursor line
    const curX = this.cursor * xStep;
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(curX, 0);
    ctx.lineTo(curX, H);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // ─── Navigation ──────────────────────────────────────────────────────────

  _goto(idx) {
    if (!this.fens.length) return;
    idx = Math.max(0, Math.min(this.fens.length - 1, idx));
    this.cursor = idx;

    const move = this.currentGame?.moves[idx - 1];
    if (move?.from !== undefined) {
      this.renderer.highlight(move.from, move.to);
    } else {
      this.renderer.highlight(-1, -1);
    }

    this._drawBoard();
    this._drawEvalGraph();
    this._highlightActiveMoveInList(idx - 1);
    this._updateNavButtons();
    this._updateLiveEval();
  }

  _updateLiveEval() {
    const result = this.moveEvals[this.cursor];
    const label  = document.getElementById('eval-label');
    const bar    = document.getElementById('eval-bar-fill');
    const depth  = document.getElementById('eval-depth');

    if (!result) {
      // real-time analysis
      this.engine.onEval = ({ evalCp, depth: d }) => {
        const pct = 50 + Math.max(-50, Math.min(50, evalCp / 800 * 50));
        if (bar) bar.style.height = pct + '%';
        if (label) label.textContent = evalCp >= 0
          ? `+${(evalCp/100).toFixed(1)}`
          : (evalCp/100).toFixed(1);
        if (depth) depth.textContent = `d${d}`;
      };
      this.engine.analyzePosition(this.fens[this.cursor], 20);
    } else {
      const cp  = result.evalCp;
      const pct = 50 + Math.max(-50, Math.min(50, cp / 800 * 50));
      if (bar) bar.style.height = pct + '%';
      if (label) label.textContent = cp >= 0
        ? `+${(cp/100).toFixed(1)}`
        : (cp/100).toFixed(1);
      if (depth) depth.textContent = result.depth ? `d${result.depth}` : '';
    }

    // Show move classification badge
    const move = this.moveData[this.cursor - 1];
    const badge = document.getElementById('move-badge');
    if (badge && move?.classification) {
      const meta = CLASS_META[move.classification];
      badge.textContent = `${meta.symbol} ${meta.label}`;
      badge.style.color = meta.color;
      badge.style.display = 'block';
    } else if (badge) {
      badge.style.display = 'none';
    }
  }

  _updateNavButtons() {
    document.getElementById('btn-first').disabled = this.cursor === 0;
    document.getElementById('btn-prev').disabled  = this.cursor === 0;
    document.getElementById('btn-next').disabled  = this.cursor >= this.fens.length - 1;
    document.getElementById('btn-last').disabled  = this.cursor >= this.fens.length - 1;
  }

  // ─── Board ────────────────────────────────────────────────────────────────

  _drawBoard() {
    const chess = new Chess(this.fens[this.cursor] || undefined);
    this.renderer.render(chess.board);
  }

  // ─── Move List ────────────────────────────────────────────────────────────

  _renderMoveList() {
    const container = document.getElementById('move-list');
    container.innerHTML = '';

    const moves = this.currentGame?.moves || [];
    let row = null;

    moves.forEach((move, i) => {
      if (move.color === 'w') {
        row = document.createElement('div');
        row.className = 'move-row';
        const num = document.createElement('span');
        num.className = 'move-num';
        num.textContent = move.moveNumber + '.';
        row.appendChild(num);
        container.appendChild(row);
      }

      const btn = document.createElement('button');
      btn.className = 'move-btn';
      btn.dataset.idx = i + 1;
      btn.addEventListener('click', () => this._goto(i + 1));

      const data = this.moveData[i];
      const cls  = data?.classification;
      const meta = cls ? CLASS_META[cls] : null;

      btn.innerHTML = `<span class="move-san">${move.san}</span>${meta && cls !== 'best' && cls !== 'good'
        ? `<span class="move-cls-dot" style="color:${meta.color}">${meta.symbol}</span>`
        : ''}`;

      if (row) row.appendChild(btn);
    });
  }

  _highlightActiveMoveInList(moveIdx) {
    document.querySelectorAll('.move-btn').forEach(b => b.classList.remove('active'));
    if (moveIdx >= 0) {
      const btn = document.querySelector(`.move-btn[data-idx="${moveIdx + 1}"]`);
      if (btn) {
        btn.classList.add('active');
        btn.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }
  }

  // ─── Game Info ───────────────────────────────────────────────────────────

  _renderHeaders() {
    const h = this.currentGame?.headers || {};
    document.getElementById('game-info').innerHTML = `
      <div class="info-row"><span class="info-key">White</span><span class="info-val">${h.White || '?'}${h.WhiteElo ? ` (${h.WhiteElo})` : ''}</span></div>
      <div class="info-row"><span class="info-key">Black</span><span class="info-val">${h.Black || '?'}${h.BlackElo ? ` (${h.BlackElo})` : ''}</span></div>
      <div class="info-row"><span class="info-key">Event</span><span class="info-val">${h.Event || '?'}</span></div>
      <div class="info-row"><span class="info-key">Date</span><span class="info-val">${h.Date || '?'}</span></div>
      <div class="info-row"><span class="info-key">Result</span><span class="info-val">${h.Result || '?'}</span></div>
      <div class="info-row"><span class="info-key">ECO</span><span class="info-val">${h.ECO || '?'} ${h.Opening || ''}</span></div>
    `;
  }
}

window.addEventListener('DOMContentLoaded', () => new ChessAnalyzer());