/* ------------------------------------------------------------------ *
 *  lib/lines.js — the "winning lines" she can choose to chase.
 *
 *  These are OUR OWN generic patterns (never the copyrighted NMJL card —
 *  CLAUDE.md §5). Each line is DECLARATIVE DATA (a spec) plus a generic
 *  interpreter that derives decompose()/winsLine() from the engine's single
 *  partition() partitioner. Adding a line = adding one data object.
 *
 *  Each LINES[id] exposes (the UI contract):
 *  - id, name, blurb
 *  - assist            → what the Easy draw-assist should chase: 'set'|'kong'|'pair'
 *  - structure         → 'setspair' (N sets/kongs + a pair) | 'pairs' (seven pairs)
 *  - plan              → goal-panel slots, e.g. ['set','set','set','set','pair']
 *  - coachGoal         → the goal text handed to the coach
 *  - decompose(tiles)  → { groups: [{label, tiles}] } | null  (for the win view)
 *  winsLine(id, tiles) = !!LINES[id].decompose(tiles).
 * ------------------------------------------------------------------ */

import { countsByKey, handGroups, partition } from "./tiles.js";

/* --- Declarative line specs ---------------------------------------- *
 * Each spec carries presentation fields + a `partition` spec (groups +
 * constraints) and an optional `accept(tiles)` size/shape gate. The generic
 * interpreter below turns each into a decompose() that the engine validates. */
const SPECS = {
  foursets: {
    id: "foursets",
    name: "Four sets & a pair",
    blurb: "Four sets of three (or four), plus a pair. The classic goal.",
    assist: "set",
    structure: "setspair",
    plan: ["set", "set", "set", "set", "pair"],
    coachGoal:
      "build 4 sets plus 1 pair. A set is three matching tiles (or four — a kong); Jokers are wild inside a set, but never in the pair.",
    accept: (t) => t.length >= 14 && t.length <= 18,
    partition: { groups: [{ kind: "set", count: 4 }, { kind: "pair", count: 1 }] },
  },
  threekongs: {
    id: "threekongs",
    name: "Three kongs & a pair",
    blurb: "Three kongs (four-of-a-kind each), plus a pair. A big, bold hand.",
    assist: "kong",
    structure: "setspair",
    plan: ["kong", "kong", "kong", "pair"],
    coachGoal:
      "build 3 kongs plus 1 pair. A kong is FOUR matching tiles; Jokers are wild inside a kong, but never in the pair.",
    accept: (t) => t.length === 14,
    partition: { groups: [{ kind: "kong", count: 3 }, { kind: "pair", count: 1 }] },
  },
  onesuit: {
    id: "onesuit",
    name: "One suit",
    blurb: "Four sets and a pair, all in a single suit (Crak, Bam, or Dot).",
    assist: "set",
    structure: "setspair",
    plan: ["set", "set", "set", "set", "pair"],
    coachGoal:
      "build 4 sets plus 1 pair using ONE suit only (all Crak, all Bam, or all Dot — no winds or dragons). Jokers are wild inside a set, never in the pair.",
    accept: (t) => t.length >= 14 && t.length <= 18,
    partition: {
      groups: [{ kind: "set", count: 4 }, { kind: "pair", count: 1 }],
      constraints: { oneSuit: true },
    },
  },
  sevenpairs: {
    id: "sevenpairs",
    name: "Seven pairs",
    blurb: "Seven pairs, no sets — and no Joker help, so it's a real challenge.",
    assist: "pair",
    structure: "pairs",
    plan: ["pair", "pair", "pair", "pair", "pair", "pair", "pair"],
    coachGoal:
      "build 7 pairs (two matching tiles each), with no sets at all. Jokers cannot be used in a pair, so set Jokers aside and collect natural pairs.",
    accept: (t) => t.length === 14,
    partition: {
      groups: [{ kind: "pair", count: 7 }],
      constraints: { noJokers: true },
    },
  },
};

/** Generic interpreter: turn a spec into a line object with decompose(). */
function makeLine(spec) {
  return {
    id: spec.id,
    name: spec.name,
    blurb: spec.blurb,
    assist: spec.assist,
    structure: spec.structure,
    plan: spec.plan,
    coachGoal: spec.coachGoal,
    decompose: (tiles) =>
      spec.accept(tiles) ? partition(tiles, spec.partition) : null,
  };
}

export const LINES = Object.fromEntries(
  Object.entries(SPECS).map(([id, spec]) => [id, makeLine(spec)])
);

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

  // Committed groups: exposed sets (3) / kongs (4) / pairs (2), + her locked pair.
  // In a pairs line, every exposed group counts as pairs (floor of its size), so
  // the panel still reflects locked pairs even from an odd legacy group.
  const isPairs = line.structure === "pairs";
  let lockedKongs = 0, lockedSets = 0, lockedPairs = 0;
  for (const g of exposed) {
    if (isPairs) lockedPairs += Math.floor(g.length / 2);
    else if (g.length >= 4) lockedKongs++;
    else if (g.length === 2) lockedPairs++;
    else lockedSets++;
  }
  const counters = {
    set: lockedKongs + lockedSets, // any 3/4 exposed group fills a "set" slot
    kong: lockedKongs,
    pair: (lockedPair ? 1 : 0) + lockedPairs,
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
