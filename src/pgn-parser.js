/**
 * pgn-parser.js
 * Parses PGN strings into structured game data.
 * Handles: headers, move text, variations (ignored for now), comments, NAGs.
 */

export class PGNParser {
  parse(pgn) {
    pgn = pgn.trim();
    const headers = this._parseHeaders(pgn);
    const moves = this._parseMoves(pgn);
    return { headers, moves };
  }

  _parseHeaders(pgn) {
    const headers = {};
    const headerRegex = /\[(\w+)\s+"([^"]*)"\]/g;
    let m;
    while ((m = headerRegex.exec(pgn)) !== null) {
      headers[m[1]] = m[2];
    }
    return headers;
  }

  _parseMoves(pgn) {
    // Strip header section
    let moveText = pgn.replace(/\[.*?\]\s*/gs, '').trim();

    // Strip comments { ... }
    moveText = moveText.replace(/\{[^}]*\}/g, '');

    // Strip NAGs ($1, $2 etc)
    moveText = moveText.replace(/\$\d+/g, '');

    // Strip variations ( ... ) — nested too
    let prev;
    do {
      prev = moveText;
      moveText = moveText.replace(/\([^()]*\)/g, '');
    } while (moveText !== prev);

    // Strip result
    moveText = moveText.replace(/\s*(1-0|0-1|1\/2-1\/2|\*)\s*$/, '');

    // Tokenize
    const tokens = moveText.split(/\s+/).filter(t => t.length > 0);

    const moves = [];
    let moveNumber = null;

    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];

      // Move number: "1." or "1..." 
      if (/^\d+\.+$/.test(token)) {
        moveNumber = parseInt(token);
        continue;
      }

      // Skip result tokens
      if (/^(1-0|0-1|1\/2-1\/2|\*)$/.test(token)) continue;

      // It's a move
      if (moveNumber !== null || moves.length > 0) {
        moves.push({
          san: token,
          moveNumber: moveNumber ?? Math.ceil((moves.length + 1) / 2),
          color: moves.length % 2 === 0 ? 'w' : 'b',
          fen: null, // filled in by board.js after applying
        });
        // After white's move, moveNumber stays same for black
        if (moves.length % 2 === 0) moveNumber = null; // reset after black
      }
    }

    return moves;
  }
}

/**
 * Multiple games in one PGN file
 */
export function splitGames(pgn) {
  // Split on blank line before a header
  const games = pgn.split(/\n\s*\n(?=\[)/).filter(g => g.trim());
  return games;
}