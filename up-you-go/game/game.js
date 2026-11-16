/* Up You Go — vanilla JS + Canvas2D. Part of dailygametree.com.
 * The world is chosen by the page URL: ?mode=ember (Ember Peaks),
 * ?mode=frostbite (Frostbite Summit), anything else for Cloud Kingdom. */

(function () {
  "use strict";

  // ---------------------------------------------------------------------
  // DOM references
  // ---------------------------------------------------------------------
  const canvas = document.getElementById("gameCanvas");
  const ctx = canvas.getContext("2d");
  const startScreen = document.getElementById("start-screen");
  const gameoverScreen = document.getElementById("gameover-screen");
  const startBtn = document.getElementById("start-btn");
  const restartBtn = document.getElementById("restart-btn");
  const finalScoreEl = document.getElementById("final-score");
  const bestScoreEl = document.getElementById("best-score");
  const hud = document.getElementById("hud");
  const scoreEl = document.getElementById("score");
  const hudWorldEl = document.getElementById("hud-world");
  const startWorldTag = document.getElementById("start-world-tag");
  const muteBtn = document.getElementById("mute-btn");
  const muteWaves = muteBtn.querySelector(".mute-waves");
  const muteSlash = muteBtn.querySelector(".mute-slash");

  // ---------------------------------------------------------------------
  // Sound — tiny SFX synthesized on the fly with the Web Audio API, no
  // external audio files (keeps the whole game to these three files).
  // Every sound is a short oscillator and/or filtered-noise burst with a
  // fast envelope; nothing is ever loaded.
  //
  // The AudioContext is created lazily on the first user gesture, since
  // browsers refuse to make sound before one. Every sfx.* call checks
  // the mute flag first, and gameplay sounds only ever play while
  // state === "playing" (see landOn()) — the idle "attract mode" bounce
  // behind the menus stays silent so the game doesn't make noise before
  // the player has actually started.
  // ---------------------------------------------------------------------
  const SOUND_MUTED_KEY = "uyg_muted";
  let muted = false;
  try {
    muted = localStorage.getItem(SOUND_MUTED_KEY) === "1";
  } catch (e) {}

  let audioCtx = null;
  function ensureAudio() {
    if (audioCtx) return audioCtx;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      audioCtx = Ctx ? new Ctx() : null;
    } catch (e) {
      audioCtx = null;
    }
    return audioCtx;
  }
  function resumeAudio() {
    const ctx = ensureAudio();
    if (ctx && ctx.state === "suspended") ctx.resume().catch(() => {});
  }
  window.addEventListener("pointerdown", resumeAudio, { once: true });
  window.addEventListener("keydown", resumeAudio, { once: true });

  function playTone({ freq = 440, endFreq = null, type = "sine", duration = 0.12, volume = 0.18, attack = 0.005, delay = 0 }) {
    if (muted) return;
    const ctx = ensureAudio();
    if (!ctx) return;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (endFreq) osc.frequency.exponentialRampToValueAtTime(Math.max(1, endFreq), t0 + duration);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(volume, t0 + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + duration + 0.02);
  }

  function playNoise({ duration = 0.15, volume = 0.16, filterFreq = 1200, delay = 0 }) {
    if (muted) return;
    const ctx = ensureAudio();
    if (!ctx) return;
    const t0 = ctx.currentTime + delay;
    const bufferSize = Math.max(1, Math.floor(ctx.sampleRate * duration));
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = filterFreq;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(volume, t0 + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    noise.connect(filter).connect(gain).connect(ctx.destination);
    noise.start(t0);
    noise.stop(t0 + duration + 0.02);
  }

  const sfx = {
    jump() {
      playTone({ freq: 320, endFreq: 520, type: "sine", duration: 0.11, volume: 0.16 });
    },
    spring() {
      playTone({ freq: 260, endFreq: 720, type: "triangle", duration: 0.18, volume: 0.22 });
    },
    vent() {
      playTone({ freq: 180, endFreq: 640, type: "sawtooth", duration: 0.5, volume: 0.12 });
      playNoise({ duration: 0.45, volume: 0.05, filterFreq: 2200 });
    },
    gust() {
      playNoise({ duration: 0.22, volume: 0.2, filterFreq: 900 });
      playTone({ freq: 500, endFreq: 220, type: "square", duration: 0.14, volume: 0.08 });
    },
    crumble() {
      playNoise({ duration: 0.18, volume: 0.14, filterFreq: 650 });
    },
    gameover() {
      playTone({ freq: 420, endFreq: 90, type: "sawtooth", duration: 0.5, volume: 0.18 });
    },
    click() {
      playTone({ freq: 680, type: "square", duration: 0.045, volume: 0.09 });
    },
    unlock() {
      playTone({ freq: 520, type: "triangle", duration: 0.12, volume: 0.16 });
      playTone({ freq: 780, type: "triangle", duration: 0.16, volume: 0.16, delay: 0.09 });
    },
  };

  // ---------------------------------------------------------------------
  // Music — one looping background track per world, synced to actual
  // gameplay: starts when a run begins, stops at game over, same as the
  // idle-silence rule the SFX above follow. Respects the mute toggle.
  //
  // Real audio files under music/, one per world id, loaded relative
  // to this script so they work the same locally and once deployed.
  // ---------------------------------------------------------------------
  const MUSIC_SRC = {
    "cloud-kingdom": "./music/cloud-kingdom.mp3",
    "world-ember-peaks": "./music/world-ember-peaks.mp3",
    "world-frostbite-summit": "./music/world-frostbite-summit.mp3",
  };
  const musicVolume = 0.35;
  const musicElements = {};
  function musicFor(id) {
    if (!musicElements[id] && MUSIC_SRC[id]) {
      try {
        const el = new Audio(MUSIC_SRC[id]);
        el.loop = true;
        el.volume = musicVolume;
        musicElements[id] = el;
      } catch (e) {
        console.warn("[music] failed to create track for " + id, e);
      }
    }
    return musicElements[id];
  }
  function playMusicFor(worldId) {
    stopMusic();
    if (muted) return;
    const el = musicFor(worldId);
    if (!el) return;
    try {
      el.currentTime = 0;
    } catch (e) {}
    el.play().catch(() => {
      /* blocked until a user gesture, or track unavailable — silent no-op */
    });
  }
  function stopMusic() {
    for (const id in musicElements) musicElements[id].pause();
  }

  function updateMuteButton() {
    muteWaves.style.display = muted ? "none" : "";
    muteSlash.style.display = muted ? "" : "none";
    muteBtn.setAttribute("aria-label", muted ? "Unmute sound" : "Mute sound");
    muteBtn.setAttribute("aria-pressed", muted ? "true" : "false");
  }
  muteBtn.addEventListener("click", () => {
    muted = !muted;
    try {
      localStorage.setItem(SOUND_MUTED_KEY, muted ? "1" : "0");
    } catch (e) {}
    updateMuteButton();
    if (muted) {
      stopMusic();
    } else if (state === "playing") {
      playMusicFor(currentWorldId);
    }
  });
  updateMuteButton();

  // ---------------------------------------------------------------------
  // Virtual resolution — fixed logical width, height follows the real
  // aspect ratio of the screen so the game fills it without distortion.
  // ---------------------------------------------------------------------
  const VIRTUAL_W = 400;
  let VIRTUAL_H = 700;
  let dpr = Math.max(1, Math.min(2.5, window.devicePixelRatio || 1));

  function resizeCanvas() {
    const wrap = document.getElementById("game-wrap");
    const displayW = wrap.clientWidth;
    const displayH = wrap.clientHeight;

    VIRTUAL_H = Math.max(500, Math.round(VIRTUAL_W * (displayH / displayW)));

    dpr = Math.max(1, Math.min(2.5, window.devicePixelRatio || 1));
    canvas.width = Math.round(displayW * dpr);
    canvas.height = Math.round(displayH * dpr);
    canvas.style.width = displayW + "px";
    canvas.style.height = displayH + "px";

    const scale = canvas.width / VIRTUAL_W;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
  }
  window.addEventListener("resize", resizeCanvas);
  window.addEventListener("orientationchange", resizeCanvas);

  // ---------------------------------------------------------------------
  // Input — keyboard + touch/mouse (left half / right half of screen)
  // ---------------------------------------------------------------------
  const input = { left: false, right: false };

  window.addEventListener("keydown", (e) => {
    if (e.code === "ArrowLeft" || e.code === "KeyA") input.left = true;
    if (e.code === "ArrowRight" || e.code === "KeyD") input.right = true;
    if (e.code === "Space" && (state === "start" || state === "gameover")) {
      e.preventDefault();
      startGame();
    }
  });
  window.addEventListener("keyup", (e) => {
    if (e.code === "ArrowLeft" || e.code === "KeyA") input.left = false;
    if (e.code === "ArrowRight" || e.code === "KeyD") input.right = false;
  });

  const activePointers = new Map();
  function updatePointerSides() {
    let left = false;
    let right = false;
    const rect = canvas.getBoundingClientRect();
    const half = rect.left + rect.width / 2;
    for (const x of activePointers.values()) {
      if (x < half) left = true;
      else right = true;
    }
    input.left = left;
    input.right = right;
  }
  canvas.addEventListener("pointerdown", (e) => {
    activePointers.set(e.pointerId, e.clientX);
    updatePointerSides();
  });
  canvas.addEventListener("pointermove", (e) => {
    if (activePointers.has(e.pointerId)) {
      activePointers.set(e.pointerId, e.clientX);
      updatePointerSides();
    }
  });
  function releasePointer(e) {
    activePointers.delete(e.pointerId);
    updatePointerSides();
  }
  canvas.addEventListener("pointerup", releasePointer);
  canvas.addEventListener("pointercancel", releasePointer);
  canvas.addEventListener("pointerleave", releasePointer);

  // ---------------------------------------------------------------------
  // Game constants — tweak these to change how the game feels
  // ---------------------------------------------------------------------
  const GRAVITY = 1500; // px/s^2 (virtual units)
  const JUMP_VELOCITY = -680;
  const SPRING_VELOCITY = -1050;
  const MOVE_ACCEL = 2600;
  const MAX_VX = 340;
  const FRICTION = 1600;
  const PLAYER_W = 44;
  const PLAYER_H = 44;

  const PLATFORM_W = 68;
  const PLATFORM_H = 18;
  const PLATFORM_MARGIN = 40; // keeps platforms fully clear of the side edges

  // Max horizontal distance (px) a newly spawned platform may sit from the
  // previous one. Chosen so that even the hardest (largest) vertical gap is
  // always reachable within the player's jump air-time at max run speed —
  // this is what keeps the game from ever generating an impossible jump,
  // in every world (world-specific tiles change what happens AFTER you
  // land, never the base placement rules).
  const MAX_X_STEP = 150;

  const SCROLL_LINE = 0.42; // fraction of screen height that triggers scroll

  // Ember Peaks' updraft vent: near-zero gravity + steady climb for a bit.
  const VENT_DURATION = 1.05; // seconds
  const VENT_GRAVITY_SCALE = 0.12;
  const VENT_RISE_VY = -260;

  // Frostbite Summit's wind gust: a hard horizontal shove on landing.
  const GUST_VX = 480;

  // ---------------------------------------------------------------------
  // Worlds
  //
  // ---------------------------------------------------------------------
  const FREE_WORLD_ID = "cloud-kingdom";
  const WORLDS = {
    "cloud-kingdom": {
      id: "cloud-kingdom",
      name: "Cloud Kingdom",
      free: true,
      dark: false,
      bgTop: "#bfe9ff",
      bgBottom: "#eaf7ff",
      atmosphere: "clouds",
      ability: "The original — no gimmicks, just good bouncing.",
      tiles: {
        normalFill: "#63d471",
        normalEdge: "#3ba852",
        movingFill: "#5aa9ff",
        movingEdge: "#3a7fd6",
        breakableFill: "#d9a066",
        breakableEdge: "#a9713f",
      },
      specialTile: null,
    },
    "world-ember-peaks": {
      id: "world-ember-peaks",
      name: "Ember Peaks",
      free: true,
      dark: true,
      bgTop: "#2b1210",
      bgBottom: "#6b2a12",
      atmosphere: "embers",
      ability: "Updraft vents launch you into a soaring, low-gravity climb.",
      tiles: {
        normalFill: "#6b4a3a",
        normalEdge: "#3d2a20",
        movingFill: "#ff8c42",
        movingEdge: "#b8501a",
        breakableFill: "#8a7a72",
        breakableEdge: "#5a4d47",
      },
      specialTile: "vent",
      specialFill: "#ff5a1f",
      specialEdge: "#ffcf7a",
    },
    "world-frostbite-summit": {
      id: "world-frostbite-summit",
      name: "Frostbite Summit",
      free: true,
      dark: false,
      bgTop: "#dff3ff",
      bgBottom: "#ffffff",
      atmosphere: "snow",
      ability: "Wind-gust tiles shove you hard sideways — great for wide gaps.",
      tiles: {
        normalFill: "#eaf6ff",
        normalEdge: "#b8dff0",
        movingFill: "#8fd9ff",
        movingEdge: "#4fb8e0",
        breakableFill: "#cfeeff",
        breakableEdge: "#7fc4e0",
      },
      specialTile: "gust",
      specialFill: "#2fb6c9",
      specialEdge: "#1a7d8c",
    },
  };

  const MODE = new URLSearchParams(location.search).get("mode");
  const currentWorldId = MODE === "ember" ? "world-ember-peaks" : MODE === "frostbite" ? "world-frostbite-summit" : FREE_WORLD_ID;

  function currentWorld() {
    return WORLDS[currentWorldId];
  }

  // ---------------------------------------------------------------------
  // Persistent high score
  // ---------------------------------------------------------------------
  const HIGH_SCORE_KEY = currentWorldId === FREE_WORLD_ID ? "upYouGoHighScore" : "upYouGoHighScore_" + currentWorldId;
  function loadHighScore() {
    try {
      return parseInt(localStorage.getItem(HIGH_SCORE_KEY), 10) || 0;
    } catch (e) {
      return 0;
    }
  }
  function saveHighScore(v) {
    try {
      localStorage.setItem(HIGH_SCORE_KEY, String(v));
    } catch (e) {
      /* storage unavailable — ignore */
    }
  }
  let highScore = loadHighScore();

  // ---------------------------------------------------------------------
  // Game state
  // ---------------------------------------------------------------------
  let state = "start"; // 'start' | 'playing' | 'gameover'
  let player, platforms, cameraY, score, atmosphere, particles;
  let lastTime = 0;

  const START_PLATFORM_Y = () => VIRTUAL_H - 60;

  function newPlayer() {
    // Rest right on top of the guaranteed starting platform (see
    // generateInitialPlatforms) with a tiny downward velocity, so the very
    // first bounce is a normal, full-power jump — identical physics to
    // every jump that follows, instead of a special-cased weaker hop.
    const platY = START_PLATFORM_Y();
    return {
      x: VIRTUAL_W / 2,
      y: platY - PLATFORM_H / 2 - PLAYER_H / 2 - 1,
      vx: 0,
      vy: 40,
      facing: 1,
      squash: 1, // 1 = normal, <1 = squashed on landing
      thermalT: 0, // Ember Peaks vent boost time remaining
    };
  }

  function makePlatform(x, y, type) {
    const p = { x, y, w: PLATFORM_W, h: PLATFORM_H, type };
    if (type === "moving" || type === "gust") {
      p.speed = type === "gust" ? 0 : 60 + Math.random() * 60;
      p.dir = Math.random() < 0.5 ? -1 : 1;
      p.minX = PLATFORM_W / 2 + 10;
      p.maxX = VIRTUAL_W - PLATFORM_W / 2 - 10;
    }
    if (type === "normal" && Math.random() < 0.16) {
      p.hasSpring = true;
    }
    if (type === "breakable") {
      p.broken = false;
      p.breakT = 0;
    }
    return p;
  }

  function pickPlatformType(difficulty, world) {
    // difficulty: 0 (start) .. 1 (very hard), grows with score
    const movingChance = 0.12 + difficulty * 0.28;
    const breakableChance = 0.08 + difficulty * 0.22;
    const specialChance = world.specialTile ? 0.14 : 0;
    const r = Math.random();
    if (r < breakableChance) return "breakable";
    if (r < breakableChance + movingChance) return "moving";
    if (r < breakableChance + movingChance + specialChance) return world.specialTile;
    return "normal";
  }

  function difficultyForScore(s) {
    return Math.min(1, s / 6000);
  }

  // Vertical gap between consecutive platforms. Capped well below the
  // player's max jump rise (v^2 / 2g ≈ 154px at JUMP_VELOCITY=-680) so a
  // plain, un-boosted jump can always cover it — springs and world
  // abilities then act as a bonus rather than a requirement.
  function pickGap(difficulty) {
    const minGap = 55 + difficulty * 10; // 55 - 65
    const maxGap = 90 + difficulty * 30; // 90 - 120
    return minGap + Math.random() * (maxGap - minGap);
  }

  // Horizontal position of the next platform, stepped a bounded distance
  // from the previous one (reflecting off the side margins) rather than
  // placed fully independently. Combined with pickGap()'s cap, this keeps
  // every jump reachable within the player's air time at max run speed.
  function nextPlatformX(lastX) {
    let x = lastX + (Math.random() * 2 - 1) * MAX_X_STEP;
    const min = PLATFORM_MARGIN;
    const max = VIRTUAL_W - PLATFORM_MARGIN;
    if (x < min) x = min + (min - x);
    if (x > max) x = max - (x - max);
    return Math.max(min, Math.min(max, x));
  }

  function topmostPlatform(list) {
    let top = null;
    for (const p of list) if (!top || p.y < top.y) top = p;
    return top;
  }

  function generateInitialPlatforms(world) {
    const list = [];
    const startX = VIRTUAL_W / 2;
    const startY = START_PLATFORM_Y();
    list.push(makePlatform(startX, startY, "normal"));
    let y = startY;
    let x = startX;
    while (y > -200) {
      y -= pickGap(0);
      x = nextPlatformX(x);
      list.push(makePlatform(x, y, pickPlatformType(0, world)));
    }
    return list;
  }

  function maybeSpawnPlatforms() {
    const world = currentWorld();
    const difficulty = difficultyForScore(score);
    const topP = topmostPlatform(platforms);
    let top = topP.y;
    let x = topP.x;
    while (top > cameraY - 150) {
      top -= pickGap(difficulty);
      x = nextPlatformX(x);
      platforms.push(makePlatform(x, top, pickPlatformType(difficulty, world)));
    }
  }

  function generateAtmosphere(kind) {
    const list = [];
    for (let i = 0; i < 8; i++) {
      list.push({
        x: Math.random() * VIRTUAL_W,
        y: Math.random() * VIRTUAL_H,
        scale: 0.5 + Math.random() * 0.9,
        speed: 6 + Math.random() * 10,
        sway: Math.random() * Math.PI * 2,
      });
    }
    return { kind, list };
  }

  function resetGame() {
    const world = currentWorld();
    player = newPlayer();
    platforms = generateInitialPlatforms(world);
    cameraY = 0;
    score = 0;
    atmosphere = generateAtmosphere(world.atmosphere);
    particles = [];
    document.getElementById("game-wrap").classList.toggle("dark-world", world.dark);
    hudWorldEl.textContent = world.name;
  }

  function startGame() {
    sfx.click();
    resetGame();
    state = "playing";
    startScreen.classList.add("hidden");
    gameoverScreen.classList.add("hidden");
    hud.classList.remove("hidden");
    playMusicFor(currentWorldId);
  }

  function endGame() {
    state = "gameover";
    sfx.gameover();
    stopMusic();
    hud.classList.add("hidden");
    const finalScore = Math.floor(score);
    if (finalScore > highScore) {
      highScore = finalScore;
      saveHighScore(highScore);
    }
    finalScoreEl.textContent = "Score: " + finalScore;
    bestScoreEl.textContent = "Best: " + highScore;
    gameoverScreen.classList.remove("hidden");
    resetGame(); // fresh idle bounce scene behind the game-over panel, rather than the frozen death frame
  }

  startBtn.addEventListener("click", startGame);
  restartBtn.addEventListener("click", startGame);


  // ---------------------------------------------------------------------
  // Update
  // ---------------------------------------------------------------------
  function updatePlayer(dt) {
    // Horizontal movement
    if (input.left && !input.right) {
      player.vx -= MOVE_ACCEL * dt;
      player.facing = -1;
    } else if (input.right && !input.left) {
      player.vx += MOVE_ACCEL * dt;
      player.facing = 1;
    } else {
      const drop = FRICTION * dt;
      if (player.vx > 0) player.vx = Math.max(0, player.vx - drop);
      else if (player.vx < 0) player.vx = Math.min(0, player.vx + drop);
    }
    player.vx = Math.max(-MAX_VX, Math.min(MAX_VX, player.vx));
    player.x += player.vx * dt;

    // Wrap around screen edges
    const half = PLAYER_W / 2;
    if (player.x < -half) player.x = VIRTUAL_W + half;
    if (player.x > VIRTUAL_W + half) player.x = -half;

    // Vertical movement — Ember Peaks' vent tile cuts gravity way down for
    // a short soaring climb instead of the usual jump arc.
    const g = player.thermalT > 0 ? GRAVITY * VENT_GRAVITY_SCALE : GRAVITY;
    player.vy += g * dt;
    if (player.thermalT > 0) {
      player.thermalT = Math.max(0, player.thermalT - dt);
    }
    player.y += player.vy * dt;

    // Ease squash back to normal
    player.squash += (1 - player.squash) * Math.min(1, dt * 10);
  }

  function checkPlatformCollisions(dt) {
    if (player.vy <= 0) return; // only land while falling
    const feetY = player.y + PLAYER_H / 2;
    const prevFeetY = feetY - player.vy * dt; // where the feet were last frame
    for (const p of platforms) {
      if (p.type === "breakable" && p.broken) continue;
      // Standard AABB overlap: sum of half-widths, so any visual overlap
      // between the player's feet and the platform counts as a landing.
      const withinX = Math.abs(player.x - p.x) < p.w / 2 + PLAYER_W / 2;
      const crossing = feetY >= p.y - p.h / 2 && prevFeetY <= p.y + p.h / 2;
      if (withinX && crossing) {
        landOn(p);
        break;
      }
    }
  }

  function landOn(p) {
    // Only make noise for real gameplay bounces, never for the idle
    // "attract mode" bouncing that runs behind the menus (see update()).
    const audible = state === "playing";

    player.squash = 0.55;
    player.y = p.y - p.h / 2 - PLAYER_H / 2;
    spawnBounceParticles(player.x, p.y);

    if (p.type === "vent") {
      player.thermalT = VENT_DURATION;
      player.vy = VENT_RISE_VY;
      if (audible) sfx.vent();
    } else if (p.type === "gust") {
      player.vy = JUMP_VELOCITY * 0.85;
      player.vx = p.dir * GUST_VX;
      player.facing = p.dir;
      if (audible) sfx.gust();
    } else {
      player.vy = p.hasSpring ? SPRING_VELOCITY : JUMP_VELOCITY;
      if (audible) (p.hasSpring ? sfx.spring() : sfx.jump());
    }

    if (p.type === "breakable") {
      p.broken = true;
      p.breakT = 0;
      if (audible) sfx.crumble();
    }
  }

  function updatePlatforms(dt) {
    for (const p of platforms) {
      if (p.type === "moving") {
        p.x += p.speed * p.dir * dt;
        if (p.x < p.minX) {
          p.x = p.minX;
          p.dir = 1;
        } else if (p.x > p.maxX) {
          p.x = p.maxX;
          p.dir = -1;
        }
      }
      if (p.type === "breakable" && p.broken) {
        p.breakT += dt;
      }
    }
    // Remove broken platforms once their crumble animation finishes,
    // and cull anything that has scrolled far below the camera.
    platforms = platforms.filter((p) => {
      if (p.type === "breakable" && p.broken && p.breakT > 0.35) return false;
      if (p.y - cameraY > VIRTUAL_H + 120) return false;
      return true;
    });
  }

  function updateCamera() {
    const screenY = player.y - cameraY;
    const threshold = VIRTUAL_H * SCROLL_LINE;
    if (screenY < threshold) {
      const delta = threshold - screenY;
      cameraY -= delta;
      score = Math.max(score, -cameraY);
    }
  }

  function spawnBounceParticles(x, y) {
    for (let i = 0; i < 6; i++) {
      particles.push({
        x,
        y,
        vx: (Math.random() - 0.5) * 120,
        vy: -Math.random() * 80,
        life: 0.35,
        t: 0,
      });
    }
  }

  function updateParticles(dt) {
    for (const pt of particles) {
      pt.t += dt;
      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;
      pt.vy += 400 * dt;
    }
    particles = particles.filter((pt) => pt.t < pt.life);
  }

  function updateAtmosphere(dt) {
    const kind = atmosphere.kind;
    for (const c of atmosphere.list) {
      if (kind === "clouds") {
        c.y += c.speed * dt * 0.2;
        if (c.y - cameraY > VIRTUAL_H + 40) {
          c.y = cameraY - 40;
          c.x = Math.random() * VIRTUAL_W;
        }
      } else if (kind === "embers") {
        c.y -= c.speed * dt * 1.4;
        c.sway += dt * 2;
        if (c.y - cameraY < -40) {
          c.y = cameraY + VIRTUAL_H + 40;
          c.x = Math.random() * VIRTUAL_W;
        }
      } else if (kind === "snow") {
        c.y += c.speed * dt * 0.9;
        c.sway += dt * 1.5;
        if (c.y - cameraY > VIRTUAL_H + 20) {
          c.y = cameraY - 20;
          c.x = Math.random() * VIRTUAL_W;
        }
      }
    }
  }

  function update(dt) {
    updateAtmosphere(dt); // ambient drift keeps animating on every screen

    if (state === "playing") {
      updatePlayer(dt);
      checkPlatformCollisions(dt);
      updatePlatforms(dt);
      updateCamera();
      updateParticles(dt);
      maybeSpawnPlatforms();

      scoreEl.textContent = Math.floor(score);

      if (player.y - cameraY > VIRTUAL_H + PLAYER_H) {
        endGame();
      }
    } else {
      // Idle "attract mode": with no input the hero just keeps landing on
      // the guaranteed starting platform, so the same physics loop makes
      // it bounce there forever behind the menus — no special-casing
      // needed, the screen just never goes still.
      updatePlayer(dt);
      checkPlatformCollisions(dt);
      updatePlatforms(dt);
      updateParticles(dt);
    }
  }

  // ---------------------------------------------------------------------
  // Drawing
  // ---------------------------------------------------------------------
  function drawBackground() {
    const world = currentWorld();
    const grad = ctx.createLinearGradient(0, 0, 0, VIRTUAL_H);
    grad.addColorStop(0, world.bgTop);
    grad.addColorStop(1, world.bgBottom);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, VIRTUAL_W, VIRTUAL_H);

    const kind = atmosphere.kind;
    for (const c of atmosphere.list) {
      const sy = c.y - cameraY;
      if (kind === "clouds") drawCloud(c.x, sy, c.scale);
      else if (kind === "embers") drawSpeck(c.x + Math.sin(c.sway) * 6, sy, c.scale, "#ffb066", "#ff7a30");
      else if (kind === "snow") drawSpeck(c.x + Math.sin(c.sway) * 8, sy, c.scale * 0.7, "#ffffff", "#cdeeff");
    }
  }

  function drawCloud(x, y, scale) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale, scale);
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.beginPath();
    ctx.ellipse(0, 0, 22, 12, 0, 0, Math.PI * 2);
    ctx.ellipse(16, -4, 14, 10, 0, 0, Math.PI * 2);
    ctx.ellipse(-16, -3, 14, 9, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawSpeck(x, y, scale, fill, glow) {
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = glow;
    ctx.globalAlpha = 0.35;
    ctx.beginPath();
    ctx.ellipse(0, 0, 6 * scale, 6 * scale, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.ellipse(0, 0, 2.6 * scale, 2.6 * scale, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawPlatform(p) {
    const sy = p.y - cameraY;
    if (sy < -40 || sy > VIRTUAL_H + 40) return;

    const world = currentWorld();
    const tiles = world.tiles;

    ctx.save();
    ctx.translate(p.x, sy);

    let breakProgress = 0;
    if (p.type === "breakable" && p.broken) {
      breakProgress = Math.min(1, p.breakT / 0.35);
      ctx.globalAlpha = 1 - breakProgress;
      ctx.translate(0, breakProgress * 18);
    }

    const w = p.w;
    const h = p.h;

    let fill = tiles.normalFill;
    let edge = tiles.normalEdge;
    if (p.type === "moving") {
      fill = tiles.movingFill;
      edge = tiles.movingEdge;
    } else if (p.type === "breakable") {
      fill = tiles.breakableFill;
      edge = tiles.breakableEdge;
    } else if (p.type === "vent" || p.type === "gust") {
      fill = world.specialFill;
      edge = world.specialEdge;
    }

    ctx.fillStyle = edge;
    roundRect(-w / 2, -h / 2 + 3, w, h, 8);
    ctx.fill();
    ctx.fillStyle = fill;
    roundRect(-w / 2, -h / 2, w, h, 8);
    ctx.fill();

    if (p.type === "breakable") {
      ctx.strokeStyle = "rgba(60,40,20,0.55)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(-w * 0.2, -h / 2 + 2);
      ctx.lineTo(-w * 0.05, h / 2 - 2);
      ctx.moveTo(w * 0.15, -h / 2 + 2);
      ctx.lineTo(w * 0.3, h / 2 - 2);
      ctx.stroke();
    }

    if (p.type === "vent") {
      drawVentIcon();
    } else if (p.type === "gust") {
      drawGustIcon(p.dir);
    }

    if (p.hasSpring && !(p.type === "breakable" && p.broken)) {
      drawSpring();
    }

    ctx.restore();
  }

  function drawVentIcon() {
    ctx.strokeStyle = "#fff1d6";
    ctx.lineWidth = 2;
    for (let i = 0; i < 3; i++) {
      const r = 4 + i * 4;
      ctx.beginPath();
      ctx.arc(0, -2, r, Math.PI * 1.15, Math.PI * 1.85);
      ctx.stroke();
    }
  }

  function drawGustIcon(dir) {
    ctx.strokeStyle = "#eafcff";
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(-10 * dir, -2);
    ctx.lineTo(10 * dir, -2);
    ctx.lineTo(4 * dir, -7);
    ctx.moveTo(10 * dir, -2);
    ctx.lineTo(4 * dir, 3);
    ctx.stroke();
  }

  function drawSpring() {
    ctx.strokeStyle = "#666";
    ctx.lineWidth = 3;
    ctx.beginPath();
    const baseY = -PLATFORM_H / 2;
    for (let i = 0; i < 4; i++) {
      const sx = -6 + (i % 2) * 12;
      const y1 = baseY - i * 5;
      const y2 = baseY - (i + 1) * 5;
      ctx.moveTo(sx, y1);
      ctx.lineTo(-sx, y2);
    }
    ctx.stroke();
    ctx.fillStyle = "#999";
    ctx.fillRect(-10, baseY - 22, 20, 4);
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawPlayer() {
    const sy = player.y - cameraY;
    ctx.save();
    ctx.translate(player.x, sy);
    ctx.scale(player.facing, 1);

    const stretch = player.vy < 0 ? 1 + Math.min(0.25, -player.vy / 3000) : 1;
    const squashX = player.squash;
    const squashY = 2 - player.squash;

    ctx.scale(squashX, squashY * stretch);

    // legs
    ctx.fillStyle = "#c23a26";
    ctx.beginPath();
    ctx.ellipse(-10, PLAYER_H * 0.42, 7, 5, 0, 0, Math.PI * 2);
    ctx.ellipse(10, PLAYER_H * 0.42, 7, 5, 0, 0, Math.PI * 2);
    ctx.fill();

    // body
    ctx.fillStyle = "#ff6b57";
    ctx.beginPath();
    ctx.ellipse(0, 0, PLAYER_W / 2, PLAYER_H / 2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#c23a26";
    ctx.lineWidth = 2;
    ctx.stroke();

    // eyes
    const falling = player.vy > 250;
    ctx.fillStyle = "#2b2140";
    ctx.beginPath();
    ctx.ellipse(-8, -4, falling ? 5 : 4, falling ? 6 : 5, 0, 0, Math.PI * 2);
    ctx.ellipse(8, -4, falling ? 5 : 4, falling ? 6 : 5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.ellipse(-6.5, -6, 1.6, 1.6, 0, 0, Math.PI * 2);
    ctx.ellipse(9.5, -6, 1.6, 1.6, 0, 0, Math.PI * 2);
    ctx.fill();

    // mouth
    ctx.strokeStyle = "#2b2140";
    ctx.lineWidth = 2;
    ctx.beginPath();
    if (falling) {
      ctx.ellipse(0, 8, 4, 5, 0, 0, Math.PI * 2);
      ctx.fillStyle = "#8a2418";
      ctx.fill();
    } else {
      ctx.arc(0, 6, 6, 0.15 * Math.PI, 0.85 * Math.PI);
      ctx.stroke();
    }

    // antenna
    ctx.strokeStyle = "#c23a26";
    ctx.beginPath();
    ctx.moveTo(0, -PLAYER_H / 2);
    ctx.quadraticCurveTo(6, -PLAYER_H / 2 - 10, 4, -PLAYER_H / 2 - 14);
    ctx.stroke();
    ctx.fillStyle = "#ffd166";
    ctx.beginPath();
    ctx.ellipse(4, -PLAYER_H / 2 - 14, 3, 3, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  function drawParticles() {
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    for (const pt of particles) {
      const alpha = 1 - pt.t / pt.life;
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.ellipse(pt.x, pt.y - cameraY, 2.5, 2.5, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function draw() {
    ctx.clearRect(0, 0, VIRTUAL_W, VIRTUAL_H);
    drawBackground();
    for (const p of platforms) drawPlatform(p);
    drawParticles();
    drawPlayer();
  }

  // ---------------------------------------------------------------------
  // Main loop
  // ---------------------------------------------------------------------
  function frame(t) {
    if (!lastTime) lastTime = t;
    let dt = (t - lastTime) / 1000;
    lastTime = t;
    dt = Math.min(dt, 1 / 30); // clamp huge gaps (tab switch, etc.)

    update(dt);
    draw();

    requestAnimationFrame(frame);
  }

  // ---------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------
  function boot() {
    resizeCanvas();
    resetGame(); // populate a static scene behind the start screen
    draw();
    startWorldTag.textContent = "Playing in " + currentWorld().name;


    requestAnimationFrame(frame);
  }

  try {
    boot();
  } catch (e) {
    console.error("[Up You Go] boot() failed:", e);
  }
})();
