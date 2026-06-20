/* Unit tests for the deterministic engine (CLAUDE.md §6/§12).
   Run with: npm test   (Node's built-in test runner) */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildWall,
  sortHand,
  countsByKey,
  isWinningHand,
  localHint,
  ORDER,
  isValidSet,
  pickAssistedDrawIndex,
  shuffle,
  coachFacts,
  chooseDiscard,
  handGroups,
  isValidKong,
  partition,
  suitOf,
} from "./tiles.js";

/* --- tiny helpers to build hands without the RNG-backed makeTile id --- */
const tile = (key, label = key, isJoker = false) => ({ id: key + Math.random(), key, glyph: "?", label, isJoker });
const joker = () => tile("JOKER", "Joker", true);
// n copies of a real tile key
const reps = (key, n) => Array.from({ length: n }, () => tile(key));

test("buildWall produces the engine's 144-tile set (no flowers in this practice build)", () => {
  const wall = buildWall();
  // 27 suited (3×9) + 4 winds + 3 dragons = 34 distinct keys × 4 = 136, + 8 jokers = 144
  assert.equal(wall.length, 144);
  const { c, jokers } = countsByKey(wall);
  assert.equal(jokers, 8);
  assert.equal(c["bam1"], 4);
  assert.equal(c["RD"], 4);
  // 34 distinct non-joker keys
  assert.equal(Object.keys(c).length, 34);
});

test("sortHand orders by ORDER and is non-mutating", () => {
  const hand = [tile("RD"), tile("bam1"), tile("crak5"), joker()];
  const sorted = sortHand(hand);
  for (let i = 1; i < sorted.length; i++) {
    assert.ok(ORDER[sorted[i - 1].key] <= ORDER[sorted[i].key]);
  }
  assert.equal(hand[0].key, "RD"); // original untouched
});

test("isWinningHand: rejects hands that are not exactly 14 tiles", () => {
  assert.equal(isWinningHand([...reps("bam1", 3)]), false);
  const thirteen = [...reps("bam1", 3), ...reps("bam2", 3), ...reps("bam3", 3), ...reps("crak1", 2), ...reps("crak2", 2)];
  assert.equal(thirteen.length, 13);
  assert.equal(isWinningHand(thirteen), false);
});

test("isWinningHand: a clean 4 sets + pair (no jokers) wins", () => {
  const hand = [
    ...reps("bam1", 3),
    ...reps("bam2", 3),
    ...reps("crak5", 3),
    ...reps("RD", 3),
    ...reps("dot9", 2),
  ];
  assert.equal(hand.length, 14);
  assert.equal(isWinningHand(hand), true);
});

test("isWinningHand: jokers complete sets but are never allowed in the pair", () => {
  // Pair must be two REAL tiles; jokers fill the triplets.
  const hand = [
    ...reps("bam1", 2), joker(), // set via 2 real + 1 joker
    ...reps("bam2", 1), joker(), joker(), // set via 1 real + 2 jokers
    ...reps("crak5", 3),
    ...reps("RD", 3),
    ...reps("dot9", 2), // the pair: two real tiles
  ];
  assert.equal(hand.length, 14);
  assert.equal(isWinningHand(hand), true);
});

test("isWinningHand: two jokers + lone tile cannot masquerade as the pair", () => {
  // 4 clean sets, then a 'pair' of one real tile + one joker => NOT a win.
  const hand = [
    ...reps("bam1", 3),
    ...reps("bam2", 3),
    ...reps("crak5", 3),
    ...reps("RD", 3),
    tile("dot9"), joker(),
  ];
  assert.equal(hand.length, 14);
  assert.equal(isWinningHand(hand), false);
});

test("isWinningHand: not a win when tiles are scattered singletons", () => {
  const hand = [
    tile("bam1"), tile("bam2"), tile("bam3"), tile("bam4"),
    tile("crak1"), tile("crak2"), tile("crak3"), tile("crak4"),
    tile("dot1"), tile("dot2"), tile("dot3"), tile("dot4"),
    tile("E"), tile("S"),
  ];
  assert.equal(hand.length, 14);
  assert.equal(isWinningHand(hand), false);
});

test("isWinningHand: a win that requires an all-joker set is detected", () => {
  // pair dot9, sets: bam1×3, crak5×3, RD×3, and three jokers as their own set.
  const hand = [
    ...reps("dot9", 2),
    ...reps("bam1", 3),
    ...reps("crak5", 3),
    ...reps("RD", 3),
    joker(), joker(), joker(),
  ];
  assert.equal(hand.length, 14);
  assert.equal(isWinningHand(hand), true);
});

test("isValidSet: three identical real tiles, or with jokers, form a set", () => {
  assert.equal(isValidSet([...reps("bam1", 3)]), true);
  assert.equal(isValidSet([...reps("bam1", 2), joker()]), true);
  assert.equal(isValidSet([tile("bam1"), joker(), joker()]), true);
  assert.equal(isValidSet([joker(), joker(), joker()]), true);
  assert.equal(isValidSet([tile("bam1"), tile("bam2"), tile("bam3")]), false); // a run, not a set
  assert.equal(isValidSet([...reps("bam1", 2)]), false); // only two tiles
});

test("pickAssistedDrawIndex: prefers a set-completing tile, then a joker, then a pair-maker", () => {
  const concealed = [...reps("bam1", 2), tile("crak5")]; // bam1 pair, crak5 single
  // wall: [new single, joker, the bam1 that completes the set]
  const wall = [tile("dot9"), joker(), tile("bam1")];
  assert.equal(pickAssistedDrawIndex(wall, concealed), 2); // completes the bam1 set

  // No completer: a joker beats a pair-maker beats a brand-new tile.
  const wall2 = [tile("dot9"), tile("crak5"), joker()];
  assert.equal(pickAssistedDrawIndex(wall2, concealed), 2); // the joker

  // Nothing helpful: fall back to the top of the wall.
  const wall3 = [tile("dot1"), tile("dot2"), tile("dot3")];
  assert.equal(pickAssistedDrawIndex(wall3, concealed), 0);
});

test("shuffle: preserves all tiles without mutating the input", () => {
  const original = [...reps("bam1", 3), ...reps("crak5", 2), joker()];
  const copy = [...original];
  const out = shuffle(original);
  assert.equal(out.length, original.length);
  assert.deepEqual(original, copy); // input untouched
  // same multiset of ids
  assert.deepEqual(out.map((t) => t.id).sort(), original.map((t) => t.id).sort());
});

test("guided play reaches a win in a bounded number of turns (no infinite loop)", () => {
  // Mirrors the component's learn-mode loop: assisted draw → win-check →
  // discard the least useful tile → bots toss. Proves the game terminates in
  // a happy Mahjong rather than cycling forever.
  function playOut() {
    let wall = buildWall();
    let hand = sortHand(wall.splice(0, 13));
    const exposed = [];
    let discards = [];
    for (let turn = 1; turn <= 300; turn++) {
      if (wall.length < 1) { wall = shuffle(discards); discards = []; }
      const idx = pickAssistedDrawIndex(wall, hand);
      hand = sortHand([...hand, wall[idx]]);
      wall = [...wall.slice(0, idx), ...wall.slice(idx + 1)];
      if (isWinningHand([...hand, ...exposed.flat()])) return turn;
      // Discard the least useful tile: a non-joker singleton if one exists,
      // otherwise the tile from the smallest group (never a joker if avoidable).
      const { c } = countsByKey(hand);
      const nonJokers = hand.filter((t) => !t.isJoker);
      const drop =
        nonJokers.find((t) => c[t.key] === 1) ||
        [...nonJokers].sort((a, b) => c[a.key] - c[b.key])[0] ||
        hand[0];
      hand = sortHand(hand.filter((t) => t.id !== drop.id));
      discards.push(drop);
      if (wall.length < 3) { wall = shuffle([...wall, ...discards]); discards = []; }
      discards.push(...wall.slice(0, 3));
      wall = wall.slice(3);
    }
    return -1;
  }
  // Run several independent games; every one should resolve in a win.
  for (let i = 0; i < 5; i++) {
    const turns = playOut();
    assert.ok(turns > 0, "game should reach a winning hand, not loop forever");
    assert.ok(turns < 300, `won in ${turns} turns`);
  }
});

test("coachFacts: reports exact pairs/sets/jokers so the coach never has to count", () => {
  // The bug repro: two West Winds + jokers must read as a PAIR, never "three".
  const hand = [
    tile("W", "West Wind"), tile("W", "West Wind"),   // West Wind pair
    tile("dot4", "4 Dot"), tile("dot4", "4 Dot"), tile("dot4", "4 Dot"), // ready-made set
    tile("dot7", "7 Dot"), tile("dot7", "7 Dot"),     // pair
    tile("dot3", "3 Dot"),                            // single
    joker(), joker(),                                 // two jokers
  ];
  const f = coachFacts(hand);
  assert.deepEqual(f.readySets, ["4 Dot"]);
  assert.equal(f.pairs.includes("West Wind"), true);
  assert.equal(f.pairs.includes("7 Dot"), true);
  assert.equal(f.readySets.includes("West Wind"), false); // never a ready-made set
  assert.equal(f.singles.includes("3 Dot"), true);
  assert.equal(f.jokers, 2);
});

test("chooseDiscard: drops a lone single, keeps pairs/triplets, never a Joker if avoidable", () => {
  const hand = [...reps("bam1", 3), ...reps("crak5", 2), tile("dot9"), joker()];
  const out = chooseDiscard(hand);
  assert.equal(out.key, "dot9");      // the lone single
  assert.notEqual(out.isJoker, true); // never the Joker

  // No singles: drop from the smallest group, still never the Joker.
  const hand2 = [...reps("bam1", 3), ...reps("crak5", 2), joker()];
  const out2 = chooseDiscard(hand2);
  assert.equal(out2.key, "crak5");
  assert.notEqual(out2.isJoker, true);
});

test("handGroups: returns the actual tiles of the reserved pair, held sets, and building pairs", () => {
  // two 8 Craks (pair), two 7 Dots + a Joker (a held set), two 4 Bams (building)
  const hand = [...reps("crak8", 2), ...reps("dot7", 2), joker(), ...reps("bam4", 2), tile("dot1")];
  const g = handGroups(hand);
  assert.ok(g.pair && g.pair.length === 2);
  assert.equal(g.pair[0].key, g.pair[1].key);
  assert.equal(g.sets.length, 1); // 7 Dot pair + Joker
  assert.equal(g.sets[0].length, 3);
  assert.ok(g.sets[0].some((t) => t.isJoker)); // uses the Joker
  assert.equal(g.building.length, 1); // the 4 Bam pair, one away from a set
  // no tile is used twice
  const ids = [...(g.pair || []), ...g.sets.flat(), ...g.building.flat()].map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("handGroups: a fresh all-singles hand has no pair, no sets", () => {
  const g = handGroups([tile("bam1"), tile("crak2"), tile("dot3"), tile("E"), joker()]);
  assert.equal(g.pair, null);
  assert.equal(g.sets.length, 0);
  assert.equal(g.building.length, 0);
});

test("isValidKong: four of one key (jokers wild) is a kong; three or mixed is not", () => {
  assert.equal(isValidKong([...reps("bam1", 4)]), true);
  assert.equal(isValidKong([...reps("bam1", 3), joker()]), true);
  assert.equal(isValidKong([...reps("bam1", 2), joker(), joker()]), true);
  assert.equal(isValidKong([...reps("bam1", 3)]), false); // only three
  assert.equal(isValidKong([...reps("bam1", 3), tile("bam2")]), false); // mixed keys
});

test("isWinningHand: allows a kong — a winning hand can be 15 tiles (one set of four)", () => {
  const hand = [
    ...reps("bam1", 4), // a kong
    ...reps("bam2", 3),
    ...reps("crak5", 3),
    ...reps("RD", 3),
    ...reps("dot9", 2), // pair
  ];
  assert.equal(hand.length, 15);
  assert.equal(isWinningHand(hand), true);
});

test("isWinningHand: a hand with four kongs + a pair (18 tiles) wins", () => {
  const hand = [
    ...reps("bam1", 4), ...reps("bam2", 4), ...reps("crak5", 4), ...reps("RD", 4), ...reps("dot9", 2),
  ];
  assert.equal(hand.length, 18);
  assert.equal(isWinningHand(hand), true);
});

test("isWinningHand: still rejects a 14-tile hand that isn't 4 sets + a pair", () => {
  const hand = [
    tile("bam1"), tile("bam2"), tile("bam3"), tile("bam4"), tile("crak1"),
    tile("crak2"), tile("crak3"), tile("dot1"), tile("dot2"), tile("dot3"),
    tile("E"), tile("S"), tile("W"), tile("N"),
  ];
  assert.equal(isWinningHand(hand), false);
});

/* --- the generic partitioner --------------------------------------- */
const FOUR_SETS_PAIR = { groups: [{ kind: "set", count: 4 }, { kind: "pair", count: 1 }] };

test("partition: four-sets-and-a-pair spec accepts a clean win and labels groups", () => {
  const hand = [...reps("bam1", 3), ...reps("bam2", 3), ...reps("crak5", 3), ...reps("RD", 3), ...reps("dot9", 2)];
  const r = partition(hand, FOUR_SETS_PAIR);
  assert.ok(r);
  assert.equal(r.groups.length, 5);
  assert.equal(r.groups.filter((g) => g.label === "Set").length, 4);
  assert.equal(r.groups.filter((g) => g.label === "Pair").length, 1);
  // every tile consumed exactly once
  const ids = r.groups.flatMap((g) => g.tiles).map((t) => t.id).sort();
  assert.deepEqual(ids, hand.map((t) => t.id).sort());
});

test("partition: jokers are wild in sets but never in the pair", () => {
  const ok = [
    ...reps("bam1", 2), joker(),
    ...reps("bam2", 1), joker(), joker(),
    ...reps("crak5", 3), ...reps("RD", 3), ...reps("dot9", 2),
  ];
  const r = partition(ok, FOUR_SETS_PAIR);
  assert.ok(r);
  const pair = r.groups.find((g) => g.label === "Pair");
  assert.ok(pair.tiles.every((t) => !t.isJoker));
  // a real tile + joker cannot stand in for the pair
  const bad = [...reps("bam1", 3), ...reps("bam2", 3), ...reps("crak5", 3), ...reps("RD", 3), tile("dot9"), joker()];
  assert.equal(partition(bad, FOUR_SETS_PAIR), null);
});

test("partition: consumes ALL tiles — a leftover tile fails the spec", () => {
  const extra = [...reps("bam1", 3), ...reps("bam2", 3), ...reps("crak5", 3), ...reps("RD", 3), ...reps("dot9", 2), tile("dot1")];
  assert.equal(partition(extra, FOUR_SETS_PAIR), null);
});

test("partition: kong spec requires size-4 groups; threes are rejected", () => {
  const kongSpec = { groups: [{ kind: "kong", count: 3 }, { kind: "pair", count: 1 }] };
  const win = [...reps("bam1", 4), ...reps("crak5", 4), ...reps("dot9", 4), ...reps("RD", 2)];
  const r = partition(win, kongSpec);
  assert.ok(r);
  assert.equal(r.groups.filter((g) => g.label === "Kong").length, 3);
  for (const g of r.groups.filter((x) => x.label === "Kong")) assert.equal(g.tiles.length, 4);
  // a joker fills a kong
  const withJoker = [...reps("bam1", 3), joker(), ...reps("crak5", 4), ...reps("dot9", 4), ...reps("RD", 2)];
  assert.ok(partition(withJoker, kongSpec));
  // sets of three do not satisfy a kong spec
  const threes = [...reps("bam1", 3), ...reps("bam2", 3), ...reps("crak5", 3), ...reps("RD", 3), ...reps("dot9", 2)];
  assert.equal(partition(threes, kongSpec), null);
});

test("partition: oneSuit constraint rejects mixed suits and honors, allows jokers", () => {
  const spec = { groups: [{ kind: "set", count: 4 }, { kind: "pair", count: 1 }], constraints: { oneSuit: true } };
  const pure = [...reps("bam1", 3), ...reps("bam2", 3), ...reps("bam3", 3), ...reps("bam4", 3), ...reps("bam5", 2)];
  assert.ok(partition(pure, spec));
  const mixed = [...reps("bam1", 3), ...reps("crak2", 3), ...reps("bam3", 3), ...reps("bam4", 3), ...reps("bam5", 2)];
  assert.equal(partition(mixed, spec), null);
  const honor = [...reps("bam1", 3), ...reps("bam2", 3), ...reps("bam3", 3), ...reps("RD", 3), ...reps("bam5", 2)];
  assert.equal(partition(honor, spec), null);
  const withJoker = [...reps("bam1", 2), joker(), ...reps("bam2", 3), ...reps("bam3", 3), ...reps("bam4", 3), ...reps("bam5", 2)];
  assert.ok(partition(withJoker, spec));
});

test("partition: noJokers constraint rejects any joker; seven pairs spec", () => {
  const spec = { groups: [{ kind: "pair", count: 7 }], constraints: { noJokers: true } };
  const pairs = [...reps("bam1", 2), ...reps("bam2", 2), ...reps("crak5", 2), ...reps("dot9", 2), ...reps("E", 2), ...reps("RD", 2), ...reps("dot1", 2)];
  const r = partition(pairs, spec);
  assert.ok(r);
  assert.equal(r.groups.length, 7);
  assert.ok(r.groups.every((g) => g.label === "Pair"));
  // a joker anywhere kills it
  const withJoker = [...pairs.slice(0, 13), joker()];
  assert.equal(partition(withJoker, spec), null);
  // four-of-a-kind = two pairs
  const quad = [...reps("bam1", 4), ...reps("crak5", 2), ...reps("dot9", 2), ...reps("E", 2), ...reps("RD", 2), ...reps("dot1", 2)];
  assert.ok(partition(quad, spec));
});

test("partition: an all-joker set is found alongside real pungs", () => {
  const hand = [...reps("dot9", 2), ...reps("bam1", 3), ...reps("crak5", 3), ...reps("RD", 3), joker(), joker(), joker()];
  assert.ok(partition(hand, FOUR_SETS_PAIR));
});

test("suitOf: maps suited keys, returns null for honors and jokers", () => {
  assert.equal(suitOf("crak3"), "crak");
  assert.equal(suitOf("bam9"), "bam");
  assert.equal(suitOf("dot1"), "dot");
  assert.equal(suitOf("RD"), null);
  assert.equal(suitOf("E"), null);
  assert.equal(suitOf("JOKER"), null);
});

test("localHint: never throws and always returns a friendly string", () => {
  assert.match(localHint([...reps("bam1", 3)]), /full set/);
  assert.match(localHint([...reps("bam2", 2)]), /pair/);
  assert.match(localHint([joker(), tile("RD")]), /Joker/);
  assert.match(localHint([tile("bam1"), tile("crak2")]), /twos or threes/);
});
