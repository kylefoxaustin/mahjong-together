/* ------------------------------------------------------------------ *
 *  lib/lines.js — the "winning lines" she can choose to chase.
 *
 *  These are OUR OWN generic patterns (never the copyrighted NMJL card —
 *  CLAUDE.md §5). Each line owns a deterministic check() and decompose() so
 *  the engine — not the LLM — validates the win and shows how it's made.
 *
 *  - check(tiles)      → true if `tiles` win this line
 *  - decompose(tiles)  → { groups: [{label, tiles}] } | null  (for the win view)
 *  - assist            → what the Easy draw-assist should chase: 'set'|'kong'|'pair'
 *  - structure         → 'setspair' (N sets/kongs + a pair) | 'pairs' (seven pairs)
 *  - plan              → target slots for the goal panel, e.g. ['set','set','set','set','pair']
 *  - coachGoal         → the goal text handed to the coach
 * ------------------------------------------------------------------ */

import { countsByKey, handGroups } from "./tiles.js";

function suitOf(key) {
  if (key.startsWith("crak")) return "crak";
  if (key.startsWith("bam")) return "bam";
  if (key.startsWith("dot")) return "dot";
  return null; // winds / dragons are not a suit
}

/** Group `tiles` into `needed` sets (sizes ∈ `sizes`, jokers wild) + one pair
 *  (two identical real tiles). Returns { groups } of tile objects, or null. */
function decomposeSetsPair(tiles, needed, sizes) {
  const jokers = tiles.filter((t) => t.isJoker);
  const byKey = {};
  for (const t of tiles) if (!t.isJoker) (byKey[t.key] = byKey[t.key] || []).push(t);

  const build = (rem, jk, n) => {
    const keys = Object.keys(rem).filter((k) => rem[k].length > 0);
    if (n === 0) return keys.length === 0 && jk.length === 0 ? [] : null;
    for (const size of sizes) {
      if (jk.length >= size) {
        const r = build(rem, jk.slice(size), n - 1);
        if (r) return [{ label: size === 4 ? "Kong" : "Set", tiles: jk.slice(0, size) }, ...r];
      }
    }
    if (!keys.length) return null;
    const k = keys[0];
    for (const size of sizes) {
      for (let real = 1; real <= Math.min(rem[k].length, size); real++) {
        const joke = size - real;
        if (joke <= jk.length) {
          const g = [...rem[k].slice(0, real), ...jk.slice(0, joke)];
          const next = { ...rem, [k]: rem[k].slice(real) };
          if (next[k].length === 0) delete next[k];
          const r = build(next, jk.slice(joke), n - 1);
          if (r) return [{ label: size === 4 ? "Kong" : "Set", tiles: g }, ...r];
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
      const sets = build(rem, [...jokers], needed);
      if (sets) return { groups: [...sets, { label: "Pair", tiles: pair }] };
    }
  }
  return null;
}

/** Seven pairs: 14 tiles, NO jokers (jokers can't pair), every key even. */
function decomposeSevenPairs(tiles) {
  if (tiles.length !== 14) return null;
  const { c, jokers } = countsByKey(tiles);
  if (jokers > 0) return null;
  if (!Object.values(c).every((n) => n % 2 === 0)) return null;
  const byKey = {};
  for (const t of tiles) (byKey[t.key] = byKey[t.key] || []).push(t);
  const groups = [];
  for (const k of Object.keys(byKey)) {
    const arr = byKey[k];
    for (let i = 0; i < arr.length; i += 2) groups.push({ label: "Pair", tiles: [arr[i], arr[i + 1]] });
  }
  return groups.length === 7 ? { groups } : null;
}

function isOneSuit(tiles) {
  const suits = new Set();
  for (const t of tiles) {
    if (t.isJoker) continue;
    const s = suitOf(t.key);
    if (!s) return false; // an honor tile — not allowed in a one-suit hand
    suits.add(s);
  }
  return suits.size <= 1;
}

export const LINES = {
  foursets: {
    id: "foursets",
    name: "Four sets & a pair",
    blurb: "Four sets of three (or four), plus a pair. The classic goal.",
    assist: "set",
    structure: "setspair",
    plan: ["set", "set", "set", "set", "pair"],
    coachGoal: "build 4 sets plus 1 pair. A set is three matching tiles (or four — a kong); Jokers are wild inside a set, but never in the pair.",
    decompose: (tiles) => (tiles.length >= 14 && tiles.length <= 18 ? decomposeSetsPair(tiles, 4, [3, 4]) : null),
  },
  threekongs: {
    id: "threekongs",
    name: "Three kongs & a pair",
    blurb: "Three kongs (four-of-a-kind each), plus a pair. A big, bold hand.",
    assist: "kong",
    structure: "setspair",
    plan: ["kong", "kong", "kong", "pair"],
    coachGoal: "build 3 kongs plus 1 pair. A kong is FOUR matching tiles; Jokers are wild inside a kong, but never in the pair.",
    decompose: (tiles) => (tiles.length === 14 ? decomposeSetsPair(tiles, 3, [4]) : null),
  },
  onesuit: {
    id: "onesuit",
    name: "One suit",
    blurb: "Four sets and a pair, all in a single suit (Crak, Bam, or Dot).",
    assist: "set",
    structure: "setspair",
    plan: ["set", "set", "set", "set", "pair"],
    coachGoal: "build 4 sets plus 1 pair using ONE suit only (all Crak, all Bam, or all Dot — no winds or dragons). Jokers are wild inside a set, never in the pair.",
    decompose: (tiles) => (tiles.length >= 14 && tiles.length <= 18 && isOneSuit(tiles) ? decomposeSetsPair(tiles, 4, [3, 4]) : null),
  },
  sevenpairs: {
    id: "sevenpairs",
    name: "Seven pairs",
    blurb: "Seven pairs, no sets — and no Joker help, so it's a real challenge.",
    assist: "pair",
    structure: "pairs",
    plan: ["pair", "pair", "pair", "pair", "pair", "pair", "pair"],
    coachGoal: "build 7 pairs (two matching tiles each), with no sets at all. Jokers cannot be used in a pair, so set Jokers aside and collect natural pairs.",
    decompose: (tiles) => decomposeSevenPairs(tiles),
  },
};

export const LINE_ORDER = ["foursets", "threekongs", "onesuit", "sevenpairs"];

/** Does `tiles` win the given line? */
export function winsLine(lineId, tiles) {
  const line = LINES[lineId] || LINES.foursets;
  return !!line.decompose(tiles);
}

/**
 * Goal-panel progress for the chosen line: a slot per `plan` entry (locked =
 * committed/exposed, held = she's holding it, empty = not yet) plus the tile
 * ids to highlight. Generic across lines so the panel reflects whatever she's
 * chasing.
 */
export function lineProgress(lineId, concealed, exposed, lockedPair) {
  const line = LINES[lineId] || LINES.foursets;
  const { c } = countsByKey(concealed);
  const hg = handGroups(concealed); // { pair, sets, building }

  // Committed groups (exposed sets/kongs + her locked pair).
  let lockedKongs = 0, lockedSets = 0;
  for (const g of exposed) (g.length >= 4 ? lockedKongs++ : lockedSets++);
  const counters = {
    set: lockedKongs + lockedSets, // any exposed group fills a "set" slot
    kong: lockedKongs,
    pair: lockedPair ? 1 : 0,
  };
  // Held (in-hand) complete groups, by kind.
  const kongKeys = Object.keys(c).filter((k) => c[k] >= 4);
  const pairKeys = Object.keys(c).filter((k) => c[k] === 2);
  const held = { set: hg.sets.length, kong: kongKeys.length, pair: pairKeys.length };

  const slots = line.plan.map((kind) => {
    if (counters[kind] > 0) { counters[kind]--; return { kind, state: "locked" }; }
    if (held[kind] > 0) { held[kind]--; return { kind, state: "held" }; }
    return { kind, state: "empty" };
  });

  // Tiles to light up, depending on what she's chasing.
  let ids;
  if (line.assist === "kong") ids = concealed.filter((t) => kongKeys.includes(t.key)).map((t) => t.id);
  else if (line.assist === "pair") ids = concealed.filter((t) => pairKeys.includes(t.key)).map((t) => t.id);
  else ids = [...(hg.pair || []), ...hg.sets.flat()].map((t) => t.id);

  return { slots, hintIds: new Set(ids) };
}
