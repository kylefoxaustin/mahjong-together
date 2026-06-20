# Native apps (Android + iOS) — private testing builds

We wrap the live web app in **Capacitor** to make real installable apps for
**private testing**. We are NOT publishing to any store yet (CLAUDE.md §1 — she's
the whole point; we ship when *we're* satisfied).

## How it works (architecture)

The native app is a thin, full-screen shell whose WebView loads the **live site**
(`server.url` in `capacitor.config.json` → `https://mahjong-together-six.vercel.app`).

Why wrap the hosted site instead of bundling the web code:
- The coach (`/api/coach`) runs **server-side on Vercel and holds the API key**.
  Loading the hosted site keeps that key off the device entirely.
- Zero changes to game logic; the app is always in sync with production.
- **Nice consequence:** pushing a web/gameplay change to `main` (→ Vercel) updates
  what the app shows **instantly, with no rebuild**. You only rebuild the native
  app when the *shell* changes (icon, splash, app id, native plugins).

Voice in the WebView: the coach **speaks** (TTS works). "Ask out loud" (speech-to-
text) is **not** available in native WebViews — it gracefully falls back to the
typing box, exactly like macOS Safari does today. Native STT would be a follow-up
(`@capacitor-community/speech-recognition` + mic permission strings).

App identity: `appId: com.kylefoxaustin.mahjongtogether`, `appName: "Mahjong, Together"`.

---

## Android — building the APK (works on this Linux box)

Requirements (already set up here): Android SDK at `~/Android/Sdk`, a portable
**JDK 21** at `~/.local/jdks/jdk-21*`, and **Node 22** via nvm (Capacitor needs both).

```bash
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 22
export ANDROID_HOME="$HOME/Android/Sdk"; export ANDROID_SDK_ROOT="$ANDROID_HOME"
export JAVA_HOME="$(ls -d ~/.local/jdks/jdk-21* | head -1)"

# after any web/native change, re-sync the shell + assets, then build:
npx cap sync android
cd android && ./gradlew assembleDebug
# → android/app/build/outputs/apk/debug/app-debug.apk
```

### Install on an Android phone/tablet
1. Copy `app-debug.apk` to the device (email/USB/Drive), or `adb install app-debug.apk`.
2. Tap it; allow **"install from this source"** when prompted (it's a debug build).
3. Launch **Mahjong, Together**. (Needs internet to load the live site.)

> Debug builds are signed with the auto-generated debug key — fine for testing,
> not for the store. A release build (signed `.aab`) comes later, only when we publish.

---

## iOS — building for iPhone/iPad (must be done on a Mac with Xcode)

iOS apps can only be compiled on **macOS with Xcode** — not on this Linux box. The
Capacitor config + `@capacitor/ios` dependency are already in the repo, so on a Mac:

```bash
# one-time: get the repo + tools on the Mac
git pull
brew install cocoapods          # if not already installed
npm install
sudo gem install cocoapods      # (or via brew, above)

# add + open the iOS project
npx cap add ios                 # generates ios/ (run once)
npx @capacitor/assets generate --ios   # app icon + splash from /assets
npx cap sync ios
npx cap open ios                # opens Xcode
```

In Xcode:
1. Select the **App** target → **Signing & Capabilities** → check *Automatically
   manage signing* → pick your **Team** (a free Apple ID works for personal testing).
2. **Microphone/speech permission strings** (needed for "Ask out loud"): open
   `ios/App/App/Info.plist` and add these two keys (Xcode: right-click → Add Row):
   - `NSMicrophoneUsageDescription` → `Mahjong, Together listens so you can ask the coach questions out loud.`
   - `NSSpeechRecognitionUsageDescription` → `Used to turn your spoken questions into text for the coach.`
   Without them, iOS rejects the app the instant the mic is used.
3. Plug in the **iPad** (or iPhone), select it as the run destination, press **▶ Run**.
   - First time: on the device, **Settings → General → VPN & Device Management** →
     trust your developer certificate.
3. The app installs and launches on her iPad.

> **Free Apple ID:** the app runs for **7 days**, then needs a re-run from Xcode to
> renew. A paid **Apple Developer** account ($99/yr) extends that to a year and is
> required to publish later. For private testing, the free path is enough.

To put it on her iPad without plugging into your Mac each week, options are
TestFlight (needs the paid account) — a later step when we're closer to "real app".

---

---

## "Ask out loud" in the native apps (native speech-to-text)

In a browser we use the Web Speech API. Inside the native app there is no Web
Speech API, so we use the **`@capacitor-community/speech-recognition`** plugin
(works on iOS + Android). The app auto-detects which it's running in
(`window.Capacitor.isNativePlatform()`) and picks the right one — no code branch
you have to flip.

What's wired:
- The plugin is an npm dependency; `npx cap sync` copies its native code into the
  android/ios projects.
- **Android**: `RECORD_AUDIO` permission + the `RecognitionService` `<queries>`
  entry are already in `android/app/src/main/AndroidManifest.xml`.
- **iOS**: add the two `Info.plist` usage strings (see the iOS section above).
- The mic button speaks/listens exactly like the web flow: continuous, with a
  generous 12-second silence auto-finish, and it accumulates phrases across the
  short restarts the native recognizer does at pauses.

Because the app loads the **hosted** site, native voice needs BOTH: (1) this STT
code deployed to Vercel (so the in-app web bundle knows to call the plugin), and
(2) a native build that includes the plugin (`npx cap sync` + rebuild). A web-only
deploy won't add voice to an already-installed app until you ship a new native build.

---

## TestFlight — update her iPad over-the-air (no weekly cable)

The free-Apple-ID path re-installs from Xcode every 7 days (needs the cable).
**TestFlight** removes that: builds last 90 days, install + updates happen on the
iPad with no Mac attached, and you push new builds whenever you like. It requires a
paid **Apple Developer Program** account ($99/yr) — the one real cost of going this
route. Nothing is public; TestFlight is private testing.

One-time setup (on the Mac, after the iOS project exists):
1. Join the Apple Developer Program; in **App Store Connect** → **Apps** → **+** →
   create the app record (pick the bundle id `com.kylefoxaustin.mahjongtogether`).
2. In Xcode → target → **Signing**: select your paid **Team**.
3. Bump the build each upload: target → **General** → **Build** (e.g. 1, 2, 3…).

Upload a build:
1. Xcode → **Product ▸ Archive** (destination must be "Any iOS Device").
2. In the Organizer window that opens → **Distribute App** → **TestFlight (Internal
   Only)** → **Upload**. Processing takes a few minutes.
3. App Store Connect → your app → **TestFlight** → add yourself / her as an
   **Internal Tester** (just needs an Apple ID email). Internal testers skip Apple's
   review wait.

On her iPad (once):
1. Install **TestFlight** from the App Store, sign in with the tester Apple ID.
2. Accept the invite → tap **Install**. Future builds you upload show an **Update**
   button — no cable, no Mac.

> Optional automation: a `fastlane` lane (`fastlane/Fastfile` with a `beta` lane
> running `build_app` + `upload_to_testflight`) makes each release one command on
> the Mac. Worth adding once the manual path works.

---

## Regenerating icons/splash

Source art lives in `/assets` (generated by `scripts/gen-native-assets.mjs` from the
same tile-on-felt design as the PWA). After changing it:

```bash
node scripts/gen-native-assets.mjs           # rebuild assets/icon.png + splash*.png
npx @capacitor/assets generate --android     # (and --ios on a Mac)
```
