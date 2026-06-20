/* ------------------------------------------------------------------ *
 *  lib/tiles.js — the deterministic Mahjong engine.
 *
 *  This file owns ALL the arithmetic and rules: the tile vocabulary,
 *  the wall, sorting, and win-structure checking. Per CLAUDE.md §4/§12,
 *  the LLM never does any of this — it only phrases warm coaching.
 *
 *  Pure, framework-free, and unit-testable (see lib/tiles.test.js).
 * ------------------------------------------------------------------ */

export const SUITS = {
  crak: { name: "Crak", glyphs: ["🀇", "🀈", "🀉", "🀊", "🀋", "🀌", "🀍", "🀎", "🀏"] },
  bam: { name: "Bam", glyphs: ["🀐", "🀑", "🀒", "🀓", "🀔", "🀕", "🀖", "🀗", "🀘"] },
  dot: { name: "Dot", glyphs: ["🀙", "🀚", "🀛", "🀜", "🀝", "🀞", "🀟", "🀠", "🀡"] },
};

export const WINDS = [
  { key: "E", glyph: "🀀", label: "East Wind" },
  { key: "S", glyph: "🀁", label: "South Wind" },
  { key: "W", glyph: "🀂", label: "West Wind" },
  { key: "N", glyph: "🀃", label: "North Wind" },
];

export const DRAGONS = [
  { key: "RD", glyph: "🀄", label: "Red Dragon" },
  { key: "GD", glyph: "🀅", label: "Green Dragon" },
  { key: "WD", glyph: "🀆", label: "White Dragon" },
];

export function makeTile(key, glyph, label, isJoker = false) {
  return { id: Math.random().toString(36).slice(2), key, glyph, label, isJoker };
}

export function buildWall() {
  const wall = [];
  for (const s of Object.keys(SUITS)) {
    SUITS[s].glyphs.forEach((g, i) => {
      const label = `${i + 1} ${SUITS[s].name}`;
      for (let n = 0; n < 4; n++) wall.push(makeTile(`${s}${i + 1}`, g, label));
    });
  }
  for (const w of WINDS) for (let n = 0; n < 4; n++) wall.push(makeTile(w.key, w.glyph, w.label));
  for (const d of DRAGONS) for (let n = 0; n < 4; n++) wall.push(makeTile(d.key, d.glyph, d.label));
  for (let n = 0; n < 8; n++) wall.push(makeTile("JOKER", "🃏", "Joker", true));
  for (let i = wall.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [wall[i], wall[j]] = [wall[j], wall[i]];
  }
  return wall;
}

export const ORDER = (() => {
  const o = {};
  let i = 0;
  for (const s of Object.keys(SUITS)) for (let n = 1; n <= 9; n++) o[`${s}${n}`] = i++;
  for (const w of WINDS) o[w.key] = i++;
  for (const d of DRAGONS) o[d.key] = i++;
  o["JOKER"] = i++;
  return o;
})();

export const sortHand = (h) => [...h].sort((a, b) => ORDER[a.key] - ORDER[b.key]);

export function countsByKey(tiles) {
  const c = {};
  let jokers = 0;
  for (const t of tiles) {
    if (t.isJoker) jokers++;
    else c[t.key] = (c[t.key] || 0) + 1;
  }
  return { c, jokers };
}

/* ------------------------------------------------------------------ *
 *  The ONE generic partitioner.
 *
 *  partition(tiles, spec) attempts to consume ALL of `tiles` into exactly
 *  the groups the spec requires, honoring the spec's constraints. It returns
 *  the labeled groups (actual tile objects) or null if no arrangement works.
 *  Every winning-line check and isWinningHand are expressed through it.
 *
 *  spec shape:
 *    {
 *      groups: [ { kind: 'set'|'kong'|'pair', count: N }, ... ],
 *      constraints?: { oneSuit?: boolean, noJokers?: boolean },
 *    }
 *  Group kinds:
 *    'set'  — size 3 OR 4, jokers wild (fills with jokers around one real key).
 *    'kong' — size exactly 4, jokers wild.
 *    'pair' — exactly 2 identical REAL tiles; jokers are NEVER allowed.
 *  Constraints:
 *    oneSuit  — every non-joker tile shares one suit (crak/bam/dot); no honors.
 *    noJokers — the whole hand must contain zero jokers.
 *
 *  Returns: { groups: [{ label, tiles }] } | null   (label 'Set'|'Kong'|'Pair')
 * ------------------------------------------------------------------ */

const SET_SIZES = { set: [3, 4], kong: [4] };
const GROUP_LABEL = { set: "Set", kong: "Kong", pair: "Pair" };

export function partition(tiles, spec) {
  const constraints = spec.constraints || {};
  const jokerTiles = tiles.filter((t) => t.isJoker);

  // Constraint: noJokers — the whole hand must be joker-free.
  if (constraints.noJokers && jokerTiles.length > 0) return null;

  // Constraint: oneSuit — every real tile shares a single suit, no honors.
  if (constraints.oneSuit) {
    const suits = new Set();
    for (const t of tiles) {
      if (t.isJoker) continue;
      const s = suitOf(t.key);
      if (!s) return null; // an honor tile — not allowed in a one-suit hand
      suits.add(s);
    }
    if (suits.size > 1) return null;
  }

  // Tile count must match exactly: sum of group sizes (pairs=2, kongs=4, sets
  // 3 or 4) — pick the cheapest (3) per set as the lower bound and 4 as upper.
  const byKey = {};
  for (const t of tiles) if (!t.isJoker) (byKey[t.key] = byKey[t.key] || []).push(t);

  // Order groups so pairs are reserved first (jokers never go to pairs), then
  // kongs, then sets — a stable, deterministic search order.
  const reqGroups = spec.groups.flatMap((g) =>
    Array.from({ length: g.count }, () => g.kind)
  );
  const order = { pair: 0, kong: 1, set: 2 };
  const ordered = [...reqGroups].sort((a, b) => order[a] - order[b]);

  // Recursive solver: carve each required group out of the remaining real
  // tiles (`rem`) + jokers (`jk`), consuming everything when done.
  const solve = (rem, jk, idx) => {
    if (idx === ordered.length) {
      const keysLeft = Object.keys(rem).some((k) => rem[k].length > 0);
      return !keysLeft && jk.length === 0 ? [] : null;
    }
    const kind = ordered[idx];
    const keys = Object.keys(rem).filter((k) => rem[k].length > 0);

    if (kind === "pair") {
      // Exactly two identical REAL tiles — never jokers.
      for (const k of keys) {
        if (rem[k].length >= 2) {
          const pair = rem[k].slice(0, 2);
          const next = { ...rem, [k]: rem[k].slice(2) };
          const sub = solve(next, jk, idx + 1);
          if (sub) return [{ label: "Pair", tiles: pair }, ...sub];
        }
      }
      return null;
    }

    // 'set' or 'kong': sizes from SET_SIZES, jokers wild.
    const sizes = SET_SIZES[kind];
    const label = GROUP_LABEL[kind];
    // Option A: an all-joker group.
    for (const size of sizes) {
      if (jk.length >= size) {
        const sub = solve(rem, jk.slice(size), idx + 1);
        if (sub) return [{ label, tiles: jk.slice(0, size) }, ...sub];
      }
    }
    if (keys.length === 0) return null;
    // Option B: build around the first remaining real key (jokers fill the rest).
    const k = keys[0];
    for (const size of sizes) {
      for (let real = 1; real <= Math.min(rem[k].length, size); real++) {
        const joke = size - real;
        if (joke <= jk.length) {
          const g = [...rem[k].slice(0, real), ...jk.slice(0, joke)];
          const next = { ...rem, [k]: rem[k].slice(real) };
          const sub = solve(next, jk.slice(joke), idx + 1);
          if (sub) return [{ label, tiles: g }, ...sub];
        }
      }
    }
    return null;
  };

  const groups = solve(byKey, jokerTiles, 0);
  return groups ? { groups } : null;
}

/** The suit of a key ('crak'|'bam'|'dot'), or null for winds/dragons/jokers. */
export function suitOf(key) {
  if (key.startsWith("crak")) return "crak";
  if (key.startsWith("bam")) return "bam";
  if (key.startsWith("dot")) return "dot";
  return null;
}

/** Three tiles forming a valid set (pung) — see also isValidKong for four. */
export function isValidKong(tiles) {
  if (!tiles || tiles.length !== 4) return false;
  const realKeys = new Set(tiles.filter((t) => !t.isJoker).map((t) => t.key));
  return realKeys.size <= 1; // all real tiles share one key (jokers wild)
}

/**
 * The practice-mode win goal (CLAUDE.md §3): 4 sets + 1 pair. Each set is a
 * pung (3) or a kong (4); jokers are wild inside a set but NEVER in the pair
 * (the pair is two identical real tiles). A kong adds a tile (paid for by its
 * replacement draw), so a winning hand is 14–18 tiles: 4×{3 or 4} + 2.
 */
export const FOUR_SETS_PAIR_SPEC = {
  groups: [
    { kind: "set", count: 4 },
    { kind: "pair", count: 1 },
  ],
};

export function isWinningHand(tiles) {
  const n = tiles.length;
  if (n < 14 || n > 18) return false;
  return !!partition(tiles, FOUR_SETS_PAIR_SPEC);
}

/** Fisher–Yates shuffle, returning a new array (used to recycle the wall). */
export function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Are these exactly three tiles a valid set? Three of one real key, with
 *  jokers wild (so 3 identical, 2+joker, 1+2 jokers, or 3 jokers all pass). */
export function isValidSet(tiles) {
  if (!tiles || tiles.length !== 3) return false;
  const realKeys = new Set(tiles.filter((t) => !t.isJoker).map((t) => t.key));
  return realKeys.size <= 1; // all real tiles share one key (or there are none)
}

/**
 * Returns the ACTUAL tile objects making up what she's
 * holding, so the UI can outline those slots and highlight the matching tiles:
 *   { pair: [t,t]|null, sets: [[t,t,t]...], building: [[t,t]...] }
 * `pair` is the reserved pair, `sets` are complete groups she HOLDS (triple or
 * pair+Joker — not yet locked), `building` are leftover pairs working toward a
 * set. Mirrors analyzeHand's choices so the panel and counts agree.
 */
export function handGroups(concealed) {
  const jokers = concealed.filter((t) => t.isJoker);
  const rem = {};
  for (const t of concealed) if (!t.isJoker) (rem[t.key] = rem[t.key] || []).push(t);
  const keys = Object.keys(rem);

  // Reserve the pair from two identical REAL tiles (prefer an exact pair).
  const exactTwo = keys.filter((k) => rem[k].length === 2);
  const atLeastTwo = keys.filter((k) => rem[k].length >= 2).sort((a, b) => rem[a].length - rem[b].length);
  const pairKey = exactTwo[0] || atLeastTwo[0];
  let pair = null;
  if (pairKey) { pair = rem[pairKey].slice(0, 2); rem[pairKey] = rem[pairKey].slice(2); }

  let jk = jokers.slice();
  const sets = [];
  for (const k of keys) {
    while ((rem[k] || []).length >= 3) { sets.push(rem[k].slice(0, 3)); rem[k] = rem[k].slice(3); }
  }
  for (const k of keys) {
    if ((rem[k] || []).length === 2 && jk.length >= 1) {
      sets.push([rem[k][0], rem[k][1], jk[0]]);
      rem[k] = [];
      jk = jk.slice(1);
    }
  }
  const building = [];
  for (const k of keys) if ((rem[k] || []).length === 2) building.push(rem[k].slice(0, 2));

  return { pair, sets, building };
}

/**
 * "Guided win" draw-assist (CLAUDE.md §1 — she cannot lose, and a nervous
 * beginner needs to feel progress). Returns the index of the most helpful
 * tile in the wall: one that completes a set she's building > a Joker > one
 * that makes a new pair. Falls back to the top of the wall (index 0) when
 * nothing helps. Keeps the game moving toward a satisfying Mahjong.
 */
export function pickAssistedDrawIndex(wall, concealed, kind = "set") {
  const { c } = countsByKey(concealed);
  let bestIdx = 0, bestScore = 0;
  wall.forEach((t, i) => {
    const have = t.isJoker ? 0 : c[t.key] || 0;
    let score;
    if (kind === "pair") {
      // Seven pairs: chase natural pairs; Jokers can't pair, so they're useless.
      score = t.isJoker ? 0 : have === 1 ? 6 : have === 0 ? 1 : 0;
    } else if (kind === "kong") {
      // Chase four-of-a-kind; a Joker helps any kong.
      score = t.isJoker ? 4 : have >= 3 ? 6 : have === 2 ? 4 : have === 1 ? 2 : 0;
    } else {
      // Default: chase sets of three (a Joker completes any set).
      score = t.isJoker ? 4 : have >= 2 ? 6 : have === 1 ? 2 : 0;
    }
    if (score > bestScore) { bestScore = score; bestIdx = i; }
  });
  return bestIdx;
}

/**
 * Exact, engine-computed facts about a hand for the coach to PHRASE — never
 * to recount (CLAUDE.md §4/§12, the LLM-never-does-arithmetic moat). Returns
 * the ready-made sets (three+ of a key), the pairs (one tile away), the lone
 * singles, and the Joker count — all as plain tile labels.
 */
export function coachFacts(tiles) {
  const counts = {}, labels = {};
  let jokers = 0;
  for (const t of tiles) {
    if (t.isJoker) { jokers++; continue; }
    counts[t.key] = (counts[t.key] || 0) + 1;
    labels[t.key] = t.label;
  }
  const readySets = [], pairs = [], singles = [];
  for (const k of Object.keys(counts)) {
    if (counts[k] >= 3) readySets.push(labels[k]);
    else if (counts[k] === 2) pairs.push(labels[k]);
    else singles.push(labels[k]);
  }
  return { readySets, pairs, singles, jokers };
}

/**
 * Which tile a bot lets go of: the least useful one. Prefers a lone single,
 * then a tile from the smallest group, and never a Joker if anything else is
 * available. Deliberately simple — the bots draw blind (no assist), so they
 * rarely complete, which keeps the human player winning while learning.
 */
export function chooseDiscard(tiles) {
  const { c } = countsByKey(tiles);
  const nonJokers = tiles.filter((t) => !t.isJoker);
  return (
    nonJokers.find((t) => c[t.key] === 1) ||
    [...nonJokers].sort((a, b) => c[a.key] - c[b.key])[0] ||
    tiles[0]
  );
}

/** A gentle, always-available hint when the coach API is unavailable. */
export function localHint(tiles) {
  const { c, jokers } = countsByKey(tiles);
  const trips = Object.keys(c).filter((k) => c[k] >= 3);
  const pairs = Object.keys(c).filter((k) => c[k] === 2);
  const label = (k) => tiles.find((t) => t.key === k)?.label || k;
  if (trips.length) return `You already have three ${label(trips[0])} tiles — that's a full set!`;
  if (pairs.length) return `You have a pair of ${label(pairs[0])}. One more makes a set.`;
  if (jokers) return `You're holding ${jokers} Joker${jokers > 1 ? "s" : ""} — keep those, they finish any set.`;
  return `See which of your tiles come in twos or threes, and let a lonely one go.`;
}
