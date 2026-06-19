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

/**
 * Can the remaining real-tile counts + `jokers` wild tiles be partitioned
 * into exactly `needed` sets of three? Jokers are wild inside a set of three.
 *
 * Greedy on the first remaining key, trying every legal real/joker split for
 * a set built around it, PLUS the option of spending three jokers as their
 * own all-joker set while real tiles remain. That last branch (CLAUDE.md §6
 * port note) is what makes the search complete: without it, a decomposition
 * that needs a standalone joker pung before all real keys are consumed is
 * missed. It can never produce a false positive — three jokers is always a
 * legal set — it only widens the search.
 */
export function canFormTriplets(counts, jokers, needed) {
  const keys = Object.keys(counts).filter((k) => counts[k] > 0).sort();
  if (keys.length === 0) return jokers % 3 === 0 && jokers / 3 === needed;
  if (needed === 0) return false;

  // Option A: spend three jokers as their own set, leaving real keys intact.
  if (jokers >= 3 && canFormTriplets(counts, jokers - 3, needed - 1)) return true;

  // Option B: build a set around the first remaining real key.
  const k = keys[0],
    have = counts[k],
    tries = [];
  if (have >= 3) tries.push([3, 0]);
  if (have >= 2 && jokers >= 1) tries.push([2, 1]);
  if (have >= 1 && jokers >= 2) tries.push([1, 2]);
  for (const [real, joke] of tries) {
    const next = { ...counts, [k]: have - real };
    if (next[k] === 0) delete next[k];
    if (canFormTriplets(next, jokers - joke, needed - 1)) return true;
  }
  return false;
}

/**
 * The practice-mode win goal (CLAUDE.md §3): 4 sets of three matching tiles
 * + 1 pair. Jokers are wild inside a set of three, but NEVER in the pair —
 * so the pair is always chosen from two identical real tiles.
 */
export function isWinningHand(tiles) {
  if (tiles.length !== 14) return false;
  const { c, jokers } = countsByKey(tiles);
  for (const k of Object.keys(c)) {
    if (c[k] >= 2) {
      const rest = { ...c, [k]: c[k] - 2 };
      if (rest[k] === 0) delete rest[k];
      if (canFormTriplets(rest, jokers, 4)) return true;
    }
  }
  return false;
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
 * Best-effort read of how close a hand is to the practice goal (4 sets + pair),
 * used to drive the on-screen goal panel and the coach's guidance. NOT the
 * authoritative win test — isWinningHand() remains the source of truth.
 *
 * `concealed` is the in-hand tiles; `exposedCount` is how many sets she has
 * already locked down (each exposed group is one complete set). We greedily
 * reserve a pair from the concealed tiles, then count concealed triplets
 * (jokers wild), and report filled / partial / empty slots.
 */
export function analyzeHand(concealed, exposedCount = 0) {
  const { c, jokers } = countsByKey(concealed);
  const counts = { ...c };
  let jk = jokers;

  // Reserve the pair from two identical REAL tiles — never a joker (per goal).
  // Prefer a key with exactly two so we don't break up triplet material.
  const exactTwo = Object.keys(counts).filter((k) => counts[k] === 2);
  const atLeastTwo = Object.keys(counts).filter((k) => counts[k] >= 2).sort((a, b) => counts[a] - counts[b]);
  const pairKey = exactTwo[0] || atLeastTwo[0];
  let hasPair = false;
  if (pairKey) {
    counts[pairKey] -= 2;
    if (counts[pairKey] === 0) delete counts[pairKey];
    hasPair = true;
  }

  // Greedily build triplets from what's left (jokers wild).
  let concealedSets = 0;
  let changed = true;
  while (changed) {
    changed = false;
    const k3 = Object.keys(counts).find((k) => counts[k] >= 3);
    if (k3) { counts[k3] -= 3; if (counts[k3] === 0) delete counts[k3]; concealedSets++; changed = true; continue; }
    const k2 = Object.keys(counts).find((k) => counts[k] === 2);
    if (k2 && jk >= 1) { delete counts[k2]; jk -= 1; concealedSets++; changed = true; continue; }
    const k1 = Object.keys(counts).find((k) => counts[k] === 1);
    if (k1 && jk >= 2) { delete counts[k1]; jk -= 2; concealedSets++; changed = true; continue; }
    if (jk >= 3) { jk -= 3; concealedSets++; changed = true; continue; }
  }

  const sets = Math.min(4, exposedCount + concealedSets);
  // Remaining real pairs are "partial" sets (one tile away).
  const partialPairs = Object.keys(counts).filter((k) => counts[k] === 2).length;

  const setSlots = [];
  for (let i = 0; i < 4; i++) {
    if (i < sets) setSlots.push("done");
    else if (i < sets + partialPairs) setSlots.push("partial");
    else setSlots.push("empty");
  }
  const pairSlot = hasPair ? "done" : exactTwo.length || atLeastTwo.length ? "partial" : "empty";

  // Keys she has exactly two of in hand — one more of any completes a set.
  // Drives both the draw-assist and the coach's "you're one away" nudges.
  const wantComplete = Object.keys(c).filter((k) => c[k] === 2);
  return { sets, hasPair, setSlots, pairSlot, partialPairs, wantComplete };
}

/**
 * "Guided win" draw-assist (CLAUDE.md §1 — she cannot lose, and a nervous
 * beginner needs to feel progress). Returns the index of the most helpful
 * tile in the wall: one that completes a set she's building > a Joker > one
 * that makes a new pair. Falls back to the top of the wall (index 0) when
 * nothing helps. Keeps the game moving toward a satisfying Mahjong.
 */
export function pickAssistedDrawIndex(wall, concealed) {
  const { c } = countsByKey(concealed);
  let bestIdx = 0, bestScore = 0;
  wall.forEach((t, i) => {
    let score;
    if (t.isJoker) score = 4;
    else {
      const have = c[t.key] || 0;
      score = have >= 2 ? 6 : have === 1 ? 2 : 0;
    }
    if (score > bestScore) { bestScore = score; bestIdx = i; }
  });
  return bestIdx;
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
