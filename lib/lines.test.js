import { test } from "node:test";
import assert from "node:assert/strict";
import { LINES, LINE_ORDER, winsLine, lineProgress } from "./lines.js";

const tile = (key, label = key, isJoker = false) => ({ id: key + Math.random(), key, glyph: "?", label, isJoker });
const joker = () => tile("JOKER", "Joker", true);
const reps = (key, n) => Array.from({ length: n }, () => tile(key));

test("LINE_ORDER lists all four lines and each has the required shape", () => {
  assert.deepEqual(LINE_ORDER, ["foursets", "threekongs", "onesuit", "sevenpairs"]);
  for (const id of LINE_ORDER) {
    const l = LINES[id];
    assert.equal(typeof l.name, "string");
    assert.equal(typeof l.decompose, "function");
    assert.ok(["set", "kong", "pair"].includes(l.assist));
  }
});

test("foursets: standard 4 sets + pair wins; a kong counts", () => {
  const clean = [...reps("bam1", 3), ...reps("bam2", 3), ...reps("crak5", 3), ...reps("RD", 3), ...reps("dot9", 2)];
  assert.equal(winsLine("foursets", clean), true);
  const withKong = [...reps("bam1", 4), ...reps("bam2", 3), ...reps("crak5", 3), ...reps("RD", 3), ...reps("dot9", 2)];
  assert.equal(winsLine("foursets", withKong), true);
  assert.equal(winsLine("foursets", clean.slice(0, 13)), false);
});

test("threekongs: exactly three kongs + a pair (14 tiles) wins; sets-of-three do not", () => {
  const win = [...reps("bam1", 4), ...reps("crak5", 4), ...reps("dot9", 4), ...reps("RD", 2)];
  assert.equal(win.length, 14);
  assert.equal(winsLine("threekongs", win), true);
  const d = LINES.threekongs.decompose(win);
  assert.equal(d.groups.filter((g) => g.label === "Kong").length, 3);
  assert.equal(d.groups.filter((g) => g.label === "Pair").length, 1);
  // four sets of THREE + pair is NOT three-kongs
  const setsHand = [...reps("bam1", 3), ...reps("bam2", 3), ...reps("crak5", 3), ...reps("RD", 3), ...reps("dot9", 2)];
  assert.equal(winsLine("threekongs", setsHand), false);
});

test("threekongs: jokers are wild inside the kongs", () => {
  const win = [...reps("bam1", 3), joker(), ...reps("crak5", 4), ...reps("dot9", 4), ...reps("RD", 2)];
  assert.equal(win.length, 14);
  assert.equal(winsLine("threekongs", win), true);
});

test("onesuit: 4 sets + pair all one suit wins; mixed suits or honors do not", () => {
  const oneSuit = [...reps("bam1", 3), ...reps("bam2", 3), ...reps("bam3", 3), ...reps("bam4", 3), ...reps("bam5", 2)];
  assert.equal(winsLine("onesuit", oneSuit), true);
  const mixed = [...reps("bam1", 3), ...reps("crak2", 3), ...reps("bam3", 3), ...reps("bam4", 3), ...reps("bam5", 2)];
  assert.equal(winsLine("onesuit", mixed), false);
  const withHonor = [...reps("bam1", 3), ...reps("bam2", 3), ...reps("bam3", 3), ...reps("RD", 3), ...reps("bam5", 2)];
  assert.equal(winsLine("onesuit", withHonor), false);
  // jokers are fine in a one-suit hand (they're suitless wilds)
  const withJoker = [...reps("bam1", 2), joker(), ...reps("bam2", 3), ...reps("bam3", 3), ...reps("bam4", 3), ...reps("bam5", 2)];
  assert.equal(winsLine("onesuit", withJoker), true);
});

test("sevenpairs: seven natural pairs win; jokers and odd counts do not", () => {
  const win = [
    ...reps("bam1", 2), ...reps("bam2", 2), ...reps("crak5", 2), ...reps("dot9", 2),
    ...reps("E", 2), ...reps("RD", 2), ...reps("dot1", 2),
  ];
  assert.equal(win.length, 14);
  assert.equal(winsLine("sevenpairs", win), true);
  assert.equal(LINES.sevenpairs.decompose(win).groups.length, 7);
  // a joker can't be in a pair
  const withJoker = [...win.slice(0, 13), joker()];
  assert.equal(winsLine("sevenpairs", withJoker), false);
  // four-of-a-kind = two pairs, still seven pairs total
  const withQuad = [
    ...reps("bam1", 4), ...reps("crak5", 2), ...reps("dot9", 2),
    ...reps("E", 2), ...reps("RD", 2), ...reps("dot1", 2),
  ];
  assert.equal(winsLine("sevenpairs", withQuad), true);
});

test("each line exposes the full declarative contract", () => {
  for (const id of LINE_ORDER) {
    const l = LINES[id];
    assert.equal(l.id, id);
    assert.equal(typeof l.blurb, "string");
    assert.equal(typeof l.coachGoal, "string");
    assert.ok(["setspair", "pairs"].includes(l.structure));
    assert.ok(Array.isArray(l.plan) && l.plan.length > 0);
    assert.ok(l.plan.every((k) => ["set", "kong", "pair"].includes(k)));
    // winsLine agrees with decompose
    assert.equal(winsLine(id, []), !!l.decompose([]));
  }
});

test("foursets: decompose labels 4 Sets + a real Pair and consumes every tile", () => {
  const hand = [...reps("bam1", 3), ...reps("bam2", 3), ...reps("crak5", 3), ...reps("RD", 3), ...reps("dot9", 2)];
  const d = LINES.foursets.decompose(hand);
  assert.equal(d.groups.filter((g) => g.label === "Set").length, 4);
  assert.equal(d.groups.filter((g) => g.label === "Pair").length, 1);
  const ids = d.groups.flatMap((g) => g.tiles).map((t) => t.id).sort();
  assert.deepEqual(ids, hand.map((t) => t.id).sort());
});

test("foursets: jokers fill sets but a joker pair is rejected (near-miss)", () => {
  const ok = [...reps("bam1", 2), joker(), ...reps("bam2", 3), ...reps("crak5", 3), ...reps("RD", 3), ...reps("dot9", 2)];
  assert.equal(winsLine("foursets", ok), true);
  const jokerPair = [...reps("bam1", 3), ...reps("bam2", 3), ...reps("crak5", 3), ...reps("RD", 3), tile("dot9"), joker()];
  assert.equal(winsLine("foursets", jokerPair), false);
  // 19 tiles is out of range
  const tooMany = [...reps("bam1", 4), ...reps("bam2", 4), ...reps("crak5", 4), ...reps("RD", 4), ...reps("dot9", 3)];
  assert.equal(winsLine("foursets", tooMany), false);
});

test("threekongs: rejects 14 tiles that are not three kongs (near-miss)", () => {
  // two kongs + two pungs + ... cannot make three kongs from 14 tiles
  const nearMiss = [...reps("bam1", 4), ...reps("crak5", 4), ...reps("dot9", 3), ...reps("RD", 3)];
  assert.equal(nearMiss.length, 14);
  assert.equal(winsLine("threekongs", nearMiss), false);
});

test("onesuit: decompose returns groups only when single-suit", () => {
  const oneSuit = [...reps("dot1", 3), ...reps("dot2", 3), ...reps("dot3", 3), ...reps("dot4", 3), ...reps("dot5", 2)];
  assert.ok(LINES.onesuit.decompose(oneSuit));
  const honor = [...reps("dot1", 3), ...reps("dot2", 3), ...reps("dot3", 3), ...reps("E", 3), ...reps("dot5", 2)];
  assert.equal(LINES.onesuit.decompose(honor), null);
});

test("sevenpairs: rejects odd counts and joker-in-pair (near-miss)", () => {
  const odd = [...reps("bam1", 3), ...reps("bam2", 1), ...reps("crak5", 2), ...reps("dot9", 2), ...reps("E", 2), ...reps("RD", 2), ...reps("dot1", 2)];
  assert.equal(odd.length, 14);
  assert.equal(winsLine("sevenpairs", odd), false);
  const jokerHand = [...reps("bam1", 2), ...reps("bam2", 2), ...reps("crak5", 2), ...reps("dot9", 2), ...reps("E", 2), ...reps("RD", 1), joker(), tile("dot1")];
  assert.equal(winsLine("sevenpairs", jokerHand), false);
});

test("lineProgress: Seven pairs shows locked pairs solid and held pairs as outline", () => {
  // Two locked pairs (exposed 2-tile groups) + two natural pairs still in hand.
  const exposed = [[tile("dot3"), tile("dot3")], [tile("bam5"), tile("bam5")]];
  const concealed = [...reps("bam3", 2), ...reps("dot6", 2), tile("crak9"), tile("E")];
  const p = lineProgress("sevenpairs", concealed, exposed, null);
  assert.equal(p.slots.filter((s) => s.state === "locked").length, 2); // the two locked pairs
  assert.equal(p.slots.filter((s) => s.state === "held").length, 2);   // the two in-hand pairs
  assert.equal(p.slots.length, 7);
});

test("lineProgress: a legacy 3-tile group in a pairs line still counts as one locked pair", () => {
  const exposed = [[tile("dot3"), tile("dot3"), tile("dot3")]]; // an odd pung from before
  const p = lineProgress("sevenpairs", [tile("E")], exposed, null);
  assert.equal(p.slots.filter((s) => s.state === "locked").length, 1);
});
