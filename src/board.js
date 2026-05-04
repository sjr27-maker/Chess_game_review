/**
 * board.js
 * - Chess game state (FEN, move application)
 * - SVG board renderer
 */

// ─── Chess Logic ────────────────────────────────────────────────────────────

const STARTING_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

export class Chess {
  constructor(fen = STARTING_FEN) {
    this.load(fen);
  }

  load(fen) {
    const parts = fen.split(' ');
    this.board = this._parseFENBoard(parts[0]);
    this.turn = parts[1] || 'w';
    this.castling = parts[2] || 'KQkq';
    this.enPassant = parts[3] || '-';
    this.halfMove = parseInt(parts[4]) || 0;
    this.fullMove = parseInt(parts[5]) || 1;
    this._history = [];
  }

  fen() {
    const boardStr = this._boardToFEN();
    return `${boardStr} ${this.turn} ${this.castling} ${this.enPassant} ${this.halfMove} ${this.fullMove}`;
  }

  _parseFENBoard(fenBoard) {
    const board = Array(64).fill(null);
    const rows = fenBoard.split('/');
    for (let r = 0; r < 8; r++) {
      let col = 0;
      for (const ch of rows[r]) {
        if (/\d/.test(ch)) {
          col += parseInt(ch);
        } else {
          board[r * 8 + col] = ch;
          col++;
        }
      }
    }
    return board;
  }

  _boardToFEN() {
    let fen = '';
    for (let r = 0; r < 8; r++) {
      let empty = 0;
      for (let c = 0; c < 8; c++) {
        const p = this.board[r * 8 + c];
        if (p) {
          if (empty) { fen += empty; empty = 0; }
          fen += p;
        } else {
          empty++;
        }
      }
      if (empty) fen += empty;
      if (r < 7) fen += '/';
    }
    return fen;
  }

  // Apply a SAN move — returns { from, to, promotion } or null
  move(san) {
    const mv = this._sanToMove(san);
    if (!mv) return null;
    this._applyMove(mv);
    return mv;
  }

  _applyMove(mv) {
    const { from, to, promotion, flags } = mv;
    const piece = this.board[from];

    // En passant capture
    if (flags.includes('e')) {
      const epDir = this.turn === 'w' ? 8 : -8;
      this.board[to + epDir] = null;
    }

    // Move piece
    this.board[to] = promotion
      ? (this.turn === 'w' ? promotion.toUpperCase() : promotion.toLowerCase())
      : piece;
    this.board[from] = null;

    // Castling: move rook
    if (flags.includes('k')) { // kingside
      const rookFrom = this.turn === 'w' ? 63 : 7;
      const rookTo = this.turn === 'w' ? 61 : 5;
      this.board[rookTo] = this.board[rookFrom];
      this.board[rookFrom] = null;
    }
    if (flags.includes('q')) { // queenside
      const rookFrom = this.turn === 'w' ? 56 : 0;
      const rookTo = this.turn === 'w' ? 59 : 3;
      this.board[rookTo] = this.board[rookFrom];
      this.board[rookFrom] = null;
    }

    // Update castling rights
    if (piece === 'K') this.castling = this.castling.replace(/[KQ]/g, '');
    if (piece === 'k') this.castling = this.castling.replace(/[kq]/g, '');
    if (from === 56 || to === 56) this.castling = this.castling.replace('Q', '');
    if (from === 63 || to === 63) this.castling = this.castling.replace('K', '');
    if (from === 0  || to === 0)  this.castling = this.castling.replace('q', '');
    if (from === 7  || to === 7)  this.castling = this.castling.replace('k', '');
    if (!this.castling) this.castling = '-';

    // En passant
    if ((piece === 'P' || piece === 'p') && Math.abs(to - from) === 16) {
      this.enPassant = this._squareName((from + to) >> 1);
    } else {
      this.enPassant = '-';
    }

    // Half move clock
    if (piece === 'P' || piece === 'p' || flags.includes('c')) {
      this.halfMove = 0;
    } else {
      this.halfMove++;
    }

    if (this.turn === 'b') this.fullMove++;
    this.turn = this.turn === 'w' ? 'b' : 'w';
    this._history.push(mv);
  }

  _squareName(idx) {
    return 'abcdefgh'[idx % 8] + (8 - Math.floor(idx / 8));
  }

  _squareIdx(name) {
    const col = name.charCodeAt(0) - 97;
    const row = 8 - parseInt(name[1]);
    return row * 8 + col;
  }

  // Convert SAN to {from, to, flags, promotion}
  _sanToMove(san) {
    const color = this.turn;
    const isUpper = color === 'w';

    // Strip check/checkmate symbols
    san = san.replace(/[+#!?]/g, '');

    // Castling
    if (san === 'O-O' || san === '0-0') {
      const from = color === 'w' ? 60 : 4;
      const to   = color === 'w' ? 62 : 6;
      return { from, to, flags: 'k', san: san };
    }
    if (san === 'O-O-O' || san === '0-0-0') {
      const from = color === 'w' ? 60 : 4;
      const to   = color === 'w' ? 58 : 2;
      return { from, to, flags: 'q', san: san };
    }

    // Promotion
    let promotion = null;
    const promMatch = san.match(/=([QRBN])$/);
    if (promMatch) {
      promotion = promMatch[1].toLowerCase();
      san = san.replace(/=[QRBN]$/, '');
    }

    // Parse piece type, disambiguation, capture, destination
    const sanRe = /^([KQRBN])?([a-h])?([1-8])?(x)?([a-h][1-8])$/;
    const m = san.match(sanRe);
    if (!m) return null;

    const [, pieceChar, disambigFile, disambigRank, capture, toSq] = m;
    const to = this._squareIdx(toSq);
    const pieceLetter = pieceChar
      ? (isUpper ? pieceChar : pieceChar.toLowerCase())
      : (isUpper ? 'P' : 'p');

    // Find candidate pieces
    let candidates = [];
    for (let i = 0; i < 64; i++) {
      if (this.board[i] !== pieceLetter) continue;
      if (disambigFile && 'abcdefgh'[i % 8] !== disambigFile) continue;
      if (disambigRank && (8 - Math.floor(i / 8)).toString() !== disambigRank) continue;
      if (this._canReach(i, to, pieceLetter, color)) {
        candidates.push(i);
      }
    }

    if (candidates.length === 0) return null;
    const from = candidates[0];

    const flags = capture ? 'c' : '';
    // En passant
    const epFlags = this._isEnPassant(from, to, pieceLetter) ? 'e' : '';

    return { from, to, flags: flags + epFlags, promotion, san };
  }

  _isEnPassant(from, to, piece) {
    if (piece !== 'P' && piece !== 'p') return false;
    if (this.enPassant === '-') return false;
    return this._squareName(to) === this.enPassant;
  }

  _canReach(from, to, piece, color) {
    const p = piece.toUpperCase();
    const fr = Math.floor(from / 8), fc = from % 8;
    const tr = Math.floor(to / 8),   tc = to % 8;
    const dr = tr - fr, dc = tc - fc;

    switch (p) {
      case 'P': {
        const dir = color === 'w' ? -1 : 1;
        if (dc === 0) {
          if (dr === dir && !this.board[to]) return true;
          if (dr === 2 * dir && !this.board[to] && !this.board[from + dir * 8]
              && ((color === 'w' && fr === 6) || (color === 'b' && fr === 1))) return true;
        } else if (Math.abs(dc) === 1 && dr === dir) {
          const target = this.board[to];
          const epSq = this.enPassant !== '-' ? this._squareIdx(this.enPassant) : -1;
          if (target && this._isOpponent(target, color)) return true;
          if (to === epSq) return true;
        }
        return false;
      }
      case 'N':
        return (Math.abs(dr) === 2 && Math.abs(dc) === 1) ||
               (Math.abs(dr) === 1 && Math.abs(dc) === 2);
      case 'B':
        if (Math.abs(dr) !== Math.abs(dc)) return false;
        return this._pathClear(from, to);
      case 'R':
        if (dr !== 0 && dc !== 0) return false;
        return this._pathClear(from, to);
      case 'Q':
        if (dr !== 0 && dc !== 0 && Math.abs(dr) !== Math.abs(dc)) return false;
        return this._pathClear(from, to);
      case 'K':
        return Math.abs(dr) <= 1 && Math.abs(dc) <= 1;
    }
    return false;
  }

  _isOpponent(piece, color) {
    return color === 'w' ? piece === piece.toLowerCase() : piece === piece.toUpperCase();
  }

  _pathClear(from, to) {
    const dr = Math.sign(Math.floor(to / 8) - Math.floor(from / 8));
    const dc = Math.sign((to % 8) - (from % 8));
    let cur = from + dr * 8 + dc;
    while (cur !== to) {
      if (this.board[cur]) return false;
      cur += dr * 8 + dc;
    }
    // Target must be empty or opponent
    const target = this.board[to];
    if (!target) return true;
    return this._isOpponent(target, this.turn);
  }
}

// ─── Board Renderer ──────────────────────────────────────────────────────────

const PIECE_SVG = {
  // White pieces
  'K': `<svg viewBox="0 0 45 45" xmlns="http://www.w3.org/2000/svg"><g fill="#fff" stroke="#000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22.5 11.63V6M20 8h5"/><path d="M22.5 25s4.5-7.5 3-10.5c0 0-1-2.5-3-2.5s-3 2.5-3 2.5c-1.5 3 3 10.5 3 10.5"/><path d="M12.5 37c5.5 3.5 14.5 3.5 20 0v-7s9-4.5 6-10.5c-4-6.5-13.5-3.5-16 4V17s-5.5-13-16-4c-3 6 5 10 5 10V37z"/><path d="M12.5 30c5.5-3 14.5-3 20 0m-20 3.5c5.5-3 14.5-3 20 0m-20 3.5c5.5-3 14.5-3 20 0"/></g></svg>`,
  'Q': `<svg viewBox="0 0 45 45" xmlns="http://www.w3.org/2000/svg"><g fill="#fff" stroke="#000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="12" r="2.75"/><circle cx="14" cy="9" r="2.75"/><circle cx="22.5" cy="8" r="2.75"/><circle cx="31" cy="9" r="2.75"/><circle cx="39" cy="12" r="2.75"/><path d="M9 26c8.5-8.5 15.5-8.5 27 0l2.5-12.5L31 25l-.3-14.1-8.2 13.1-8.2-13.1L14 25 6.5 13.5 9 26z"/><path d="M9 26c0 2 1.5 2 2.5 4 1 1.5 1 1 .5 3.5-1.5 1-1.5 2.5-1.5 2.5-1.5 1.5.5 2.5.5 2.5 6.5 1 16.5 1 23 0 0 0 1.5-1 0-2.5 0 0 .5-1.5-1-2.5-.5-2.5-.5-2 .5-3.5 1-2 2.5-2 2.5-4-8.5-1.5-18.5-1.5-27 0z"/><path d="M11 38.5a35 35 1 0 0 23 0"/><path d="M11 29a35 35 1 0 1 23 0"/><path d="M12.5 31.5h20M11.5 34.5h22M10.5 37.5h24"/></g></svg>`,
  'R': `<svg viewBox="0 0 45 45" xmlns="http://www.w3.org/2000/svg"><g fill="#fff" stroke="#000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 39h27v-3H9v3zM12.5 32l1.5-2.5h17l1.5 2.5h-20zM12 36v-4h21v4H12z"/><path d="M14 29.5v-13h17v13H14z"/><path d="M9 12l3.5 3h20l3.5-3V9H9v3zM9 9h27"/><path d="M11 12v2.5M14 12v2.5M17 12v2.5M20 12v2.5M23 12v2.5M26 12v2.5M29 12v2.5M32 12v2.5M34 12v2.5"/></g></svg>`,
  'B': `<svg viewBox="0 0 45 45" xmlns="http://www.w3.org/2000/svg"><g fill="#fff" stroke="#000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><g fill="#fff" stroke-linecap="butt"><path d="M9 36c3.39-.97 10.11.43 13.5-2 3.39 2.43 10.11 1.03 13.5 2 0 0 1.65.54 3 2-.68.97-1.65.99-3 .5-3.39-.97-10.11.46-13.5-1-3.39 1.46-10.11.03-13.5 1-1.354.49-2.323.47-3-.5 1.354-1.94 3-2 3-2z"/><path d="M15 32c2.5 2.5 12.5 2.5 15 0 .5-1.5 0-2 0-2 0-2.5-2.5-4-2.5-4 5.5-1.5 6-11.5-5-15.5-11 4-10.5 14-5 15.5 0 0-2.5 1.5-2.5 4 0 0-.5.5 0 2z"/><path d="M25 8a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z"/></g><path d="M17.5 26h10M15 30h15" stroke-linejoin="miter"/></g></svg>`,
  'N': `<svg viewBox="0 0 45 45" xmlns="http://www.w3.org/2000/svg"><g fill="#fff" stroke="#000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 10c10.5 1 16.5 8 16 29H15c0-9 10-6.5 8-21"/><path d="M24 18c.38 5.12-2.38 5.88-4 10 2.5 2.5 7.5 2 8 0 1.38-3.12-.38-8-4-10z"/><path d="M9.5 25.5a.5.5 0 1 0 1 0 .5.5 0 1 0-1 0z" fill="#000"/><path d="M14.933 15.75a5 5 0 0 1-2.433 6.544 5 5 0 0 1-6.5-2.5 5 5 0 0 1 2.5-6.5 5 5 0 0 1 6.433 2.456z"/></g></svg>`,
  'P': `<svg viewBox="0 0 45 45" xmlns="http://www.w3.org/2000/svg"><path d="M22.5 9c-2.21 0-4 1.79-4 4 0 .89.29 1.71.78 2.38-1.95 1.12-3.28 3.21-3.28 5.62 0 2.03.98 3.84 2.5 5-5.5 1.9-9.5 7.5-9.5 14h28c0-6.5-4-12.1-9.5-14 1.52-1.16 2.5-2.97 2.5-5 0-2.41-1.33-4.5-3.28-5.62.49-.67.78-1.49.78-2.38 0-2.21-1.79-4-4-4z" fill="#fff" stroke="#000" stroke-width="1.5" stroke-linecap="round"/></svg>`,
  // Black pieces
  'k': `<svg viewBox="0 0 45 45" xmlns="http://www.w3.org/2000/svg"><g fill="#000" stroke="#000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22.5 11.63V6" stroke="#fff"/><path d="M22.5 25s4.5-7.5 3-10.5c0 0-1-2.5-3-2.5s-3 2.5-3 2.5c-1.5 3 3 10.5 3 10.5"/><path d="M12.5 37c5.5 3.5 14.5 3.5 20 0v-7s9-4.5 6-10.5c-4-6.5-13.5-3.5-16 4V17s-5.5-13-16-4c-3 6 5 10 5 10V37z"/><path d="M20 8h5" stroke="#fff"/><path d="M12.5 30c5.5-3 14.5-3 20 0m-20 3.5c5.5-3 14.5-3 20 0m-20 3.5c5.5-3 14.5-3 20 0" stroke="#fff"/></g></svg>`,
  'q': `<svg viewBox="0 0 45 45" xmlns="http://www.w3.org/2000/svg"><g fill="#000" stroke="#000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="12" r="2.75" fill="#000"/><circle cx="14" cy="9" r="2.75" fill="#000"/><circle cx="22.5" cy="8" r="2.75" fill="#000"/><circle cx="31" cy="9" r="2.75" fill="#000"/><circle cx="39" cy="12" r="2.75" fill="#000"/><path d="M9 26c8.5-8.5 15.5-8.5 27 0l2.5-12.5L31 25l-.3-14.1-8.2 13.1-8.2-13.1L14 25 6.5 13.5 9 26z"/><path d="M9 26c0 2 1.5 2 2.5 4 1 1.5 1 1 .5 3.5-1.5 1-1.5 2.5-1.5 2.5-1.5 1.5.5 2.5.5 2.5 6.5 1 16.5 1 23 0 0 0 1.5-1 0-2.5 0 0 .5-1.5-1-2.5-.5-2.5-.5-2 .5-3.5 1-2 2.5-2 2.5-4-8.5-1.5-18.5-1.5-27 0z"/><path d="M11 38.5a35 35 1 0 0 23 0M11 29a35 35 1 0 1 23 0M12.5 31.5h20M11.5 34.5h22M10.5 37.5h24" stroke="#fff"/></g></svg>`,
  'r': `<svg viewBox="0 0 45 45" xmlns="http://www.w3.org/2000/svg"><g fill="#000" stroke="#000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 39h27v-3H9v3zM12.5 32l1.5-2.5h17l1.5 2.5h-20zM12 36v-4h21v4H12z"/><path d="M14 29.5v-13h17v13H14z"/><path d="M9 12l3.5 3h20l3.5-3V9H9v3zM9 9h27"/><path d="M11 12v2.5M14 12v2.5M17 12v2.5M20 12v2.5M23 12v2.5M26 12v2.5M29 12v2.5M32 12v2.5M34 12v2.5" stroke="#fff"/></g></svg>`,
  'b': `<svg viewBox="0 0 45 45" xmlns="http://www.w3.org/2000/svg"><g fill="#000" stroke="#000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><g stroke-linecap="butt"><path d="M9 36c3.39-.97 10.11.43 13.5-2 3.39 2.43 10.11 1.03 13.5 2 0 0 1.65.54 3 2-.68.97-1.65.99-3 .5-3.39-.97-10.11.46-13.5-1-3.39 1.46-10.11.03-13.5 1-1.354.49-2.323.47-3-.5 1.354-1.94 3-2 3-2z"/><path d="M15 32c2.5 2.5 12.5 2.5 15 0 .5-1.5 0-2 0-2 0-2.5-2.5-4-2.5-4 5.5-1.5 6-11.5-5-15.5-11 4-10.5 14-5 15.5 0 0-2.5 1.5-2.5 4 0 0-.5.5 0 2z"/><path d="M25 8a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z"/></g><path d="M17.5 26h10M15 30h15" stroke="#fff" stroke-linejoin="miter"/></g></svg>`,
  'n': `<svg viewBox="0 0 45 45" xmlns="http://www.w3.org/2000/svg"><g fill="#000" stroke="#000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 10c10.5 1 16.5 8 16 29H15c0-9 10-6.5 8-21"/><path d="M24 18c.38 5.12-2.38 5.88-4 10 2.5 2.5 7.5 2 8 0 1.38-3.12-.38-8-4-10z"/><path d="M9.5 25.5a.5.5 0 1 0 1 0 .5.5 0 1 0-1 0z" fill="#fff"/><path d="M14.933 15.75a5 5 0 0 1-2.433 6.544 5 5 0 0 1-6.5-2.5 5 5 0 0 1 2.5-6.5 5 5 0 0 1 6.433 2.456z"/></g></svg>`,
  'p': `<svg viewBox="0 0 45 45" xmlns="http://www.w3.org/2000/svg"><path d="M22.5 9c-2.21 0-4 1.79-4 4 0 .89.29 1.71.78 2.38-1.95 1.12-3.28 3.21-3.28 5.62 0 2.03.98 3.84 2.5 5-5.5 1.9-9.5 7.5-9.5 14h28c0-6.5-4-12.1-9.5-14 1.52-1.16 2.5-2.97 2.5-5 0-2.41-1.33-4.5-3.28-5.62.49-.67.78-1.49.78-2.38 0-2.21-1.79-4-4-4z" fill="#000" stroke="#000" stroke-width="1.5" stroke-linecap="round"/></svg>`,
};

export class BoardRenderer {
  constructor(container) {
    this.container = container;
    this.flipped = false;
    this.highlighted = { from: -1, to: -1 };
    this.selected = -1;
    this._render([]);
  }

  setFlipped(f) {
    this.flipped = f;
  }

  highlight(from, to) {
    this.highlighted = { from, to };
  }

  render(board) {
    this._render(board);
  }

  _render(board) {
    const size = this.container.clientWidth || 480;
    const sq = size / 8;

    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
    svg.setAttribute('width', size);
    svg.setAttribute('height', size);
    svg.style.display = 'block';

    const LIGHT = '#f0d9b5';
    const DARK  = '#b58863';
    const HL_FROM = 'rgba(20,85,30,0.5)';
    const HL_TO   = 'rgba(20,85,30,0.5)';

    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const boardR = this.flipped ? 7 - r : r;
        const boardC = this.flipped ? 7 - c : c;
        const idx = boardR * 8 + boardC;

        const isLight = (r + c) % 2 === 0;
        const rect = document.createElementNS(svgNS, 'rect');
        rect.setAttribute('x', c * sq);
        rect.setAttribute('y', r * sq);
        rect.setAttribute('width', sq);
        rect.setAttribute('height', sq);
        rect.setAttribute('fill', isLight ? LIGHT : DARK);
        svg.appendChild(rect);

        // Highlight
        if (idx === this.highlighted.from || idx === this.highlighted.to) {
          const hl = document.createElementNS(svgNS, 'rect');
          hl.setAttribute('x', c * sq);
          hl.setAttribute('y', r * sq);
          hl.setAttribute('width', sq);
          hl.setAttribute('height', sq);
          hl.setAttribute('fill', idx === this.highlighted.from ? HL_FROM : HL_TO);
          svg.appendChild(hl);
        }

        // Piece
        const piece = board[idx];
        if (piece && PIECE_SVG[piece]) {
          const fo = document.createElementNS(svgNS, 'foreignObject');
          fo.setAttribute('x', c * sq + sq * 0.05);
          fo.setAttribute('y', r * sq + sq * 0.05);
          fo.setAttribute('width', sq * 0.9);
          fo.setAttribute('height', sq * 0.9);
          fo.innerHTML = PIECE_SVG[piece];
          svg.appendChild(fo);
        }

        // Rank labels (left edge)
        if (c === 0) {
          const label = document.createElementNS(svgNS, 'text');
          label.setAttribute('x', 3);
          label.setAttribute('y', r * sq + 14);
          label.setAttribute('font-size', 11);
          label.setAttribute('fill', isLight ? DARK : LIGHT);
          label.setAttribute('font-family', 'monospace');
          label.textContent = this.flipped ? (r + 1) : (8 - r);
          svg.appendChild(label);
        }
        // File labels (bottom edge)
        if (r === 7) {
          const label = document.createElementNS(svgNS, 'text');
          label.setAttribute('x', c * sq + sq - 10);
          label.setAttribute('y', size - 3);
          label.setAttribute('font-size', 11);
          label.setAttribute('fill', isLight ? DARK : LIGHT);
          label.setAttribute('font-family', 'monospace');
          label.textContent = this.flipped ? 'hgfedcba'[c] : 'abcdefgh'[c];
          svg.appendChild(label);
        }
      }
    }

    this.container.innerHTML = '';
    this.container.appendChild(svg);
  }
}