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
 * Like canFormTriplets, but each set may be a pung (3) OR a kong (4). Jokers
 * are wild inside any set. Used by the win check now that kongs are allowed.
 * Requires consuming ALL tiles into exactly `needed` sets.
 */
export function canFormSets(counts, jokers, needed) {
  const keys = Object.keys(counts).filter((k) => counts[k] > 0);
  if (needed === 0) return keys.length === 0 && jokers === 0;
  // An all-joker set of 3 or 4.
  for (const size of [3, 4]) {
    if (jokers >= size && canFormSets(counts, jokers - size, needed - 1)) return true;
  }
  if (keys.length === 0) return false;
  const k = keys[0];
  for (const size of [3, 4]) {
    const maxReal = Math.min(counts[k], size);
    for (let real = 1; real <= maxReal; real++) {
      const joke = size - real;
      if (joke <= jokers) {
        const next = { ...counts, [k]: counts[k] - real };
        if (next[k] === 0) delete next[k];
        if (canFormSets(next, jokers - joke, needed - 1)) return true;
      }
    }
  }
  return false;
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
export function isWinningHand(tiles) {
  const n = tiles.length;
  if (n < 14 || n > 18) return false;
  const { c, jokers } = countsByKey(tiles);
  for (const k of Object.keys(c)) {
    if (c[k] >= 2) {
      const rest = { ...c, [k]: c[k] - 2 };
      if (rest[k] === 0) delete rest[k];
      if (canFormSets(rest, jokers, 4)) return true;
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

  // A set is only "done" (gold ✓) once she has LOCKED it (an exposed set). Tiles
  // she merely holds — even a full triple or a pair+Joker — show as "in
  // progress", never done. This is the honest distinction: she hasn't committed
  // them yet (and can't always see which tiles a detected set would use), so we
  // don't claim them. It also nudges her to press "Make this set" to lock one.
  let buildingSets = 0; // in-hand groups already complete (triple or pair+Joker)
  for (const k of Object.keys(counts)) {
    while (counts[k] >= 3) { counts[k] -= 3; buildingSets++; }
  }
  for (const k of Object.keys(counts)) {
    if (counts[k] === 2 && jk >= 1) { counts[k] -= 2; jk -= 1; buildingSets++; }
  }
  // Remaining real pairs are also progress toward a set (one tile away).
  const partialPairs = Object.keys(counts).filter((k) => counts[k] === 2).length;

  const locked = Math.min(4, exposedCount); // committed sets — the only "done"
  const building = buildingSets + partialPairs; // everything in progress

  const setSlots = [];
  for (let i = 0; i < 4; i++) {
    if (i < locked) setSlots.push("done");
    else if (i < locked + building) setSlots.push("partial");
    else setSlots.push("empty");
  }
  const pairSlot = hasPair ? "done" : "empty";

  // Keys she has exactly two of in hand — one more of any completes a set.
  // Drives both the draw-assist and the coach's "you're one away" nudges.
  const wantComplete = Object.keys(c).filter((k) => c[k] === 2);
  return { sets: locked, locked, building, hasPair, setSlots, pairSlot, partialPairs, wantComplete };
}

/**
 * Like analyzeHand, but returns the ACTUAL tile objects making up what she's
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

/**
 * Given a winning hand (14–18 tiles), return ONE concrete way it forms 4 sets
 * + a pair, as actual tile objects: { sets: [[...3 or 4]...], pair: [t,t] }, or
 * null if it isn't a win. Each set is a pung (3) or kong (4). Used to SHOW her
 * how she won (the win-checker re-arranges all tiles, so the winning grouping
 * isn't always the one she locked). The pair is two identical REAL tiles.
 */
export function decomposeWin(tiles) {
  if (!tiles || tiles.length < 14 || tiles.length > 18) return null;
  const jokers = tiles.filter((t) => t.isJoker);
  const byKey = {};
  for (const t of tiles) if (!t.isJoker) (byKey[t.key] = byKey[t.key] || []).push(t);

  // buildSets: carve `needed` sets (each a pung of 3 or kong of 4) out of the
  // remaining real tiles + jokers, consuming everything.
  const buildSets = (rem, jk, needed) => {
    const keys = Object.keys(rem).filter((k) => rem[k].length > 0);
    if (needed === 0) return keys.length === 0 && jk.length === 0 ? [] : null;
    for (const size of [3, 4]) {
      if (jk.length >= size) {
        const res = buildSets(rem, jk.slice(size), needed - 1);
        if (res) return [jk.slice(0, size), ...res];
      }
    }
    if (keys.length === 0) return null;
    const k = keys[0];
    for (const size of [3, 4]) {
      const maxReal = Math.min(rem[k].length, size);
      for (let r = 1; r <= maxReal; r++) {
        const j = size - r;
        if (j <= jk.length) {
          const setTiles = [...rem[k].slice(0, r), ...jk.slice(0, j)];
          const nextRem = { ...rem, [k]: rem[k].slice(r) };
          if (nextRem[k].length === 0) delete nextRem[k];
          const res = buildSets(nextRem, jk.slice(j), needed - 1);
          if (res) return [setTiles, ...res];
        }
      }
    }
    return null;
  };

  for (const pk of Object.keys(byKey)) {
    if (byKey[pk].length >= 2) {
      const pair = byKey[pk].slice(0, 2);
      const rem = {};
      for (const k of Object.keys(byKey)) {
        const arr = k === pk ? byKey[k].slice(2) : byKey[k].slice();
        if (arr.length) rem[k] = arr;
      }
      const sets = buildSets(rem, [...jokers], 4);
      if (sets) return { sets, pair };
    }
  }
  return null;
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
