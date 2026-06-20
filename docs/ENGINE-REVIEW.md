# Engine & UI review — consolidation before scaling to many lines

Prompted by: we're about to grow from 4 winning lines toward ~50, so the line
system is becoming load-bearing. This is the right moment to consolidate.

> **Copyright reality (CLAUDE.md §5):** we cannot ship NMJL card hands. So "~50
> lines" must be **our own generic patterns**, not the League card. Her *real*
> card stays in "Practice my card" (free text, coach-judged — nothing embedded).
> The architecture below makes adding generic lines cheap; it does NOT mean
> shipping the card.

## What I found (grounded in the current code)

**Dead code** (app no longer calls these; only their tests do):
- `canFormTriplets` (tiles.js) — superseded by `canFormSets`.
- `decomposeWin` (tiles.js) — superseded by `lines.js` `decomposeSetsPair`.
- `analyzeHand` (tiles.js) — superseded by `lines.js` `lineProgress`.
→ ~100 lines of engine + their tests can go. Removing them ends the "which
function is the real one?" confusion.

**Duplication** — three near-identical recursive "partition tiles into groups":
- `canFormSets(counts, jokers, needed)` → boolean (tiles.js, used by isWinningHand)
- `decomposeSetsPair(tiles, needed, sizes)` → groups (lines.js)
- `decomposeSevenPairs(tiles)` → groups (lines.js)
They all do the same shape of search. They should be ONE generic partitioner;
the boolean check is just `!!decompose(...)`.

**Per-line hand-written `decompose`** — fine for 4 lines, unmaintainable at ~50.
Each line currently carries imperative code. At scale this should be DATA.

**Component** — `MahjongCoach.jsx` is ~1370 lines. It works and is fairly well
covered, so the risk/reward of splitting it is lower than the engine work. Light
extraction only (see P2).

## Plan (prioritized, each independently shippable + tested)

### P0 — remove dead code (safe; tests guard it)
Delete `canFormTriplets`, `decomposeWin`, `analyzeHand` and their tests. Re-run
the suite (should stay green since the app doesn't use them).

### P1 — one generic partitioner + declarative line specs (the scaling enabler)
1. A single `partition(tiles, groupSpec)` in the engine that returns the labeled
   groups (or null). `winsLine = !!partition`. Collapse canFormSets /
   decomposeSetsPair / decomposeSevenPairs into it.
2. Redefine each line as **data**, e.g.:
   ```
   { id, name, blurb,
     groups: [ {kind:'set', size:[3,4], count:4} , {kind:'pair', count:1} ],
     constraints: { oneSuit?:true, noJokersInPair:true, noHonors?:true },
     assist: 'set'|'kong'|'pair' }   // assist could even be derived
   ```
   A generic interpreter produces check / decompose / panel-plan / coach-goal
   from the spec. Adding a line = adding one data object. 50 lines becomes a
   table, not 50 functions.
3. Keep "Seven pairs" (all-pairs, no jokers) expressible in the same spec
   (groups:[{kind:'pair',count:7}], constraints:{noJokersInPair:true}).

### P2 — component tidy (conservative)
- Extract pure/self-contained pieces into hooks ONLY if low-risk:
  `useAutosave`, `useBotTurns`, `useSpeechRecognition` already-ish separable.
- Add a few **integration tests** for the line flows (deal → play → win per line)
  so future line additions are protected.
- Leave the render/state machine otherwise intact (it's working + deployed).

## Sequencing
1. P0 dead-code removal (small, safe) — ship.
2. P1 generic partitioner (refactor isWinningHand/winsLine onto it, tests green) — ship.
3. P1 declarative line specs (migrate the 4 existing lines to data; behavior
   identical; tests green) — ship.
4. Then adding generic lines is data-only.
5. P2 component hooks/tests as a separate, optional pass.

## Risk notes
- Engine has 40 tests → P0/P1 refactors are well-guarded; regressions surface fast.
- The component is the risky surface; keep P2 light and test-backed.
- Do NOT let "more lines" pull in copyrighted card content — specs stay generic.

## Open question for Kyle
Execute the full P0→P1 now (engine consolidation + declarative specs), or just
P0 (dead-code) first and review the spec design before migrating?
