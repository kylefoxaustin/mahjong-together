# Rules gap analysis & feature roadmap

A deep-dive comparing **real American (NMJL-style) Mahjong** against what
*Mahjong, Together* implements today, with a prioritized, sequenced list of
fixes/additions. Triggered by a real observation: other players should be able
to **want the same discard she's claiming** — i.e., we don't model the claiming
contest.

> **Scope reminder (CLAUDE.md §3, §5):** this is a *gentle practice tool*, not a
> tournament engine. The win goal is deliberately our own simple hand (4 sets of
> three + a pair), and we never ship copyrighted NMJL card hands or scoring. So
> the aim below is to teach **real mechanics** (Charleston, calling, jokers)
> faithfully — NOT full card/scoring fidelity. Each item is tagged for scope.

---

## How real American Mahjong works (the parts that touch our gameplay)

1. **Tiles** — 152: 1–9 in 3 suits (×4), winds (16), dragons (12), **flowers (8)**,
   jokers (8). Hands are defined by the annual NMJL card.
2. **Charleston** — First Charleston (mandatory): pass 3 **right → across → left**;
   a **blind pass** is allowed on the *first-left*. Second Charleston (optional,
   needs all 4 to agree): **left → across → right**. Then an optional **courtesy
   pass** (0–3 tiles across, once per game). All skippable by agreement.
3. **Turn order** — counterclockwise: draw from the wall, then discard.
4. **Claiming a discard** — ANY player may claim the **most recent** discard
   (before the next player draws) to either **make an exposure** (pung = 3, kong
   = 4) or **declare Mahjong**. Claiming **jumps the turn order** (play resumes
   to the caller's right). Exposures are placed face-up and are committed.
   - **Priority when several want it:** **Mahjong beats an exposure**; between two
     exposure claims, the player **next in turn order** wins — *except* the
     "attentiveness" exception: a player who calls and **begins exposing before**
     the next-in-turn verbalizes can take it.
5. **Kong** — claiming/forming 4-of-a-kind; the maker draws a **replacement tile**
   from the wall (because a kong is "worth" an extra tile).
6. **Jokers** — wild inside a group of **three or more** (pung/kong), **never** in
   a pair or single, and never as the winning pair. **Joker exchange:** on YOUR
   turn you may swap the **natural tile** for a joker sitting in ANY exposure
   (yours or an opponent's). You may **not** claim a discard just to do an
   exchange.
7. **Winning** — your 14 tiles must match a hand on the card; you may win off your
   own draw or off any discard (by calling). Declared by the player.
8. **Wall game** — if the wall runs out with no winner, the hand is a **draw**
   (no one wins); tiles are reshuffled for a new hand.

Sources: see bottom.

---

## What we implement today (from the code)

| Area | Today |
|---|---|
| Tiles | 144 (no flowers); 8 jokers ✓ |
| Charleston | single pass **right→across→left** + **Skip**; no blind / 2nd / courtesy |
| Turn loop | she draws (draw-assist on Easy), discards; then 3 opponents each draw + discard, revealed one at a time |
| Opponents | real 13-tile hands; draw (blind→assisted by difficulty), discard least-useful; **can declare Mahjong on their own draw** |
| Calling | only **she** can call, only a **pung** (she holds ≥2), offered once after the 3 tosses; no priority, **opponents never call** |
| Kong | ❌ not implemented (pung only) |
| Jokers | wild in sets ✓, never in pair ✓; **no joker exchange** |
| Winning | our own goal (4 sets + pair); **she declares** via "I think I won!"; win breakdown shown; can win off a called tile |
| Pair | she can lock it ("Make this my pair") |
| Wall end | discards **recycle forever** (never a wall game) |
| Difficulty | Easy / Normal / Hard / Advanced (opponent draw skill + her assist) |

---

## The gaps, prioritized & sequenced

### P0 — correctness & "feels real" (do first; small, self-contained)

1. **Opponents can win off HER discard (Mahjong-on-discard).**
   Today opponents only win on their own self-draw. Real tables: a discard can
   complete someone's hand. *Scope: in.* Gentle: gate frequency by difficulty
   (Easy: never; Normal: rare; Hard/Advanced: yes). Ties into #4.
   *Effort: M.*

2. **Kong (4 of a kind) + replacement draw.**
   Let her call/declare a 4th matching tile as a kong and draw a replacement.
   Natural extension of the pung we already do; teaches a real move.
   *Scope: in. Effort: M.*

3. **Wall game (graceful "nobody won this hand").**
   Instead of recycling forever, when the wall is truly exhausted, end the hand
   kindly ("This one's a wash — let's deal again!") with Play again. *Scope: in
   (keep a generous recycle first, then a wall game). Effort: S.*

### P1 — the headline missing system + real mechanics

4. **Claiming/priority system (the observation that started this).**
   - Opponents can **also claim discards** (pung/kong/Mahjong), not just toss.
   - When **she and an opponent both want a tile**, apply real priority:
     **Mahjong > next-in-turn exposure**, with a friendly UX ("Across also wanted
     that — but your call wins!" / "Across took the 5 Bam to finish a set").
   - A call **jumps the turn order** (resume from the caller).
   - *Scope: in, but DIFFICULTY-GATED for gentleness:* Easy = opponents never
     contest her calls; Normal = occasional; Hard/Advanced = full contest. This
     keeps "she can't lose" on Easy while making the table real on higher levels.
   - *Effort: L (the biggest item; changes the turn/claim flow).*

5. **Charleston completeness** (already on the brief's roadmap).
   - **Blind pass** on the first-left (steal 1–3 of the incoming tiles unseen).
   - **Optional second Charleston** (left→across→right).
   - **Courtesy pass** (0–3 across, once).
   - *Scope: in. Effort: M.* Keep every step skippable (overwhelm guard).

6. **Joker exchange (redeem a joker).**
   On her turn, if she holds the natural tile for a joker in any exposure (hers
   or an opponent's), let her **swap** to reclaim the joker. Real, satisfying,
   and teaches joker value. *Scope: in. Effort: M.* Coach should explain it.

### P2 — realism polish / explicitly optional

7. **Immediate per-discard claiming** (claim the *most recent* discard before the
   next draw), replacing today's "offer once after all three tosses." More
   faithful, but more fiddly UX for a beginner. *Scope: maybe; revisit after #4.*

8. **Flowers (8 tiles)** — only meaningful if we add hands that use them; our
   practice goal doesn't. *Scope: out for now (stay at 144 tiles).*

### Out of scope (by design — CLAUDE.md §5)

- **NMJL card hands & scoring / payouts / joker-bonus** — copyrighted and against
  the gentle intent. "Practice my card" already lets her chase her *own* card via
  the coach.
- **Dead hands, dangerous/"hot" discards, betting** — too punishing/complex for a
  nervous beginner.

---

## Suggested build sequence

1. **#3 Wall game** (small, removes the only "never ends" oddity).
2. **#2 Kong** (small, self-contained new move).
3. **#1 Opponent Mahjong-on-discard** (sets up the claim flow).
4. **#4 Claiming + priority, difficulty-gated** (the headline; biggest).
5. **#6 Joker exchange.**
6. **#5 Charleston completeness.**
7. Reassess **#7** (immediate per-discard claiming) once #4 lands.

Each step ships independently with tests + a coach explanation, keeping Easy mode
"she can't lose."

---

## Sources

- [American mahjong — Wikipedia](https://en.wikipedia.org/wiki/American_mahjong)
- [American Mahjong Rules (2026) — MahjongCompare](https://mahjongcompare.com/styles/american)
- [How to Discard and Claim Tiles in American Mahjong — Mahj Mind](https://mahjmindaz.com/2025/08/08/how-to-discard-and-claim-tiles-in-american-mahjong-beginners-guide/)
- [The Charleston — American Mah Jongg Association](https://guide.americanmahjonggassociation.com/how-to-play-american-mah-jongg/the-charleston/)
- [How the Charleston Works — Mahjong 4 Friends](https://mahjong4friends.com/guides/american-mah-jongg-charleston-guide)
- [How to Use Jokers in American Mahjong — Southern Sparrow](https://southernsparrow.com/blogs/how-to-play-mahjong/how-to-use-jokers-in-american-mahjong)
- [Joker Protocols (Article 221) — Mahj Life](https://mahjlife.com/wiki/joker-protocols-article-221/)
- [Sloperama FAQ 19 — American Mah-Jongg](https://sloperama.com/mjfaq/mjfaq19.html)
