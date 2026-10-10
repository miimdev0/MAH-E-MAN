# ماه من | MAH-E MAN

A static, Persian, right-to-left romantic experience for Mahdieh, made by Mojtaba.

## Website sources

The complete website logic and presentation live in exactly these three source files:

- `html.html` — semantic HTML and the five scenes
- `css.css` — responsive design, local font faces, artwork, and motion
- `js.js` — Tehran-time countdown, scene state, persistence, optional sound, and local test controls

`site.webmanifest`, the `moon-icon*` files, `font/`, Capacitor configuration, and GitHub workflow files are assets/build configuration, not additional website HTML/CSS/JavaScript sources. The repository initially had no `font/` directory, so the Arabic/Persian and Latin Vazirmatn WOFF2 subsets and their SIL Open Font License were added.

## Local preview and test mode

From the repository root, run a static server, for example:

```sh
python3 -m http.server 8000 --bind 0.0.0.0
```

Open `http://localhost:8000/html.html`. The countdown is based on **11 October 2026 at 00:00 in `Asia/Tehran`**, converted with the browser's IANA time-zone database (no hard-coded offset). As with any static client-side page, the device clock and local storage are not a trusted security boundary; this protects against accidental early display, not intentional tampering.

To preview every scene without waiting, temporarily change the `APP_CONFIG` at the top of `js.js` to:

```js
environment: "development",
enableDeveloperTools: true,
```

Keep the target settings below it unchanged and open the page on `localhost`. A local-only panel previews waiting, the final countdown, reveal, letter, and ending using the same rendering/state code. Test progress is kept out of production storage. Restore `environment: "production"` and `enableDeveloperTools: false` before publishing. A query parameter cannot enable this mode.

Sound is off by default. The toggle enables only quiet, synthesized chimes after a user gesture; there is no bundled music track.

## Add the Doran font

`www/font/` is the Capacitor web-root font slot. Add your licensed webfont there as **`Doran.woff2`**. The app and Pages build both include files from that folder; when the valid WOFF2 is present, the page switches to Doran automatically and otherwise keeps using Vazirmatn. Keep the original font extension—if your Doran file is TTF/OTF, its actual format needs a matching CSS source declaration.

## GitHub Pages

The source entry is deliberately named `html.html`, not `index.html`. `.github/workflows/pages.yml` creates a generated `index.html` in the deployment artifact, preserving the three-source-file requirement. It also packages CSS, JavaScript, PWA metadata/icons, Vazirmatn, and any custom font placed in `www/font/`.

The repository had no configured Pages site at inspection time. Set **Settings → Pages → Build and deployment → Source** to **GitHub Actions**; a push to `main` then runs the Pages workflow. This repository has not been deployed or verified live yet. The manifest supports standalone display mode, but no service worker is included, so offline caching is not claimed.

## Android APK via GitHub Actions

`capacitor.config.json` points Capacitor at `www/`. The workflow `.github/workflows/android-apk.yml` stages the three website sources there, generates the Android project on the GitHub runner, builds a debug APK, and uploads it as the artifact **`MAH-E-MAN-android-debug`**. It runs on pushes to `main` or this Arena branch, and can also be run manually from the repository's **Actions** tab. The generated `android/` project is intentionally not checked in; `package.json` and `package-lock.json` pin the Capacitor build tools.

The APK is a debug-signed install/test build, not a Play Store release. A static page or plain Capacitor wrapper still cannot guarantee a notification while Android has fully closed the app. That needs a native local-notification plugin and Android permission/scheduling configuration; none is added by this APK workflow.
