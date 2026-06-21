"use client";

import { useEffect, useState } from "react";

// Auto-refresh the app when a new version is deployed, so she never has to.
// We compare this build's id (baked in at build time) against the live
// deployment's id (from /api/version). When they differ, we reload — but only at
// a GENTLE moment, so she's never yanked out of a move:
//   • if it's safe right now (she's on the menu / a game just ended) → reload now
//   • otherwise (mid-game) → reload the instant she steps away (tab/app hidden),
//     or as soon as she returns to a safe screen. Her game is auto-saved either
//     way, so she lands on a fresh version with "Continue your game" waiting.
const POLL_MS = 90_000;
const BOOT_ID = process.env.NEXT_PUBLIC_BUILD_ID || null;

export function useAutoUpdate(safeToReload) {
  const [updateReady, setUpdateReady] = useState(false);

  // Poll for a newer deployment (on an interval and whenever the app regains focus).
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!BOOT_ID || BOOT_ID === "dev") return; // local/dev — nothing to watch
    let stopped = false;
    const check = async () => {
      try {
        const res = await fetch("/api/version", { cache: "no-store" });
        if (!res.ok) return;
        const { id } = await res.json();
        if (id && id !== "dev" && id !== BOOT_ID && !stopped) setUpdateReady(true);
      } catch { /* offline or a hiccup — try again next time */ }
    };
    const onVisible = () => { if (document.visibilityState === "visible") check(); };
    const interval = setInterval(check, POLL_MS);
    document.addEventListener("visibilitychange", onVisible);
    check();
    return () => { stopped = true; clearInterval(interval); document.removeEventListener("visibilitychange", onVisible); };
  }, []);

  // Once an update is waiting, reload at a gentle moment.
  useEffect(() => {
    if (!updateReady || typeof window === "undefined") return;
    if (safeToReload) { window.location.reload(); return; }
    const onHide = () => { if (document.visibilityState === "hidden") window.location.reload(); };
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, [updateReady, safeToReload]);
}
