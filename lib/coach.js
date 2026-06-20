/* ------------------------------------------------------------------ *
 *  lib/coach.js — the coaching layer.
 *
 *  Assembles the warm tutor system prompt and talks to the server-side
 *  proxy at /api/coach (which holds ANTHROPIC_API_KEY). The model only
 *  phrases coaching and interprets/judges her plain-English card target;
 *  it never touches tile counts or win-structure (that's lib/tiles.js).
 *
 *  Replies are read aloud, so prompts demand short, plain, list-free text.
 * ------------------------------------------------------------------ */

export const BASE_STYLE = `You are a warm, patient Mahjong tutor sitting beside an older beginner who has never used a computer and is just learning American-style Mahjong. She is easily overwhelmed and a little nervous.
Speak in 2 to 3 short, friendly sentences. No lists, no markdown. Name tiles in plain words exactly as given (e.g. "the 3 Bam", "the Red Dragon", "your Joker"). Give ONE clear suggestion at a time. Be encouraging — it's only practice, she can't lose. Plain text only; it is read aloud.
Never count her tiles yourself or invent any numbers. Only state tile counts, pairs, or numbers of sets that you are explicitly given as facts. Never tell her she has three of a tile unless the facts list it as a ready-made set; if she has a pair, remember a Joker can be the third tile.
When you mention a tile, always use its full name exactly as written — number AND suit (like "the 3 Bam", "the 6 Dot"), or "the Red Dragon", "the East Wind", "your Joker" — so the game can light up the tiles you mean on her screen.
This is one single fresh game — there are no earlier rounds or past games. Never say anything carried over from a previous round or game. If the goal panel shows a set as done, it is because she is holding three matching tiles, or a pair plus a Joker, or has locked a set this game — explain it from her current tiles, never invent a history.`;

// Default learn-mode goal; callers can pass the chosen line's goal instead.
export const LEARN_GOAL = "build 4 sets plus 1 pair. A set is three matching tiles (or four — a kong); Jokers are wild inside a set, but never in the pair.";

export const cardGoal = (target) =>
  `\nShe is going for one specific hand from her own paper Mah Jongg card. Her target hand, in her words: "${target}". Steer her toward THAT hand. If she asks you to check whether she has finished, compare her tiles to the target and tell her clearly yes or no, and why, kindly.`;

/** Build the full system prompt. In learn mode, `lineGoal` is the description of
 *  the winning line she's chasing (defaults to the classic goal). */
export function buildSystemPrompt(mode, target, lineGoal) {
  if (mode === "card") return BASE_STYLE + cardGoal(target);
  return BASE_STYLE + `\nThe goal of this practice game: ${lineGoal || LEARN_GOAL}`;
}

/**
 * Ask the coach. Posts {system, userText} to the local proxy and returns
 * the spoken text, or null on any failure so the caller can fall back to a
 * local hint (CLAUDE.md §3/§12 — the game must never stall).
 */
export async function callCoach(system, userText) {
  try {
    const res = await fetch("/api/coach", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ system, userText }),
    });
    if (!res.ok) return null;
    const { text } = await res.json();
    return text || null;
  } catch {
    return null;
  }
}
