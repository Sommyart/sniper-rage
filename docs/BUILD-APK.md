# Sniper Rage: installing on a phone, and building an APK

## What I can and cannot produce, and why

**I cannot build the APK in this environment.** This is a factual limit, not a
preference, and here is exactly what I checked:

| Check | Result |
|---|---|
| Java | present, OpenJDK 21 |
| `keytool`, `jarsigner` | present |
| Gradle | present, `/opt/gradle/bin/gradle` |
| `ANDROID_HOME` / `ANDROID_SDK_ROOT` | unset, no SDK on disk |
| `dl.google.com` (the SDK and build-tools) | **403, blocked at the proxy** |
| `repo1.maven.org` (Maven Central) | **403, blocked at the proxy** |
| GitHub release downloads | **403, blocked at the proxy** |
| npm registry | reachable |
| `android-sdk-tools`, `apksigner` on npm | do not exist |

An APK needs two tools that are not obtainable from any registry this sandbox
can reach: **aapt2**, which compiles resources and the binary manifest, and
**d8**, which turns classes into `classes.dex`. Both ship only in the Android
SDK build-tools, from Google's servers or Maven Central, and both are blocked.
Without them there is no way to produce a valid APK, and an APK signed with
`jarsigner` alone (v1 only) will not install on Android 11 or newer anyway.

So anything presented as a compiled APK from this environment would not have
been built here. The routes below are the real ones, and route 2 produces a
genuine signed APK with no local tooling at all.

What this repository does produce is a **complete, fully offline, installable
build** in `public/`, with three.js, the soundtrack and the character and
weapon models inlined and the four environment models precached. Once it is on
a phone it runs with the network off. Every route below starts from that.

```bash
node build/package.js     # writes public/
```

---

## Route 1: install directly, no APK needed

This is what most people actually want when they ask for an APK: a home-screen
icon, fullscreen landscape, and offline play.

1. Host `public/` over **https**. Vercel, Netlify or GitHub Pages all work.
   A service worker will not register from a `file://` path, so it has to be
   served, over https or `localhost`.
2. Open the URL in Chrome on the phone.
3. Menu, then **Install app**, or use **05 INSTALL APP** in the game's own menu.
4. Turn on airplane mode and launch it from the home screen. It plays.

The service worker precaches the page and all four environment models on the
first load, so after that first visit there is no network traffic at all.

---

## Route 2: a real signed APK with PWABuilder, no local tooling

Once `public/` is hosted over https:

1. Go to `https://www.pwabuilder.com`.
2. Paste the hosted URL and let it read the manifest.
3. Choose **Android**, then **Generate Package**.
4. Pick **Signed APK**. Let it generate a signing key, and **save the
   `signing.keystore` file and its passwords somewhere safe.** You need the
   same key for every future update. Lose it and you cannot update the app
   under the same package name, ever.
5. Download the zip. `app-release-signed.apk` is inside it.
6. Copy the APK to the phone, allow "install from unknown sources" for your
   file manager, and install.

PWABuilder produces a Trusted Web Activity, which normally streams from your
URL. Because the service worker precaches everything, it still plays offline
after the first launch.

This is the route to use. It takes about five minutes and the APK is really
signed and really installable.

---

## Route 3: a self-contained APK with Capacitor, needs Android Studio

This bundles the files inside the APK, so it never touches a URL.

On a machine with Node and Android Studio:

```bash
mkdir sniper-rage-app && cd sniper-rage-app
npm init -y
npm install @capacitor/core @capacitor/android
npm install -D @capacitor/cli
npx cap init "Sniper Rage" com.sommyart.sniperrage --web-dir=www

mkdir www
# copy the CONTENTS of public/ into www/
#   www/index.html, www/sw.js, www/manifest.webmanifest,
#   www/icon-*.png, www/assets/*.glb

npx cap add android
npx cap sync android
npx cap open android
```

Force landscape and fullscreen before building. In
`android/app/src/main/AndroidManifest.xml`, on the `<activity>` tag:

```xml
android:screenOrientation="sensorLandscape"
android:configChanges="orientation|keyboardHidden|keyboard|screenSize|locale|smallestScreenSize|screenLayout|uiMode"
```

Then **Build > Generate Signed Bundle / APK > APK**, create a keystore, choose
**release**. The APK lands in `android/app/release/`.

Two things worth setting while you are in there:
- `com.sommyart.sniperrage` is a placeholder. Change it if you want something
  else; it is permanent once published to Play.
- App icons: replace `android/app/src/main/res/mipmap-*`, or use Android
  Studio's **Image Asset** tool with `public/icon-512.png` as the source.

---

## The in-game INSTALL APP button

**05 INSTALL APP** in the menu hides itself once the game is already installed.

In order, it:

1. Builds a web app manifest at run time from a Blob if the page has none, so
   even a single hosted HTML file is installable with no extra files.
2. Registers `sw.js` if one sits beside the page. Without `sw.js` the game
   still installs, it just will not run with the network off.
3. Captures the browser's install prompt, and fires it on INSTALL NOW.
4. If the browser refuses to offer a prompt, shows the manual route for that
   exact platform rather than a dead button: Share then Add to Home Screen on
   iOS Safari, the three dot menu on Chrome for Android, Add page to on Samsung
   Internet, the address bar icon on desktop.

It also detects an insecure link and says so, because that is the most common
reason the install option never appears.

### The absolute minimum to host it

Upload `public/index.html` as `index.html`, with `sw.js`, the manifest, the
icons and `assets/` beside it. Share the link. That is the whole deployment.

A standalone `public/sniper-rage.html` is also produced, which plays from a
single file, though it still wants `assets/` beside it for the ruins and the
scaffolding.

---

## If the music is silent

Open **Settings** in the game. The **MUSIC STATUS** row has a TEST button, and
the readout says which case you are in:

| Readout | Meaning |
|---|---|
| PLAYING | Decoded and looping through the music bus. Working. |
| PLAYING (FALLBACK) | Buffer decode failed, playing via the audio element. Still audible. |
| DECODING | Still decoding. Resolves in a second or two. |
| BLOCKED BY BROWSER | Autoplay refused. Tap or press any key; it retries. |
| TRACK UNAVAILABLE | The audio could not be read at all. |
| AUDIO NOT STARTED | No audio context yet. Click or tap anything first. |

Also check the MUSIC slider is not at zero, and that the phone is not in silent
mode, which on iOS suppresses web audio entirely.
