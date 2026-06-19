"use client";

import { useState, useEffect, useRef, useCallback, useMemo, useSyncExternalStore } from "react";
import { Volume2, VolumeX, Mic, HelpCircle, RotateCcw, ArrowRight, BadgeCheck } from "lucide-react";
import { buildWall, sortHand, makeTile, isWinningHand, localHint, analyzeHand, isValidSet, pickAssistedDrawIndex, shuffle, coachFacts } from "@/lib/tiles";
import { buildSystemPrompt, callCoach } from "@/lib/coach";

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
const PREFERRED_VOICE_NAMES = [
  "Samantha", "Victoria", "Alex", "Karen", "Daniel",
  "Google US English", "Google UK English Female", "Google UK English Male",
  "Microsoft Zira - English (United States)",
  "Microsoft Aria Online (Natural) - English (United States)",
  "Microsoft David - English (United States)",
];

function selectBestVoice() {
  if (typeof window === "undefined" || !window.speechSynthesis) return null;
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return null;
  for (const name of PREFERRED_VOICE_NAMES) {
    const match = voices.find((v) => v.name === name);
    if (match) return match;
  }
  return (
    voices.find((v) => v.lang === "en-US") ||
    voices.find((v) => v.lang && v.lang.startsWith("en")) ||
    voices[0]
  );
}

function useSpeech(enabled) {
  const voiceRef = useRef(null);

  // Warm up the voice list once on mount; re-resolve when it changes.
  useEffect(() => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    const resolve = () => { voiceRef.current = selectBestVoice(); };
    resolve();
    window.speechSynthesis.addEventListener?.("voiceschanged", resolve);
    return () => window.speechSynthesis.removeEventListener?.("voiceschanged", resolve);
  }, []);

  const speak = useCallback((text) => {
    if (!enabled || !text || typeof window === "undefined" || !window.speechSynthesis) return;
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
  }, [enabled]);

  const stop = useCallback(() => {
    if (typeof window !== "undefined" && window.speechSynthesis) {
      try { window.speechSynthesis.cancel(); } catch { /* ignore */ }
    }
  }, []);

  return { speak, stop };
}

function Tile({ tile, onClick, selected, dim, small }) {
  // Rack-friendly tile sized for a tablet. Glyph and number/suit live in their
  // OWN fixed regions (top vs. bottom) so they can never overlap, and the glyph
  // region clips so the image can't spill. The number is the reliable read for
  // low vision; the glyph is the picture above it.
  const w = small ? 50 : 66, h = small ? 70 : 94;
  const glyphBox = small ? 38 : 50;
  const glyphSize = tile.isJoker ? (small ? 22 : 30) : (small ? 28 : 38);
  const suited = /^(\d) (Crak|Bam|Dot)$/.exec(tile.label);
  return (
    <button
      onClick={onClick}
      disabled={!onClick}
      aria-label={tile.label}
      className={`relative flex shrink-0 flex-col items-center justify-between overflow-hidden rounded-lg border-2 bg-white shadow-md transition motion-reduce:transition-none
        ${onClick
          ? "cursor-pointer hover:-translate-y-1 focus:-translate-y-1 motion-reduce:hover:translate-y-0 motion-reduce:focus:translate-y-0 focus:outline-none focus:ring-4 focus:ring-red-400"
          : "cursor-default"}
        ${selected ? "border-red-600 ring-4 ring-red-300 -translate-y-1 motion-reduce:translate-y-0" : "border-stone-400"}
        ${dim ? "opacity-70" : ""}`}
      style={{ width: w, height: h }}
    >
      <span aria-hidden="true" className="flex w-full items-center justify-center overflow-hidden text-stone-700" style={{ height: glyphBox, fontSize: glyphSize, lineHeight: 1 }}>{tile.glyph}</span>
      {suited ? (
        <span className="flex flex-col items-center leading-none pb-1">
          <span className="font-black text-stone-900" style={{ fontSize: small ? 16 : 22 }}>{suited[1]}</span>
          <span className="font-bold text-stone-600 uppercase tracking-wide" style={{ fontSize: small ? 8 : 10 }}>{suited[2]}</span>
        </span>
      ) : (
        <span className="font-black text-stone-900 text-center leading-tight px-0.5 pb-1" style={{ fontSize: small ? 9 : 11 }}>{tile.label}</span>
      )}
    </button>
  );
}

// One slot in the "Your goal" progress panel.
function Slot({ state, label, pair }) {
  const styles =
    state === "done"
      ? "bg-amber-400 border-amber-300 text-emerald-950"
      : state === "partial"
        ? "bg-emerald-700/50 border-emerald-400 text-emerald-50"
        : "bg-emerald-900/40 border-emerald-700/70 text-emerald-600";
  const status = state === "done" ? "done" : state === "partial" ? "in progress" : "not started yet";
  return (
    <div
      role="img"
      aria-label={`${label}: ${status}`}
      className={`flex flex-col items-center justify-center rounded-2xl border-4 h-16 w-20 sm:w-24 ${styles}`}
    >
      <span className="text-2xl font-black leading-none" aria-hidden="true">{state === "done" ? "✓" : state === "partial" ? "…" : "•"}</span>
      <span className="mt-0.5 text-[10px] sm:text-xs font-bold uppercase tracking-wide">{pair ? "Pair" : "Set"}</span>
    </div>
  );
}

export default function MahjongCoach() {
  const [screen, setScreen] = useState("menu");
  const [mode, setMode] = useState("learn");
  const [target, setTarget] = useState("");

  const [wall, setWall] = useState([]);
  const [hand, setHand] = useState([]);
  const [exposed, setExposed] = useState([]);
  const [selected, setSelected] = useState([]);
  const [botDiscards, setBotDiscards] = useState([null, null, null]); // last tile each opponent tossed
  const [callable, setCallable] = useState(null);
  const [discards, setDiscards] = useState([]); // spent tiles, recycled into the wall when it runs low
  const [phase, setPhase] = useState("draw");
  const [coach, setCoach] = useState("");
  const [thinking, setThinking] = useState(false);
  const [voiceOn, setVoiceOn] = useState(true);
  const [listening, setListening] = useState(false);
  const [typed, setTyped] = useState("");
  const recogRef = useRef(null);

  const { speak, stop } = useSpeech(voiceOn);
  // SpeechRecognition (STT) is Chrome/Android-only and absent on iOS Safari,
  // and doesn't exist during SSR. useSyncExternalStore reads it client-only:
  // the server snapshot is false, so there's no hydration mismatch, and the
  // real value lands on the client without a setState-in-effect.
  const sttSupported = useSyncExternalStore(
    () => () => {}, // capability is static — nothing to subscribe to
    () => !!(window.SpeechRecognition || window.webkitSpeechRecognition),
    () => false, // server snapshot
  );

  const allTiles = useMemo(() => [...hand, ...exposed.flat()], [hand, exposed]);
  // Live read of how close she is to the goal — drives the panel + coaching.
  const progress = useMemo(() => analyzeHand(hand, exposed.length), [hand, exposed]);
  // Which three currently-selected concealed tiles (if any) form a valid set.
  const selectedTiles = useMemo(() => hand.filter((t) => selected.includes(t.id)), [hand, selected]);
  const canMakeSet = selected.length === 3 && isValidSet(selectedTiles);
  const say = useCallback((msg) => { setCoach(msg); speak(msg); }, [speak]);

  const startGame = useCallback((withCharleston) => {
    stop();
    const w = buildWall();
    const h = sortHand(w.splice(0, 13));
    setWall(w); setHand(h); setExposed([]); setSelected([]); setCallable(null);
    setDiscards([]);
    setBotDiscards([null, null, null]);
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

  // Plain-English summary of exactly what she can do right now, so the coach
  // only ever suggests real on-screen actions (CLAUDE.md §12 — no impossible
  // advice). Kept terse; it's context for the model, not read aloud.
  const actionsForPhase = useCallback(() => {
    if (phase === "draw") return `She can take a tile from the wall. She can also tap three matching tiles (Jokers count as wild) and press "Make this set" to lock a set in.`;
    if (phase === "discard") return `She just drew. She should tap one tile and press "Let this tile go". She can first tap three matching tiles and press "Make this set" to lock a set in.`;
    if (phase === "call") return `A tile on the table (${callable?.label}) would finish a set. She can press "Take it" or "Leave it".`;
    return `It's a quiet moment; she's getting set up.`;
  }, [phase, callable]);

  const runCoach = useCallback(async (question) => {
    setThinking(true);
    const sys = buildSystemPrompt(mode, target);
    const f = coachFacts(hand);
    const tilesStr = sortHand(hand).map((t) => t.label).join(", ");
    // Exact facts from the engine. The coach phrases these; it must not recount.
    const facts = [
      `Sets already locked in and safe: ${exposed.length}.`,
      `Tiles she ALREADY has three of (ready-made sets): ${f.readySets.length ? f.readySets.join(", ") : "none"}.`,
      `Pairs in her hand (two matching — one tile away from a set): ${f.pairs.length ? f.pairs.join(", ") : "none"}.`,
      `Jokers in her hand: ${f.jokers} (a Joker can be the third tile of any set).`,
      mode === "learn" ? `Progress: ${progress.sets} of 4 sets, and ${progress.hasPair ? "her pair is set" : "no pair yet"}.` : "",
      `Her full hand, for context only: ${tilesStr}.`,
    ].filter(Boolean).join("\n");
    const rules = `These facts are exact and come from the game. Do NOT count her tiles or invent any numbers — rely only on the facts above. If you suggest making a set, name exactly which tiles to tap using only the pairs and Jokers listed (for example, "your two West Winds and one Joker"). What she can do right now: ${actionsForPhase()}`;
    const userText = question
      ? `${facts}\n\n${rules}\n\nShe asked out loud: "${question}"\n\nAnswer her kindly and simply, suggesting only things she can do right now.`
      : `${facts}\n\n${rules}\n\nGive her ONE gentle suggestion for her next move.`;
    const reply = await callCoach(sys, userText);
    say(reply || localHint(allTiles));
    setThinking(false);
  }, [allTiles, hand, exposed, mode, target, progress, actionsForPhase, say]);

  const toggleSelect = (tile) => {
    setSelected((s) => s.includes(tile.id) ? s.filter((x) => x !== tile.id) : s.length < 3 ? [...s, tile.id] : s);
  };

  const passCharleston = () => {
    if (selected.length !== 3) return;
    const keep = hand.filter((t) => !selected.includes(t.id));
    const received = wall.slice(0, 3);
    setHand(sortHand([...keep, ...received]));
    setWall((w) => w.slice(3));
    setSelected([]);
    const next = phase === "charleston-right" ? "charleston-across" : phase === "charleston-across" ? "charleston-left" : "draw";
    setPhase(next);
    if (next === "charleston-across") say("Good. Now pick three to pass across the table. Tap three and press Pass.");
    else if (next === "charleston-left") say("Almost done — three more, this time to your left.");
    else say("That's the Charleston finished. Now the real game begins. Take a tile when you're ready.");
  };

  // Top up the wall from the spent-tile pile so the game never dead-ends.
  const topUp = useCallback((w, need) => {
    if (w.length >= need || discards.length === 0) return w;
    const merged = shuffle([...w, ...discards]);
    setDiscards([]);
    return merged;
  }, [discards]);

  const botsPlay = useCallback((concealed) => {
    const w = topUp(wall, 3);
    const picks = w.slice(0, 3);
    const rest = w.slice(3);
    setBotDiscards([picks[0] || null, picks[1] || null, picks[2] || null]);
    const counts = {};
    concealed.forEach((t) => { if (!t.isJoker) counts[t.key] = (counts[t.key] || 0) + 1; });
    const claim = picks.find((p) => p && !p.isJoker && counts[p.key] >= 2) || null;
    // Spent bot tiles go to the discard pile — except the one she might claim.
    setDiscards((d) => [...d, ...picks.filter((p) => p && p !== claim)]);
    setWall(rest);
    setCallable(claim);
    setPhase(claim ? "call" : "draw");
    if (claim) say(`That ${claim.label} would finish a set for you! Press "Take it" to grab it, or "Leave it" to wait.`);
    else say("Your turn again — take a tile when you're ready.");
  }, [wall, topUp, say]);

  const drawTile = () => {
    if (phase !== "draw") return;
    const w = topUp(wall, 1);
    if (w.length === 0) { startGame(false); return; } // pile and wall both empty — fresh deal
    // Guided win (learn mode): nudge a helpful tile her way; card mode draws straight.
    const idx = mode === "learn" ? pickAssistedDrawIndex(w, hand) : 0;
    const t = w[idx];
    const rest = [...w.slice(0, idx), ...w.slice(idx + 1)];
    const newHand = sortHand([...hand, t]);
    setWall(rest); setHand(newHand); setSelected([]);
    const full = [...newHand, ...exposed.flat()];
    if (mode === "learn" && isWinningHand(full)) { setPhase("won"); say("You did it! Four sets and a pair — that's a winning hand. Beautifully done."); return; }
    setPhase("discard");
    runCoach();
  };

  const discardTile = (tile) => {
    if (phase !== "discard" || !tile) return;
    const newHand = sortHand(hand.filter((t) => t.id !== tile.id));
    setHand(newHand);
    setDiscards((d) => [...d, tile]);
    setSelected([]);
    botsPlay(newHand);
  };
  // "Let this tile go" — discards the single selected tile.
  const letItGo = () => {
    if (phase !== "discard" || selected.length !== 1) return;
    discardTile(hand.find((t) => t.id === selected[0]));
  };

  // "Make this set" — lock three matching (Joker-wild) tiles down as a set.
  const makeSet = () => {
    if (!canMakeSet) return;
    const setTiles = hand.filter((t) => selected.includes(t.id));
    const keep = hand.filter((t) => !selected.includes(t.id));
    const newExposed = [...exposed, setTiles];
    setHand(sortHand(keep));
    setExposed(newExposed);
    setSelected([]);
    const full = [...keep, ...newExposed.flat()];
    if (mode === "learn" && isWinningHand(full)) { setPhase("won"); say("That's four sets and a pair — you've won! Wonderful."); return; }
    say(phase === "discard" ? "Lovely — that set is locked in and safe. Now let one tile go." : "Lovely — that set is locked in and safe. Take a tile when you're ready.");
  };

  const takeCall = () => {
    if (!callable) return;
    let removed = 0; const keep = [];
    for (const t of hand) {
      if (removed < 2 && t.key === callable.key && !t.isJoker) { removed++; continue; }
      keep.push(t);
    }
    const newExposed = [...exposed, [makeTile(callable.key, callable.glyph, callable.label), makeTile(callable.key, callable.glyph, callable.label), callable]];
    setExposed(newExposed);
    setHand(sortHand(keep));
    setCallable(null);
    setSelected([]);
    const full = [...keep, ...newExposed.flat()];
    if (mode === "learn" && isWinningHand(full)) { setPhase("won"); say("You took the very tile you needed — four sets and a pair. You win! Beautiful."); return; }
    setPhase("discard");
    say("Nice grab — that set is locked in and safe. Now let one tile go.");
  };

  const leaveCall = () => {
    setDiscards((d) => (callable ? [...d, callable] : d));
    setCallable(null);
    setPhase("draw");
    say("No problem, we'll wait for a better one. Take a tile from the wall.");
  };
  const checkCard = () => runCoach("I think I've finished my hand — can you check me against my card?");

  const startListening = () => {
    if (!sttSupported) return;
    const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
    const rec = new Rec();
    rec.lang = "en-US"; rec.interimResults = false; rec.maxAlternatives = 1;
    rec.onresult = (e) => { setListening(false); runCoach(e.results[0][0].transcript); };
    rec.onerror = () => setListening(false);
    rec.onend = () => setListening(false);
    recogRef.current = rec; setListening(true); rec.start();
  };

  const askTyped = () => { if (typed.trim()) { runCoach(typed.trim()); setTyped(""); } };

  const inCharleston = phase.startsWith("charleston");
  // Tapping a tile selects it (to discard or to make a set) — never an instant,
  // unrecoverable discard. Selection is live during the Charleston and her turn.
  const tileSelectable = inCharleston || phase === "draw" || phase === "discard";
  const tileClick = (t) => (tileSelectable ? () => toggleSelect(t) : undefined);

  if (screen === "menu") {
    return (
      <Shell voiceOn={voiceOn} setVoiceOn={() => { stop(); setVoiceOn((v) => !v); }} hideReset>
        <div className="w-full max-w-3xl mx-auto text-center pt-6">
          <h1 className="text-3xl sm:text-4xl font-black text-amber-200 mb-2">Mahjong, together</h1>
          <p className="text-emerald-200 text-lg mb-8">Pick how you'd like to play today.</p>
          <div className="grid sm:grid-cols-2 gap-4">
            <button onClick={() => { setMode("learn"); startGame(true); }}
              className="rounded-3xl bg-stone-50 text-emerald-950 p-6 text-left shadow-2xl transition hover:-translate-y-1 motion-reduce:transition-none motion-reduce:hover:translate-y-0 focus:outline-none focus:ring-4 focus:ring-amber-400">
              <div className="text-2xl font-black mb-2">Just play &amp; learn</div>
              <p className="text-base text-stone-600">A gentle full game — the Charleston, taking tiles off the table, and a simple hand to aim for. The coach walks you through every step. You can't lose.</p>
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
        </div>
      </Shell>
    );
  }

  if (screen === "cardsetup") {
    return (
      <Shell voiceOn={voiceOn} setVoiceOn={() => { stop(); setVoiceOn((v) => !v); }} onReset={() => setScreen("menu")} resetLabel="Menu">
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

  return (
    <Shell voiceOn={voiceOn} setVoiceOn={() => { stop(); setVoiceOn((v) => !v); }} onReset={() => setScreen("menu")} resetLabel="Menu">
      <div className="w-full max-w-5xl mx-auto rounded-3xl bg-stone-50 text-emerald-950 p-5 sm:p-6 shadow-2xl mb-4 flex items-start gap-4" aria-live="polite">
        <div className="shrink-0 h-14 w-14 rounded-full bg-emerald-700 text-amber-200 flex items-center justify-center text-2xl font-black" aria-hidden="true">♪</div>
        <p className="text-xl sm:text-2xl font-semibold leading-snug self-center">{thinking ? "Let me look at your tiles…" : coach}</p>
      </div>

      {mode === "card" && (
        <div className="w-full max-w-5xl mx-auto mb-3 text-center text-amber-200 text-base font-semibold">
          Going for: <span className="italic">{target}</span>
        </div>
      )}

      {mode === "learn" && phase !== "won" && (
        <div className="w-full max-w-5xl mx-auto mb-4 rounded-3xl bg-emerald-800/40 p-4">
          <div className="text-sm uppercase tracking-widest text-emerald-300 mb-3 font-bold text-center">Your goal — four sets and a pair</div>
          <div className="flex items-center justify-center gap-2 sm:gap-3 flex-wrap">
            {progress.setSlots.map((s, i) => <Slot key={i} state={s} label={`Set ${i + 1}`} />)}
            <span className="text-emerald-300 text-3xl font-black px-1" aria-hidden="true">+</span>
            <Slot state={progress.pairSlot} label="The pair" pair />
          </div>
        </div>
      )}

      <div className="w-full max-w-5xl mx-auto grid grid-cols-3 gap-3 mb-4">
        {["Left player", "Across", "Right player"].map((name, i) => {
          const t = botDiscards[i];
          return (
            <div key={name} className="rounded-xl bg-emerald-800/70 py-3 px-2 flex flex-col items-center justify-start gap-2">
              <div className="text-xs sm:text-sm uppercase tracking-wider text-emerald-300 font-bold">{name}</div>
              {t ? (
                // Re-keyed by tile id so the toss animation replays each round.
                <div key={t.id} className="animate-toss flex flex-col items-center gap-1">
                  <Tile tile={t} small dim />
                  <div className="text-xs font-semibold text-emerald-200">let this go</div>
                </div>
              ) : (
                <div className="text-sm font-semibold text-emerald-400/70 flex items-center" style={{ height: 70 }}>waiting…</div>
              )}
            </div>
          );
        })}
      </div>

      {exposed.length > 0 && (
        <div className="w-full max-w-5xl mx-auto mb-3">
          <div className="text-xs uppercase tracking-widest text-emerald-300 mb-2 font-bold">Sets you've made — locked in &amp; safe</div>
          <div className="flex flex-wrap gap-2">
            {exposed.map((m, i) => m.map((t) => <Tile key={t.id + i} tile={t} small dim />))}
          </div>
        </div>
      )}

      <div className="w-full max-w-5xl mx-auto rounded-3xl bg-emerald-800/60 p-4 sm:p-5 mb-4">
        <div className="text-sm uppercase tracking-widest text-emerald-300 mb-3 font-bold">
          Your tiles
          {inCharleston ? ` — tap 3 to pass (${selected.length}/3)`
            : phase === "discard" ? " — tap a tile to let it go, or tap 3 matching to make a set"
            : phase === "draw" ? " — take a tile, or tap 3 matching to make a set"
            : ""}
        </div>
        {/* Single-row rack lined up in front of the player (traditional layout).
            Tiles are sorted by suit/number. The inner w-max + mx-auto centers
            the rack when it fits and stays fully scrollable (left edge always
            reachable) on a narrow tablet. */}
        <div className="overflow-x-auto px-1 py-1">
          <div className="flex flex-nowrap gap-1.5 w-max mx-auto">
            {hand.map((t) => <Tile key={t.id} tile={t} selected={selected.includes(t.id)} onClick={tileClick(t)} />)}
          </div>
        </div>
      </div>

      {(phase === "draw" || phase === "discard") && selected.length > 0 && (
        <div className="w-full max-w-5xl mx-auto flex flex-wrap items-center gap-3 mb-3">
          {selected.length === 3 ? (
            <button onClick={makeSet} disabled={!canMakeSet}
              className="flex-1 min-w-[12rem] rounded-2xl bg-amber-500 text-emerald-950 text-xl font-black py-4 disabled:opacity-40 focus:outline-none focus:ring-4 focus:ring-amber-300">
              {canMakeSet ? "Make this set ✓" : "Those three don't match — try again"}
            </button>
          ) : phase === "discard" && selected.length === 1 ? (
            <button onClick={letItGo}
              className="flex-1 min-w-[12rem] rounded-2xl bg-emerald-700 hover:bg-emerald-600 text-white text-xl font-bold py-4 focus:outline-none focus:ring-4 focus:ring-amber-300">
              Let this tile go
            </button>
          ) : (
            <p className="flex-1 min-w-[12rem] text-emerald-100 text-lg font-semibold self-center">
              {selected.length === 2
                ? "That's a pair! Tap one more matching tile to make a set of three — or press “Take a tile”."
                : "Tap two more matching tiles to make a set of three — or press “Take a tile”."}
            </p>
          )}
          <button onClick={() => setSelected([])}
            className="rounded-2xl bg-emerald-800 hover:bg-emerald-700 text-white text-lg font-bold px-5 py-4 focus:outline-none focus:ring-4 focus:ring-amber-300">
            Clear
          </button>
        </div>
      )}

      {inCharleston ? (
        <div className="w-full max-w-5xl mx-auto flex gap-3 mb-4">
          <button onClick={passCharleston} disabled={selected.length !== 3}
            className="flex-1 rounded-2xl bg-amber-500 text-emerald-950 text-2xl font-black py-5 disabled:opacity-40 focus:outline-none focus:ring-4 focus:ring-amber-300">
            {selected.length === 3 ? "Pass these 3 →" : `Pick 3 to pass (${selected.length}/3)`}</button>
          <button onClick={() => { setSelected([]); setPhase("draw"); say("We'll skip the rest of the Charleston. Take a tile when you're ready."); }}
            className="rounded-2xl bg-emerald-700 text-white px-6 text-lg font-bold focus:outline-none focus:ring-4 focus:ring-amber-300">Skip</button>
        </div>
      ) : phase === "call" ? (
        <div className="w-full max-w-5xl mx-auto flex gap-3 mb-4">
          <button onClick={takeCall} className="flex-1 rounded-2xl bg-amber-500 text-emerald-950 text-2xl font-black py-5 focus:outline-none focus:ring-4 focus:ring-amber-300">Take it ({callable?.label})</button>
          <button onClick={leaveCall} className="flex-1 rounded-2xl bg-emerald-700 text-white text-2xl font-bold py-5 focus:outline-none focus:ring-4 focus:ring-amber-300">Leave it</button>
        </div>
      ) : (
        <div className="w-full max-w-5xl mx-auto flex flex-col sm:flex-row gap-3 mb-4">
          <button onClick={phase === "won" ? () => startGame(mode === "learn") : drawTile} disabled={phase !== "draw" && phase !== "won"}
            className="flex-1 rounded-2xl bg-amber-500 enabled:hover:bg-amber-400 text-emerald-950 text-2xl font-black py-5 disabled:opacity-40 focus:outline-none focus:ring-4 focus:ring-amber-300">
            {phase === "won" ? "Play again 🎉" : "Take a tile"}
          </button>
          <button onClick={() => runCoach()} disabled={thinking || hand.length === 0}
            className="flex-1 rounded-2xl bg-emerald-600 enabled:hover:bg-emerald-500 text-white text-2xl font-bold py-5 flex items-center justify-center gap-3 disabled:opacity-40 focus:outline-none focus:ring-4 focus:ring-amber-300">
            <HelpCircle size={26} /> What should I do?
          </button>
          {mode === "card" && (
            <button onClick={checkCard} disabled={thinking}
              className="flex-1 rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white text-2xl font-bold py-5 flex items-center justify-center gap-3 disabled:opacity-40 focus:outline-none focus:ring-4 focus:ring-amber-300">
              <BadgeCheck size={26} /> Did I win?
            </button>
          )}
          <button onClick={startListening} disabled={!sttSupported || listening || thinking}
            className={`flex-1 rounded-2xl text-2xl font-bold py-5 flex items-center justify-center gap-3 disabled:opacity-40 focus:outline-none focus:ring-4 focus:ring-amber-300
              ${listening ? "bg-red-500 text-white animate-pulse motion-reduce:animate-none" : "bg-emerald-600 hover:bg-emerald-500 text-white"}`}>
            <Mic size={26} /> {listening ? "Listening…" : "Ask out loud"}
          </button>
        </div>
      )}

      <div className="w-full max-w-5xl mx-auto flex gap-2">
        <label htmlFor="coach-question" className="sr-only">Type a question for the coach</label>
        <input id="coach-question" value={typed} onChange={(e) => setTyped(e.target.value)} onKeyDown={(e) => e.key === "Enter" && askTyped()}
          placeholder="…or type a question for the coach"
          className="flex-1 rounded-xl px-4 py-3 text-lg text-emerald-950 placeholder-stone-400 focus:outline-none focus:ring-4 focus:ring-amber-400" />
        <button onClick={askTyped} className="rounded-xl bg-stone-100 text-emerald-950 px-5 py-3 text-lg font-bold hover:bg-white focus:outline-none focus:ring-4 focus:ring-amber-300">Ask</button>
      </div>
      {!sttSupported && <p className="text-emerald-300 text-sm mt-3 text-center">(Voice questions work in Chrome — the typing box always works.)</p>}
    </Shell>
  );
}

function Shell({ children, voiceOn, setVoiceOn, onReset, resetLabel = "Deal new tiles", hideReset }) {
  return (
    <div className="min-h-screen w-full bg-emerald-900 text-stone-100 p-4 sm:p-6">
      <div className="w-full max-w-5xl mx-auto flex items-center justify-end gap-2 mb-4">
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
