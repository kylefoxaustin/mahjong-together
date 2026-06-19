/* Unit tests for the deterministic engine (CLAUDE.md §6/§12).
   Run with: npm test   (Node's built-in test runner) */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildWall,
  sortHand,
  countsByKey,
  canFormTriplets,
  isWinningHand,
  localHint,
  ORDER,
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

/* --- the edge case CampMatch flagged: leftover jokers forming their OWN
   all-joker set while real tiles still need to be placed. The completeness
   branch in canFormTriplets must find these. --- */
test("canFormTriplets: three leftover jokers form their own set alongside a real pung", () => {
  // {A:3} + 3 jokers, needing 2 sets: AAA + JJJ.
  assert.equal(canFormTriplets({ bam1: 3 }, 3, 2), true);
});

test("canFormTriplets: a standalone joker pung is found even when needed before real keys are exhausted", () => {
  // {A:3, B:3} + 3 jokers, need 3 sets: AAA, BBB, JJJ.
  assert.equal(canFormTriplets({ bam1: 3, bam2: 3 }, 3, 3), true);
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

test("canFormTriplets: impossible when there simply aren't enough tiles", () => {
  assert.equal(canFormTriplets({ bam1: 1 }, 3, 2), false); // 4 tiles, need 6
});

test("localHint: never throws and always returns a friendly string", () => {
  assert.match(localHint([...reps("bam1", 3)]), /full set/);
  assert.match(localHint([...reps("bam2", 2)]), /pair/);
  assert.match(localHint([joker(), tile("RD")]), /Joker/);
  assert.match(localHint([tile("bam1"), tile("crak2")]), /twos or threes/);
});
