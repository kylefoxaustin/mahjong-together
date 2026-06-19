/* ------------------------------------------------------------------ *
 *  app/api/coach/route.js — the server-side Claude proxy.
 *
 *  The ONLY thing that must live on the server is ANTHROPIC_API_KEY
 *  (CLAUDE.md §4/§7). The client assembles the whole prompt and POSTs
 *  { system, userText }; nothing sensitive is in it. Non-streaming and
 *  tool-less by design (§8) — keep it simple.
 *
 *  Fail-soft (patterns mined from reference/campmatch/campy-chat.ts):
 *  every error path returns { text: null } so the client falls back to a
 *  local hint and the game never stalls.
 * ------------------------------------------------------------------ */

export const runtime = "nodejs";

export async function POST(req) {
  try {
    const { system, userText } = await req.json();
    if (!system || !userText) return Response.json({ text: null });

    if (!process.env.ANTHROPIC_API_KEY) {
      console.error("coach: ANTHROPIC_API_KEY is not configured");
      return Response.json({ text: null });
    }

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001", // bump to "claude-sonnet-4-6" for richer guidance
        max_tokens: 300, // replies are 2–3 sentences, read aloud
        system,
        messages: [{ role: "user", content: userText }],
      }),
    });

    if (!r.ok) {
      console.error("coach: Anthropic API returned", r.status);
      return Response.json({ text: null });
    }

    const data = await r.json();
    const text = (data.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join(" ")
      .trim();
    return Response.json({ text: text || null });
  } catch (error) {
    console.error("coach: request failed", error?.message ?? error);
    return Response.json({ text: null });
  }
}
