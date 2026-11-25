// Turns a level file ({ map, spots, legend, ... }) into the contract shape (cells, things, legend).
//
// Level files are written as one `map` so a level can be read as a single picture. Each map
// char is one of:
//   - a legend char: that cell, nothing on it
//   - a thing char (config THING_CHARS): the thing, standing on the same kind of floor as the
//     nearest plain cell to its left, right, above or below (in that order)
//   - a `spots` char: spots[ch] = cell char + thing char, for the places where the neighbour
//     rule would pick the wrong floor
// Legend chars therefore never reuse a thing char. tools/validate-levels.mjs checks the result.

import { THING_CHARS, THING_EMPTY } from '../config.js';

export function build({ map, spots = {}, ...level }) {
  const { legend, id } = level;
  for (const ch of [...Object.keys(legend), ...Object.keys(spots)]) {
    if (THING_CHARS[ch]) throw new Error(`${id}: '${ch}' is a thing char and cannot be a legend or spots char`);
  }
  const isThing = (ch) => THING_CHARS[ch] !== undefined || spots[ch] !== undefined;
  const plain = (ch) => {
    const d = legend[ch];
    return d && !d.solid && !d.door && !d.lift && !d.secret && !d.trigger && !d.damage;
  };
  const floorUnder = (x, y) => {
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      let nx = x + dx, ny = y + dy;
      while (map[ny] && map[ny][nx] !== undefined && isThing(map[ny][nx])) { nx += dx; ny += dy; }
      const ch = map[ny] && map[ny][nx];
      if (ch !== undefined && plain(ch)) return ch;
    }
    throw new Error(`${id}: no plain floor next to '${map[y][x]}' at ${x},${y}; add a spots entry`);
  };
  const cells = [], things = [];
  map.forEach((row, y) => {
    let c = '', t = '';
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      if (spots[ch]) { c += spots[ch][0]; t += spots[ch][1]; }
      else if (THING_CHARS[ch]) { c += floorUnder(x, y); t += ch; }
      else { c += ch; t += THING_EMPTY; }
    }
    cells.push(c);
    things.push(t);
  });
  return { ...level, cells, things };
}
