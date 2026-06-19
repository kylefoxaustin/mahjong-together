import { useState, useEffect, useRef, useCallback } from "react";
import { Volume2, VolumeX, Mic, HelpCircle, RotateCcw, ArrowRight, BadgeCheck } from "lucide-react";

/* ------------------------------------------------------------------ *
 *  Mahjong Coach — v0.2
 *  Two ways to play, chosen from a start menu:
 *   1) "Just play & learn" — practice game with the Charleston and
 *      calling tiles off discards. Win goal is our own simple hand
 *      (4 sets of three + a pair, Jokers wild in a set).
 *   2) "Practice my card" — she names the exact hand she's going for
 *      from her own physical League card; the coach reads that target
 *      plus her tiles and steers her toward it, and checks her when she
 *      thinks she's done. Engine handles tiles & turns; the LLM handles
 *      interpreting the card pattern. Nothing from the card ships here.
 * ------------------------------------------------------------------ */

const SUITS = {
  crak: { name: "Crak", glyphs: ["🀇","🀈","🀉","🀊","🀋","🀌","🀍","🀎","🀏"] },
  bam:  { name: "Bam",  glyphs: ["🀐","🀑","🀒","🀓","🀔","🀕","🀖","🀗","🀘"] },
  dot:  { name: "Dot",  glyphs: ["🀙","🀚","🀛","🀜","🀝","🀞","🀟","🀠","🀡"] },
};
const WINDS = [
  { key: "E", glyph: "🀀", label: "East Wind" },
  { key: "S", glyph: "🀁", label: "South Wind" },
  { key: "W", glyph: "🀂", label: "West Wind" },
  { key: "N", glyph: "🀃", label: "North Wind" },
];
const DRAGONS = [
  { key: "RD", glyph: "🀄", label: "Red Dragon" },
  { key: "GD", glyph: "🀅", label: "Green Dragon" },
  { key: "WD", glyph: "🀆", label: "White Dragon" },
];

function makeTile(key, glyph, label, isJoker = false) {
  return { id: Math.random().toString(36).slice(2), key, glyph, label, isJoker };
}
function buildWall() {
  const wall = [];
  for (const s of Object.keys(SUITS)) {
    SUITS[s].glyphs.forEach((g, i) => {
      const label = `${i + 1} ${SUITS[s].name}`;
      for (let n = 0; n < 4; n++) wall.push(makeTile(`${s}${i + 1}`, g, label));
    });
  }
  for (const w of WINDS) for (let n = 0; n < 4; n++) wall.push(makeTile(w.key, w.glyph, w.label));
  for (const d of DRAGONS) for (let n = 0; n < 4; n++) wall.push(makeTile(d.key, d.glyph, d.label));
  for (let n = 0; n < 8; n++) wall.push(makeTile("JOKER", "🃏", "Joker", true));
  for (let i = wall.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [wall[i], wall[j]] = [wall[j], wall[i]];
  }
  return wall;
}
const ORDER = (() => {
  const o = {}; let i = 0;
  for (const s of Object.keys(SUITS)) for (let n = 1; n <= 9; n++) o[`${s}${n}`] = i++;
  for (const w of WINDS) o[w.key] = i++;
  for (const d of DRAGONS) o[d.key] = i++;
  o["JOKER"] = i++;
  return o;
})();
const sortHand = (h) => [...h].sort((a, b) => ORDER[a.key] - ORDER[b.key]);

function countsByKey(tiles) {
  const c = {}; let jokers = 0;
  for (const t of tiles) { if (t.isJoker) jokers++; else c[t.key] = (c[t.key] || 0) + 1; }
  return { c, jokers };
}
function canFormTriplets(counts, jokers, needed) {
  const keys = Object.keys(counts).filter((k) => counts[k] > 0).sort();
  if (keys.length === 0) return jokers % 3 === 0 && jokers / 3 === needed;
  if (needed === 0) return false;
  const k = keys[0], have = counts[k], tries = [];
  if (have >= 3) tries.push([3, 0]);
  if (have >= 2 && jokers >= 1) tries.push([2, 1]);
  if (have >= 1 && jokers >= 2) tries.push([1, 2]);
  for (const [real, joke] of tries) {
    const next = { ...counts, [k]: have - real };
    if (next[k] === 0) delete next[k];
    if (canFormTriplets(next, jokers - joke, needed - 1)) return true;
  }
  return false;
}
function isWinningHand(tiles) {
  if (tiles.length !== 14) return false;
  const { c, jokers } = countsByKey(tiles);
  for (const k of Object.keys(c)) {
    if (c[k] >= 2) {
      const rest = { ...c, [k]: c[k] - 2 };
      if (rest[k] === 0) delete rest[k];
      if (canFormTriplets(rest, jokers, 4)) return true;
    }
  }
  return false;
}
function localHint(tiles) {
  const { c, jokers } = countsByKey(tiles);
  const trips = Object.keys(c).filter((k) => c[k] >= 3);
  const pairs = Object.keys(c).filter((k) => c[k] === 2);
  const label = (k) => tiles.find((t) => t.key === k)?.label || k;
  if (trips.length) return `You already have three ${label(trips[0])} tiles — that's a full set!`;
  if (pairs.length) return `You have a pair of ${label(pairs[0])}. One more makes a set.`;
  if (jokers) return `You're holding ${jokers} Joker${jokers > 1 ? "s" : ""} — keep those, they finish any set.`;
  return `See which of your tiles come in twos or threes, and let a lonely one go.`;
}

const BASE_STYLE = `You are a warm, patient Mahjong tutor sitting beside an older beginner who has never used a computer and is just learning American-style Mahjong. She is easily overwhelmed and a little nervous.
Speak in 2 to 3 short, friendly sentences. No lists, no markdown. Name tiles in plain words exactly as given (e.g. "the 3 Bam", "the Red Dragon", "your Joker"). Give ONE clear suggestion at a time. Be encouraging — it's only practice, she can't lose. Plain text only; it is read aloud.`;
const LEARN_GOAL = `\nThe goal of this practice game: build 4 sets of three matching tiles, plus 1 pair. A set is three identical tiles. Jokers are wild inside a set of three, but never in the pair.`;
const cardGoal = (target) => `\nShe is going for one specific hand from her own paper Mah Jongg card. Her target hand, in her words: "${target}". Steer her toward THAT hand. If she asks you to check whether she has finished, compare her tiles to the target and tell her clearly yes or no, and why, kindly.`;

async function callClaude(system, userText) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 1000,
      system,
      messages: [{ role: "user", content: userText }],
    }),
  });
  const data = await res.json();
  return (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join(" ").trim() || null;
}

function useSpeech(enabled) {
  const speak = useCallback((text) => {
    if (!enabled || !text || typeof window === "undefined" || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 0.95; u.pitch = 1.0;
    window.speechSynthesis.speak(u);
  }, [enabled]);
  const stop = useCallback(() => {
    if (typeof window !== "undefined" && window.speechSynthesis) window.speechSynthesis.cancel();
  }, []);
  return { speak, stop };
}

function Tile({ tile, onClick, selected, dim, small }) {
  const w = small ? 60 : 84, h = small ? 84 : 116;
  return (
    <button
      onClick={onClick}
      disabled={!onClick}
      aria-label={tile.label}
      className={`relative flex flex-col items-center justify-center rounded-2xl border-4 transition
        ${onClick ? "cursor-pointer hover:-translate-y-2 focus:-translate-y-2 focus:outline-none focus:ring-4 focus:ring-red-400" : "cursor-default"}
        ${selected ? "border-red-500 -translate-y-2" : "border-stone-300"}
        ${dim ? "opacity-50" : ""} bg-stone-50 shadow-lg`}
      style={{ width: w, height: h }}
    >
      <span style={{ fontSize: tile.isJoker ? (small ? 24 : 34) : (small ? 40 : 56), lineHeight: 1 }}>{tile.glyph}</span>
      <span className="mt-1 text-[10px] sm:text-xs font-bold uppercase tracking-wide text-stone-500">{tile.label}</span>
    </button>
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
  const [botDiscards, setBotDiscards] = useState(["—", "—", "—"]);
  const [callable, setCallable] = useState(null);
  const [phase, setPhase] = useState("draw");
  const [coach, setCoach] = useState("");
  const [thinking, setThinking] = useState(false);
  const [voiceOn, setVoiceOn] = useState(true);
  const [listening, setListening] = useState(false);
  const [typed, setTyped] = useState("");
  const recogRef = useRef(null);

  const { speak, stop } = useSpeech(voiceOn);
  const sttSupported = typeof window !== "undefined" && (window.SpeechRecognition || window.webkitSpeechRecognition);
  const allTiles = [...hand, ...exposed.flat()];
  const say = useCallback((msg) => { setCoach(msg); speak(msg); }, [speak]);

  const startGame = useCallback((withCharleston) => {
    stop();
    const w = buildWall();
    const h = sortHand(w.splice(0, 13));
    setWall(w); setHand(h); setExposed([]); setSelected([]); setCallable(null);
    setBotDiscards(["—", "—", "—"]);
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

  const runCoach = useCallback(async (question) => {
    setThinking(true);
    const tilesStr = sortHand(allTiles).map((t) => t.label).join(", ");
    const sys = BASE_STYLE + (mode === "card" ? cardGoal(target) : LEARN_GOAL);
    const exposedStr = exposed.length ? ` She has already set down (exposed): ${exposed.map((m) => m[0].label + " x3").join("; ")}.` : "";
    const userText = question
      ? `Her tiles now: ${tilesStr}.${exposedStr}\n\nShe asked out loud: "${question}"\n\nAnswer her kindly and simply.`
      : `It's her turn. Her tiles now: ${tilesStr}.${exposedStr}\n\nGive her one gentle suggestion about what to aim for or which tile to let go.`;
    try { say((await callClaude(sys, userText)) || localHint(allTiles)); }
    catch { say(localHint(allTiles)); }
    finally { setThinking(false); }
  }, [allTiles, exposed, mode, target, say]);

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

  const botsPlay = useCallback((concealed) => {
    setWall((w) => {
      const picks = w.slice(0, 3);
      setBotDiscards(picks.map((p) => p?.label || "—"));
      const counts = {};
      concealed.forEach((t) => { if (!t.isJoker) counts[t.key] = (counts[t.key] || 0) + 1; });
      const claim = picks.find((p) => p && !p.isJoker && counts[p.key] >= 2) || null;
      setCallable(claim);
      setPhase(claim ? "call" : "draw");
      if (claim) say(`That ${claim.label} would finish a set for you! Press "Take it" to grab it, or "Leave it" to wait.`);
      return w.slice(3);
    });
  }, [say]);

  const drawTile = () => {
    if (phase !== "draw" || wall.length === 0) return;
    const [t, ...rest] = wall;
    const newHand = sortHand([...hand, t]);
    setWall(rest); setHand(newHand);
    const full = [...newHand, ...exposed.flat()];
    if (mode === "learn" && isWinningHand(full)) { setPhase("won"); say("You did it! Four sets and a pair — that's a winning hand. Beautifully done."); return; }
    setPhase("discard");
    runCoach();
  };
  const discardTile = (tile) => {
    if (phase !== "discard") return;
    const newHand = sortHand(hand.filter((t) => t.id !== tile.id));
    setHand(newHand);
    botsPlay(newHand);
  };
  const takeCall = () => {
    if (!callable) return;
    let removed = 0; const keep = [];
    for (const t of hand) {
      if (removed < 2 && t.key === callable.key && !t.isJoker) { removed++; continue; }
      keep.push(t);
    }
    setExposed((e) => [...e, [makeTile(callable.key, callable.glyph, callable.label), makeTile(callable.key, callable.glyph, callable.label), callable]]);
    setHand(sortHand(keep));
    setCallable(null);
    setPhase("discard");
    say("Nice grab — that set is locked in and safe. Now let one tile go.");
  };
  const leaveCall = () => { setCallable(null); setPhase("draw"); say("No problem, we'll wait for a better one. Take a tile from the wall."); };
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
  const tileClick = (t) => phase === "discard" ? () => discardTile(t) : inCharleston ? () => toggleSelect(t) : undefined;

  if (screen === "menu") {
    return (
      <Shell voiceOn={voiceOn} setVoiceOn={() => { stop(); setVoiceOn((v) => !v); }} hideReset>
        <div className="w-full max-w-3xl mx-auto text-center pt-6">
          <h1 className="text-3xl sm:text-4xl font-black text-amber-200 mb-2">Mahjong, together</h1>
          <p className="text-emerald-200 text-lg mb-8">Pick how you'd like to play today.</p>
          <div className="grid sm:grid-cols-2 gap-4">
            <button onClick={() => { setMode("learn"); startGame(true); }}
              className="rounded-3xl bg-stone-50 text-emerald-950 p-6 text-left shadow-2xl hover:-translate-y-1 transition">
              <div className="text-2xl font-black mb-2">Just play &amp; learn</div>
              <p className="text-base text-stone-600">A gentle full game — the Charleston, taking tiles off the table, and a simple hand to aim for. The coach walks you through every step. You can't lose.</p>
            </button>
            <button onClick={() => { setMode("card"); setScreen("cardsetup"); }}
              className="rounded-3xl bg-stone-50 text-emerald-950 p-6 text-left shadow-2xl hover:-translate-y-1 transition">
              <div className="text-2xl font-black mb-2">Practice my card</div>
              <p className="text-base text-stone-600">Tell the coach which hand you're going for from your own paper card, and it'll guide you straight toward it and check you when you're close.</p>
            </button>
          </div>
          <button onClick={() => { setMode("learn"); startGame(false); }} className="mt-6 text-emerald-200 underline text-base">
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
            className="w-full rounded-2xl p-4 text-lg text-emerald-950" />
          <div className="flex gap-3 mt-4">
            <button onClick={() => target.trim() && startGame(false)} disabled={!target.trim()}
              className="flex-1 rounded-2xl bg-amber-500 text-emerald-950 text-xl font-black py-4 disabled:opacity-40 flex items-center justify-center gap-2">
              Start this hand <ArrowRight size={22} />
            </button>
            <button onClick={() => setScreen("menu")} className="rounded-2xl bg-emerald-700 text-white px-6 text-lg font-bold">Back</button>
          </div>
        </div>
      </Shell>
    );
  }

  return (
    <Shell voiceOn={voiceOn} setVoiceOn={() => { stop(); setVoiceOn((v) => !v); }} onReset={() => setScreen("menu")} resetLabel="Menu">
      <div className="w-full max-w-5xl mx-auto rounded-3xl bg-stone-50 text-emerald-950 p-5 sm:p-6 shadow-2xl mb-4 flex items-start gap-4">
        <div className="shrink-0 h-14 w-14 rounded-full bg-emerald-700 text-amber-200 flex items-center justify-center text-2xl font-black">♪</div>
        <p className="text-xl sm:text-2xl font-semibold leading-snug self-center">{thinking ? "Let me look at your tiles…" : coach}</p>
      </div>

      {mode === "card" && (
        <div className="w-full max-w-5xl mx-auto mb-3 text-center text-amber-200 text-base font-semibold">
          Going for: <span className="italic">{target}</span>
        </div>
      )}

      <div className="w-full max-w-5xl mx-auto grid grid-cols-3 gap-3 mb-4 text-center">
        {["Left player", "Across", "Right player"].map((name, i) => (
          <div key={name} className="rounded-xl bg-emerald-800/70 py-2 px-2">
            <div className="text-xs uppercase tracking-wider text-emerald-300">{name}</div>
            <div className="text-sm font-semibold text-stone-200">tossed: {botDiscards[i]}</div>
          </div>
        ))}
      </div>

      {exposed.length > 0 && (
        <div className="w-full max-w-5xl mx-auto mb-3">
          <div className="text-xs uppercase tracking-widest text-emerald-300 mb-2 font-bold">Sets you've set down</div>
          <div className="flex flex-wrap gap-2">
            {exposed.map((m, i) => m.map((t) => <Tile key={t.id + i} tile={t} small dim />))}
          </div>
        </div>
      )}

      <div className="w-full max-w-5xl mx-auto rounded-3xl bg-emerald-800/60 p-4 sm:p-5 mb-4">
        <div className="text-sm uppercase tracking-widest text-emerald-300 mb-3 font-bold">
          Your tiles
          {phase === "discard" ? " — tap one to let it go" : inCharleston ? ` — tap 3 to pass (${selected.length}/3)` : ""}
        </div>
        <div className="flex flex-wrap gap-3 justify-center">
          {hand.map((t) => <Tile key={t.id} tile={t} selected={selected.includes(t.id)} onClick={tileClick(t)} />)}
        </div>
      </div>

      {inCharleston ? (
        <div className="w-full max-w-5xl mx-auto flex gap-3 mb-4">
          <button onClick={passCharleston} disabled={selected.length !== 3}
            className="flex-1 rounded-2xl bg-amber-500 text-emerald-950 text-2xl font-black py-5 disabled:opacity-40">Pass these 3 →</button>
          <button onClick={() => { setSelected([]); setPhase("draw"); say("We'll skip the rest of the Charleston. Take a tile when you're ready."); }}
            className="rounded-2xl bg-emerald-700 text-white px-6 text-lg font-bold">Skip</button>
        </div>
      ) : phase === "call" ? (
        <div className="w-full max-w-5xl mx-auto flex gap-3 mb-4">
          <button onClick={takeCall} className="flex-1 rounded-2xl bg-amber-500 text-emerald-950 text-2xl font-black py-5">Take it ({callable?.label})</button>
          <button onClick={leaveCall} className="flex-1 rounded-2xl bg-emerald-700 text-white text-2xl font-bold py-5">Leave it</button>
        </div>
      ) : (
        <div className="w-full max-w-5xl mx-auto flex flex-col sm:flex-row gap-3 mb-4">
          <button onClick={drawTile} disabled={phase !== "draw" || wall.length === 0}
            className="flex-1 rounded-2xl bg-amber-500 enabled:hover:bg-amber-400 text-emerald-950 text-2xl font-black py-5 disabled:opacity-40">
            {phase === "won" ? "You won! 🎉" : "Take a tile"}
          </button>
          <button onClick={() => runCoach()} disabled={thinking || hand.length === 0}
            className="flex-1 rounded-2xl bg-emerald-600 enabled:hover:bg-emerald-500 text-white text-2xl font-bold py-5 flex items-center justify-center gap-3 disabled:opacity-40">
            <HelpCircle size={26} /> What should I do?
          </button>
          {mode === "card" && (
            <button onClick={checkCard} disabled={thinking}
              className="flex-1 rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white text-2xl font-bold py-5 flex items-center justify-center gap-3 disabled:opacity-40">
              <BadgeCheck size={26} /> Did I win?
            </button>
          )}
          <button onClick={startListening} disabled={!sttSupported || listening || thinking}
            className={`flex-1 rounded-2xl text-2xl font-bold py-5 flex items-center justify-center gap-3 disabled:opacity-40
              ${listening ? "bg-red-500 text-white animate-pulse" : "bg-emerald-600 hover:bg-emerald-500 text-white"}`}>
            <Mic size={26} /> {listening ? "Listening…" : "Ask out loud"}
          </button>
        </div>
      )}

      <div className="w-full max-w-5xl mx-auto flex gap-2">
        <input value={typed} onChange={(e) => setTyped(e.target.value)} onKeyDown={(e) => e.key === "Enter" && askTyped()}
          placeholder="…or type a question for the coach"
          className="flex-1 rounded-xl px-4 py-3 text-lg text-emerald-950 placeholder-stone-400" />
        <button onClick={askTyped} className="rounded-xl bg-stone-100 text-emerald-950 px-5 py-3 text-lg font-bold hover:bg-white">Ask</button>
      </div>
      {!sttSupported && <p className="text-emerald-300 text-sm mt-3 text-center">(Voice questions work in Chrome — the typing box always works.)</p>}
    </Shell>
  );
}

function Shell({ children, voiceOn, setVoiceOn, onReset, resetLabel = "Deal new tiles", hideReset }) {
  return (
    <div className="min-h-screen w-full bg-emerald-900 text-stone-100 p-4 sm:p-6">
      <div className="w-full max-w-5xl mx-auto flex items-center justify-end gap-2 mb-4">
        <button onClick={setVoiceOn} className="flex items-center gap-2 rounded-full bg-emerald-700 hover:bg-emerald-600 px-4 py-2 text-base font-bold">
          {voiceOn ? <Volume2 size={22} /> : <VolumeX size={22} />}{voiceOn ? "Voice on" : "Voice off"}
        </button>
        {!hideReset && (
          <button onClick={onReset} className="flex items-center gap-2 rounded-full bg-amber-500 hover:bg-amber-400 text-emerald-950 px-4 py-2 text-base font-extrabold">
            <RotateCcw size={20} /> {resetLabel}
          </button>
        )}
      </div>
      {children}
    </div>
  );
}
