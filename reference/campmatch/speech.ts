/**
 * Text-to-speech helper for Campy.
 *
 * Uses the browser's built-in Web Speech Synthesis API — no network call,
 * no API key, no cost. Voice quality depends on the user's OS / browser.
 *
 * Web-only. On native React Native this module's functions are all no-ops.
 */

const PREFERRED_VOICE_NAMES = [
  // macOS / iOS (typically great quality)
  'Samantha',
  'Victoria',
  'Alex',
  'Karen',
  'Daniel',
  // Chrome desktop (Google voices)
  'Google US English',
  'Google UK English Female',
  'Google UK English Male',
  // Edge / Windows
  'Microsoft Zira - English (United States)',
  'Microsoft Aria Online (Natural) - English (United States)',
  'Microsoft David - English (United States)',
];

let cachedVoice: SpeechSynthesisVoice | null = null;
let voiceResolved = false;

export function isSpeechAvailable(): boolean {
  return (
    typeof window !== 'undefined' &&
    'speechSynthesis' in window &&
    typeof window.SpeechSynthesisUtterance !== 'undefined'
  );
}

function selectBestVoice(): SpeechSynthesisVoice | null {
  if (!isSpeechAvailable()) return null;
  const voices = window.speechSynthesis.getVoices();
  if (voices.length === 0) return null;

  // Try preferred names first (exact match)
  for (const name of PREFERRED_VOICE_NAMES) {
    const match = voices.find((v) => v.name === name);
    if (match) return match;
  }

  // Fall back to any English voice (prefer en-US, then any en-*)
  const enUS = voices.find((v) => v.lang === 'en-US');
  if (enUS) return enUS;

  const anyEnglish = voices.find((v) => v.lang.startsWith('en'));
  if (anyEnglish) return anyEnglish;

  // Last resort: whichever is first
  return voices[0];
}

/**
 * Ensures the voice list has been populated before a speak call.
 * On Chrome, getVoices() initially returns [] and then fires a
 * voiceschanged event when the list is ready.
 */
function ensureVoiceReady(onReady: () => void): void {
  if (!isSpeechAvailable()) return;
  if (voiceResolved) {
    onReady();
    return;
  }

  const voices = window.speechSynthesis.getVoices();
  if (voices.length > 0) {
    cachedVoice = selectBestVoice();
    voiceResolved = true;
    onReady();
    return;
  }

  // Wait for the voiceschanged event, then resolve
  const handler = () => {
    cachedVoice = selectBestVoice();
    voiceResolved = true;
    window.speechSynthesis.removeEventListener('voiceschanged', handler);
    onReady();
  };
  window.speechSynthesis.addEventListener('voiceschanged', handler);
}

/**
 * Speak the given text. Queues after any in-flight utterance.
 * No-op on native or when speech is unavailable.
 */
export function speakText(text: string): void {
  if (!isSpeechAvailable()) return;
  const trimmed = text.trim();
  if (!trimmed) return;

  ensureVoiceReady(() => {
    try {
      const utterance = new SpeechSynthesisUtterance(trimmed);
      if (cachedVoice) {
        utterance.voice = cachedVoice;
      }
      utterance.rate = 1.0;
      utterance.pitch = 1.0;
      utterance.volume = 1.0;
      window.speechSynthesis.speak(utterance);
    } catch {
      // ignore — some browsers throw if speech is interrupted mid-queue
    }
  });
}

/**
 * Cancel any in-progress or queued speech immediately.
 * Safe to call repeatedly.
 */
export function cancelSpeech(): void {
  if (!isSpeechAvailable()) return;
  try {
    window.speechSynthesis.cancel();
  } catch {
    // ignore
  }
}
