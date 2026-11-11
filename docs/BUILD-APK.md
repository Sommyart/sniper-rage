# Sniper Rage: installing on a phone, and building an APK

## What I could and could not produce

I could not build the APK myself. This environment has a Java runtime but no
Android SDK, and the network proxy blocks Google's and Gradle's servers, so the
SDK, build tools and Gradle cannot be downloaded here. Anyone claiming to hand
you a compiled APK from this session would be handing you something that was
not actually built.

What I have produced instead is `sniper-rage-pwa.zip`: a complete, fully
offline, installable build of the game. It has **no external dependencies at
all** (three.js and the soundtrack are bundled), so once it is on a phone it
runs with the network off. From that package, an APK is a short mechanical step
that you can do in a browser or in Android Studio. Both routes are below.

---

## Option 1: install directly, no APK needed (fastest)

This gives a home-screen icon, fullscreen landscape, and offline play. It is
what most people actually want when they ask for an APK.

1. Unzip `sniper-rage-pwa.zip`. You get a `pwa/` folder.
2. Host that folder over **https**. Any of these work:
   - Vercel: drag the folder onto the dashboard, or `npx vercel deploy pwa --prod`
   - GitHub Pages: push the folder contents to a repo, enable Pages
   - Netlify: drag and drop
   A service worker will not register from a `file://` path, so it has to be
   served. https or `localhost` only.
3. Open the URL in Chrome on the Android phone.
4. Menu, then **Install app** (or **Add to Home Screen**).
5. Turn airplane mode on and launch it from the home screen. It should play.

The service worker precaches every asset on first load, so after that first
visit there is no network traffic.

---

## Option 2: turn it into a real APK with PWABuilder (no local tooling)

Once the folder from Option 1 is hosted:

1. Go to `https://www.pwabuilder.com`
2. Paste your hosted URL and let it analyse the manifest.
3. Choose **Android**, then **Generate Package**.
4. Pick **Signed APK**. Let it generate a new signing key and **save the
   `signing.keystore` file and its passwords somewhere safe**. You need the same
   key for every future update; lose it and you cannot update the app on the
   same package name.
5. Download the zip. It contains `app-release-signed.apk`.
6. Copy the APK to the phone, allow "install from unknown sources" for your file
   manager, and install.

Note that PWABuilder produces a Trusted Web Activity, which normally streams
from your URL. Because everything here is precached by the service worker, it
still plays offline after the first launch.

---

## Option 3: a real self-contained APK with Capacitor (needs Android Studio)

This bundles the files inside the APK, so it never needs a URL at all.

On a machine with Node and Android Studio installed:

```bash
mkdir sniper-rage-app && cd sniper-rage-app
npm init -y
npm install @capacitor/core @capacitor/android
npm install -D @capacitor/cli
npx cap init "Sniper Rage" com.sommyart.sniperrage --web-dir=www

mkdir www
# copy the CONTENTS of the pwa/ folder into www/
#   www/index.html, www/bgm.mp3, www/manifest.webmanifest, www/sw.js, www/icon-*.png

npx cap add android
npx cap sync android
npx cap open android
```

Before building, force landscape and fullscreen. In
`android/app/src/main/AndroidManifest.xml`, on the `<activity>` tag, set:

```xml
android:screenOrientation="sensorLandscape"
android:configChanges="orientation|keyboardHidden|keyboard|screenSize|locale|smallestScreenSize|screenLayout|uiMode"
```

Then in Android Studio: **Build > Generate Signed Bundle / APK > APK**, create a
keystore, choose **release**, and build. The APK lands in
`android/app/release/`.

Two things worth setting while you are in there:
- `com.sommyart.sniperrage` is a placeholder package name. Change it if you want
  something else; it is permanent once published.
- App icons: replace the files under `android/app/src/main/res/mipmap-*`, or use
  Android Studio's **Image Asset** tool with `icon-512.png` as the source.

---

## If the music is silent

Open **Settings** in the game. There is a **MUSIC STATUS** row with a TEST
button. The readout tells you which case you are in:

| Readout | Meaning |
|---|---|
| PLAYING | Decoded and looping through the music bus. Working. |
| PLAYING (FALLBACK) | The buffer decode failed, playing via the audio element. Still audible. |
| DECODING | Still decoding the track. Should resolve in a second or two. |
| BLOCKED BY BROWSER | Autoplay was refused. Tap or press any key; it retries automatically. |
| TRACK UNAVAILABLE | The audio file could not be read at all. |
| AUDIO NOT STARTED | No audio context yet. Click or tap anything first. |

Also check the MUSIC slider is not at zero, and that the phone is not in silent
mode, which on iOS suppresses web audio entirely.


---

## The in-game INSTALL APP button

The menu now has **05 INSTALL APP**. It hides itself once the game is already
running as an installed app.

What it does, in order:

1. If the page has no manifest linked (the standalone single-file build), it
   builds one at run time from a Blob, icons included, and injects it. This is
   what lets a **single hosted HTML file** be installable with no extra files.
2. It registers `sw.js` if one is sitting beside the page. If there is no
   `sw.js` the game still installs, it just will not run with the network off.
3. It captures the browser's install prompt. Pressing INSTALL NOW fires it.
4. If the browser will not offer a prompt, the panel shows the manual route for
   that exact platform instead of a dead button: Share then Add to Home Screen
   on iOS Safari, the three dot menu on Chrome for Android, the Add page to
   menu on Samsung Internet, the address bar icon on desktop.

It also detects an insecure link and says so plainly, because that is the most
common reason installing does not appear.

### The minimum to host it

Upload `sniper-rage.html` to any https host, rename it `index.html`, share the
link. The install button works from that alone.

To get offline play as well, upload `sw.js` next to it. Nothing else is needed:
the service worker caches the page on first visit.

### Reusing the installer elsewhere

`pwa-install.js` is the same logic as a standalone drop-in for any other page:

```html
<script src="pwa-install.js"></script>
<script>
  PWAInstall.configure({
    name: "Sniper Rage",
    shortName: "Sniper Rage",
    orientation: "landscape",
    display: "fullscreen",
    icon192: "icon-192.png",
    icon512: "icon-512.png"
  });
  PWAInstall.onInstructions = function (info) {
    // no native prompt available: show info.title and info.steps your own way
    console.log(info.title, info.steps);
  };
  PWAInstall.mount(document.getElementById("my-install-button"));
</script>
```

`PWAInstall.canPrompt()`, `.isInstalled()`, `.isSecure()`, `.platform()`,
`.install()` and `.instructions()` are all available if you want to build your
own interface around it.
