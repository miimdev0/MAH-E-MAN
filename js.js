(() => {
  "use strict";

  /*
   * Production is the safe default. To preview locally, temporarily change both
   * values to development/true. The controls are then restricted to localhost
   * (or file://); a query string alone can never enable test mode.
   */
  const APP_CONFIG = Object.freeze({
    environment: "production",
    enableDeveloperTools: false,
    target: Object.freeze({
      year: 2026,
      month: 10,
      day: 11,
      hour: 0,
      minute: 0,
      second: 0,
      timeZone: "Asia/Tehran"
    })
  });

  const MINUTE = 60 * 1000;
  const SECOND = 1000;
  const REVEAL_SEQUENCE_DURATION = 23_500;
  const PROGRESS_KEY = "mah-e-man:revealed-progress:v1";
  const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
  const REVEAL_LINES = [
    { at: 5_200, text: "مهدیه جان..." },
    { at: 7_650, text: "ماهِ من، این همه انتظار فقط برای یه چیز بود..." },
    { at: 10_050, text: "اینکه یه بار دیگه بهت بگم چقدر بودنت برای من قشنگه." },
    { at: 12_850, text: "روز دخترت مبارک، ماهِ من ❤️" }
  ];
  const FINAL_MESSAGES = [
    "ماهی، یه لحظه چشماتو به اینجا بسپار...",
    "یه چیزی هست که دلم می‌خواد بهت بگم.",
    "این چند ثانیه، فقط برای توئه.",
    "مهدیه...",
    "آماده‌ای، ماهِ من؟"
  ];
  const SCREEN_BY_SCENE = Object.freeze({
    waiting: "waiting-screen",
    final: "final-screen",
    reveal: "reveal-screen",
    letter: "letter-screen",
    ending: "ending-screen"
  });

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const root = document.documentElement;
  const body = document.body;
  const announcer = $("#screen-announcer");
  const errorBox = $("#timer-error");
  const soundButton = $("#sound-toggle");
  const devPanel = $("#developer-tools");
  const waitingValues = {
    days: $("#count-days"),
    hours: $("#count-hours"),
    minutes: $("#count-minutes"),
    seconds: $("#count-seconds")
  };
  const finalNumber = $("#final-number");
  const finalDial = $("#final-dial");
  const finalMessage = $("#final-heading");
  const revealScreen = $("#reveal-screen");
  const revealLines = $$("[data-reveal-line]");
  const letterScroll = $("#letter-scroll");
  const continueButton = $("#continue-button");
  const readAgainButton = $("#read-again-button");

  const allowedDevHosts = new Set(["", "localhost", "127.0.0.1", "[::1]", "::1"]);
  const developerToolsEnabled = APP_CONFIG.environment === "development"
    && APP_CONFIG.enableDeveloperTools === true
    && allowedDevHosts.has(window.location.hostname);

  let targetTimestamp = Number.NaN;
  let currentMainState = null;
  let activeScene = $(".screen.is-active")?.id || "waiting-screen";
  let scheduledUpdate = 0;
  let lastFinalMessage = -1;
  let lastRevealLine = -2;
  let simulationClock = null;
  let developmentProgress = null;

  function persianDigits(value) {
    return String(value).replace(/[0-9]/g, digit => PERSIAN_DIGITS[digit.charCodeAt(0) - 48]);
  }

  function paddedPersian(value) {
    return persianDigits(String(value).padStart(2, "0"));
  }

  function wallTimeToEpoch(fields, timeZone) {
    const wanted = Date.UTC(fields.year, fields.month - 1, fields.day, fields.hour, fields.minute, fields.second);
    const formatter = new Intl.DateTimeFormat("en-US-u-ca-gregory-nu-latn", {
      timeZone,
      calendar: "gregory",
      numberingSystem: "latn",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23"
    });

    let guess = wanted;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const parts = Object.fromEntries(formatter.formatToParts(new Date(guess)).map(part => [part.type, part.value]));
      const representedAsUtc = Date.UTC(
        Number(parts.year),
        Number(parts.month) - 1,
        Number(parts.day),
        Number(parts.hour),
        Number(parts.minute),
        Number(parts.second)
      );
      const correction = wanted - representedAsUtc;
      if (correction === 0) return guess;
      if (Math.abs(correction) > 2 * 24 * 60 * MINUTE) {
        throw new RangeError("Could not resolve the requested wall-clock time.");
      }
      guess += correction;
    }

    const check = Object.fromEntries(formatter.formatToParts(new Date(guess)).map(part => [part.type, part.value]));
    const resolved = [check.year, check.month, check.day, check.hour, check.minute, check.second].map(Number);
    const expected = [fields.year, fields.month, fields.day, fields.hour, fields.minute, fields.second];
    if (resolved.some((part, index) => part !== expected[index])) {
      throw new RangeError("The browser could not resolve the requested time zone.");
    }
    return guess;
  }

  function nowTimestamp() {
    if (!developerToolsEnabled || !simulationClock) return Date.now();
    return simulationClock.epoch + (Date.now() - simulationClock.startedAt);
  }

  function readProgress() {
    if (developerToolsEnabled) return developmentProgress;
    try {
      const raw = window.localStorage.getItem(PROGRESS_KEY);
      if (!raw) return null;
      const value = JSON.parse(raw);
      if (!value || value.unlocked !== true || !["reveal", "letter", "ending"].includes(value.scene)) return null;
      if (!Number.isFinite(Number(value.revealStartedAt))) return null;
      return {
        unlocked: true,
        scene: value.scene,
        revealStartedAt: Number(value.revealStartedAt)
      };
    } catch (_error) {
      return null;
    }
  }

  function writeProgress(value) {
    const cleanValue = {
      unlocked: true,
      scene: value.scene,
      revealStartedAt: Number(value.revealStartedAt)
    };
    if (developerToolsEnabled) {
      developmentProgress = cleanValue;
      return;
    }
    try {
      window.localStorage.setItem(PROGRESS_KEY, JSON.stringify(cleanValue));
    } catch (_error) {
      /* The experience still works if browser storage is unavailable. */
    }
  }

  function getOrCreateProgress(now) {
    let progress = readProgress();
    if (!progress) {
      progress = { unlocked: true, scene: "reveal", revealStartedAt: now };
      writeProgress(progress);
    }
    if (progress.scene === "reveal" && now - progress.revealStartedAt >= REVEAL_SEQUENCE_DURATION) {
      progress = { ...progress, scene: "letter" };
      writeProgress(progress);
    }
    return progress;
  }

  function announce(message) {
    if (announcer) announcer.textContent = message;
  }

  function showTimerError(error) {
    if (!errorBox) return;
    errorBox.textContent = "مرورگرت نتونست زمانِ دقیقِ تهران رو محاسبه کنه. لطفاً با یک مرورگر به‌روز دوباره امتحان کن.";
    errorBox.hidden = false;
    if (window.console && typeof window.console.error === "function") {
      console.error("MAH-E MAN time-zone initialization failed.", error);
    }
  }

  function activateScreen(sceneName) {
    const targetId = SCREEN_BY_SCENE[sceneName];
    const target = targetId ? document.getElementById(targetId) : null;
    if (!target) return;
    body.dataset.scene = sceneName;
    if (activeScene === targetId && target.classList.contains("is-active")) return;

    const previous = document.getElementById(activeScene);
    if (previous && previous !== target) {
      previous.classList.remove("is-active");
      previous.classList.add("is-leaving");
      previous.setAttribute("aria-hidden", "true");
      const previousId = previous.id;
      window.setTimeout(() => {
        const leaving = document.getElementById(previousId);
        if (leaving && !leaving.classList.contains("is-active")) {
          leaving.classList.remove("is-leaving");
          leaving.hidden = true;
        }
      }, 1_000);
    }

    activeScene = targetId;
    target.hidden = false;
    target.classList.remove("is-leaving");
    target.setAttribute("aria-hidden", "false");
    requestAnimationFrame(() => target.classList.add("is-active"));

    if (sceneName === "letter" && letterScroll) letterScroll.scrollTop = 0;
  }

  function changeJourneyScene(sceneName, options = {}) {
    const previousScene = body.dataset.scene || "waiting";
    const changed = activeScene !== SCREEN_BY_SCENE[sceneName];
    activateScreen(sceneName);
    if (changed && options.announce !== false) {
      const messages = {
        waiting: "همه‌چیز برای لحظه‌ی خودش آماده می‌شه.",
        final: "شمارش پایانی آغاز شد.",
        reveal: "لحظه‌ی موعود رسید.",
        letter: "نامه‌ای از مجتبی برای مهدیه.",
        ending: "از طرف مجتبی، برای ماهِ خودش."
      };
      announce(messages[sceneName] || "");
    }
    if (changed && options.sound !== false && previousScene !== sceneName) sound.chime(sceneName);
  }

  function updateNumber(element, value) {
    if (!element) return;
    const nextText = String(value);
    if (element.textContent === nextText) return;
    element.classList.remove("is-changing");
    element.textContent = nextText;
    void element.offsetWidth;
    element.classList.add("is-changing");
  }

  function updateWaitingCountdown(now) {
    const wholeSeconds = Math.max(0, Math.floor((targetTimestamp - now) / SECOND));
    const values = {
      days: Math.floor(wholeSeconds / 86_400),
      hours: Math.floor((wholeSeconds % 86_400) / 3_600),
      minutes: Math.floor((wholeSeconds % 3_600) / 60),
      seconds: wholeSeconds % 60
    };
    const unitLabels = { days: "روز", hours: "ساعت", minutes: "دقیقه", seconds: "ثانیه" };
    for (const [unit, element] of Object.entries(waitingValues)) {
      const formatted = unit === "days" ? persianDigits(values[unit]) : paddedPersian(values[unit]);
      updateNumber(element, formatted);
      if (element && element.parentElement) element.parentElement.setAttribute("aria-label", `${formatted} ${unitLabels[unit]}`);
    }
  }

  function updateFinalCountdown(now) {
    const millisecondsLeft = Math.max(0, targetTimestamp - now);
    const secondsLeft = Math.max(1, Math.ceil(millisecondsLeft / SECOND));
    const elapsedSeconds = Math.max(0, 60 - secondsLeft);
    updateNumber(finalNumber, persianDigits(secondsLeft));
    if (finalDial) finalDial.style.setProperty("--progress", `${Math.min(100, Math.max(0, (elapsedSeconds / 60) * 100))}%`);

    const messageIndex = Math.min(FINAL_MESSAGES.length - 1, Math.floor(elapsedSeconds / 12));
    if (messageIndex !== lastFinalMessage && finalMessage) {
      lastFinalMessage = messageIndex;
      finalMessage.classList.remove("message-change");
      finalMessage.textContent = FINAL_MESSAGES[messageIndex];
      void finalMessage.offsetWidth;
      finalMessage.classList.add("message-change");
      if (messageIndex > 0) announce(FINAL_MESSAGES[messageIndex]);
    }

    const phase = secondsLeft <= 1 ? "one"
      : secondsLeft <= 2 ? "two"
        : secondsLeft <= 3 ? "three"
          : secondsLeft <= 5 ? "five"
            : secondsLeft <= 10 ? "ten" : "build";
    const finalScreen = document.getElementById("final-screen");
    if (finalScreen && finalScreen.dataset.phase !== phase) finalScreen.dataset.phase = phase;
    return secondsLeft;
  }

  function updateRevealSequence(elapsed) {
    if (!revealScreen) return;
    const beat = elapsed < 650 ? "seed"
      : elapsed < 1_650 ? "bloom"
        : elapsed < 2_850 ? "moon"
          : elapsed < 5_200 ? "heart" : "words";
    if (revealScreen.dataset.beat !== beat) revealScreen.dataset.beat = beat;

    let visibleLine = -1;
    for (let index = REVEAL_LINES.length - 1; index >= 0; index -= 1) {
      if (elapsed >= REVEAL_LINES[index].at) {
        visibleLine = index;
        break;
      }
    }
    if (visibleLine !== lastRevealLine) {
      lastRevealLine = visibleLine;
      revealLines.forEach((line, index) => {
        const isVisible = index === visibleLine;
        line.classList.toggle("is-visible", isVisible);
        line.setAttribute("aria-hidden", String(!isVisible));
      });
      if (visibleLine >= 0) announce(REVEAL_LINES[visibleLine].text);
    }
  }

  function setMainState(nextState) {
    if (nextState === currentMainState) return;
    const previous = currentMainState;
    currentMainState = nextState;
    body.classList.remove("state-waiting", "state-final", "state-revealed");
    const visualState = nextState === "FINAL_COUNTDOWN" ? "final" : nextState.toLowerCase();
    body.classList.add(`state-${visualState}`);
    if (previous === "WAITING" && nextState === "FINAL_COUNTDOWN") {
      announce("شمارش پایانی آغاز شد.");
      sound.chime("final");
    } else if (nextState === "REVEALED" && previous !== "REVEALED") {
      announce("لحظه‌ی موعود رسید.");
      sound.chime("reveal");
    }
  }

  function mainStateAt(now) {
    if (now >= targetTimestamp) return "REVEALED";
    if (now >= targetTimestamp - MINUTE) return "FINAL_COUNTDOWN";
    return "WAITING";
  }

  function applyVisualState(now, secondsLeft) {
    const revealProgress = activeScene === "reveal" && currentMainState === "REVEALED"
      ? Math.max(0, now - (readProgress()?.revealStartedAt || now))
      : 0;
    sky.setState({
      state: currentMainState || "WAITING",
      scene: body.dataset.scene || "waiting",
      secondsLeft: Number.isFinite(secondsLeft) ? secondsLeft : 60,
      revealElapsed: revealProgress
    });
  }

  function updateExperience() {
    if (!Number.isFinite(targetTimestamp)) return;
    const now = nowTimestamp();
    const nextState = mainStateAt(now);
    setMainState(nextState);

    if (nextState === "WAITING") {
      changeJourneyScene("waiting", { announce: false, sound: false });
      updateWaitingCountdown(now);
      applyVisualState(now, 60);
      return;
    }

    if (nextState === "FINAL_COUNTDOWN") {
      changeJourneyScene("final", { announce: false, sound: false });
      const secondsLeft = updateFinalCountdown(now);
      applyVisualState(now, secondsLeft);
      return;
    }

    let progress = getOrCreateProgress(now);
    if (progress.scene === "reveal") {
      const elapsed = Math.max(0, now - progress.revealStartedAt);
      if (elapsed >= REVEAL_SEQUENCE_DURATION) {
        progress = { ...progress, scene: "letter" };
        writeProgress(progress);
      } else {
        changeJourneyScene("reveal", { announce: false, sound: false });
        updateRevealSequence(elapsed);
        applyVisualState(now, 0);
        return;
      }
    }

    lastRevealLine = -2;
    changeJourneyScene(progress.scene, { announce: false, sound: false });
    applyVisualState(now, 0);
  }

  function nextUpdateDelay(now) {
    if (document.hidden || !Number.isFinite(targetTimestamp)) return 0;
    if (currentMainState === "WAITING") {
      const timeToFinal = targetTimestamp - MINUTE - now;
      return Math.max(1, Math.min(1000 - (now % 1000), timeToFinal));
    }
    if (currentMainState === "FINAL_COUNTDOWN") {
      const timeToReveal = targetTimestamp - now;
      return Math.max(1, Math.min(1000 - (now % 1000), timeToReveal));
    }
    if (activeScene === "reveal") return 180;
    return 0;
  }

  function updateAndSchedule() {
    if (scheduledUpdate) window.clearTimeout(scheduledUpdate);
    scheduledUpdate = 0;
    updateExperience();
    const delay = nextUpdateDelay(nowTimestamp());
    if (delay > 0) scheduledUpdate = window.setTimeout(updateAndSchedule, delay);
  }

  function moveToRevealedScene(sceneName, shouldFocus = false) {
    if (!developerToolsEnabled && mainStateAt(Date.now()) !== "REVEALED") return;
    const now = nowTimestamp();
    const existing = getOrCreateProgress(now);
    const next = { ...existing, scene: sceneName };
    if (sceneName === "reveal") next.revealStartedAt = now;
    writeProgress(next);
    lastRevealLine = -2;
    changeJourneyScene(sceneName);
    applyVisualState(now, 0);
    if (shouldFocus) {
      const heading = sceneName === "letter" ? $("#letter-heading") : $("#ending-heading");
      if (heading) heading.focus({ preventScroll: true });
    }
    updateAndSchedule();
  }

  function enableMaterialSymbolsWhenAvailable() {
    if (!document.fonts || typeof document.fonts.load !== "function") return;
    document.fonts.load('24px "Material Symbols Rounded"', "volume_off replay expand_more")
      .then(faces => {
        if (faces.length > 0) root.classList.add("material-symbols-ready");
      })
      .catch(() => { /* Inline SVG icons remain visible if Google Fonts cannot load. */ });
  }

  async function enableOptionalDoranFont() {
    if (typeof window.fetch !== "function" || !document.fonts || typeof document.fonts.load !== "function") return;
    try {
      const fontUrl = new URL("font/Doran.woff2", document.baseURI);
      const response = await window.fetch(fontUrl.href, { cache: "force-cache" });
      if (!response.ok) return;
      const faces = await document.fonts.load('400 1rem "Doran"', "ماه من مهدیه");
      if (faces.length > 0) root.classList.add("doran-font-ready");
    } catch (_error) {
      /* Doran is user-supplied; Vazirmatn remains the default until the file exists. */
    }
  }

  const sound = (() => {
    let context = null;
    let masterGain = null;
    let enabled = false;

    function paintButton() {
      if (!soundButton) return;
      const label = enabled ? "خاموش کردن آواهای ظریف" : "روشن کردن آواهای ظریف";
      soundButton.setAttribute("aria-pressed", String(enabled));
      soundButton.setAttribute("aria-label", label);
      soundButton.title = label;
      const symbol = $(".material-symbols-rounded", soundButton);
      if (symbol) symbol.textContent = enabled ? "volume_up" : "volume_off";
    }

    function tone(frequency, startAt, duration, peak, wave = "sine") {
      if (!context || !masterGain || context.state !== "running") return;
      const oscillator = context.createOscillator();
      const envelope = context.createGain();
      oscillator.type = wave;
      oscillator.frequency.setValueAtTime(frequency, startAt);
      envelope.gain.setValueAtTime(0.0001, startAt);
      envelope.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), startAt + Math.min(.16, duration * .2));
      envelope.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
      oscillator.connect(envelope);
      envelope.connect(masterGain);
      oscillator.start(startAt);
      oscillator.stop(startAt + duration + .03);
      oscillator.addEventListener("ended", () => {
        oscillator.disconnect();
        envelope.disconnect();
      }, { once: true });
    }

    function chime(kind) {
      if (!enabled || !context || context.state !== "running") return;
      const startAt = context.currentTime + .025;
      const pitches = kind === "reveal" ? [523.25, 659.25, 783.99]
        : kind === "final" ? [440, 554.37]
          : [493.88, 659.25];
      pitches.forEach((frequency, index) => tone(frequency, startAt + index * .105, 1.45, .12, "sine"));
    }

    async function toggle() {
      if (enabled) {
        enabled = false;
        if (masterGain && context) {
          masterGain.gain.cancelScheduledValues(context.currentTime);
          masterGain.gain.setValueAtTime(0, context.currentTime);
        }
        paintButton();
        return;
      }
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) {
        announce("این مرورگر از صدای اختیاری پشتیبانی نمی‌کنه؛ تجربه بدون صدا هم کامله.");
        return;
      }
      try {
        if (!context) {
          context = new AudioContextClass({ latencyHint: "interactive" });
          masterGain = context.createGain();
          masterGain.gain.value = 0;
          masterGain.connect(context.destination);
        }
        await context.resume();
        if (context.state !== "running") return;
        enabled = true;
        masterGain.gain.cancelScheduledValues(context.currentTime);
        masterGain.gain.setTargetAtTime(.42, context.currentTime, .08);
        paintButton();
        chime("tap");
      } catch (_error) {
        enabled = false;
        paintButton();
        announce("پخش صدا در این مرورگر در دسترس نیست؛ می‌تونی تجربه رو بی‌صدا ادامه بدی.");
      }
    }

    return { toggle, chime, paintButton };
  })();

  const sky = (() => {
    const canvas = $("#sky-canvas");
    const context = canvas && typeof canvas.getContext === "function" ? canvas.getContext("2d", { alpha: true }) : null;
    const reducedMotionQuery = typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-reduced-motion: reduce)")
      : null;
    let reducedMotion = Boolean(reducedMotionQuery && reducedMotionQuery.matches);
    let visible = !document.hidden;
    let frameHandle = 0;
    let width = 0;
    let height = 0;
    let dpr = 1;
    let lastFrame = 0;
    let mode = { state: "WAITING", scene: "waiting", secondsLeft: 60, revealElapsed: 0 };
    let stars = [];
    let motes = [];
    let petals = [];

    function random(min, max) { return min + Math.random() * (max - min); }
    function wrap(value, size) { return ((value % size) + size) % size; }
    function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }

    function resize() {
      if (!canvas || !context) return;
      width = Math.max(1, window.innerWidth);
      height = Math.max(1, window.innerHeight);
      dpr = Math.min(window.devicePixelRatio || 1, width < 600 ? 1.35 : 1.6);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);

      const starCount = clamp(Math.round((width * height) / 5_300), 48, 122);
      const moteCount = clamp(Math.round((width * height) / 5_600), 38, 90);
      stars = Array.from({ length: starCount }, () => ({
        x: random(0, width),
        y: random(0, height),
        radius: random(.45, 1.25),
        alpha: random(.22, .74),
        phase: random(0, Math.PI * 2),
        speed: random(.32, 1.18),
        tint: Math.random() > .72 ? "232,197,138" : "255,214,231"
      }));
      motes = Array.from({ length: moteCount }, () => ({
        x: random(0, width),
        y: random(0, height),
        radius: random(.55, 1.6),
        vx: random(-3.3, 3.3),
        vy: random(-5.2, -1.1),
        phase: random(0, Math.PI * 2),
        tint: Math.random() > .62 ? "232,197,138" : "241,138,184"
      }));
      petals = Array.from({ length: 16 }, () => ({
        x: random(-.05 * width, 1.05 * width),
        y: random(-height, height),
        length: random(5, 10),
        width: random(2.2, 4.1),
        vx: random(-7, 7),
        vy: random(9, 23),
        spin: random(-.42, .42),
        angle: random(0, Math.PI * 2),
        phase: random(0, Math.PI * 2)
      }));
      render(performance.now());
      requestFrame();
    }

    function drawStars(timeSeconds, deltaSeconds) {
      const still = reducedMotion || (mode.state === "FINAL_COUNTDOWN" && mode.secondsLeft <= 1);
      const quiet = mode.state === "FINAL_COUNTDOWN" && mode.secondsLeft <= 2;
      stars.forEach(star => {
        if (!still) {
          const activity = quiet ? .16 : 1;
          star.x += Math.sin(timeSeconds * .08 + star.phase) * deltaSeconds * .6 * activity;
          star.y += Math.cos(timeSeconds * .06 + star.phase) * deltaSeconds * .38 * activity;
        }
        star.x = wrap(star.x, width);
        star.y = wrap(star.y, height);
        const twinkle = still ? 1 : quiet
          ? .9 + .1 * Math.sin(timeSeconds * star.speed + star.phase)
          : .66 + .34 * Math.sin(timeSeconds * star.speed + star.phase);
        context.globalAlpha = star.alpha * twinkle;
        context.fillStyle = `rgb(${star.tint})`;
        context.beginPath();
        context.arc(star.x, star.y, star.radius, 0, Math.PI * 2);
        context.fill();
        if (star.radius > 1.12 && twinkle > .89) {
          context.globalAlpha = star.alpha * .16;
          context.fillRect(star.x - 3, star.y - .35, 6, .7);
          context.fillRect(star.x - .35, star.y - 3, .7, 6);
        }
      });
      context.globalAlpha = 1;
    }

    function drawMotes(timeSeconds, deltaSeconds) {
      const still = reducedMotion || (mode.state === "FINAL_COUNTDOWN" && mode.secondsLeft <= 1);
      const quiet = mode.state === "FINAL_COUNTDOWN" && mode.secondsLeft <= 2;
      const calm = mode.scene === "letter" || mode.scene === "ending";
      motes.forEach(mote => {
        if (!still) {
          const driftScale = (calm ? .24 : 1) * (quiet ? .16 : 1);
          mote.x += mote.vx * deltaSeconds * driftScale + Math.sin(timeSeconds * .2 + mote.phase) * deltaSeconds * .5;
          mote.y += mote.vy * deltaSeconds * driftScale;
        }
        mote.x = wrap(mote.x, width);
        mote.y = wrap(mote.y, height);
        const pulse = still ? .56 : quiet
          ? .54 + .08 * (Math.sin(timeSeconds * .24 + mote.phase) + 1) / 2
          : .36 + .3 * (Math.sin(timeSeconds * .48 + mote.phase) + 1) / 2;
        context.globalAlpha = pulse * (calm ? .45 : .85);
        context.fillStyle = `rgb(${mote.tint})`;
        context.beginPath();
        context.arc(mote.x, mote.y, mote.radius, 0, Math.PI * 2);
        context.fill();
      });
      context.globalAlpha = 1;
    }

    function heartBlend() {
      if (mode.state === "FINAL_COUNTDOWN") return clamp((60 - mode.secondsLeft) / 54, .05, .82);
      if (mode.state === "REVEALED" && mode.scene === "reveal") return clamp(mode.revealElapsed / 2_800, .12, 1);
      return 0;
    }

    function drawHeart(timeSeconds) {
      const blend = heartBlend();
      if (!blend) return;
      const centerX = width * .5;
      const centerY = height * (mode.scene === "reveal" ? .405 : .41);
      const spread = Math.min(width, height) * .0054;
      const count = width < 500 ? 58 : 84;
      const still = reducedMotion || (mode.state === "FINAL_COUNTDOWN" && mode.secondsLeft <= 1);
      const quiet = mode.state === "FINAL_COUNTDOWN" && mode.secondsLeft <= 2;
      const shimmer = still ? 0 : Math.sin(timeSeconds * 1.3) * (quiet ? .003 : .018);
      const alpha = mode.state === "FINAL_COUNTDOWN"
        ? .13 + blend * .34
        : clamp(mode.revealElapsed / 2_400, .16, .6);
      for (let index = 0; index < count; index += 1) {
        const angle = (Math.PI * 2 * index) / count;
        const heartX = 16 * Math.pow(Math.sin(angle), 3);
        const heartY = 13 * Math.cos(angle) - 5 * Math.cos(2 * angle) - 2 * Math.cos(3 * angle) - Math.cos(4 * angle);
        const orbitRadius = Math.min(width, height) * (.075 + (index % 7) * .003);
        const orbitX = Math.cos(angle) * orbitRadius;
        const orbitY = Math.sin(angle) * orbitRadius;
        const amount = clamp(blend + shimmer, 0, 1);
        const x = centerX + orbitX * (1 - amount) + heartX * spread * amount;
        const y = centerY + orbitY * (1 - amount) - heartY * spread * amount;
        const radius = .65 + ((index * 13) % 10) / 12;
        context.globalAlpha = alpha * (.58 + .42 * (Math.sin(timeSeconds * .8 + index) + 1) / 2);
        context.fillStyle = index % 4 === 0 ? "#E8C58A" : "#FFD6E7";
        context.beginPath();
        context.arc(x, y, radius, 0, Math.PI * 2);
        context.fill();
      }
      context.globalAlpha = 1;
    }

    function drawArcs(timeSeconds) {
      const reveal = mode.state === "REVEALED" && mode.scene === "reveal";
      const final = mode.state === "FINAL_COUNTDOWN" && mode.secondsLeft <= 42;
      const ending = mode.scene === "ending";
      if (!reveal && !final && !ending) return;
      const progress = reveal ? clamp(mode.revealElapsed / 2_800, 0, 1) : final ? clamp((42 - mode.secondsLeft) / 36, .04, .72) : .18;
      const still = reducedMotion || (mode.state === "FINAL_COUNTDOWN" && mode.secondsLeft <= 1);
      const quiet = mode.state === "FINAL_COUNTDOWN" && mode.secondsLeft <= 2;
      const movement = still ? 0 : Math.sin(timeSeconds * .12) * (quiet ? .012 : .07);
      const centerX = width * .5;
      const centerY = height * .405;
      const radiusX = Math.min(width, height) * (.16 + movement);
      const radiusY = radiusX * .72;
      context.lineWidth = .65;
      for (let index = 0; index < 3; index += 1) {
        context.globalAlpha = (ending ? .075 : .04 + progress * .14) * (1 - index * .2);
        context.strokeStyle = index === 1 ? "#E8C58A" : "#F18AB8";
        context.beginPath();
        context.ellipse(centerX, centerY, radiusX + index * 19, radiusY + index * 13, (index - 1) * .22 + movement, .2 + index * .45, Math.PI * (1.38 + index * .12));
        context.stroke();
      }
      context.globalAlpha = 1;
    }

    function drawPetals(timeSeconds) {
      if (mode.state !== "REVEALED" || mode.scene !== "reveal" || mode.revealElapsed < 1_250) return;
      const reveal = clamp((mode.revealElapsed - 1_250) / 2_500, 0, 1);
      const still = reducedMotion;
      petals.forEach((petal, index) => {
        const x = still ? petal.x : wrap(petal.x + petal.vx * timeSeconds + Math.sin(timeSeconds * .25 + petal.phase) * 17, width);
        const y = still ? wrap(petal.y, height) : wrap(petal.y + petal.vy * timeSeconds, height + 50) - 25;
        const rotation = still ? petal.angle : petal.angle + petal.spin * timeSeconds;
        const alpha = reveal * (.23 + .16 * (Math.sin(timeSeconds * .4 + petal.phase) + 1) / 2);
        context.save();
        context.translate(x, y);
        context.rotate(rotation);
        context.globalAlpha = alpha;
        context.fillStyle = index % 3 === 0 ? "#E8C58A" : "#F18AB8";
        context.beginPath();
        context.moveTo(0, -petal.length / 2);
        context.quadraticCurveTo(petal.width * 1.1, -petal.length * .12, 0, petal.length / 2);
        context.quadraticCurveTo(-petal.width * 1.1, -petal.length * .12, 0, -petal.length / 2);
        context.fill();
        context.restore();
      });
      context.globalAlpha = 1;
    }

    function render(timestamp) {
      if (!canvas || !context || !width || !height) return;
      const seconds = timestamp / 1000;
      const delta = lastFrame ? clamp((timestamp - lastFrame) / 1000, 0, .04) : 0;
      lastFrame = timestamp;
      context.clearRect(0, 0, width, height);
      drawStars(seconds, delta);
      drawMotes(seconds, delta);
      drawArcs(seconds);
      drawHeart(seconds);
      drawPetals(seconds);
    }

    function shouldAnimate() {
      if (!visible || reducedMotion) return false;
      if (mode.state === "FINAL_COUNTDOWN" && mode.secondsLeft <= 1) return false;
      if (mode.state === "WAITING" || mode.state === "FINAL_COUNTDOWN") return true;
      return mode.scene === "reveal" || mode.scene === "ending";
    }

    function frame(timestamp) {
      frameHandle = 0;
      render(timestamp);
      if (shouldAnimate()) frameHandle = window.requestAnimationFrame(frame);
    }

    function requestFrame() {
      if (!context || !visible) return;
      if (frameHandle) window.cancelAnimationFrame(frameHandle);
      frameHandle = window.requestAnimationFrame(frame);
    }

    function setState(next) {
      mode = { ...mode, ...next };
      if (!context) return;
      if (shouldAnimate()) requestFrame();
      else {
        if (frameHandle) window.cancelAnimationFrame(frameHandle);
        frameHandle = 0;
        render(performance.now());
      }
    }

    function pause() {
      visible = false;
      if (frameHandle) window.cancelAnimationFrame(frameHandle);
      frameHandle = 0;
    }

    function resume() {
      visible = !document.hidden;
      lastFrame = 0;
      if (shouldAnimate()) requestFrame();
      else render(performance.now());
    }

    if (reducedMotionQuery) {
      const onMotionPreference = event => {
        reducedMotion = event.matches;
        lastFrame = 0;
        if (shouldAnimate()) requestFrame();
        else {
          if (frameHandle) window.cancelAnimationFrame(frameHandle);
          frameHandle = 0;
          render(performance.now());
        }
      };
      if (typeof reducedMotionQuery.addEventListener === "function") reducedMotionQuery.addEventListener("change", onMotionPreference);
      else if (typeof reducedMotionQuery.addListener === "function") reducedMotionQuery.addListener(onMotionPreference);
    }

    return { resize, setState, pause, resume };
  })();

  function setupDeveloperTools() {
    if (!developerToolsEnabled || !devPanel) return;
    devPanel.hidden = false;
    $$('[data-dev-stage]', devPanel).forEach(button => {
      button.addEventListener("click", () => {
        const stage = button.dataset.devStage;
        const offsets = {
          waiting: -10 * 60 * SECOND,
          final: -42 * SECOND,
          reveal: 0,
          letter: 30 * SECOND,
          ending: 30 * SECOND
        };
        if (!(stage in offsets)) return;
        simulationClock = { epoch: targetTimestamp + offsets[stage], startedAt: Date.now() };
        developmentProgress = null;
        lastFinalMessage = -1;
        lastRevealLine = -2;
        if (stage === "letter" || stage === "ending") {
          developmentProgress = {
            unlocked: true,
            scene: stage,
            revealStartedAt: targetTimestamp
          };
        }
        updateAndSchedule();
      });
    });
  }

  function initialize() {
    enableMaterialSymbolsWhenAvailable();
    void enableOptionalDoranFont();
    sound.paintButton();
    if (soundButton) soundButton.addEventListener("click", () => { void sound.toggle(); });
    if (continueButton) continueButton.addEventListener("click", () => moveToRevealedScene("ending", true));
    if (readAgainButton) readAgainButton.addEventListener("click", () => moveToRevealedScene("letter", true));

    setupDeveloperTools();
    sky.resize();
    window.addEventListener("resize", sky.resize, { passive: true });
    window.addEventListener("orientationchange", sky.resize, { passive: true });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        if (scheduledUpdate) window.clearTimeout(scheduledUpdate);
        scheduledUpdate = 0;
        sky.pause();
      } else {
        sky.resume();
        updateAndSchedule();
      }
    });
    window.addEventListener("pageshow", () => {
      sky.resume();
      updateAndSchedule();
    });
    window.addEventListener("pagehide", () => {
      if (scheduledUpdate) window.clearTimeout(scheduledUpdate);
      scheduledUpdate = 0;
      sky.pause();
    });
    window.addEventListener("focus", updateAndSchedule);

    try {
      targetTimestamp = wallTimeToEpoch(APP_CONFIG.target, APP_CONFIG.target.timeZone);
      updateAndSchedule();
    } catch (error) {
      showTimerError(error);
    }
  }

  initialize();
})();
