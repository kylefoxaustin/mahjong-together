# Design sketch — "Let her choose the winning line"

Goal: let her pick **what hand she's aiming for** from a small menu of simple
patterns, instead of always the same "four sets and a pair." The coach steers
toward her chosen line, the goal panel shows it, and the deterministic engine
validates the win against it.

## Guardrails (must hold)

- **No copyrighted content (CLAUDE.md §5).** The menu uses our OWN generic
  patterns (seven pairs, all-kongs, one-suit, etc.) — NEVER the NMJL card's
  specific hands. Her *real* card stays in "Practice my card" (free text +
  coach-judged), which we keep as-is.
- **LLM never does the arithmetic (§4/§12).** Each line ships a deterministic
  `check(tiles)` (and a `decompose` for the win breakdown). The coach only
  phrases guidance toward the chosen line.
- **Gentle / not overwhelming (§2).** Default is the simple line; choosing is
  optional; big buttons, one-line plain descriptions, voice-read.

## How a "line" is modeled (engine)

A line is a small descriptor in `lib/lines.js`:

```
{ id, name, blurb,
  tiles: 14,                 // some lines are larger (kongs)
  check(allTiles): boolean,  // deterministic win test for THIS line
  decompose(allTiles): {groups, labels} | null,  // for the win breakdown
  panel(concealed, exposed, lockedPair): slot model,  // goal-panel shape
  assist(concealed): key/score hints  // what the draw-assist should chase
}
```

`isWinningHand`, the goal panel, the draw-assist, and the coach prompt all
dispatch through the chosen line. The current "four sets + pair" becomes the
first line; everything we built still works as that default.

## Candidate lines (small, generic, copyright-free)

| Line | What it is | Jokers | Feel |
|---|---|---|---|
| **Four sets & a pair** *(default)* | today's goal (sets of 3 or 4 + a pair) | wild in sets | all-purpose |
| **Three kongs & a pair** | three sets of FOUR + a pair (11 tiles → bigger) | wild in kongs | kong-focused, satisfying |
| **One suit** | four sets + a pair, all in a single suit (Crak/Bam/Dot) | wild in sets | teaches suits; a stretch goal |
| **Seven pairs** | seven pairs, no sets | *see note* | very simple to grasp |

**Joker nuance for Seven pairs:** real rule = Jokers can't be in a pair, which
makes this line ignore her 8 Jokers (dead weight) and the draw-assist awkward.
Two choices:
- **(a)** keep it pure (natural pairs only) and label it "no Joker help — a real
  challenge," or
- **(b)** a gentle exception: "for this line, a Joker may complete a pair."
This is a decision to make if we include Seven pairs. The other three lines keep
Jokers useful (in sets), so they're cleaner.

## Where she picks it (UX options)

- **Option A — inline selector** in "Just play & learn": a small **"Aiming for: Four
  sets & a pair ▸"** chip on the start menu (and/or a "Change goal" button
  in-game). Lowest friction; default just works. *(Recommended.)*
- **Option B — picker screen**: tapping "Just play & learn" opens a one-screen
  menu of the lines (big cards with a tiny tile mock each), then deals.
- **Option C — third menu path**: a separate "Pick a hand to chase" alongside the
  two existing modes. Most discoverable, but adds a top-level choice.

## What changes per line (so nothing breaks)

- **Goal panel**: slot shape comes from the line (e.g. Seven pairs = 7 pair
  slots; Three kongs = 3 kong slots + pair). Outline/solid logic stays.
- **Draw-assist (Easy)**: chases the line's targets (pairs for Seven pairs, kongs
  for Three kongs) so "she can't lose" still holds per line.
- **Coach**: `LEARN_GOAL` becomes the line's description; the exact-facts +
  highlight machinery is unchanged.
- **Win breakdown**: uses the line's `decompose`.
- **Persistence**: save the chosen line id with the game + as a remembered
  preference (like difficulty).

## Suggested phasing

1. **Phase 1** — the line abstraction + the picker (Option A) + **two or three
   joker-friendly lines** (Four sets & a pair, Three kongs & a pair, One suit).
   Line-aware win-check, panel, coach, and assist. Default unchanged.
2. **Phase 2** — Seven pairs (after the joker decision), more lines, and
   **save her favorite lines** (ties into the brief's roadmap item #2).

## Open decisions for Kyle

1. **Placement:** A (inline chip), B (picker screen), or C (third menu path)?
2. **Starter line set:** which 2–4 lines to ship first?
3. **Seven pairs Jokers:** include it? and if so, pure (a) or gentle (b)?
