"use client";

import { useState, useEffect, useRef, useCallback, useMemo, useSyncExternalStore } from "react";
import { Volume2, VolumeX, Mic, HelpCircle, RotateCcw, ArrowRight, BadgeCheck, Lightbulb, LightbulbOff } from "lucide-react";
import { buildWall, sortHand, makeTile, isWinningHand, localHint, isValidSet, isValidKong, pickAssistedDrawIndex, coachFacts, chooseDiscard } from "@/lib/tiles";
import { buildSystemPrompt, callCoach } from "@/lib/coach";
import { LINES, LINE_ORDER, winsLine, lineProgress } from "@/lib/lines";

// Where the in-progress game is auto-saved on her device (localStorage). Bump
// the version suffix if the saved shape ever changes, to avoid restoring stale data.
const SAVE_KEY = "mahjong-together:v1";

// The three opponent seats, in turn order.
const SEAT_NAMES = ["Left player", "Across", "Right player"];

// Charleston flow: first (right→across→left), then an optional second
// (left→across→right), then an optional courtesy pass — each step skippable.
const CHARLESTON_NEXT = {
  "charleston-right": "charleston-across",
  "charleston-across": "charleston-left",
  "charleston-left": "charleston-2ask",
  "charleston2-left": "charleston2-across",
  "charleston2-across": "charleston2-right",
  "charleston2-right": "charleston-courtesy",
};
const PASS_PHASES = ["charleston-right", "charleston-across", "charleston-left", "charleston2-left", "charleston2-across", "charleston2-right"];
const CHARLESTON_SAY = {
  "charleston-across": "Good. Now pick three to pass across the table.",
  "charleston-left": "Almost done with the first pass — three more, this time to your left.",
  "charleston2-left": "Second Charleston! Pick three tiles to pass to your left.",
  "charleston2-across": "Now three across the table.",
  "charleston2-right": "Last pass — three to your right.",
};

// Difficulty ladder. `herAssist` nudges helpful tiles to her on her draw (the
// gentle "she can't lose" mode); `botAssist` is how often each opponent draws
// toward completing its OWN hand (0 = blind/basic, 1 = master). Everyone draws
// from the same shuffled wall — higher levels just make the opponents sharper.
// `claimWin`: may an opponent complete THEIR hand off HER discard (declare
// Mahjong on a discard)? Gated so Easy/Normal stay gentle and only Hard/Advanced
// introduce that real threat.
const DIFFICULTY = {
  easy:     { label: "Easy",     blurb: "I help you a lot, and the others play simply.", herAssist: true,  botAssist: 0,   claimWin: false, botClaims: false },
  normal:   { label: "Normal",   blurb: "Everyone draws their own tiles; the others play simply.", herAssist: false, botAssist: 0,   claimWin: false, botClaims: false },
  hard:     { label: "Hard",     blurb: "The other players are sharper — they grab discards and can win off yours.", herAssist: false, botAssist: 0.6, claimWin: true, botClaims: true },
  advanced: { label: "Advanced", blurb: "The other players are masters — a real challenge!", herAssist: false, botAssist: 1,   claimWin: true, botClaims: true },
};
const DIFF_ORDER = ["easy", "normal", "hard", "advanced"];

// How long each opponent "thinks" before discarding. `maxMs` is the upper bound
// of a random ponder (each bot takes a fresh random ~1s..maxMs, one after the
// other); `instant` reveals them on a brisk fixed beat. Default is a comfortable
// 20 seconds. She can always press "Skip ahead" to jump the wait.
const SPEEDS = {
  instant: { label: "Instant",      blurb: "They move right away.",            instant: true },
  s20:     { label: "Up to 20 sec", blurb: "A short, comfortable pause.",      maxMs: 20000 },
  s50:     { label: "Up to 50 sec", blurb: "A longer, real-table think.",      maxMs: 50000 },
  s75:     { label: "Up to 75 sec", blurb: "Plenty of time, like a slow game.", maxMs: 75000 },
};
const SPEED_ORDER = ["instant", "s20", "s50", "s75"];
const DEFAULT_SPEED = "s20";

const DIFF_KEY = "mahjong-together:difficulty"; // remembers her last choice across visits
const SPEED_KEY = "mahjong-together:speed"; // remembers how long the opponents think
const HINTS_KEY = "mahjong-together:hints"; // remembers the on-screen-hints toggle
const LINE_KEY = "mahjong-together:line"; // remembers the winning line she chases

/* ------------------------------------------------------------------ *
 *  Mahjong, Together — coach + game UI (ported from the v0.2 artifact)
 *
 *  Two ways to play, chosen from a start menu:
 *   1) "Just play & learn" — practice game with the Charleston and
 *      calling tiles off discards. Win goal is our own simple hand
 *      (4 sets of three + a pair, Jokers wild in a set).
 *   2) "Practice my card" — she names the exact hand she's going for
 *      from her own physical League card; the coach reads that target
 *      plus her tiles and steers her toward it, and checks her when she
 *      thinks she's done.
 *
 *  Engine (lib/tiles.js) owns tiles, turns, and win-structure. The coach
 *  (lib/coach.js → /api/coach) only phrases warm guidance and judges the
 *  plain-English card target. The LLM never does the arithmetic.
 * ------------------------------------------------------------------ */

/* --- Web Speech TTS: robust voice selection (folds in CampMatch's
   speech.ts). getVoices() is often empty until 'voiceschanged' fires,
   which matters for her very first spoken line. --- */

// Modern neural/enhanced voices sound far more natural than the old compact
// ones, and they're free where the device has them (Edge "Natural", Apple
// "Enhanced/Premium", Google/Siri). We prefer these by name first.
const NATURAL_HINT = /natural|neural|enhanced|premium|online|siri/i;
const PREFERRED_VOICE_NAMES = [
  "Samantha", "Ava", "Allison", "Victoria", "Karen", "Alex", "Daniel",
  "Google US English", "Google UK English Female", "Google UK English Male",
  "Microsoft Aria Online (Natural) - English (United States)",
  "Microsoft Jenny Online (Natural) - English (United States)",
  "Microsoft Zira - English (United States)",
];

function selectBestVoice() {
  if (typeof window === "undefined" || !window.speechSynthesis) return null;
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return null;
  const english = voices.filter((v) => v.lang && v.lang.toLowerCase().startsWith("en"));
  const pool = english.length ? english : voices;
  // 1) Any high-quality neural/enhanced English voice the device has installed.
  const natural = pool.find((v) => NATURAL_HINT.test(v.name));
  if (natural) return natural;
  // 2) A known good-sounding voice by exact name.
  for (const name of PREFERRED_VOICE_NAMES) {
    const match = pool.find((v) => v.name === name);
    if (match) return match;
  }
  // 3) Fall back to en-US, then anything.
  return pool.find((v) => v.lang === "en-US") || pool[0];
}

function useSpeech() {
  const voiceRef = useRef(null);

  // Warm up the voice list once on mount; re-resolve when it changes.
  useEffect(() => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    const resolve = () => { voiceRef.current = selectBestVoice(); };
    resolve();
    window.speechSynthesis.addEventListener?.("voiceschanged", resolve);
    return () => window.speechSynthesis.removeEventListener?.("voiceschanged", resolve);
  }, []);

  // Always speaks when called — callers decide whether voice is on. iOS needs
  // the FIRST utterance to happen inside a user gesture, so the voice toggle
  // calls this directly on tap, which both confirms it works and unlocks audio.
  const speak = useCallback((text) => {
    if (!text || typeof window === "undefined" || !window.speechSynthesis) return;
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      // If voices weren't ready at mount (Safari/Chrome first utterance), grab now.
      if (!voiceRef.current) voiceRef.current = selectBestVoice();
      if (voiceRef.current) u.voice = voiceRef.current;
      u.rate = 0.95;
      u.pitch = 1.0;
      u.volume = 1.0;
      window.speechSynthesis.speak(u);
    } catch {
      // Some browsers throw if speech is interrupted mid-queue — ignore.
    }
  }, []);

  const stop = useCallback(() => {
    if (typeof window !== "undefined" && window.speechSynthesis) {
      try { window.speechSynthesis.cancel(); } catch { /* ignore */ }
    }
  }, []);

  return { speak, stop };
}

function Tile({ tile, onClick, selected, dim, small, draggable, dragging, fill, highlight, onPointerDown, onPointerMove, onPointerUp }) {
  // Glyph and number/suit live in their own regions (top vs. bottom) so they
  // never overlap. `fill` hand tiles flex to share the rack width — they always
  // fit (no horizontal scroll) — and size their glyph/number with container
  // units (cqw) so everything scales crisply with the tile, however many there
  // are. Non-fill tiles use a fixed pixel size.
  const w = small ? 60 : 84, h = small ? 92 : 132;
  const suited = /^(\d) (Crak|Bam|Dot)$/.exec(tile.label);
  const glyphFs = fill ? (tile.isJoker ? "54cqw" : "76cqw") : (tile.isJoker ? (small ? 26 : 40) : (small ? 34 : 54));
  const numFs = fill ? "48cqw" : (small ? 20 : 34);
  const subFs = fill ? "20cqw" : (small ? 9 : 14);
  const labelFs = fill ? "19cqw" : (small ? 10 : 14);
  return (
    <button
      onClick={onClick}
      disabled={!onClick}
      aria-label={tile.label}
      data-tileid={tile.id}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      className={`relative flex ${fill ? "" : "shrink-0"} flex-col items-center justify-between overflow-hidden rounded-lg border-2 bg-white shadow-md transition motion-reduce:transition-none
        ${onClick
          ? "cursor-pointer hover:-translate-y-1 focus:-translate-y-1 motion-reduce:hover:translate-y-0 motion-reduce:focus:translate-y-0 focus:outline-none focus:ring-4 focus:ring-red-400"
          : "cursor-default"}
        ${draggable ? "touch-none" : ""}
        ${dragging ? "opacity-80 scale-105 shadow-xl z-10" : ""}
        ${dragging ? "border-amber-500 ring-4 ring-amber-400"
          : selected ? "border-red-600 ring-4 ring-red-300 -translate-y-1 motion-reduce:translate-y-0"
          : highlight ? "border-yellow-500 ring-4 ring-yellow-300 -translate-y-1 motion-reduce:translate-y-0"
          : "border-stone-400"}
        ${dim ? "opacity-70" : ""}`}
      style={fill
        ? { flex: "1 1 0", minWidth: 0, maxWidth: 124, aspectRatio: "84 / 132", containerType: "inline-size" }
        : { width: w, height: h }}
    >
      <span aria-hidden="true" className="flex w-full items-center justify-center overflow-hidden text-stone-700 pt-0.5" style={{ fontSize: glyphFs, lineHeight: 1 }}>{tile.glyph}</span>
      {suited ? (
        <span className="flex flex-col items-center leading-none pb-1">
          <span className="font-black text-stone-900" style={{ fontSize: numFs }}>{suited[1]}</span>
          <span className="font-bold text-stone-600 uppercase tracking-wide" style={{ fontSize: subFs }}>{suited[2]}</span>
        </span>
      ) : (
        <span className="font-black text-stone-900 text-center leading-tight px-0.5 pb-1" style={{ fontSize: labelFs }}>{tile.label}</span>
      )}
    </button>
  );
}

// One slot in the "Your goal" progress panel.
//  locked  = committed/exposed (or won) → SOLID gold ✓ ("locked in & safe")
//  held    = she's holding the tiles but hasn't committed → gold OUTLINE (hollow)
//  building= a pair working toward a set → dim "…"
//  empty   = nothing yet
function Slot({ state, kind = "set" }) {
  const label = kind === "pair" ? "Pair" : kind === "kong" ? "Kong" : "Set";
  const pair = kind === "pair";
  const styles =
    state === "locked"
      ? "bg-amber-400 border-amber-300 text-emerald-950" // solid
      : state === "held"
        ? "bg-transparent border-amber-400 text-amber-300" // outline only
        : state === "building"
          ? "bg-emerald-700/40 border-emerald-500 text-emerald-100"
          : "bg-emerald-900/40 border-emerald-700/70 text-emerald-600";
  const status =
    state === "locked" ? "locked in" : state === "held" ? "you have it — not locked yet" : state === "building" ? "in progress" : "not started yet";
  const mark = state === "locked" ? "✓" : state === "held" ? "○" : state === "building" ? "…" : "•";
  return (
    <div
      role="img"
      aria-label={`${label}: ${status}`}
      className={`flex flex-col items-center justify-center rounded-2xl border-4 h-16 w-16 sm:w-20 ${pair ? "" : ""} ${styles}`}
    >
      <span className="text-2xl font-black leading-none" aria-hidden="true">{mark}</span>
      <span className="mt-0.5 text-[10px] sm:text-xs font-bold uppercase tracking-wide">{label}</span>
    </div>
  );
}

export default function MahjongCoach() {
  const [screen, setScreen] = useState("menu");
  const [mode, setMode] = useState("learn");
  const [difficulty, setDifficulty] = useState("easy");
  const [line, setLine] = useState("foursets"); // which winning line she's chasing (learn mode)
  const [target, setTarget] = useState("");

  const [wall, setWall] = useState([]);
  const [hand, setHand] = useState([]);
  const [exposed, setExposed] = useState([]);
  const [lockedPair, setLockedPair] = useState(null); // the two tiles she's committed as her pair
  const [selected, setSelected] = useState([]);
  const [highlightIds, setHighlightIds] = useState([]); // tiles the coach just mentioned — lit up in gold
  const [botDiscards, setBotDiscards] = useState([null, null, null]); // last tile each opponent tossed
  const [botHands, setBotHands] = useState([[], [], []]); // the three opponents' concealed hands (face down to her)
  const [callable, setCallable] = useState(null);
  const [discards, setDiscards] = useState([]); // spent tiles, recycled into the wall when it runs low
  const [phase, setPhase] = useState("draw");
  const [coach, setCoach] = useState("");
  const [thinking, setThinking] = useState(false);
  const [voiceOn, setVoiceOn] = useState(true);
  const [hintsOn, setHintsOn] = useState(true); // on-screen highlighting of tiles/sets
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState(""); // live words while she's speaking
  const [typed, setTyped] = useState("");
  const recogRef = useRef(null);
  const finalTranscriptRef = useRef(""); // accumulates her finished phrases across pauses
  const stoppingRef = useRef(false); // true once she's done (or silence) — so we send, not restart
  const silenceTimerRef = useRef(null); // generous "she's gone quiet" auto-finish
  const currentSegRef = useRef(""); // native STT: the phrase being spoken right now (between restarts)
  const rackRef = useRef(null); // the hand rack, for drag-to-rearrange measurements
  const dragRef = useRef(null); // in-flight drag: { id, startX, moved }
  const justDraggedRef = useRef(false); // suppress the click that fires after a drag
  const [dragId, setDragId] = useState(null); // tile currently being dragged (for styling)
  const [savedGame, setSavedGame] = useState(null); // a resumable auto-saved game, surfaced as "Continue" on the menu
  const [isStandalone, setIsStandalone] = useState(false); // true when already installed as an app (hides the install tip)
  const [speed, setSpeedState] = useState(DEFAULT_SPEED); // how long the opponents "think" before discarding
  const hydratedRef = useRef(false); // becomes true once a saved game has been restored (or none found)
  const botTimersRef = useRef([]); // pending setTimeout ids for the staged opponent turns
  const fastForwardRef = useRef(null); // set during a bots round so "Skip ahead" can fast-forward it
  const clearBotTimers = () => { botTimersRef.current.forEach(clearTimeout); botTimersRef.current = []; };

  const { speak, stop } = useSpeech();
  // Speech-to-text comes from one of two places: the Web Speech API (Chrome /
  // Android browsers; absent on iOS Safari), OR — when we're running inside our
  // native app — the Capacitor speech-recognition plugin (works on iOS + Android).
  // Capacitor injects `window.Capacitor` even when loading a remote URL, so we can
  // detect native without statically importing the plugin (keeps SSR/build clean).
  // useSyncExternalStore reads client-only: server snapshot false, no hydration
  // mismatch, real value lands on the client without a setState-in-effect.
  const sttSupported = useSyncExternalStore(
    () => () => {}, // capability is static — nothing to subscribe to
    () => !!(window.SpeechRecognition || window.webkitSpeechRecognition) || !!window.Capacitor?.isNativePlatform?.(),
    () => false, // server snapshot
  );

  const lineDef = LINES[line] || LINES.foursets;
  const pairsLine = lineDef.structure === "pairs"; // Seven pairs — no set/kong/pair locking
  const allTiles = useMemo(() => [...hand, ...exposed.flat(), ...(lockedPair || [])], [hand, exposed, lockedPair]);
  // When she wins, work out ONE clear way her tiles make the chosen line.
  const winBreakdown = useMemo(() => (phase === "won" ? lineDef.decompose(allTiles) : null), [phase, allTiles, lineDef]);
  // Progress toward the chosen line — drives the panel slots and (when hints are
  // on) the gold highlight on the matching tiles.
  const progress = useMemo(() => lineProgress(line, hand, exposed, lockedPair), [line, hand, exposed, lockedPair]);
  const hintIds = progress.hintIds;
  // Which currently-selected concealed tiles (if any) form a valid set/kong.
  const selectedTiles = useMemo(() => hand.filter((t) => selected.includes(t.id)), [hand, selected]);
  const canMakeSet = !pairsLine && selected.length === 3 && isValidSet(selectedTiles);
  const canMakeKong = !pairsLine && selected.length === 4 && isValidKong(selectedTiles);
  // Two matching REAL tiles she can commit as a pair (jokers never in a pair).
  // Sets-lines have a single pair (lockedPair); Seven pairs collects many.
  const canMakePair = selected.length === 2 &&
    selectedTiles.length === 2 && !selectedTiles[0].isJoker && !selectedTiles[1].isJoker &&
    selectedTiles[0].key === selectedTiles[1].key &&
    (pairsLine || !lockedPair);
  // She can declare a win only when her tiles actually win the chosen line, and
  // it's her turn — she decides WHEN, the game never finishes it for her.
  const canDeclareWin = mode === "learn" && phase === "discard" && winsLine(line, allTiles);
  // Joker exchange: on her turn, a Joker in one of her locked sets can be
  // reclaimed if she holds the real tile it stands in for.
  const myTurn = phase === "draw" || phase === "discard";
  // She can ask the coach only when it's her move — never during the opponents'
  // turn, so the coach can't hand back stale "wait for my turn" advice just as
  // her turn begins.
  const canAsk = myTurn || phase === "call";
  const anyJokerRedeemable = myTurn && exposed.some((g) => {
    const realKey = g.find((t) => !t.isJoker)?.key;
    return realKey && g.some((t) => t.isJoker) && hand.some((t) => t.key === realKey && !t.isJoker);
  });
  const say = useCallback((msg) => { setCoach(msg); if (voiceOn) speak(msg); }, [voiceOn, speak]);

  // Voice on/off. Turning it ON speaks the current coaching line immediately
  // (inside the tap) so she hears that it works and gets caught up; iOS also
  // needs that first utterance to be in a user gesture to unlock audio.
  const toggleVoice = useCallback(() => {
    if (voiceOn) { stop(); setVoiceOn(false); }
    else { setVoiceOn(true); speak(coach || "Voice is on. I'll read everything to you."); }
  }, [voiceOn, coach, speak, stop]);

  // On-screen hints = the gold tile highlighting (coach suggestions + the goal
  // panel's "you're holding these" outline). Remembered across visits.
  const toggleHints = useCallback(() => {
    setHintsOn((on) => {
      const next = !on;
      try { localStorage.setItem(HINTS_KEY, next ? "1" : "0"); } catch { /* ignore */ }
      return next;
    });
  }, []);

  // On first load, read remembered menu prefs and detect any resumable game
  // (client only, so no SSR mismatch). We DON'T jump onto the board — instead we
  // open on the menu and offer a big "Continue your game" button, so she's never
  // dropped mid-game without context. Also note if we're already an installed app.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    try {
      const standalone =
        window.matchMedia?.("(display-mode: standalone)")?.matches ||
        window.navigator.standalone === true;
      if (standalone) setIsStandalone(true);
    } catch { /* ignore */ }
    try {
      const pref = localStorage.getItem(DIFF_KEY);
      if (pref && DIFFICULTY[pref]) setDifficulty(pref); // remembered menu choice
      const linePref = localStorage.getItem(LINE_KEY);
      if (linePref && LINES[linePref]) setLine(linePref);
      const hp = localStorage.getItem(HINTS_KEY);
      if (hp === "0") setHintsOn(false);
      const sp = localStorage.getItem(SPEED_KEY);
      if (sp && SPEEDS[sp]) setSpeedState(sp);
      const raw = localStorage.getItem(SAVE_KEY);
      const s = raw && JSON.parse(raw);
      const terminal = s && ["won", "botwon", "wallgame"].includes(s.phase);
      if (s && s.screen === "game" && Array.isArray(s.hand) && s.hand.length && !terminal) {
        setSavedGame(s); // surface "Continue your game" on the menu
      } else if (terminal) {
        localStorage.removeItem(SAVE_KEY); // a finished game isn't resumable
      }
    } catch { /* corrupt or unavailable storage — start fresh */ }
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Auto-save the in-progress game whenever it changes (no buttons, no prompts).
  // The first run is skipped so it can't clobber the save before restore lands.
  useEffect(() => {
    if (!hydratedRef.current) { hydratedRef.current = true; return; }
    try {
      // Only write while in a game. We deliberately DON'T clear the save on the
      // menu — that's what keeps "Continue your game" available. The save is
      // cleared explicitly by "Start over", and overwritten when a new game starts.
      if (screen === "game") {
        localStorage.setItem(SAVE_KEY, JSON.stringify({
          screen, mode, difficulty, line, target, wall, hand, exposed, lockedPair, discards, botDiscards, botHands, callable, phase, coach, voiceOn,
        }));
      }
    } catch { /* storage full or unavailable — ignore, game still works */ }
  }, [screen, mode, difficulty, line, target, wall, hand, exposed, lockedPair, discards, botDiscards, botHands, callable, phase, coach, voiceOn]);

  const startGame = useCallback((withCharleston) => {
    stop();
    clearBotTimers();
    const w = buildWall();
    const h = sortHand(w.splice(0, 13));
    // Deal each of the three opponents a concealed 13-tile hand from the wall.
    const bots = [sortHand(w.splice(0, 13)), sortHand(w.splice(0, 13)), sortHand(w.splice(0, 13))];
    setWall(w); setHand(h); setBotHands(bots); setExposed([]); setLockedPair(null); setSelected([]); setCallable(null);
    setDiscards([]); setHighlightIds([]);
    setBotDiscards([null, null, null]);
    setSavedGame(null); // a fresh game supersedes any earlier auto-save
    setScreen("game");
    if (mode === "learn" && withCharleston) {
      setPhase("charleston-right");
      say("First comes the Charleston. Pick three tiles you don't need and we'll pass them to your right. Tap three, then press Pass.");
    } else {
      setPhase("draw");
      say(mode === "card"
        ? `Let's build your hand: "${target}". Take a tile when you're ready, and I'll help you head toward it.`
        : "Here are your 13 tiles. Take a tile from the wall and we'll figure out the rest together.");
    }
  }, [mode, target, say, stop]);

  // Resume the auto-saved game (the "Continue your game" button on the menu).
  // Mirrors the save shape written above; silent (we set coach text, not speech).
  const continueGame = useCallback(() => {
    const s = savedGame;
    if (!s) return;
    stop();
    clearBotTimers();
    setMode(s.mode || "learn");
    if (s.difficulty && DIFFICULTY[s.difficulty]) setDifficulty(s.difficulty);
    if (s.line && LINES[s.line]) setLine(s.line);
    setTarget(s.target || "");
    setWall(s.wall || []);
    setHand(s.hand || []);
    setExposed(s.exposed || []);
    setLockedPair(s.lockedPair || null);
    setDiscards(s.discards || []);
    setBotDiscards(s.botDiscards || [null, null, null]);
    setBotHands(s.botHands || [[], [], []]);
    // A Seven-pairs game never has a real call; drop any stale callable.
    const pairsRestore = LINES[s.line]?.structure === "pairs";
    setCallable(pairsRestore ? null : (s.callable || null));
    // "bots" is transient (timer-driven), and "call" doesn't belong to a pairs
    // line — in either case just hand the turn back to her.
    setPhase(s.phase === "bots" || (pairsRestore && s.phase === "call") ? "draw" : (s.phase || "draw"));
    setCoach(s.coach || "");
    if (typeof s.voiceOn === "boolean") setVoiceOn(s.voiceOn);
    setSelected([]); setHighlightIds([]);
    setSavedGame(null);
    setScreen("game");
  }, [savedGame, stop]);

  // Pick (and remember) a difficulty from the menu.
  const chooseDifficulty = useCallback((key) => {
    setDifficulty(key);
    try { localStorage.setItem(DIFF_KEY, key); } catch { /* ignore */ }
  }, []);

  // How long the opponents think before discarding (remembered across visits).
  const setSpeed = useCallback((key) => {
    setSpeedState(key);
    try { localStorage.setItem(SPEED_KEY, key); } catch { /* ignore */ }
  }, []);

  // Pick (and remember) which winning line she's chasing.
  const chooseLine = useCallback((key) => {
    setLine(key);
    try { localStorage.setItem(LINE_KEY, key); } catch { /* ignore */ }
  }, []);

  // "Start over" — wipe the saved game and return to a clean menu.
  // Hard-stop the microphone with no callbacks firing (used on leave/unmount).
  const cancelListening = useCallback(() => {
    clearTimeout(silenceTimerRef.current);
    stoppingRef.current = true;
    const rec = recogRef.current;
    if (rec) { rec.onresult = null; rec.onerror = null; rec.onend = null; try { rec.abort(); } catch { /* ignore */ } }
    recogRef.current = null;
    if (typeof window !== "undefined" && window.Capacitor?.isNativePlatform?.()) {
      import("@capacitor-community/speech-recognition")
        .then(({ SpeechRecognition }) => { SpeechRecognition.stop().catch(() => {}); SpeechRecognition.removeAllListeners(); })
        .catch(() => {});
    }
    setListening(false); setInterim("");
  }, []);

  const startOver = useCallback(() => {
    stop();
    cancelListening();
    clearBotTimers();
    try { localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ }
    setSavedGame(null);
    setHand([]); setWall([]); setExposed([]); setLockedPair(null); setDiscards([]); setBotHands([[], [], []]);
    setBotDiscards([null, null, null]); setCallable(null); setSelected([]); setHighlightIds([]);
    setPhase("draw"); setCoach(""); setTarget(""); setMode("learn");
    setScreen("menu");
  }, [stop, cancelListening]);

  // Clear any pending opponent-turn timers and stop the mic if the page goes away.
  useEffect(() => () => { clearBotTimers(); cancelListening(); }, [cancelListening]);

  // Plain-English summary of exactly what she can do right now, so the coach
  // only ever suggests real on-screen actions (CLAUDE.md §12 — no impossible
  // advice). Kept terse; it's context for the model, not read aloud.
  const actionsForPhase = useCallback((p = phase, formable = {}) => {
    // Only mention "Make this…" for groups she can ACTUALLY form right now (she
    // has two/three matching tiles). With no matches, say so plainly so the coach
    // never tells her to "find a pair" when there isn't one.
    let makeHint = "";
    if (!pairsLine) {
      const opts = [];
      if (formable.hasReadySet) opts.push(`tap the three or four matching tiles and press "Make this set" / "Make this kong"`);
      if (formable.hasPair) opts.push(`tap the two matching tiles and press "Make this my pair"`);
      makeHint = opts.length
        ? ` She could also ${opts.join(", or ")}.`
        : ` She has NO matching tiles to make a set or pair yet, so do NOT suggest finding or making one — her move is simply to ${p === "discard" ? "let a tile go" : "draw a tile"}.`;
    }
    if (p === "draw") return `It is her turn to draw. She can press "Take a tile" to draw from the wall.${makeHint}`;
    if (p === "discard") return `She has ALREADY drawn her tile, so she canNOT take another right now — the "Take a tile" button is disabled. Her main move is to let one tile go: tap a tile and press "Let this tile go".${makeHint} Do NOT tell her to take or draw a tile.`;
    if (p === "call") return `A tile on the table (${callable?.label}) would finish a set. She can press "Take it" or "Leave it". Do NOT tell her to draw.`;
    return `It's a quiet moment; she's getting set up.`;
  }, [phase, callable, pairsLine]);

  // `overrides` lets a caller pass the just-updated hand/phase, since React
  // state set immediately before this call hasn't been applied yet (that's how
  // the coach used to give "take a tile" advice right after she'd drawn).
  const runCoach = useCallback(async (question, overrides) => {
    const curHand = overrides?.hand ?? hand;
    const curPhase = overrides?.phase ?? phase;
    setThinking(true);
    setHighlightIds([]); // clear any old highlight while she waits
    const sys = buildSystemPrompt(mode, target, lineDef.coachGoal);
    const f = coachFacts(curHand);
    const tilesStr = sortHand(curHand).map((t) => t.label).join(", ");
    // Exact facts from the engine. The coach phrases these; it must not recount.
    // Pair-centric facts for Seven pairs; set-centric for the other lines.
    const facts = (pairsLine ? [
      `Her goal this game: ${lineDef.coachGoal}`,
      `Pairs she already has (two matching): ${f.pairs.length ? f.pairs.join(", ") : "none"}.`,
      `Tiles she has three or more of (a pair needs only two — a spare can go): ${f.readySets.length ? f.readySets.join(", ") : "none"}.`,
      `Tiles she has only ONE of (need a match to make a pair): ${f.singles.length ? f.singles.join(", ") : "none"}.`,
      `Jokers in her hand: ${f.jokers} (Jokers CANNOT be in a pair, so they're best let go).`,
      `Her full hand, for context only: ${tilesStr}.`,
    ] : [
      mode === "learn" ? `Her goal this game: ${lineDef.coachGoal}` : "",
      `Groups she has locked in and safe so far: ${exposed.length}${lockedPair ? " (plus her pair)" : ""}.`,
      `Tiles she ALREADY has three of (ready-made sets): ${f.readySets.length ? f.readySets.join(", ") : "none"}.`,
      `Pairs in her hand (two matching): ${f.pairs.length ? f.pairs.join(", ") : "none"}.`,
      `Jokers in her hand: ${f.jokers} (a Joker is wild inside a set, never in a pair).`,
      `Her full hand, for context only: ${tilesStr}.`,
      curPhase === "call" && callable
        ? `A tile on the table she can TAKE right now: ${callable.label} (she presses "Take it").`
        : `No discarded tile can be taken right now — taking only happens the moment it's offered.`,
    ]).filter(Boolean).join("\n");
    const formable = { hasReadySet: f.readySets.length > 0, hasPair: f.pairs.length > 0 };
    const rules = `These facts are exact and come from the game. Do NOT count her tiles or invent any numbers, and only ever name tiles that appear in the facts above — never a tile she doesn't have. Do NOT tell her to "look for", "find", or "make" a pair or set unless the facts list tiles she ALREADY has two or three of; if she has none, the right move is simply to draw or let a tile go. Never tell her to take/grab a discarded tile unless the facts say one can be taken right now. Suggest ONLY actions that are possible right now. What she can do right now: ${actionsForPhase(curPhase, formable)}`;
    const userText = question
      ? `${facts}\n\n${rules}\n\nShe asked out loud: "${question}"\n\nAnswer her kindly and simply, suggesting only things she can do right now.`
      : `${facts}\n\n${rules}\n\nGive her ONE gentle suggestion for her next move.`;
    const reply = await callCoach(sys, userText);
    const finalText = reply || localHint([...curHand, ...exposed.flat()]);
    say(finalText);
    // Light up any of her tiles the coach named (deterministic label match).
    const low = finalText.toLowerCase();
    setHighlightIds(curHand.filter((t) => low.includes(t.label.toLowerCase())).map((t) => t.id));
    setThinking(false);
  }, [hand, phase, exposed, lockedPair, callable, mode, target, lineDef, pairsLine, actionsForPhase, say]);

  const toggleSelect = (tile) => {
    setHighlightIds([]); // she's choosing now — let her own selection lead
    const maxSel = phase === "draw" || phase === "discard" ? 4 : 3; // 4 only for kongs in play
    setSelected((s) => s.includes(tile.id) ? s.filter((x) => x !== tile.id) : s.length < maxSel ? [...s, tile.id] : s);
  };

  // Move `n` selected tiles out and draw `n` back (the pass is simulated from
  // the wall). Used by every Charleston pass (3) and the courtesy pass (0–3).
  const passTiles = (n) => {
    const keep = hand.filter((t) => !selected.includes(t.id));
    const received = wall.slice(0, n);
    setHand(sortHand([...keep, ...received]));
    setWall((w) => w.slice(n));
    setSelected([]);
  };

  const finishCharleston = useCallback(() => {
    setSelected([]);
    setPhase("draw");
    say(mode === "card"
      ? `All set! We're building your hand: "${target}". Take a tile when you're ready.`
      : "All set — the Charleston's done. Take a tile from the wall and we'll figure out the rest together.");
  }, [mode, target, say]);

  const passCharleston = () => {
    if (selected.length !== 3) return;
    passTiles(3);
    const next = CHARLESTON_NEXT[phase];
    setPhase(next);
    if (next === "charleston-2ask") say("That's the first Charleston done! Would you like a second Charleston, or shall we start playing?");
    else if (next === "charleston-courtesy") say("Almost ready! One last courtesy swap with the player across — pick up to three tiles to trade, or skip.");
    else say(CHARLESTON_SAY[next] || "Pick three to pass.");
  };

  const startSecondCharleston = () => { setSelected([]); setPhase("charleston2-left"); say(CHARLESTON_SAY["charleston2-left"]); };
  const declineSecondCharleston = () => { setSelected([]); setPhase("charleston-courtesy"); say("We'll skip the second Charleston. One last courtesy swap with the player across — pick up to three tiles to trade, or skip."); };
  const doCourtesy = () => {
    if (selected.length > 3) return;
    passTiles(selected.length); // 0–3
    finishCharleston();
  };

  // The wall is finite (real mahjong): when it runs out with no winner, the
  // hand is a gentle draw — a "wall game".
  const endWallGame = useCallback(() => {
    clearBotTimers();
    setPhase("wallgame");
    say("We've used up all the tiles and nobody finished — this hand is a wash. That happens! Press “Play again” for a fresh deal.");
  }, [say]);

  // The three opponents each take a real turn: draw a tile, and either declare
  // Mahjong (rare — they draw blind) or let go of their least useful tile. We
  // compute the whole round up front (deterministic, no stale state), then
  // REVEAL each toss on a short timer so she can watch what they did.
  const playBotsRound = useCallback((herConcealed) => {
    clearBotTimers();
    const botAssist = DIFFICULTY[difficulty].botAssist; // 0 = basic/blind, 1 = master
    let w = [...wall];
    const disc = [...discards];
    // A bot draws blind by default; at higher difficulty it sometimes draws the
    // most useful tile for its OWN hand. The wall is finite — no recycling.
    const drawFor = (botHand) => {
      if (w.length === 0) return null;
      const idx = botAssist > 0 && Math.random() < botAssist ? pickAssistedDrawIndex(w, botHand) : 0;
      return w.splice(idx, 1)[0];
    };
    const bots = botHands.map((h) => [...h]);
    const tosses = [null, null, null];
    let winner = -1;
    for (let i = 0; i < 3; i++) {
      const drawn = drawFor(bots[i]);
      if (!drawn) break;
      bots[i] = [...bots[i], drawn];
      // Bots only declare Mahjong in the practice game — in "Practice my card"
      // they never end her round, so she can keep working toward her hand.
      if (mode === "learn" && isWinningHand(bots[i])) { winner = i; break; }
      const d = chooseDiscard(bots[i]);
      bots[i] = bots[i].filter((t) => t.id !== d.id);
      tosses[i] = d;
      disc.push(d);
    }
    // Commit the (non-animated) state now; reveal the tosses on a timer.
    setWall(w); setBotHands(bots); setDiscards(disc);
    setSelected([]); setCallable(null); setBotDiscards([null, null, null]);
    setPhase("bots");
    const spd = SPEEDS[speed] || SPEEDS[DEFAULT_SPEED];
    say(spd.instant
      ? "Let's see what the other players do."
      : "The other players are taking their turns. Take all the time you need — or press “Skip ahead” to hurry them along.");

    const lastReveal = winner >= 0 ? winner : 2;
    const reveal = (i) => setBotDiscards((bd) => { const n = [...bd]; n[i] = tosses[i]; return n; });

    // Resolve the round once the opponents have discarded: detect a win, an
    // opponent's claim, or hand the turn back to her (offering any tile she can take).
    const resolve = () => {
      fastForwardRef.current = null; // round's over — disarm "Skip ahead"
      if (winner >= 0) {
        setPhase("botwon");
        say(`${SEAT_NAMES[winner]} finished their hand this round — nicely played by them! You'll get the next one. Press "Play again" when you're ready.`);
        return;
      }
      const counts = {};
      herConcealed.forEach((t) => { if (!t.isJoker) counts[t.key] = (counts[t.key] || 0) + 1; });
      // Seven pairs never claims a pung off a discard — there are no sets.
      const claim = (LINES[line].structure === "pairs") ? null : (tosses.find((p) => p && !p.isJoker && counts[p.key] >= 2) || null);
      if (claim) {
        const cfg = DIFFICULTY[difficulty];
        const di = tosses.indexOf(claim); // the opponent who discarded it
        const keyOf = (bh, key) => bh.filter((t) => t.key === key && !t.isJoker).length;
        // Her own winning claim has priority over any opponent exposure (Mahjong
        // beats an exposure), and we always protect the human's win.
        const herWin = winsLine(line, [...herConcealed, claim, ...exposed.flat(), ...(lockedPair || [])]);
        // (a) Otherwise an opponent may declare Mahjong on it (Hard/Advanced).
        if (!herWin && cfg.claimWin) {
          const wb = bots.findIndex((bh, i) => i !== di && isWinningHand([...bh, claim]));
          if (wb >= 0) {
            setBotHands((hs) => hs.map((bh, i) => (i === wb ? [...bh, claim] : bh)));
            setDiscards((d) => d.filter((x) => x !== claim));
            setPhase("botwon");
            say(`${SEAT_NAMES[wb]} called the ${claim.label} to complete their hand — Mahjong for them! You'll get the next one. Press “Play again” when you're ready.`);
            return;
          }
        }
        // (b) Or an opponent grabs it for a set before she can (turn priority).
        if (!herWin && cfg.botClaims) {
          const tk = bots.findIndex((bh, i) => i !== di && keyOf(bh, claim.key) >= 2);
          if (tk >= 0) {
            setDiscards((d) => d.filter((x) => x !== claim)); // taken off the table
            setPhase("draw");
            say(`${SEAT_NAMES[tk]} grabbed the ${claim.label} for a set before you could. Your turn — take a tile when you're ready.`);
            return;
          }
        }
        // (c) It's hers to take.
        setCallable(claim);
        setPhase("call");
        say(herWin
          ? `The ${claim.label} completes your hand! Others wanted it, but a winning claim comes first. Take your time — press “Take it”, then “I think I won!”.`
          : `Wait — that ${claim.label} would finish a set for you! Take your time: press “Take it” to grab it, or “Leave it” to pass. It will wait for you.`);
      } else if (w.length === 0) {
        endWallGame(); // the wall ran dry and nobody finished
      } else {
        setPhase("draw");
        say("Your turn again — take a tile when you're ready.");
      }
    };

    // "Skip ahead" fast-forwards the rest of this round: cancel the pending
    // ponder timers, reveal every discard at once, and resolve immediately.
    fastForwardRef.current = () => {
      clearBotTimers();
      for (let i = 0; i <= lastReveal; i++) reveal(i);
      resolve();
    };

    if (spd.instant) {
      // Instant: a brisk, steady beat so the tosses are still readable.
      const STEP = 280;
      for (let i = 0; i <= lastReveal; i++) {
        botTimersRef.current.push(setTimeout(() => reveal(i), STEP * (i + 1)));
      }
      botTimersRef.current.push(setTimeout(resolve, STEP * (lastReveal + 2)));
    } else {
      // Each opponent ponders a fresh random ~1s..maxMs before discarding, one
      // after another, like real people at the table.
      const FLOOR = Math.min(1000, spd.maxMs);
      let at = 0;
      for (let i = 0; i <= lastReveal; i++) {
        at += FLOOR + Math.random() * (spd.maxMs - FLOOR);
        const when = at;
        botTimersRef.current.push(setTimeout(() => reveal(i), when));
      }
      botTimersRef.current.push(setTimeout(resolve, at + 900));
    }
  }, [wall, discards, botHands, exposed, lockedPair, difficulty, mode, line, speed, endWallGame, say]);

  // "Skip ahead" button during the opponents' turns — hurry them without waiting.
  const skipBots = useCallback(() => {
    if (fastForwardRef.current) fastForwardRef.current();
  }, []);

  const drawTile = () => {
    if (phase !== "draw") return;
    if (wall.length === 0) { endWallGame(); return; } // finite wall — nobody won
    // On Easy (learn mode) we nudge a helpful tile her way so she can't lose;
    // at Normal and up she draws from the wall like everyone else.
    const idx = mode === "learn" && DIFFICULTY[difficulty].herAssist ? pickAssistedDrawIndex(wall, hand, lineDef.assist) : 0;
    const t = wall[idx];
    const rest = [...wall.slice(0, idx), ...wall.slice(idx + 1)];
    // Append the new tile (don't re-sort) so her own arrangement is preserved;
    // the fresh tile arrives at the end of the rack. "Tidy up" re-sorts on demand.
    const newHand = [...hand, t];
    setWall(rest); setHand(newHand); setSelected([]);
    setPhase("discard");
    // Never auto-declare — she decides when to finish. If she now holds a
    // winning hand, point her to the "I think I won!" button; otherwise coach.
    const full = [...newHand, ...exposed.flat(), ...(lockedPair || [])];
    if (mode === "learn" && winsLine(line, full)) {
      say("Wonderful — I think you have a winning hand! When you're ready, press “I think I won!” to finish. You can keep arranging or locking sets first if you like.");
    } else {
      // Pass the fresh hand + phase — state set above isn't applied yet, and the
      // coach must advise on the discard step (the just-drawn tile included).
      runCoach(undefined, { hand: newHand, phase: "discard" });
    }
  };

  // She declares the win herself (the button only shows when she truly has one).
  const declareWin = () => {
    setPhase("won");
    say("You did it! Four sets and a pair — that's a winning hand. Beautifully done.");
  };

  const discardTile = (tile) => {
    if (phase !== "discard" || !tile) return;
    const newHand = hand.filter((t) => t.id !== tile.id);
    setHand(newHand);
    setDiscards((d) => [...d, tile]);
    setSelected([]);
    // #3: at Hard/Advanced, an opponent may complete THEIR hand off her discard.
    if (mode === "learn" && DIFFICULTY[difficulty].claimWin) {
      const claimer = botHands.findIndex((bh) => isWinningHand([...bh, tile]));
      if (claimer >= 0) {
        clearBotTimers();
        setBotHands((hs) => hs.map((bh, i) => (i === claimer ? [...bh, tile] : bh)));
        setBotDiscards([null, null, null]);
        setPhase("botwon");
        say(`${SEAT_NAMES[claimer]} called your ${tile.label} to complete their hand — Mahjong for them this round! You'll get the next one. Press “Play again” when you're ready.`);
        return;
      }
    }
    playBotsRound(newHand);
  };
  // "Let this tile go" — discards the single selected tile.
  const letItGo = () => {
    if (phase !== "discard" || selected.length !== 1) return;
    discardTile(hand.find((t) => t.id === selected[0]));
  };

  // Re-sort the rack whenever she wants the game to organize it for her.
  const tidyUp = () => { setSelected([]); setHand((h) => sortHand(h)); };

  /* --- Drag to rearrange her own rack (touch + mouse, via Pointer Events).
     A tap (no real movement) still selects; a drag past a small threshold
     reorders. New draws append to the end so her arrangement is preserved. --- */
  const canArrange = phase === "draw" || phase === "discard";
  const onTilePointerDown = (e, tile) => {
    if (!canArrange) return;
    dragRef.current = { id: tile.id, startX: e.clientX, moved: false };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* older browsers */ }
  };
  const onTilePointerMove = (e) => {
    const d = dragRef.current;
    if (!d) return;
    if (!d.moved && Math.abs(e.clientX - d.startX) < 10) return; // tap, not a drag
    if (!d.moved) { d.moved = true; setDragId(d.id); }
    const kids = rackRef.current ? [...rackRef.current.querySelectorAll("[data-tileid]")] : [];
    let target = 0; // insertion index among the OTHER tiles
    for (const k of kids) {
      if (k.dataset.tileid === d.id) continue;
      const r = k.getBoundingClientRect();
      if (e.clientX > r.left + r.width / 2) target++;
    }
    setHand((h) => {
      const from = h.findIndex((t) => t.id === d.id);
      if (from < 0) return h;
      const arr = [...h];
      const [m] = arr.splice(from, 1);
      arr.splice(Math.max(0, Math.min(arr.length, target)), 0, m);
      if (arr.every((t, i) => t.id === h[i].id)) return h; // no change — avoid churn
      return arr;
    });
  };
  const onTilePointerUp = (e) => {
    const d = dragRef.current;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    if (d?.moved) justDraggedRef.current = true; // swallow the click that follows a drag
    dragRef.current = null;
    setDragId(null);
  };

  // "Make this set" — lock three matching (Joker-wild) tiles down as a set.
  const makeSet = () => {
    if (!canMakeSet) return;
    const setTiles = hand.filter((t) => selected.includes(t.id));
    const keep = hand.filter((t) => !selected.includes(t.id));
    const newExposed = [...exposed, setTiles];
    setHand(keep);
    setExposed(newExposed);
    setSelected([]);
    const full = [...keep, ...newExposed.flat(), ...(lockedPair || [])];
    if (mode === "learn" && phase === "discard" && winsLine(line, full)) {
      say("Lovely — that set is locked in, and I think you have a winning hand now! Press “I think I won!” when you're ready.");
    } else {
      say(phase === "discard" ? "Lovely — that set is locked in and safe. Now let one tile go." : "Lovely — that set is locked in and safe. Take a tile when you're ready.");
    }
  };

  // "Make this kong" — lock four matching (Joker-wild) tiles as a kong, and
  // draw a replacement tile (a kong is worth an extra tile). She ends up with a
  // tile to let go, so we land in the discard step.
  const makeKong = () => {
    if (!canMakeKong) return;
    const kongTiles = hand.filter((t) => selected.includes(t.id));
    const keep = hand.filter((t) => !selected.includes(t.id));
    // Replacement draw (assisted on Easy, like her normal draw).
    let newHand = keep, restWall = wall;
    if (wall.length > 0) {
      const idx = mode === "learn" && DIFFICULTY[difficulty].herAssist ? pickAssistedDrawIndex(wall, keep, lineDef.assist) : 0;
      newHand = [...keep, wall[idx]];
      restWall = [...wall.slice(0, idx), ...wall.slice(idx + 1)];
    }
    const newExposed = [...exposed, kongTiles];
    setHand(newHand);
    setExposed(newExposed);
    setWall(restWall);
    setSelected([]);
    setHighlightIds([]);
    setPhase("discard");
    const full = [...newHand, ...newExposed.flat(), ...(lockedPair || [])];
    if (mode === "learn" && winsLine(line, full)) {
      say("A kong — four of a kind! And I think that's a winning hand. Press “I think I won!” when you're ready.");
    } else {
      say("A kong — four of a kind, locked in, and you drew a replacement tile. Now let one tile go.");
    }
  };

  // Joker exchange — swap her matching real tile into a locked set and take the
  // Joker back into her hand (a real NMJL rule; Jokers are wild and valuable).
  const redeemJoker = (groupIndex, jokerId) => {
    const group = exposed[groupIndex];
    if (!group) return;
    const realKey = group.find((t) => !t.isJoker)?.key;
    const natural = hand.find((t) => t.key === realKey && !t.isJoker);
    const jokerInGroup = group.find((t) => t.id === jokerId && t.isJoker);
    if (!realKey || !natural || !jokerInGroup) return;
    setExposed(exposed.map((g, i) => (i === groupIndex ? g.map((t) => (t.id === jokerId ? natural : t)) : g)));
    setHand([...hand.filter((t) => t.id !== natural.id), jokerInGroup]);
    setSelected([]);
    setHighlightIds([]);
    say(`Nice swap — your ${natural.label} goes into that set, and the Joker is back in your hand to use anywhere.`);
  };

  // "Make this my pair" — commit two matching tiles as her pair (the win needs
  // exactly one). Like locking a set, it just sets them aside, safe.
  const makePair = () => {
    if (!canMakePair) return;
    const pairTiles = hand.filter((t) => selected.includes(t.id));
    const keep = hand.filter((t) => !selected.includes(t.id));
    setHand(keep);
    setSelected([]);
    setHighlightIds([]);
    // Seven pairs collects many pairs (each goes to the locked area); the other
    // lines have a single pair (lockedPair).
    let newExposed = exposed, newLockedPair = lockedPair;
    if (pairsLine) { newExposed = [...exposed, pairTiles]; setExposed(newExposed); }
    else { newLockedPair = pairTiles; setLockedPair(pairTiles); }
    const full = [...keep, ...newExposed.flat(), ...(newLockedPair || [])];
    if (mode === "learn" && phase === "discard" && winsLine(line, full)) {
      say("That's your last pair — I think you've won! Press “I think I won!” when you're ready.");
    } else if (pairsLine) {
      say(phase === "discard" ? "Lovely — that pair is locked in and safe. Keep collecting pairs, then let a tile go." : "Lovely — that pair is locked in and safe. Keep collecting pairs!");
    } else {
      say(phase === "discard" ? "Your pair is set aside and safe. Now let one tile go." : "Your pair is set aside and safe. Take a tile when you're ready.");
    }
  };

  const takeCall = () => {
    if (!callable) return;
    // Seven pairs never claims a discard for a set — leave it.
    if (pairsLine) { leaveCall(); return; }
    // If she already holds three of this tile, the call makes a KONG (4) and she
    // draws a replacement; otherwise it's a pung (3). Jokers never count here.
    const have = hand.filter((t) => t.key === callable.key && !t.isJoker).length;
    const kong = have >= 3;
    const removeCount = kong ? 3 : 2;
    let removed = 0; const keep = [];
    for (const t of hand) {
      if (removed < removeCount && t.key === callable.key && !t.isJoker) { removed++; continue; }
      keep.push(t);
    }
    const copy = () => makeTile(callable.key, callable.glyph, callable.label);
    const group = kong ? [copy(), copy(), copy(), callable] : [copy(), copy(), callable];
    const newExposed = [...exposed, group];
    // Replacement draw for a kong.
    let newHand = keep, restWall = wall;
    if (kong && wall.length > 0) {
      const idx = mode === "learn" && DIFFICULTY[difficulty].herAssist ? pickAssistedDrawIndex(wall, keep, lineDef.assist) : 0;
      newHand = [...keep, wall[idx]];
      restWall = [...wall.slice(0, idx), ...wall.slice(idx + 1)];
    }
    setExposed(newExposed);
    setHand(newHand);
    setWall(restWall);
    setDiscards((d) => d.filter((x) => x !== callable)); // taken off the table
    setCallable(null);
    setSelected([]);
    setPhase("discard");
    const full = [...newHand, ...newExposed.flat(), ...(lockedPair || [])];
    if (mode === "learn" && winsLine(line, full)) {
      say(kong ? "A kong off the table — four of a kind! I think that's a winning hand. Press “I think I won!”." : "Nice grab — and I think that completes a winning hand! Press “I think I won!” when you're ready.");
    } else {
      say(kong ? "A kong — four of a kind, locked in, and you drew a replacement. Now let one tile go." : "Nice grab — that set is locked in and safe. Now let one tile go.");
    }
  };

  const leaveCall = () => {
    // The tile is already sitting in the discard pile — just decline it.
    setCallable(null);
    setPhase("draw");
    say("No problem, we'll wait for a better one. Take a tile from the wall.");
  };
  const checkCard = () => runCoach("I think I've finished my hand — can you check me against my card?");

  // She controls when she's done. Recognition runs CONTINUOUSLY so a pause to
  // think never cuts her off; it finishes only when she taps "I'm done" or
  // after a long, generous silence. We accumulate her phrases and send once.
  const SILENCE_MS = 12000;
  const armSilenceTimer = () => {
    clearTimeout(silenceTimerRef.current);
    silenceTimerRef.current = setTimeout(() => finishListening(), SILENCE_MS);
  };

  // Native (in-app) speech recognition via the Capacitor plugin. Mirrors the web
  // flow: listen continuously, show interim words, accumulate phrases across the
  // brief restarts the native recognizer does at pauses, and send when she's done.
  const startNative = async () => {
    stop(); // don't let the coach talk over her
    try {
      const { SpeechRecognition } = await import("@capacitor-community/speech-recognition");
      const perm = await SpeechRecognition.requestPermissions().catch(() => null);
      if (perm && perm.speechRecognition && perm.speechRecognition !== "granted") {
        say("I need permission to use the microphone. You can type your question instead.");
        return;
      }
      finalTranscriptRef.current = "";
      currentSegRef.current = "";
      stoppingRef.current = false;
      setInterim("");
      setListening(true);
      await SpeechRecognition.removeAllListeners();
      await SpeechRecognition.addListener("partialResults", (data) => {
        const m = (data && data.matches && data.matches[0]) || "";
        currentSegRef.current = m;
        setInterim((finalTranscriptRef.current + m).trim());
        armSilenceTimer();
      });
      await SpeechRecognition.addListener("listeningState", (st) => {
        // The recognizer stops itself at a pause — if she isn't done, bank what she
        // said and start again so a pause never cuts her off.
        if (st && st.status === "stopped" && !stoppingRef.current) {
          if (currentSegRef.current) { finalTranscriptRef.current += currentSegRef.current + " "; currentSegRef.current = ""; }
          SpeechRecognition.start({ language: "en-US", partialResults: true, popup: false }).catch(() => {});
        }
      });
      await SpeechRecognition.start({ language: "en-US", partialResults: true, popup: false });
      armSilenceTimer();
    } catch {
      setListening(false);
      say("I can't reach the microphone. You can type your question instead.");
    }
  };

  const startListening = () => {
    if (!sttSupported || listening) return;
    if (window.Capacitor?.isNativePlatform?.()) { startNative(); return; }
    stop(); // don't let the coach talk over her
    const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
    const rec = new Rec();
    rec.lang = "en-US";
    rec.continuous = true;     // keep listening through pauses
    rec.interimResults = true; // show her what it's hearing
    rec.maxAlternatives = 1;
    finalTranscriptRef.current = "";
    stoppingRef.current = false;

    rec.onresult = (e) => {
      let live = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalTranscriptRef.current += r[0].transcript + " ";
        else live += r[0].transcript;
      }
      setInterim(live);
      armSilenceTimer(); // she's still talking — reset the quiet countdown
    };
    rec.onerror = (ev) => {
      if (ev.error === "not-allowed" || ev.error === "service-not-allowed") {
        stoppingRef.current = true;
        clearTimeout(silenceTimerRef.current);
        setListening(false); setInterim("");
        say("I can't reach the microphone. You can type your question instead.");
      }
      // other errors (no-speech, network, aborted) fall through to onend
    };
    rec.onend = () => {
      if (stoppingRef.current) {
        clearTimeout(silenceTimerRef.current);
        setListening(false);
        const text = finalTranscriptRef.current.trim();
        setInterim("");
        if (text) runCoach(text);
        else say("I didn't quite catch that — tap the mic and try again, or type your question.");
      } else {
        // The browser ended early (its own timeout) but she isn't done — keep going.
        try { rec.start(); } catch { setListening(false); }
      }
    };
    recogRef.current = rec;
    setInterim("");
    setListening(true);
    try { rec.start(); } catch { setListening(false); }
    armSilenceTimer();
  };

  // Finish capturing and send what she said. (Reassigned via the ref pattern so
  // the timer/handlers above can call it.)
  function finishListening() {
    stoppingRef.current = true;
    clearTimeout(silenceTimerRef.current);
    if (window.Capacitor?.isNativePlatform?.()) {
      (async () => {
        try {
          const { SpeechRecognition } = await import("@capacitor-community/speech-recognition");
          await SpeechRecognition.stop().catch(() => {});
          await SpeechRecognition.removeAllListeners();
        } catch { /* ignore */ }
        setListening(false);
        const text = (finalTranscriptRef.current + " " + (currentSegRef.current || "")).trim();
        finalTranscriptRef.current = ""; currentSegRef.current = "";
        setInterim("");
        if (text) runCoach(text);
        else say("I didn't quite catch that — tap the mic and try again, or type your question.");
      })();
      return;
    }
    try { recogRef.current && recogRef.current.stop(); } catch { setListening(false); }
  }

  const askTyped = () => { if (typed.trim()) { runCoach(typed.trim()); setTyped(""); } };

  const inCharleston = phase.startsWith("charleston");
  const isPassPhase = PASS_PHASES.includes(phase); // a Charleston pass (exactly 3)
  const isCourtesy = phase === "charleston-courtesy"; // optional courtesy swap (0–3)
  // Tapping a tile selects it (to discard or to make a set) — never an instant,
  // unrecoverable discard. Not selectable on the "second Charleston?" prompt.
  const tileSelectable = isPassPhase || isCourtesy || phase === "draw" || phase === "discard";

  if (screen === "menu") {
    return (
      <Shell voiceOn={voiceOn} setVoiceOn={toggleVoice} hideReset>
        <div className="w-full max-w-3xl mx-auto text-center pt-6">
          <h1 className="text-3xl sm:text-4xl font-black text-amber-200 mb-2">Mahjong, together</h1>
          <p className="text-emerald-200 text-lg mb-6">Pick how you'd like to play today.</p>

          {savedGame && (
            <button onClick={continueGame}
              className="w-full mb-8 rounded-3xl bg-amber-400 text-emerald-950 p-5 shadow-2xl transition hover:-translate-y-1 motion-reduce:transition-none motion-reduce:hover:translate-y-0 focus:outline-none focus:ring-4 focus:ring-amber-200">
              <div className="text-2xl font-black">Continue your game</div>
              <p className="text-base font-semibold text-emerald-900 mt-1">Pick up right where you left off.</p>
            </button>
          )}

          <div className="mb-8 text-left">
            <div className="text-emerald-200 text-sm font-bold uppercase tracking-widest mb-2 text-center">How challenging?</div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {DIFF_ORDER.map((key) => {
                const d = DIFFICULTY[key];
                const on = difficulty === key;
                return (
                  <button key={key} onClick={() => chooseDifficulty(key)} aria-pressed={on}
                    className={`rounded-2xl p-3 border-4 transition motion-reduce:transition-none focus:outline-none focus:ring-4 focus:ring-amber-300
                      ${on ? "bg-amber-400 border-amber-300 text-emerald-950" : "bg-emerald-800/60 border-emerald-700 text-emerald-100 hover:bg-emerald-700/60"}`}>
                    <div className="text-lg font-black">{d.label}</div>
                    <div className={`text-xs font-semibold mt-1 ${on ? "text-emerald-900" : "text-emerald-300"}`}>{d.blurb}</div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="mb-8 text-left">
            <div className="text-emerald-200 text-sm font-bold uppercase tracking-widest mb-2 text-center">A hand to aim for (in “Just play &amp; learn”)</div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {LINE_ORDER.map((key) => {
                const l = LINES[key];
                const on = line === key;
                return (
                  <button key={key} onClick={() => chooseLine(key)} aria-pressed={on}
                    className={`rounded-2xl p-3 border-4 transition motion-reduce:transition-none focus:outline-none focus:ring-4 focus:ring-amber-300
                      ${on ? "bg-amber-400 border-amber-300 text-emerald-950" : "bg-emerald-800/60 border-emerald-700 text-emerald-100 hover:bg-emerald-700/60"}`}>
                    <div className="text-base font-black">{l.name}</div>
                    <div className={`text-xs font-semibold mt-1 ${on ? "text-emerald-900" : "text-emerald-300"}`}>{l.blurb}</div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="mb-8 text-left">
            <div className="text-emerald-200 text-sm font-bold uppercase tracking-widest mb-2 text-center">How long do the other players think?</div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {SPEED_ORDER.map((key) => {
                const s = SPEEDS[key];
                const active = speed === key;
                return (
                  <button key={key} onClick={() => setSpeed(key)} aria-pressed={active}
                    className={`rounded-2xl p-3 border-4 transition motion-reduce:transition-none focus:outline-none focus:ring-4 focus:ring-amber-300
                      ${active ? "bg-amber-400 border-amber-300 text-emerald-950" : "bg-emerald-800/60 border-emerald-700 text-emerald-100 hover:bg-emerald-700/60"}`}>
                    <div className="text-base font-black">{s.label}</div>
                    <div className={`text-xs font-semibold mt-1 ${active ? "text-emerald-900" : "text-emerald-300"}`}>{s.blurb}</div>
                  </button>
                );
              })}
            </div>
            <p className="text-emerald-300 text-xs text-center mt-2">You can always press “Skip ahead” to jump the wait.</p>
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <button onClick={() => { setMode("learn"); startGame(true); }}
              className="rounded-3xl bg-stone-50 text-emerald-950 p-6 text-left shadow-2xl transition hover:-translate-y-1 motion-reduce:transition-none motion-reduce:hover:translate-y-0 focus:outline-none focus:ring-4 focus:ring-amber-400">
              <div className="text-2xl font-black mb-2">Just play &amp; learn</div>
              <p className="text-base text-stone-600">A gentle full game — the Charleston, taking tiles off the table, and a simple hand to aim for. The coach walks you through every step. On Easy, you can't lose.</p>
            </button>
            <button onClick={() => { setMode("card"); setScreen("cardsetup"); }}
              className="rounded-3xl bg-stone-50 text-emerald-950 p-6 text-left shadow-2xl transition hover:-translate-y-1 motion-reduce:transition-none motion-reduce:hover:translate-y-0 focus:outline-none focus:ring-4 focus:ring-amber-400">
              <div className="text-2xl font-black mb-2">Practice my card</div>
              <p className="text-base text-stone-600">Tell the coach which hand you're going for from your own paper card, and it'll guide you straight toward it and check you when you're close.</p>
            </button>
          </div>
          <button onClick={() => { setMode("learn"); startGame(false); }} className="mt-6 text-emerald-200 underline text-base focus:outline-none focus:ring-4 focus:ring-amber-400 rounded">
            Skip the Charleston and just deal
          </button>

          {!isStandalone && (
            <div className="mt-10 rounded-2xl border-2 border-emerald-700 bg-emerald-800/40 p-4 text-emerald-100 text-base">
              <div className="font-black text-amber-200 mb-1">Make this its own app</div>
              <p className="leading-relaxed">
                On a <span className="font-bold">Mac</span>: in Chrome, open the <span className="font-bold">⋮</span> menu and choose <span className="font-bold">Install</span> — or in Safari, <span className="font-bold">File ▸ Add to Dock</span>.
                <br />
                On an <span className="font-bold">iPad</span>: tap <span className="font-bold">Share</span>, then <span className="font-bold">Add to Home Screen</span>.
              </p>
              <p className="text-emerald-300 text-sm mt-2">Then it opens from your own icon, full-screen — just like a real game.</p>
            </div>
          )}
        </div>
      </Shell>
    );
  }

  if (screen === "cardsetup") {
    return (
      <Shell voiceOn={voiceOn} setVoiceOn={toggleVoice} onReset={() => setScreen("menu")} resetLabel="Menu">
        <div className="w-full max-w-2xl mx-auto pt-6">
          <h2 className="text-2xl sm:text-3xl font-black text-amber-200 mb-3">Which hand from your card?</h2>
          <p className="text-emerald-100 text-lg mb-4">
            Read it to me however it's written on your card — for example,
            <span className="italic"> "three Red Dragons, then 2025 in Bams, and a pair of Flowers." </span>
            I'll help you build exactly that.
          </p>
          <textarea value={target} onChange={(e) => setTarget(e.target.value)} rows={3}
            placeholder="Type the hand you're going for…"
            className="w-full rounded-2xl p-4 text-lg text-emerald-950 focus:outline-none focus:ring-4 focus:ring-amber-400" />
          <div className="flex gap-3 mt-4">
            <button onClick={() => target.trim() && startGame(false)} disabled={!target.trim()}
              className="flex-1 rounded-2xl bg-amber-500 text-emerald-950 text-xl font-black py-4 disabled:opacity-40 flex items-center justify-center gap-2 focus:outline-none focus:ring-4 focus:ring-amber-300">
              Start this hand <ArrowRight size={22} />
            </button>
            <button onClick={() => setScreen("menu")} className="rounded-2xl bg-emerald-700 text-white px-6 text-lg font-bold focus:outline-none focus:ring-4 focus:ring-amber-300">Back</button>
          </div>
        </div>
      </Shell>
    );
  }

  if (phase === "won") {
    return (
      <Shell voiceOn={voiceOn} setVoiceOn={toggleVoice} hintsOn={hintsOn} onToggleHints={toggleHints} onReset={startOver} resetLabel="Start over">
        <div className="w-full max-w-6xl mx-auto rounded-3xl bg-stone-50 text-emerald-950 p-5 sm:p-6 shadow-2xl mb-4 flex items-start gap-4" aria-live="polite">
          <div className="shrink-0 h-14 w-14 rounded-full bg-emerald-700 text-amber-200 flex items-center justify-center text-2xl font-black" aria-hidden="true">♪</div>
          <p className="text-xl sm:text-2xl font-semibold leading-snug self-center">{coach}</p>
        </div>

        <div className="w-full max-w-6xl mx-auto text-center text-amber-200 text-2xl sm:text-3xl font-black mb-2">🎉 Here's how your hand won 🎉</div>
        <p className="w-full max-w-6xl mx-auto text-center text-emerald-200 text-base mb-5">{lineDef.name}.</p>

        {winBreakdown ? (
          <div className="w-full max-w-6xl mx-auto flex flex-wrap gap-3 justify-center mb-6">
            {winBreakdown.groups.map((g, i) => (
              <div key={i} className={`rounded-2xl p-3 flex flex-col items-center gap-2 ${g.label === "Pair" ? "bg-amber-500/20 border-2 border-amber-400" : "bg-emerald-800/60"}`}>
                <div className={`text-xs uppercase tracking-widest font-bold ${g.label === "Pair" ? "text-amber-300" : "text-emerald-300"}`}>{g.label}</div>
                <div className="flex gap-1.5">{g.tiles.map((t) => <Tile key={t.id} tile={t} small />)}</div>
              </div>
            ))}
          </div>
        ) : (
          // Fallback (shouldn't happen for a real win): show all her tiles.
          <div className="w-full max-w-6xl mx-auto flex flex-wrap gap-1.5 justify-center mb-6">
            {allTiles.map((t) => <Tile key={t.id} tile={t} small />)}
          </div>
        )}

        <div className="w-full max-w-6xl mx-auto">
          <button onClick={() => startGame(mode === "learn")}
            className="w-full rounded-2xl bg-amber-500 hover:bg-amber-400 text-emerald-950 text-2xl font-black py-5 focus:outline-none focus:ring-4 focus:ring-amber-300">
            Play again 🎉
          </button>
        </div>
      </Shell>
    );
  }

  return (
    <Shell voiceOn={voiceOn} setVoiceOn={toggleVoice} hintsOn={hintsOn} onToggleHints={toggleHints} onReset={startOver} resetLabel="Start over">
      <div className="w-full max-w-6xl mx-auto rounded-3xl bg-stone-50 text-emerald-950 p-5 sm:p-6 shadow-2xl mb-4 flex items-start gap-4" aria-live="polite">
        <div className="shrink-0 h-14 w-14 rounded-full bg-emerald-700 text-amber-200 flex items-center justify-center text-2xl font-black" aria-hidden="true">♪</div>
        <p className="text-xl sm:text-2xl font-semibold leading-snug self-center">
          {thinking
            ? "Let me look at your tiles…"
            : listening
              ? (interim ? `“${interim}”` : "I'm listening — take your time, then tap “I'm done”.")
              : coach}
        </p>
      </div>

      <div className="w-full max-w-6xl mx-auto -mt-2 mb-3 text-center text-emerald-300 text-sm font-semibold">
        Level: {DIFFICULTY[difficulty].label}{mode === "learn" ? ` · Goal: ${lineDef.name}` : ""}
      </div>

      {canDeclareWin && (
        <div className="w-full max-w-6xl mx-auto mb-4">
          <button onClick={declareWin}
            className="w-full rounded-2xl bg-amber-500 hover:bg-amber-400 text-emerald-950 text-2xl sm:text-3xl font-black py-6 shadow-2xl focus:outline-none focus:ring-4 focus:ring-amber-300 motion-safe:animate-pulse motion-reduce:animate-none">
            I think I won! 🎉
          </button>
          <p className="text-center text-emerald-200 text-sm mt-2">No rush — lock in or arrange your tiles however you like first.</p>
        </div>
      )}

      {mode === "card" && (
        <div className="w-full max-w-6xl mx-auto mb-3 text-center text-amber-200 text-base font-semibold">
          Going for: <span className="italic">{target}</span>
        </div>
      )}

      {mode === "learn" && !inCharleston && phase !== "won" && phase !== "botwon" && phase !== "wallgame" && (
        <div className="w-full max-w-6xl mx-auto mb-4 rounded-3xl bg-emerald-800/40 p-4">
          <div className="text-sm uppercase tracking-widest text-emerald-300 mb-3 font-bold text-center">Your goal — {lineDef.name}</div>
          <div className="flex items-center justify-center gap-2 flex-wrap">
            {progress.slots.map((s, i) => <Slot key={i} state={s.state} kind={s.kind} />)}
          </div>
          <p className="text-center text-emerald-300 text-xs sm:text-sm mt-3">
            {pairsLine
              ? `Tap two matching tiles and “Make this pair” to lock each pair (Jokers can't go in a pair). Collect all seven, then press “I think I won!”. A gold outline ○${hintsOn ? " (lit up below)" : ""} marks a pair you're still holding.`
              : <>Solid gold ✓ = locked in &amp; safe. A gold <span className="text-amber-300 font-bold">outline ○</span> means you're holding those tiles{hintsOn ? " (lit up below)" : ""} but haven't locked them. Tap matching tiles to “Make this set,” “Make this kong,” or “Make this my pair.”</>}
          </p>
        </div>
      )}

      <div className="w-full max-w-6xl mx-auto grid grid-cols-3 gap-3 mb-4">
        {SEAT_NAMES.map((name, i) => {
          const t = botDiscards[i];
          return (
            <div key={name} className="rounded-xl bg-emerald-800/70 py-3 px-2 flex flex-col items-center justify-start gap-2">
              <div className="text-xs sm:text-sm uppercase tracking-wider text-emerald-300 font-bold">{name}</div>
              {t ? (
                // Re-keyed by tile id so the toss animation replays each round.
                <div key={t.id} className="animate-toss flex flex-col items-center gap-1">
                  {phase === "call" && callable && t.id === callable.id ? (
                    <div className="rounded-xl ring-4 ring-amber-300 animate-pulse motion-reduce:animate-none">
                      <Tile tile={t} small highlight onClick={takeCall} />
                    </div>
                  ) : (
                    <Tile tile={t} small dim />
                  )}
                  <div className={phase === "call" && callable && t.id === callable.id
                    ? "text-sm font-black text-amber-300"
                    : "text-xs font-semibold text-emerald-200"}>
                    {phase === "call" && callable && t.id === callable.id ? "tap to take! 👆" : "let this go"}
                  </div>
                </div>
              ) : (
                <div className="text-sm font-semibold text-emerald-300 flex items-center animate-pulse motion-reduce:animate-none" style={{ height: 92 }}>{phase === "bots" ? "thinking…" : "waiting…"}</div>
              )}
            </div>
          );
        })}
      </div>

      {(exposed.length > 0 || lockedPair) && (
        <div className="w-full max-w-6xl mx-auto mb-3">
          <div className="text-xs uppercase tracking-widest text-emerald-300 mb-2 font-bold">Locked in &amp; safe</div>
          <div className="flex flex-wrap gap-3 items-end">
            {exposed.map((m, i) => {
              const realKey = m.find((t) => !t.isJoker)?.key;
              const redeemable = myTurn && realKey && m.some((t) => t.isJoker) && hand.some((t) => t.key === realKey && !t.isJoker);
              return (
                <div key={`set${i}`} className="flex gap-1.5">
                  {m.map((t) =>
                    t.isJoker && redeemable
                      ? <Tile key={t.id} tile={t} small highlight={hintsOn} onClick={() => redeemJoker(i, t.id)} />
                      : <Tile key={t.id} tile={t} small dim />,
                  )}
                </div>
              );
            })}
            {lockedPair && (
              <div className="flex flex-col items-center gap-1">
                <div className="flex gap-1.5">{lockedPair.map((t) => <Tile key={t.id} tile={t} small dim />)}</div>
                <div className="text-[10px] uppercase tracking-widest text-amber-300 font-bold">Your pair</div>
              </div>
            )}
          </div>
          {anyJokerRedeemable && (
            <p className="text-emerald-300 text-xs sm:text-sm mt-2">
              💡 Tap a glowing Joker to take it back — your matching tile goes into the set, and the Joker returns to your hand.
            </p>
          )}
        </div>
      )}

      <div className="w-full max-w-6xl mx-auto rounded-3xl bg-emerald-800/60 p-4 sm:p-5 mb-4">
        <div className="flex items-center justify-between gap-3 mb-3">
          <div className="text-sm uppercase tracking-widest text-emerald-300 font-bold">
            Your tiles
            {isPassPhase ? ` — tap 3 to pass (${selected.length}/3)`
              : isCourtesy ? ` — tap up to 3 to trade (${selected.length})`
              : phase === "charleston-2ask" ? ""
              : phase === "discard" ? (pairsLine ? " — tap 2 matching = pair · tap 1 to let go · drag to rearrange" : " — tap to let go · 2 = pair, 3 = set, 4 = kong · drag to rearrange")
              : phase === "draw" ? (pairsLine ? " — tap 2 matching = pair · drag to rearrange" : " — drag to rearrange · 2 = pair, 3 = set, 4 = kong")
              : ""}
          </div>
          {canArrange && hand.length > 0 && (
            <button onClick={tidyUp}
              className="shrink-0 rounded-full bg-emerald-700 hover:bg-emerald-600 text-white text-sm font-bold px-4 py-2 focus:outline-none focus:ring-4 focus:ring-amber-300">
              Tidy up
            </button>
          )}
        </div>
        {/* Single-row rack lined up in front of the player. Tiles flex to share
            the width and ALWAYS fit — no horizontal scroll (which would clip the
            leftmost tile and fight finger-dragging on touch). They scale their
            glyph/number with the tile via container units. Drag to rearrange. */}
        <div className="px-1 py-1">
          <div ref={rackRef} className="flex flex-nowrap gap-1.5 w-full justify-center">
            {hand.map((t) => (
              <Tile key={t.id} tile={t} selected={selected.includes(t.id)} fill
                highlight={hintsOn && myTurn && (hintIds.has(t.id) || highlightIds.includes(t.id))}
                draggable={canArrange}
                dragging={dragId === t.id}
                onPointerDown={canArrange ? (e) => onTilePointerDown(e, t) : undefined}
                onPointerMove={canArrange ? onTilePointerMove : undefined}
                onPointerUp={canArrange ? onTilePointerUp : undefined}
                onClick={tileSelectable ? () => {
                  if (justDraggedRef.current) { justDraggedRef.current = false; return; }
                  toggleSelect(t);
                } : undefined}
              />
            ))}
          </div>
        </div>
      </div>

      {(phase === "draw" || phase === "discard") && selected.length > 0 && (
        <div className="w-full max-w-6xl mx-auto flex flex-wrap items-center gap-3 mb-3">
          {pairsLine ? (
            canMakePair ? (
              <button onClick={makePair}
                className="flex-1 min-w-[12rem] rounded-2xl bg-amber-500 text-emerald-950 text-xl font-black py-4 focus:outline-none focus:ring-4 focus:ring-amber-300">
                Make this pair ✓
              </button>
            ) : phase === "discard" && selected.length === 1 ? (
              <button onClick={letItGo}
                className="flex-1 min-w-[12rem] rounded-2xl bg-emerald-700 hover:bg-emerald-600 text-white text-xl font-bold py-4 focus:outline-none focus:ring-4 focus:ring-amber-300">
                Let this tile go
              </button>
            ) : (
              <p className="flex-1 min-w-[12rem] text-emerald-100 text-lg font-semibold self-center">
                {selected.length === 2 ? "Those two don't match — pick two of the same tile (no Joker) for a pair." : "Tap two matching tiles to “Make this pair,” or one tile to let it go."}
              </p>
            )
          ) : selected.length === 4 ? (
            <button onClick={makeKong} disabled={!canMakeKong}
              className="flex-1 min-w-[12rem] rounded-2xl bg-amber-500 text-emerald-950 text-xl font-black py-4 disabled:opacity-40 focus:outline-none focus:ring-4 focus:ring-amber-300">
              {canMakeKong ? "Make this kong (4) ✓" : "Those four don't match — try again"}
            </button>
          ) : selected.length === 3 ? (
            <button onClick={makeSet} disabled={!canMakeSet}
              className="flex-1 min-w-[12rem] rounded-2xl bg-amber-500 text-emerald-950 text-xl font-black py-4 disabled:opacity-40 focus:outline-none focus:ring-4 focus:ring-amber-300">
              {canMakeSet ? "Make this set ✓" : "Those three don't match — try again"}
            </button>
          ) : canMakePair ? (
            <>
              <button onClick={makePair}
                className="flex-1 min-w-[12rem] rounded-2xl bg-amber-500 text-emerald-950 text-xl font-black py-4 focus:outline-none focus:ring-4 focus:ring-amber-300">
                Make this my pair ✓
              </button>
              <span className="text-emerald-200 text-sm font-semibold self-center">…or tap one more matching tile for a set of three.</span>
            </>
          ) : phase === "discard" && selected.length === 1 ? (
            <button onClick={letItGo}
              className="flex-1 min-w-[12rem] rounded-2xl bg-emerald-700 hover:bg-emerald-600 text-white text-xl font-bold py-4 focus:outline-none focus:ring-4 focus:ring-amber-300">
              Let this tile go
            </button>
          ) : (
            <p className="flex-1 min-w-[12rem] text-emerald-100 text-lg font-semibold self-center">
              {selected.length === 2 && lockedPair
                ? "You already have your pair. Tap one more matching tile to make a set of three."
                : selected.length === 2
                  ? "Those two don't match. Pick two of the same tile for a pair (no Joker), or tap one more for a set."
                  : "Tap matching tiles to make a set or a pair — or press “Take a tile”."}
            </p>
          )}
          <button onClick={() => setSelected([])}
            className="rounded-2xl bg-emerald-800 hover:bg-emerald-700 text-white text-lg font-bold px-5 py-4 focus:outline-none focus:ring-4 focus:ring-amber-300">
            Clear
          </button>
        </div>
      )}

      {isPassPhase ? (
        <div className="w-full max-w-6xl mx-auto flex gap-3 mb-4">
          <button onClick={passCharleston} disabled={selected.length !== 3}
            className="flex-1 rounded-2xl bg-amber-500 text-emerald-950 text-2xl font-black py-5 disabled:opacity-40 focus:outline-none focus:ring-4 focus:ring-amber-300">
            {selected.length === 3 ? "Pass these 3 →" : `Pick 3 to pass (${selected.length}/3)`}</button>
          <button onClick={finishCharleston}
            className="rounded-2xl bg-emerald-700 text-white px-6 text-lg font-bold focus:outline-none focus:ring-4 focus:ring-amber-300">Skip to playing</button>
        </div>
      ) : phase === "charleston-2ask" ? (
        <div className="w-full max-w-6xl mx-auto flex flex-col sm:flex-row gap-3 mb-4">
          <button onClick={startSecondCharleston}
            className="flex-1 rounded-2xl bg-amber-500 text-emerald-950 text-2xl font-black py-5 focus:outline-none focus:ring-4 focus:ring-amber-300">Yes, a second Charleston</button>
          <button onClick={declineSecondCharleston}
            className="flex-1 rounded-2xl bg-emerald-700 text-white text-2xl font-bold py-5 focus:outline-none focus:ring-4 focus:ring-amber-300">No, let's play</button>
        </div>
      ) : isCourtesy ? (
        <div className="w-full max-w-6xl mx-auto flex gap-3 mb-4">
          <button onClick={doCourtesy} disabled={selected.length > 3}
            className="flex-1 rounded-2xl bg-amber-500 text-emerald-950 text-2xl font-black py-5 disabled:opacity-40 focus:outline-none focus:ring-4 focus:ring-amber-300">
            {selected.length === 0 ? "Trade nothing →" : `Trade these ${selected.length} →`}</button>
          <button onClick={finishCharleston}
            className="rounded-2xl bg-emerald-700 text-white px-6 text-lg font-bold focus:outline-none focus:ring-4 focus:ring-amber-300">Skip</button>
        </div>
      ) : phase === "call" ? (
        <div className="w-full max-w-6xl mx-auto flex gap-3 mb-4">
          <button onClick={takeCall} className="flex-1 rounded-2xl bg-amber-500 text-emerald-950 text-2xl font-black py-5 ring-4 ring-amber-300 animate-pulse motion-reduce:animate-none focus:outline-none focus:ring-4 focus:ring-amber-200">Take it ({callable?.label})</button>
          <button onClick={leaveCall} className="flex-1 rounded-2xl bg-emerald-700 text-white text-2xl font-bold py-5 focus:outline-none focus:ring-4 focus:ring-amber-300">Leave it</button>
        </div>
      ) : phase === "bots" ? (
        <div className="w-full max-w-6xl mx-auto flex flex-col sm:flex-row items-center gap-3 mb-4">
          <span className="flex-1 text-emerald-100 text-lg font-semibold text-center sm:text-left">The other players are thinking. No rush — take your time.</span>
          <button onClick={skipBots}
            className="rounded-2xl bg-emerald-700 hover:bg-emerald-600 text-white text-xl font-bold px-8 py-4 focus:outline-none focus:ring-4 focus:ring-amber-300">
            Skip ahead ▶▶
          </button>
        </div>
      ) : (
        <div className="w-full max-w-6xl mx-auto flex flex-col sm:flex-row gap-3 mb-4">
          <button onClick={(phase === "won" || phase === "botwon" || phase === "wallgame") ? () => startGame(mode === "learn") : drawTile} disabled={phase !== "draw" && phase !== "won" && phase !== "botwon" && phase !== "wallgame"}
            className="flex-1 rounded-2xl bg-amber-500 enabled:hover:bg-amber-400 text-emerald-950 text-2xl font-black py-5 disabled:opacity-40 focus:outline-none focus:ring-4 focus:ring-amber-300">
            {phase === "won" ? "Play again 🎉"
              : phase === "botwon" || phase === "wallgame" ? "Play again"
              : phase === "bots" ? "Other players…"
              : phase === "discard" ? "Let a tile go first"
              : "Take a tile"}
          </button>
          <button onClick={() => runCoach()} disabled={thinking || hand.length === 0 || !canAsk}
            className="flex-1 rounded-2xl bg-emerald-600 enabled:hover:bg-emerald-500 text-white text-2xl font-bold py-5 flex items-center justify-center gap-3 disabled:opacity-40 focus:outline-none focus:ring-4 focus:ring-amber-300">
            <HelpCircle size={26} /> What should I do?
          </button>
          {mode === "card" && (
            <button onClick={checkCard} disabled={thinking || !canAsk}
              className="flex-1 rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white text-2xl font-bold py-5 flex items-center justify-center gap-3 disabled:opacity-40 focus:outline-none focus:ring-4 focus:ring-amber-300">
              <BadgeCheck size={26} /> Did I win?
            </button>
          )}
          <button onClick={listening ? finishListening : startListening} disabled={!sttSupported || thinking || (!canAsk && !listening)}
            className={`flex-1 rounded-2xl text-2xl font-bold py-5 flex items-center justify-center gap-3 disabled:opacity-40 focus:outline-none focus:ring-4 focus:ring-amber-300
              ${listening ? "bg-red-500 text-white animate-pulse motion-reduce:animate-none" : "bg-emerald-600 hover:bg-emerald-500 text-white"}`}>
            <Mic size={26} /> {listening ? "I'm done — ask" : "Ask out loud"}
          </button>
        </div>
      )}

      <div className="w-full max-w-6xl mx-auto flex gap-2">
        <label htmlFor="coach-question" className="sr-only">Type a question for the coach</label>
        <input id="coach-question" value={typed} onChange={(e) => setTyped(e.target.value)} onKeyDown={(e) => e.key === "Enter" && canAsk && askTyped()} disabled={!canAsk}
          placeholder={canAsk ? "…or type a question for the coach" : "…the other players are taking their turn"}
          className="flex-1 rounded-xl px-4 py-3 text-lg text-emerald-950 placeholder-stone-400 disabled:opacity-50 focus:outline-none focus:ring-4 focus:ring-amber-400" />
        <button onClick={askTyped} disabled={!canAsk} className="rounded-xl bg-stone-100 text-emerald-950 px-5 py-3 text-lg font-bold hover:bg-white disabled:opacity-40 focus:outline-none focus:ring-4 focus:ring-amber-300">Ask</button>
      </div>
      {!sttSupported && <p className="text-emerald-300 text-sm mt-3 text-center">(Voice questions work in Chrome — the typing box always works.)</p>}
    </Shell>
  );
}

function Shell({ children, voiceOn, setVoiceOn, hintsOn, onToggleHints, onReset, resetLabel = "Deal new tiles", hideReset }) {
  return (
    <div className="min-h-screen w-full bg-emerald-900 text-stone-100 p-4 sm:p-6">
      <div className="w-full max-w-6xl mx-auto flex items-center justify-end gap-2 mb-4 flex-wrap">
        {onToggleHints && (
          <button onClick={onToggleHints} aria-pressed={hintsOn} className="flex items-center gap-2 rounded-full bg-emerald-700 hover:bg-emerald-600 px-4 py-2 text-base font-bold focus:outline-none focus:ring-4 focus:ring-amber-300">
            {hintsOn ? <Lightbulb size={22} /> : <LightbulbOff size={22} />}{hintsOn ? "Hints on" : "Hints off"}
          </button>
        )}
        <button onClick={setVoiceOn} aria-pressed={voiceOn} className="flex items-center gap-2 rounded-full bg-emerald-700 hover:bg-emerald-600 px-4 py-2 text-base font-bold focus:outline-none focus:ring-4 focus:ring-amber-300">
          {voiceOn ? <Volume2 size={22} /> : <VolumeX size={22} />}{voiceOn ? "Voice on" : "Voice off"}
        </button>
        {!hideReset && (
          <button onClick={onReset} className="flex items-center gap-2 rounded-full bg-amber-500 hover:bg-amber-400 text-emerald-950 px-4 py-2 text-base font-extrabold focus:outline-none focus:ring-4 focus:ring-amber-300">
            <RotateCcw size={20} /> {resetLabel}
          </button>
        )}
      </div>
      {children}
    </div>
  );
}
