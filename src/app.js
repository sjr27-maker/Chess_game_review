/**
 * app.js
 * Wires together: PGN parser → chess logic → board renderer → engine
 */

import { PGNParser, splitGames } from './pgn-parser.js';
import { Chess, BoardRenderer } from './board.js';
import { StockfishEngine } from './engine.js';

class ChessAnalyzer {
  constructor() {
    this.parser   = new PGNParser();
    this.chess    = new Chess();
    this.engine   = new StockfishEngine();
    this.renderer = null;

    this.games    = [];       // parsed games
    this.currentGame = null;  // { headers, moves }
    this.fens     = [];       // fen at each half-move (fens[0] = start)
    this.cursor   = 0;        // current position index

    this._initUI();
    this._initEngine();
    this._bindKeys();
  }

  // ─── Engine ──────────────────────────────────────────────────────────────

  _initEngine() {
    this.engine.onReady = () => {
      document.getElementById('engine-status').textContent = 'Stockfish ready';
      document.getElementById('engine-status').classList.add('ready');
    };
    this.engine.onEval = ({ eval: ev, depth, bestMove }) => {
      this._updateEvalBar(ev, depth, bestMove);
    };
  }

  _updateEvalBar(ev, depth, bestMove) {
    const bar   = document.getElementById('eval-bar-fill');
    const label = document.getElementById('eval-label');
    const depthEl = document.getElementById('eval-depth');
    const bmEl  = document.getElementById('best-move');

    if (!bar) return;

    // ev is from white's perspective; clamp to [-10, 10]
    const clamped = Math.max(-10, Math.min(10, ev));
    // percent: 50% = equal. White pushes up.
    const pct = 50 + (clamped / 10) * 50;
    bar.style.height = pct + '%';

    if (Math.abs(ev) >= 999) {
      label.textContent = ev > 0 ? '#' : '-#';
    } else {
      label.textContent = (ev > 0 ? '+' : '') + ev.toFixed(1);
    }
    if (depthEl) depthEl.textContent = `d${depth}`;
    if (bmEl && bestMove) {
      bmEl.textContent = `Best: ${bestMove}`;
      this._highlightBestMove(bestMove);
    }
  }

  _highlightBestMove(uci) {
    // uci like "e2e4" → square indices
    const files = 'abcdefgh';
    const fc = files.indexOf(uci[0]);
    const fr = 8 - parseInt(uci[1]);
    const tc = files.indexOf(uci[2]);
    const tr = 8 - parseInt(uci[3]);
    const fromIdx = fr * 8 + fc;
    const toIdx   = tr * 8 + tc;
    this.renderer.highlight(fromIdx, toIdx);
    this._drawBoard();
  }

  // ─── UI Init ─────────────────────────────────────────────────────────────

  _initUI() {
    // Board
    const boardEl = document.getElementById('board');
    this.renderer = new BoardRenderer(boardEl);
    this._drawBoard();

    // PGN input
    document.getElementById('btn-load-pgn').addEventListener('click', () => {
      const pgn = document.getElementById('pgn-input').value.trim();
      if (pgn) this._loadPGN(pgn);
    });

    // File upload
    const fileInput = document.getElementById('pgn-file');
    fileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => this._loadPGN(ev.target.result);
      reader.readAsText(file);
    });
    window.triggerFileOpen = () => fileInput.click();

    // Navigation
    document.getElementById('btn-first').addEventListener('click', () => this._goto(0));
    document.getElementById('btn-prev').addEventListener('click',  () => this._goto(this.cursor - 1));
    document.getElementById('btn-next').addEventListener('click',  () => this._goto(this.cursor + 1));
    document.getElementById('btn-last').addEventListener('click',  () => this._goto(this.fens.length - 1));

    // Flip
    document.getElementById('btn-flip').addEventListener('click', () => {
      this.renderer.flipped = !this.renderer.flipped;
      this._drawBoard();
    });

    // Auto-analyze toggle
    document.getElementById('btn-analyze').addEventListener('click', () => {
      this._analyzeCurrentPosition();
    });

    // Game selector
    document.getElementById('game-select').addEventListener('change', (e) => {
      this._selectGame(parseInt(e.target.value));
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

  // ─── PGN Loading ──────────────────────────────────────────────────────────

  _loadPGN(text) {
    try {
      const gameTexts = splitGames(text);
      this.games = gameTexts.map(g => this.parser.parse(g));

      // Populate game selector
      const sel = document.getElementById('game-select');
      sel.innerHTML = '';
      this.games.forEach((g, i) => {
        const opt = document.createElement('option');
        opt.value = i;
        const w = g.headers.White || '?';
        const b = g.headers.Black || '?';
        opt.textContent = `Game ${i + 1}: ${w} vs ${b}`;
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
    this._buildFENList();
    this._renderMoveList();
    this._renderHeaders();
    this._goto(0);
  }

  _buildFENList() {
    const game = this.currentGame;
    const chess = new Chess(); // fresh instance
    this.fens = [chess.fen()];

    for (const move of game.moves) {
      const result = chess.move(move.san);
      if (!result) {
        console.warn('Could not apply move:', move.san);
        break;
      }
      move.fen = chess.fen();
      move.from = result.from;
      move.to = result.to;
      this.fens.push(chess.fen());
    }
  }

  // ─── Navigation ──────────────────────────────────────────────────────────

  _goto(idx) {
    if (!this.fens.length) return;
    idx = Math.max(0, Math.min(this.fens.length - 1, idx));
    this.cursor = idx;

    // Highlight last move
    const move = this.currentGame?.moves[idx - 1];
    if (move && move.from !== undefined) {
      this.renderer.highlight(move.from, move.to);
    } else {
      this.renderer.highlight(-1, -1);
    }

    this._drawBoard();
    this._highlightActiveMoveInList(idx - 1);
    this._analyzeCurrentPosition();
    this._updateNavButtons();
  }

  _analyzeCurrentPosition() {
    if (!this.engine.ready || !this.fens[this.cursor]) return;
    this.engine.analyzePosition(this.fens[this.cursor], 20);
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
      btn.textContent = move.san;
      btn.dataset.idx = i + 1;
      btn.addEventListener('click', () => this._goto(i + 1));
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

  // ─── Headers ─────────────────────────────────────────────────────────────

  _renderHeaders() {
    const h = this.currentGame?.headers || {};
    const el = document.getElementById('game-info');
    el.innerHTML = `
      <div class="info-row"><span class="info-key">White</span><span class="info-val">${h.White || '?'} ${h.WhiteElo ? `(${h.WhiteElo})` : ''}</span></div>
      <div class="info-row"><span class="info-key">Black</span><span class="info-val">${h.Black || '?'} ${h.BlackElo ? `(${h.BlackElo})` : ''}</span></div>
      <div class="info-row"><span class="info-key">Event</span><span class="info-val">${h.Event || '?'}</span></div>
      <div class="info-row"><span class="info-key">Date</span><span class="info-val">${h.Date || '?'}</span></div>
      <div class="info-row"><span class="info-key">Result</span><span class="info-val result-${h.Result?.replace('/', '-') || 'unknown'}">${h.Result || '?'}</span></div>
      <div class="info-row"><span class="info-key">ECO</span><span class="info-val">${h.ECO || '?'} ${h.Opening || ''}</span></div>
    `;
  }
}

// Bootstrap
window.addEventListener('DOMContentLoaded', () => {
  new ChessAnalyzer();
});