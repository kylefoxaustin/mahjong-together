# Mahjong, Together — Project Brief & Build Spec

> A browser-based American Mahjong game with a patient AI coach who watches the
> board, talks out loud, and answers spoken questions — built for a specific
> player: my mom. Recently widowed, learning the game, and not comfortable with
> computers. Every design decision serves *her*.

This file is both the **intent to hold** and the **build plan to execute**. When in
doubt about a tradeoff, re-read Section 1 and choose whatever serves that player.

---

## 0. How to use this doc

- Treat Section 1–2 as immovable: the *why* and the *who*. Don't optimize them away.
- Section 3 is the product. Section 4 is the architecture and the one core principle.
- Sections 6–9 get it onto GitHub + Vercel with a hands-off, passwordless deploy loop.
- A working reference implementation already exists as a single React file
  (`MahjongCoach.jsx`, v0.2). Port it in; don't start the game logic from scratch.

---

## 1. The goal (intent — hold this)

Build a place where my mom can sit down **alone** and learn/play American (NMJL-style)
Mahjong while feeling guided the whole way, as if a patient friend were sitting beside
her. The AI coach is the heart of the product, not a feature bolted on.

Success looks like: she opens one bookmark, taps one big button, and starts playing.
The coach greets her by voice, watches her tiles, suggests one thing at a time, and
answers when she **talks to it** ("which tile should I keep?"). She never has to type,
never sees jargon she doesn't understand, and **cannot lose**.

This is a gift, and a labor of love. Quality of the *experience for a nervous beginner*
matters more than feature completeness or rules fidelity.

---

## 2. Who it's for — non-negotiable UX constraints

Primary user: elderly, grieving, computer-illiterate. Therefore:

- **Voice-first.** Coach speaks every message aloud (Web Speech `speechSynthesis`).
  She asks questions by **talking** (`SpeechRecognition`). Typing is a fallback, never
  the main path. A visible "Voice on/off" toggle.
- **Giant everything.** Big tiles, big text, big buttons, high contrast. Assume she
  may have reduced vision and is using a tablet or a large laptop screen.
- **Almost no chrome.** Minimal controls on screen at once. One clear action at a time.
- **No losing.** Bots keep the table alive but cannot beat her in the core experience.
  Mistakes are gently corrected, never punished.
- **Plain language only.** Name tiles the way a person would ("the 3 Bam", "the Red
  Dragon", "your Joker"). Introduce a term only when teaching it, gently.
- **Quality floor:** responsive down to tablet, visible keyboard focus, `prefers-reduced-motion`
  respected, screen-reader labels on tiles.

---

## 3. Product spec

### Start menu → two modes

**A) "Just play & learn"** — a gentle, complete-feeling game.
- Opens with the **Charleston**: pass 3 right → 3 across → 3 left, the coach narrating
  each pass. A **Skip** button is always available (Charleston can overwhelm a beginner).
- During play, when a bot discards a tile she could use, a big **"Take it"** button
  appears so she learns to **call** a set off the table. Called sets are exposed and
  count toward the win.
- Win goal here is **our own simple practice hand**: 4 sets of three matching tiles + 1
  pair. Jokers are wild inside a set of three, never in the pair. (This is a generic
  teaching goal, deliberately *not* a card hand — see Section 5.)

**B) "Practice my card"** — practice her actual card.
- Setup screen: she (or I) type/read aloud the exact hand she's chasing from her own
  paper card, in her own words ("three Red Dragons, then 2025 in Bams, and a pair of
  Flowers").
- The coach steers her toward **that specific hand** every turn, and a **"Did I win?"**
  button asks the coach to check her tiles against the stated target and answer kindly.

### Shared across both modes
- Proactive coaching: the moment she draws, the coach offers one suggestion, spoken.
- On-demand: "What should I do?" button, "Ask out loud" mic button, and a typed box.
- Graceful fallback: if the coach API call fails, fall back to a simple local hint so
  the game is never dead.

### Roadmap (build after v1 is solid, in roughly this order)
1. A **gentle bot opponent** that can actually declare its own Mahjong, so it feels like
   a real table (still tuned so she usually wins while learning).
2. **Save her favorite card hands** (localStorage is fine in the real app) so "Practice
   my card" remembers the hands she plays most.
3. A **structured card-pattern parser** for *auto*-win detection in card mode (only if
   wanted — the coach-judges-it approach is gentler and already works).
4. Second Charleston + courtesy pass; simple scoring; larger/selectable tile themes.

---

## 4. Architecture

**Stack:** Next.js (App Router) + React + Tailwind CSS, deployed on Vercel. Browser Web
Speech API for TTS/STT. The coach is Claude, called through a **server-side proxy** so
the API key never ships to the browser.

**The one core principle (the moat — do not violate):**
> The deterministic engine owns all arithmetic and rules — tiles, the wall, turns, the
> Charleston, calling, and win *structure*. **The LLM never does the arithmetic.** The
> LLM only does the fuzzy parts: phrasing warm coaching, and interpreting/judging her
> plain-English card hand in "Practice my card" mode.

This is what lets "Practice my card" exist without shipping any card content or building
a full pattern grammar, and it keeps the game correct and cheap. Same shape as the
Detourist "LLM never touches the numbers" design.

**Coaching call path:** client → `POST /api/coach` (serverless, holds `ANTHROPIC_API_KEY`)
→ Anthropic Messages API → text back → spoken aloud.

**Model:** start with `claude-haiku-4-5-20251001` for snappy, low-cost coaching; bump to
`claude-sonnet-4-6` if you want richer guidance. Keep `max_tokens` small (~300) — replies
are 2–3 sentences by design.

---

## 5. Copyright boundary (important — keep the repo clean)

The annual National Mah Jongg League card is copyrighted and the League enforces it.
**Do not embed any NMJL (or other publisher's) card hands, images, or the year's hand
list in this repo, ever.** "Practice my card" works entirely off the hand the *user*
types in from the card she already owns. The practice mode uses our own generic goal.
This is both the legal route and the better design (the card changes every April).

---

## 6. Repo structure

```
mahjong-together/
├─ app/
│  ├─ layout.jsx
│  ├─ page.jsx                 # renders <MahjongCoach />
│  └─ api/
│     └─ coach/
│        └─ route.js           # server-side Claude proxy (holds the key)
├─ components/
│  └─ MahjongCoach.jsx         # game + coach UI (port from the v0.2 artifact)
├─ lib/
│  ├─ tiles.js                 # tile vocab, buildWall, sortHand, win-check (extract)
│  └─ coach.js                 # buildSystemPrompt(), callCoach() -> POST /api/coach
├─ public/
├─ .env.local                  # ANTHROPIC_API_KEY (gitignored)
├─ .gitignore
├─ next.config.js
├─ package.json
├─ tailwind.config.js
├─ postcss.config.js
└─ CLAUDE.md                   # this file
```

The reference `MahjongCoach.jsx` currently keeps tile logic, win-checking, and the coach
prompts inline. First refactor: extract `lib/tiles.js` and `lib/coach.js`, and swap the
component's direct `fetch("https://api.anthropic.com/...")` call for `callCoach()` that
hits the local `/api/coach` route.

---

## 7. Environment variables

| Name                | Where                         | Notes                                   |
|---------------------|-------------------------------|-----------------------------------------|
| `ANTHROPIC_API_KEY` | `.env.local` + Vercel project | **Server-side only.** Never `NEXT_PUBLIC_`. |

Set it locally in `.env.local` and in Vercel under **Project → Settings → Environment
Variables** for both Production and Preview.

---

## 8. The coach proxy (server route)

```js
// app/api/coach/route.js
export const runtime = "nodejs";

export async function POST(req) {
  const { system, userText } = await req.json();
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001", // or "claude-sonnet-4-6"
      max_tokens: 300,
      system,
      messages: [{ role: "user", content: userText }],
    }),
  });
  const data = await r.json();
  const text = (data.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join(" ")
    .trim();
  return Response.json({ text: text || null });
}
```

```js
// lib/coach.js (client side)
export async function callCoach(system, userText) {
  const res = await fetch("/api/coach", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ system, userText }),
  });
  const { text } = await res.json();
  return text;
}
```

(Optional later: switch the route to streaming for word-by-word coaching, and start
speaking as tokens arrive.)

---

## 9. GitHub + Vercel: passwordless continuous deploy

The goal: I push code (or Claude Code does), and the live site updates automatically with
**no password in the loop**, and my mom reaches the site with **no login**.

### One-time setup
1. **Create the repo** (public is fine — no secrets live in it; the key is only in Vercel):
   ```bash
   gh repo create kylefoxaustin/mahjong-together --public --source=. --push
   ```
2. **Connect to Vercel via Git integration** (do this once in the Vercel dashboard:
   *Add New → Project → Import* the GitHub repo). This installs the Vercel GitHub app and
   authorizes deploys. After this, **every push to `main` auto-builds and deploys** and
   every PR gets a preview URL — all without a password prompt.
3. **Add the env var** in Vercel: *Project → Settings → Environment Variables →*
   `ANTHROPIC_API_KEY` (Production + Preview).
4. **Make it public for her** — turn OFF any access wall so she never sees a login:
   *Project → Settings → Deployment Protection* → ensure **Vercel Authentication** and
   **Password Protection** are **disabled** for Production. (Menu names can shift in
   Vercel's UI; the thing to confirm is that production is publicly reachable.)
5. Optional: add a friendly custom domain (e.g. `mom-mahjong.<something>`) so the bookmark
   is easy.

### The ongoing loop (truly passwordless)
```bash
git add -A && git commit -m "…" && git push      # Vercel auto-deploys main → production
```
That's it — no `vercel login`, no password, on every change.

### If Claude Code should deploy via CLI non-interactively (optional)
Prefer the git-push path above. If you also want direct CLI control, create a Vercel
**access token** (*Vercel → Account Settings → Tokens*), store it as `VERCEL_TOKEN`
(local env or a GitHub Actions secret — never commit it), then:
```bash
vercel --token "$VERCEL_TOKEN" --prod --yes
```
This runs headless with no interactive password.

---

## 10. Setup commands (Claude Code can run these)

```bash
# scaffold
npx create-next-app@latest mahjong-together --js --tailwind --app --no-src-dir --eslint
cd mahjong-together
npm i lucide-react

# drop in the code
#  - components/MahjongCoach.jsx  (from the v0.2 reference)
#  - app/api/coach/route.js       (Section 8)
#  - lib/coach.js, lib/tiles.js   (extracted from the reference)
#  - wire app/page.jsx to render <MahjongCoach />

# secrets (local)
printf 'ANTHROPIC_API_KEY=%s\n' "sk-ant-..." > .env.local
echo ".env*.local" >> .gitignore

# ship
git init && git add -A && git commit -m "Mahjong, Together v0.2"
gh repo create kylefoxaustin/mahjong-together --public --source=. --push
# then import the repo in the Vercel dashboard (Section 9, step 2)
```

---

## 11. Definition of done for v1

- [ ] Start menu offers both modes with large, clear buttons.
- [ ] "Just play & learn" runs: Charleston (with Skip), draw/discard vs. bots, calling a
      set off a discard, and a detected win on the practice goal.
- [ ] "Practice my card" accepts a typed/spoken target, coaches toward it, and "Did I
      win?" returns a clear kind verdict.
- [ ] Coach speaks aloud by default; "Ask out loud" captures speech; typed box works as
      fallback; API failure degrades to a local hint (game never stalls).
- [ ] Tiles and text are large and high-contrast; keyboard focus visible; reduced-motion
      respected; works on a tablet.
- [ ] `ANTHROPIC_API_KEY` is server-side only; nothing secret in the repo.
- [ ] Pushing to `main` auto-deploys to a public URL with no login for the visitor.

---

## 12. Conventions & guardrails

- **LLM never does arithmetic.** Tile counts, legality, win-structure, turn order = code.
  The model only phrases coaching and interprets/judges the card-mode target.
- **No copyrighted card content** in the repo, in prompts, or in fixtures.
- **Coach replies stay short** (2–3 sentences), warm, one suggestion at a time, plain tile
  names, no markdown — they are read aloud.
- **Fail soft.** Any coach/network error falls back to a local hint and keeps her playing.
- **Accessibility is a feature, not a polish step.** If a change makes the screen busier or
  the text smaller, it's probably wrong for this user.
- Keep the engine deterministic and unit-testable (the win-checker especially).

---

## Reference links
- Claude API overview: https://docs.claude.com/en/api/overview
- Messages API: https://docs.claude.com/en/api/messages
- Claude Code docs: https://docs.claude.com/en/docs/claude-code/overview
- Next.js on Vercel: https://vercel.com/docs/frameworks/nextjs

## Reference files dropped by the CampMatch session

- `MahjongCoach.jsx` (repo root) — the v0.2 reference engine to port. Refactor per §6:
  extract `lib/tiles.js` + `lib/coach.js`, swap the inline `callClaude` (which posts
  straight to api.anthropic.com and only works in the artifact sandbox) for `callCoach()`
  → `/api/coach`.
- `reference/campmatch/campy-chat.ts` — CampMatch's server-side Claude proxy. Mine it for
  the fail-soft error handling + Anthropic request shape (it streams via SSE + uses tools;
  yours is simpler — non-streaming, no tools — so take the patterns, not the structure).
- `reference/campmatch/speech.ts` — CampMatch's Web Speech TTS helper. The v0.2 `useSpeech`
  hook already covers this; cross-check for the `onvoiceschanged` / voice-selection details.

*Build it gently. She's the whole point. TTA.*
