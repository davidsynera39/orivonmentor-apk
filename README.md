# Orivon — Android app

A Capacitor wrapper that loads your deployed Orivon server inside a native Android shell.
The backend (Express + Postgres + AI keys) can't run on a phone, so it must stay hosted
(e.g. Render). Because the app loads from your server, cookie login, CV upload, PDF/Word
export and Paystack payments work exactly as on the web, and web updates reach the app
instantly with no new APK.

## Build the APK

**Option A — Android Studio**
1. Install Node 20+ and Android Studio.
2. `npm install`
3. `ORIVON_URL=https://your-server.com npx cap sync android` (Windows: `set ORIVON_URL=...` first)
4. `npx cap open android` → Build ▸ Build APK(s). Or: `cd android && ./gradlew assembleDebug`
   (output: `android/app/build/outputs/apk/debug/app-debug.apk`).

**Option B — no local setup:** push this folder to GitHub, then Actions ▸ "Build Android APK" ▸ Run workflow, enter your URL, download the APK artifact.

## Server settings to check
- Set `NODE_ENV=production` and `APP_URL=https://your-server.com` on the server (Paystack callback uses it).
- Server must be HTTPS.

## Notes
- Downloads are handled natively (`MainActivity.java`) and land in the Downloads folder.
- App id: `com.orivon.app` (change in `capacitor.config.js` before publishing).
- Icons/splash: replace the defaults in `android/app/src/main/res/` (or use `@capacitor/assets`).
- Play Store release: create a keystore and sign `assembleRelease`/`bundleRelease`. Google may question apps that are only a website wrapper, so add native value (push notifications, etc.) if you publish.
