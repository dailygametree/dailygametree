/* Galactic Defenders — a wave-defense shooter. Vanilla JS + Canvas2D, sound
 * synthesized with the Web Audio API. Part of dailygametree.com.
 * The sector is chosen by the page URL: ?mode=omega for Sector Omega,
 * anything else for Sector Alpha. */
(function () {
  "use strict";

  // ---------------------------------------------------------------------
  // DOM references
  // ---------------------------------------------------------------------
  const canvas = document.getElementById("gameCanvas");
  const ctx = canvas.getContext("2d");
  const gameWrap = document.getElementById("game-wrap");
  const startScreen = document.getElementById("start-screen");
  const gameoverScreen = document.getElementById("gameover-screen");
  const waveBanner = document.getElementById("wave-banner");
  const waveBannerLine1 = document.getElementById("wave-banner-line1");
  const waveBannerLine2 = document.getElementById("wave-banner-line2");
  const startBtn = document.getElementById("start-btn");
  const restartBtn = document.getElementById("restart-btn");
  const startHiscoreEl = document.getElementById("start-hiscore");
  const startSectorTag = document.getElementById("start-sector-tag");
  const finalScoreEl = document.getElementById("final-score");
  const bestScoreEl = document.getElementById("best-score");
  const newHighEl = document.getElementById("new-high");
  const hud = document.getElementById("hud");
  const scoreEl = document.getElementById("score");
  const waveEl = document.getElementById("wave");
  const hiScoreEl = document.getElementById("hi-score");
  const livesEl = document.getElementById("lives");
  const powerupRowEl = document.getElementById("powerup-row");
  const bossHpWrap = document.getElementById("boss-hp-wrap");
  const bossHpFill = document.getElementById("boss-hp-fill");
  const muteBtn = document.getElementById("mute-btn");
  const muteWaves = muteBtn.querySelector(".mute-waves");
  const muteSlash = muteBtn.querySelector(".mute-slash");

  // ---------------------------------------------------------------------
  // Sound + music — synthesized live with the Web Audio API.
  // ---------------------------------------------------------------------
  const SOUND_MUTED_KEY = "galdef_muted";
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

  function playTone({ freq = 440, endFreq = null, type = "sine", duration = 0.12, volume = 0.16, attack = 0.004, delay = 0 }) {
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

  function playNoise({ duration = 0.14, volume = 0.16, filterFreq = 1200, delay = 0 }) {
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
    gain.gain.exponentialRampToValueAtTime(volume, t0 + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    noise.connect(filter).connect(gain).connect(ctx.destination);
    noise.start(t0);
    noise.stop(t0 + duration + 0.02);
  }

  let stepBeatToggle = 0;
  const sfx = {
    shoot() {
      playTone({ freq: 720, endFreq: 1180, type: "square", duration: 0.07, volume: 0.09 });
    },
    invaderHit() {
      playNoise({ duration: 0.12, volume: 0.14, filterFreq: 1400 });
    },
    playerHit() {
      playNoise({ duration: 0.3, volume: 0.2, filterFreq: 500 });
      playTone({ freq: 300, endFreq: 60, type: "sawtooth", duration: 0.35, volume: 0.16 });
    },
    step() {
      stepBeatToggle = 1 - stepBeatToggle;
      playTone({ freq: stepBeatToggle ? 110 : 87, type: "square", duration: 0.09, volume: 0.1 });
    },
    ufoBonus() {
      playTone({ freq: 500, endFreq: 1000, type: "triangle", duration: 0.22, volume: 0.16 });
    },
    powerup() {
      playTone({ freq: 520, type: "triangle", duration: 0.1, volume: 0.14 });
      playTone({ freq: 780, type: "triangle", duration: 0.14, volume: 0.14, delay: 0.08 });
    },
    bossHit() {
      playNoise({ duration: 0.08, volume: 0.12, filterFreq: 1800 });
    },
    bossExplode() {
      playNoise({ duration: 0.5, volume: 0.22, filterFreq: 400 });
      playTone({ freq: 220, endFreq: 40, type: "sawtooth", duration: 0.7, volume: 0.2 });
    },
    waveClear() {
      playTone({ freq: 440, type: "triangle", duration: 0.12, volume: 0.16 });
      playTone({ freq: 660, type: "triangle", duration: 0.14, volume: 0.16, delay: 0.1 });
      playTone({ freq: 880, type: "triangle", duration: 0.2, volume: 0.16, delay: 0.2 });
    },
    bossWarning() {
      playTone({ freq: 160, type: "sawtooth", duration: 0.35, volume: 0.15 });
      playTone({ freq: 160, type: "sawtooth", duration: 0.35, volume: 0.15, delay: 0.42 });
    },
    gameover() {
      playTone({ freq: 300, endFreq: 60, type: "sawtooth", duration: 0.6, volume: 0.18 });
    },
    click() {
      playTone({ freq: 620, type: "square", duration: 0.045, volume: 0.09 });
    },
    unlock() {
      playTone({ freq: 520, type: "triangle", duration: 0.12, volume: 0.16 });
      playTone({ freq: 780, type: "triangle", duration: 0.16, volume: 0.16, delay: 0.09 });
    },
  };

  // --- tense procedural music: an alternating low two-note pulse that ---
  // --- speeds up with the wave, and gains a dissonant stab layer      ---
  // --- during boss fights. Runs only while state === "playing".      ---
  let musicRunning = false;
  let musicTimerId = null;
  let nextNoteTime = 0;
  let beatIndex = 0;

  function musicBpm() {
    let bpm = 96 + Math.min(46, (wave - 1) * 4);
    if (boss && boss.active) bpm += 22;
    return bpm;
  }
  function scheduleBeat(time, idx) {
    if (muted) return;
    const ctx = ensureAudio();
    if (!ctx) return;
    const lowFreq = idx % 2 === 0 ? 65.4 : 73.4;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(lowFreq, time);
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(0.13, time + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.22);
    osc.connect(gain).connect(ctx.destination);
    osc.start(time);
    osc.stop(time + 0.25);

    if (boss && boss.active && idx % 4 === 0) {
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = "square";
      osc2.frequency.setValueAtTime(lowFreq * 3 + 11, time);
      gain2.gain.setValueAtTime(0.0001, time);
      gain2.gain.exponentialRampToValueAtTime(0.05, time + 0.01);
      gain2.gain.exponentialRampToValueAtTime(0.0001, time + 0.15);
      osc2.connect(gain2).connect(ctx.destination);
      osc2.start(time);
      osc2.stop(time + 0.16);
    }
  }
  function musicScheduleLoop() {
    if (!musicRunning) return;
    const ctx = ensureAudio();
    if (ctx) {
      const beatDur = 60 / musicBpm();
      while (nextNoteTime < ctx.currentTime + 0.12) {
        scheduleBeat(nextNoteTime, beatIndex);
        beatIndex++;
        nextNoteTime += beatDur;
      }
    }
    musicTimerId = setTimeout(musicScheduleLoop, 25);
  }
  function startMusic() {
    if (musicRunning) return;
    musicRunning = true;
    const ctx = ensureAudio();
    nextNoteTime = ctx ? ctx.currentTime + 0.05 : 0;
    beatIndex = 0;
    musicScheduleLoop();
  }
  function stopMusic() {
    musicRunning = false;
    if (musicTimerId) {
      clearTimeout(musicTimerId);
      musicTimerId = null;
    }
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
  });
  updateMuteButton();

  // ---------------------------------------------------------------------
  // Sectors (worlds)
  // ---------------------------------------------------------------------
  const FREE_SECTOR_ID = "sector-alpha";
  const SECTORS = {
    "sector-alpha": {
      id: "sector-alpha",
      name: "SECTOR ALPHA",
      free: true,
      phosphor: "#39ff6a",
      phosphorBright: "#eafff0",
      phosphorMid: "#39ff6a",
      phosphorLow: "#1f9e49",
      bulletColor: "#eafff0",
      starColor: "#8fd6a6",
      danger: "#ffb020",
      accent: "#ff3d7a",
      alienBright: "#a9dbff",
      alienMid: "#4da6ff",
      alienLow: "#2b6fd6",
      ability: "The original defense line. Balanced and steady.",
      specialEnemy: null,
      specialPower: null,
    },
    "sector-omega": {
      id: "sector-omega",
      name: "SECTOR OMEGA",
      free: true,
      phosphor: "#ff5240",
      phosphorBright: "#fff0ea",
      phosphorMid: "#ff5240",
      phosphorLow: "#a8321f",
      bulletColor: "#fff0ea",
      starColor: "#d68f83",
      danger: "#ffcf3d",
      accent: "#ffcf3d",
      alienBright: "#fff0ea",
      alienMid: "#ff5240",
      alienLow: "#a8321f",
      ability: "Splitter drones, piercing rounds, and a boss that calls for backup.",
      specialEnemy: "splitter",
      specialPower: "pierce",
    },
  };
  const MODE = new URLSearchParams(location.search).get("mode");
  const currentSectorId = MODE === "omega" ? "sector-omega" : FREE_SECTOR_ID;

  function currentSector() {
    return SECTORS[currentSectorId];
  }

  // ---------------------------------------------------------------------
  // Virtual resolution
  // ---------------------------------------------------------------------
  const VIRTUAL_W = 400;
  let VIRTUAL_H = 700;
  let dpr = Math.max(1, Math.min(2.5, window.devicePixelRatio || 1));

  function resizeCanvas() {
    const displayW = gameWrap.clientWidth;
    const displayH = gameWrap.clientHeight;
    VIRTUAL_H = Math.max(480, Math.round(VIRTUAL_W * (displayH / displayW)));
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
  // Input
  // ---------------------------------------------------------------------
  const input = { left: false, right: false, firing: false };
  let touchActive = false;
  let touchX = VIRTUAL_W / 2;

  window.addEventListener("keydown", (e) => {
    if (e.code === "ArrowLeft" || e.code === "KeyA") input.left = true;
    if (e.code === "ArrowRight" || e.code === "KeyD") input.right = true;
    if (e.code === "Space") {
      e.preventDefault();
      if (state === "start" || state === "gameover") newGame();
      else input.firing = true;
    }
  });
  window.addEventListener("keyup", (e) => {
    if (e.code === "ArrowLeft" || e.code === "KeyA") input.left = false;
    if (e.code === "ArrowRight" || e.code === "KeyD") input.right = false;
    if (e.code === "Space") input.firing = false;
  });

  function clientXToVirtual(clientX) {
    const rect = canvas.getBoundingClientRect();
    return ((clientX - rect.left) / rect.width) * VIRTUAL_W;
  }
  canvas.addEventListener("pointerdown", (e) => {
    touchActive = true;
    touchX = clientXToVirtual(e.clientX);
    input.firing = true;
  });
  canvas.addEventListener("pointermove", (e) => {
    if (touchActive) touchX = clientXToVirtual(e.clientX);
  });
  function releaseTouch() {
    touchActive = false;
    input.firing = false;
  }
  canvas.addEventListener("pointerup", releaseTouch);
  canvas.addEventListener("pointercancel", releaseTouch);
  canvas.addEventListener("pointerleave", releaseTouch);

  // ---------------------------------------------------------------------
  // Constants
  // ---------------------------------------------------------------------
  const PLAYER_W = 30, PLAYER_H = 16;
  const PLAYER_SPEED = 260;
  const PLAYER_MARGIN = 20;
  const playerY = () => VIRTUAL_H - 56;

  const BULLET_W = 3, BULLET_H = 13;
  const PLAYER_BULLET_SPEED = 520;
  const FIRE_COOLDOWN = 0.3;
  const MAX_PLAYER_BULLETS = 4;

  const INVADER_COLS = 7, INVADER_ROWS = 4;
  const INVADER_W = 24, INVADER_H = 16;
  const PITCH_X = 38, PITCH_Y = 28;
  const FORMATION_MARGIN = 30;
  const FORMATION_TOP = 78;
  const INVADER_DROP = 14;
  const INVADER_STEP_X = 6;

  const ESCORT_COLS = 4, ESCORT_ROWS = 2;

  const INVADER_BULLET_SPEED = 190;
  const UFO_W = 28, UFO_H = 12;
  const UFO_SPEED = 100;
  const UFO_VALUES = [60, 110, 160, 310];

  const LIVES_START = 3;
  const RESPAWN_INVULN = 1.4;

  const DIVE_SPEED = 210;
  const POWERUP_FALL_SPEED = 95;
  const POWERUP_DROP_CHANCE = 0.11;

  const HIGH_SCORE_KEY = currentSectorId === "sector-omega" ? "galdefHighScore_omega" : "galdefHighScore";
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
    } catch (e) {}
  }
  let hiScore = loadHighScore();

  function pad6(n) {
    return String(Math.max(0, Math.floor(n))).padStart(6, "0");
  }

  function isBossWave(n) {
    return n % 5 === 0;
  }

  // ---------------------------------------------------------------------
  // Enemy types
  // ---------------------------------------------------------------------
  const ENEMY_TYPES = {
    grunt: { hp: 1 },
    shooter: { hp: 1, fireMult: 2.4 },
    tank: { hp: 3, fireMult: 0.5, scale: 1.25 },
    splitter: { hp: 2 },
  };

  function typeScore(type, row) {
    if (type === "grunt") return row === 0 ? 35 : row <= 2 ? 25 : 15;
    if (type === "shooter") return 30;
    if (type === "tank") return 65;
    if (type === "splitter") return 40;
    return 15;
  }

  // ---------------------------------------------------------------------
  // Game state
  // ---------------------------------------------------------------------
  let state = "start"; // start | playing | wavecomplete | bossincoming | gameover
  let player, playerBullets, invaderBullets, invaders, shields, particles, stars, shards, powerups;
  let formationDir, formationOffsetX, formationOffsetY, stepTimer, stepInterval;
  let ufo, ufoTimer;
  let boss = null;
  let score = 0, wave = 1, lives = LIVES_START, marchFrame = 0;
  let fireTimer = 0, invulnTimer = 0, shieldPowerTimer = 0, waveBannerTimer = 0, diveTimer = 0;
  let activePower = { rapid: 0, spread: 0, pierce: 0 };
  let lastTime = 0;

  function makeStars() {
    const list = [];
    for (let i = 0; i < 70; i++) {
      list.push({
        x: Math.random() * VIRTUAL_W,
        y: Math.random() * VIRTUAL_H,
        r: Math.random() < 0.15 ? 1.6 : 0.9,
        phase: Math.random() * Math.PI * 2,
        speed: 1 + Math.random() * 1.5,
      });
    }
    return list;
  }

  function newPlayer() {
    return { x: VIRTUAL_W / 2 };
  }

  // Which enemy type occupies a given row, for the current wave/sector.
  function typeForCell(row, col, waveNum, sector) {
    if (row === 0) return waveNum >= 6 && (col + row) % 3 === 0 ? "tank" : "grunt";
    if (row === 1 || row === 2) {
      if (waveNum >= 3 && (col + row) % 3 === 0) return "shooter";
      if (sector.specialEnemy === "splitter" && waveNum >= 2 && (col + row) % 4 === 0) return "splitter";
      return "grunt";
    }
    if (sector.specialEnemy === "splitter" && waveNum >= 2 && (col + row) % 5 === 0) return "splitter";
    return "grunt";
  }

  function buildInvaders(cols, rows, waveNum, sector) {
    const list = [];
    const totalW = (cols - 1) * PITCH_X;
    const startX = (VIRTUAL_W - totalW) / 2;
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const type = typeForCell(row, col, waveNum, sector);
        list.push({
          row,
          col,
          type,
          hp: ENEMY_TYPES[type].hp,
          maxHp: ENEMY_TYPES[type].hp,
          baseX: startX + col * PITCH_X,
          baseY: FORMATION_TOP + row * PITCH_Y,
          alive: true,
          diving: false,
          divePhase: 0,
        });
      }
    }
    return list;
  }

  function buildShields() {
    const cols = 6, rows = 4, block = 7;
    const shieldW = cols * block;
    const gapCount = 3;
    const totalW = shieldW * gapCount + (gapCount - 1) * 46;
    const startX = (VIRTUAL_W - totalW) / 2;
    const y = playerY() - 74;
    const list = [];
    for (let s = 0; s < gapCount; s++) {
      const x = startX + s * (shieldW + 46);
      const blocks = [];
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const notch = r === rows - 1 && c >= 2 && c <= 3;
          if (notch) continue;
          blocks.push({ c, r, hp: 2 });
        }
      }
      list.push({ x, y, cols, rows, block, blocks });
    }
    return list;
  }

  function stepIntervalFor(aliveCount, totalCount, waveNum) {
    const frac = aliveCount / Math.max(1, totalCount);
    const base = 0.16 + frac * 0.62;
    const waveSpeedup = Math.max(0.4, 1 - (waveNum - 1) * 0.055);
    return Math.max(0.055, base * waveSpeedup);
  }

  function fireChanceFor(waveNum) {
    return Math.min(0.05, 0.016 + waveNum * 0.0016);
  }
  function maxInvaderBulletsFor(waveNum) {
    return Math.min(7, 3 + Math.floor(waveNum / 4));
  }

  function spawnBoss(waveNum) {
    const hp = 16 + Math.floor(waveNum / 5) * 10;
    return {
      active: true,
      x: VIRTUAL_W / 2 - 35,
      y: 46,
      w: 70,
      h: 34,
      hp,
      maxHp: hp,
      dir: 1,
      speed: 46 + waveNum * 1.6,
      bob: 0,
      fireTimer: 1.4,
      enraged: false,
    };
  }

  function spawnWave(n, opts) {
    opts = opts || {};
    const sector = currentSector();
    invaderBullets = [];
    shards = shards || [];
    powerups = powerups || [];
    diveTimer = 3 + Math.random() * 2;

    if (isBossWave(n)) {
      invaders = buildInvaders(ESCORT_COLS, ESCORT_ROWS, n, sector);
      boss = spawnBoss(n);
    } else {
      invaders = buildInvaders(INVADER_COLS, INVADER_ROWS, n, sector);
      boss = null;
    }
    formationDir = 1;
    formationOffsetX = 0;
    formationOffsetY = 0;
    stepTimer = 0;
    stepInterval = stepIntervalFor(invaders.length, invaders.length, n);
    ufo = null;
    ufoTimer = 12 + Math.random() * 10;
    waveEl.textContent = String(n).padStart(2, "0");
  }

  function newGame() {
    sfx.click();
    score = 0;
    wave = 1;
    lives = LIVES_START;
    player = newPlayer();
    playerBullets = [];
    invaderBullets = [];
    shards = [];
    powerups = [];
    particles = [];
    shields = buildShields();
    activePower = { rapid: 0, spread: 0, pierce: 0 };
    fireTimer = 0;
    invulnTimer = 0;
    shieldPowerTimer = 0;
    gameWrap.classList.toggle("sector-omega", currentSectorId === "sector-omega");
    spawnWave(1);
    state = "playing";
    startScreen.classList.add("hidden");
    gameoverScreen.classList.add("hidden");
    waveBanner.classList.add("hidden");
    hud.classList.remove("hidden");
    updateHud();
    renderLives();
    renderPowerups();
    startMusic();
  }

  function updateHud() {
    scoreEl.textContent = pad6(score);
    hiScoreEl.textContent = pad6(Math.max(score, hiScore));
    if (boss && boss.active) {
      bossHpWrap.classList.add("active");
      bossHpFill.style.width = Math.max(0, (boss.hp / boss.maxHp) * 100) + "%";
    } else {
      bossHpWrap.classList.remove("active");
    }
  }

  function renderLives() {
    livesEl.innerHTML = "";
    for (let i = 0; i < lives; i++) {
      const wrap = document.createElement("span");
      wrap.className = "life-icon";
      wrap.innerHTML =
        '<svg width="16" height="12" viewBox="0 0 16 12"><path d="M8 0 L11 6 L16 6 L16 9 L0 9 L0 6 L5 6 Z" fill="currentColor"/></svg>';
      wrap.style.color = currentSector().phosphor;
      livesEl.appendChild(wrap);
    }
  }

  function renderPowerups() {
    powerupRowEl.innerHTML = "";
    const labels = { rapid: "RAPID", spread: "SPREAD", pierce: "PIERCE" };
    for (const key of Object.keys(activePower)) {
      if (activePower[key] > 0) {
        const chip = document.createElement("span");
        chip.className = "power-chip";
        chip.textContent = labels[key] || key.toUpperCase();
        powerupRowEl.appendChild(chip);
      }
    }
    if (shieldPowerTimer > 0) {
      const chip = document.createElement("span");
      chip.className = "power-chip";
      chip.textContent = "SHIELD";
      powerupRowEl.appendChild(chip);
    }
  }

  function endGame() {
    state = "gameover";
    sfx.gameover();
    stopMusic();
    hud.classList.add("hidden");
    const finalScore = Math.floor(score);
    const isNewHigh = finalScore > hiScore;
    if (isNewHigh) {
      hiScore = finalScore;
      saveHighScore(hiScore);
    }
    finalScoreEl.textContent = "SCORE " + pad6(finalScore);
    bestScoreEl.textContent = "HI-SCORE " + pad6(hiScore);
    newHighEl.classList.toggle("hidden", !isNewHigh);
    gameoverScreen.classList.remove("hidden");
  }

  startBtn.addEventListener("click", newGame);
  restartBtn.addEventListener("click", newGame);


  // ---------------------------------------------------------------------
  // Gameplay update helpers
  // ---------------------------------------------------------------------
  function aliveInvaders() {
    return invaders.filter((inv) => inv.alive && !inv.diving);
  }
  function invaderScreenPos(inv) {
    if (inv.diving) return { x: inv.diveX, y: inv.diveY };
    return { x: inv.baseX + formationOffsetX, y: inv.baseY + formationOffsetY };
  }
  function invaderSize(inv) {
    const scale = ENEMY_TYPES[inv.type].scale || 1;
    return { w: INVADER_W * scale, h: INVADER_H * scale };
  }

  function updatePlayer(dt) {
    if (touchActive) {
      const maxStep = PLAYER_SPEED * dt;
      const delta = touchX - player.x;
      player.x += Math.max(-maxStep, Math.min(maxStep, delta));
    } else {
      if (input.left && !input.right) player.x -= PLAYER_SPEED * dt;
      else if (input.right && !input.left) player.x += PLAYER_SPEED * dt;
    }
    const half = PLAYER_W / 2;
    player.x = Math.max(PLAYER_MARGIN + half, Math.min(VIRTUAL_W - PLAYER_MARGIN - half, player.x));

    fireTimer = Math.max(0, fireTimer - dt);
    const cooldown = activePower.rapid > 0 ? FIRE_COOLDOWN * 0.42 : FIRE_COOLDOWN;
    if (input.firing && fireTimer <= 0 && playerBullets.length < MAX_PLAYER_BULLETS) {
      const baseY = playerY() - PLAYER_H / 2;
      if (activePower.spread > 0) {
        playerBullets.push({ x: player.x, y: baseY, vx: 0 });
        playerBullets.push({ x: player.x, y: baseY, vx: -140 });
        playerBullets.push({ x: player.x, y: baseY, vx: 140 });
      } else {
        playerBullets.push({ x: player.x, y: baseY, vx: 0 });
      }
      fireTimer = cooldown;
      sfx.shoot();
    }

    if (invulnTimer > 0) invulnTimer = Math.max(0, invulnTimer - dt);
    if (shieldPowerTimer > 0) shieldPowerTimer = Math.max(0, shieldPowerTimer - dt);
    let powerChanged = false;
    for (const key of Object.keys(activePower)) {
      if (activePower[key] > 0) {
        activePower[key] = Math.max(0, activePower[key] - dt);
        if (activePower[key] === 0) powerChanged = true;
      }
    }
    if (powerChanged) renderPowerups();
  }

  function updateFormation(dt) {
    stepTimer += dt;
    if (stepTimer < stepInterval) return;
    stepTimer = 0;

    const alive = aliveInvaders();
    if (alive.length === 0) return;
    let minX = Infinity, maxX = -Infinity;
    for (const inv of alive) {
      const x = inv.baseX + formationOffsetX;
      const size = invaderSize(inv);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x + size.w);
    }

    const nextMin = minX + formationDir * INVADER_STEP_X;
    const nextMax = maxX + formationDir * INVADER_STEP_X;
    if (nextMin < FORMATION_MARGIN || nextMax > VIRTUAL_W - FORMATION_MARGIN) {
      formationOffsetY += INVADER_DROP;
      formationDir *= -1;
    } else {
      formationOffsetX += formationDir * INVADER_STEP_X;
    }

    marchFrame = 1 - marchFrame;
    stepInterval = stepIntervalFor(alive.length, invaders.length, wave);
    sfx.step();

    for (const inv of alive) {
      const pos = invaderScreenPos(inv);
      const size = invaderSize(inv);
      if (pos.y + size.h >= playerY() - PLAYER_H) {
        endGame();
        return;
      }
    }
  }

  function updateDiving(dt) {
    diveTimer -= dt;
    if (diveTimer <= 0 && wave >= 4) {
      diveTimer = Math.max(1.6, 5.5 - wave * 0.12);
      const candidates = invaders.filter((inv) => inv.alive && !inv.diving && inv.type !== "tank");
      if (candidates.length > 0 && Math.random() < 0.6) {
        const pick = candidates[Math.floor(Math.random() * candidates.length)];
        const pos = invaderScreenPos(pick);
        pick.diving = true;
        pick.diveX = pos.x;
        pick.diveY = pos.y;
        pick.diveVX = (player.x - pos.x) * 0.6 + (Math.random() - 0.5) * 60;
      }
    }
    for (const inv of invaders) {
      if (!inv.alive || !inv.diving) continue;
      inv.diveY += DIVE_SPEED * dt;
      inv.diveX += inv.diveVX * dt * 0.35;
      if (Math.random() < 0.02) particles.push({ x: inv.diveX + INVADER_W / 2, y: inv.diveY, vx: 0, vy: -20, life: 0.2, t: 0, color: currentSector().accent });
      if (inv.diveY > VIRTUAL_H + 20) {
        inv.alive = false; // dove off screen, gone for good
      }
    }
  }

  function maybeFire() {
    const maxBullets = maxInvaderBulletsFor(wave);
    if (invaderBullets.length >= maxBullets) return;
    const chance = fireChanceFor(wave);
    const byCol = {};
    for (const inv of invaders) {
      if (!inv.alive || inv.diving) continue;
      if (!byCol[inv.col] || inv.row > byCol[inv.col].row) byCol[inv.col] = inv;
    }
    for (const inv of Object.values(byCol)) {
      const mult = ENEMY_TYPES[inv.type].fireMult || 1;
      if (Math.random() < chance * mult) {
        const pos = invaderScreenPos(inv);
        const size = invaderSize(inv);
        invaderBullets.push({ x: pos.x + size.w / 2, y: pos.y + size.h });
        if (invaderBullets.length >= maxBullets) break;
      }
    }
    for (const inv of invaders) {
      if (inv.alive && inv.diving && Math.random() < 0.02 && invaderBullets.length < maxBullets) {
        invaderBullets.push({ x: inv.diveX + INVADER_W / 2, y: inv.diveY + INVADER_H });
      }
    }
    if (boss && boss.active) {
      boss.fireTimer -= 1 / 60;
      const interval = boss.enraged ? 0.55 : 1.1;
      if (boss.fireTimer <= 0 && invaderBullets.length < maxBullets + 3) {
        boss.fireTimer = interval;
        const bx = boss.x + boss.w / 2, by = boss.y + boss.h;
        invaderBullets.push({ x: bx, y: by, vx: -90 });
        invaderBullets.push({ x: bx, y: by, vx: 0 });
        invaderBullets.push({ x: bx, y: by, vx: 90 });
      }
    }
  }

  function updateBoss(dt) {
    if (!boss || !boss.active) return;
    boss.bob += dt;
    boss.x += boss.dir * boss.speed * dt;
    if (boss.x < FORMATION_MARGIN) {
      boss.x = FORMATION_MARGIN;
      boss.dir = 1;
    } else if (boss.x + boss.w > VIRTUAL_W - FORMATION_MARGIN) {
      boss.x = VIRTUAL_W - FORMATION_MARGIN - boss.w;
      boss.dir = -1;
    }
    boss.enraged = boss.hp / boss.maxHp < 0.4;
  }

  function updateUfo(dt) {
    if (ufo && ufo.active) {
      ufo.x += ufo.dir * UFO_SPEED * dt;
      if (ufo.x < -UFO_W - 10 || ufo.x > VIRTUAL_W + 10) ufo.active = false;
      return;
    }
    if (boss && boss.active) return; // no UFO distractions during a boss fight
    ufoTimer -= dt;
    if (ufoTimer <= 0) {
      const dir = Math.random() < 0.5 ? 1 : -1;
      ufo = {
        active: true,
        dir,
        x: dir === 1 ? -UFO_W : VIRTUAL_W,
        y: 34,
        value: UFO_VALUES[Math.floor(Math.random() * UFO_VALUES.length)],
      };
      ufoTimer = 16 + Math.random() * 12;
    }
  }

  function updateBullets(dt) {
    for (const b of playerBullets) {
      b.y -= PLAYER_BULLET_SPEED * dt;
      b.x += (b.vx || 0) * dt;
    }
    playerBullets = playerBullets.filter((b) => b.y > -BULLET_H && b.x > -10 && b.x < VIRTUAL_W + 10);

    for (const b of invaderBullets) {
      b.y += INVADER_BULLET_SPEED * dt;
      b.x += (b.vx || 0) * dt;
    }
    invaderBullets = invaderBullets.filter((b) => b.y < VIRTUAL_H + BULLET_H);
  }

  function updateShards(dt) {
    for (const s of shards) {
      s.x += s.vx * dt;
      s.y += s.vy * dt;
    }
    shards = shards.filter((s) => s.y < VIRTUAL_H + 20);
  }

  function updatePowerups(dt) {
    for (const p of powerups) p.y += POWERUP_FALL_SPEED * dt;
    powerups = powerups.filter((p) => p.y < VIRTUAL_H + 20);
  }

  function rectsOverlap(ax, ay, aw, ah, bx, by, bw, bh) {
    return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
  }

  function hitShieldBlock(bx, by, bw, bh) {
    for (const shield of shields) {
      for (let i = shield.blocks.length - 1; i >= 0; i--) {
        const blk = shield.blocks[i];
        const bxPos = shield.x + blk.c * shield.block;
        const byPos = shield.y + blk.r * shield.block;
        if (rectsOverlap(bx, by, bw, bh, bxPos, byPos, shield.block, shield.block)) {
          blk.hp -= 1;
          if (blk.hp <= 0) shield.blocks.splice(i, 1);
          return true;
        }
      }
    }
    return false;
  }

  function spawnExplosion(x, y, color) {
    for (let i = 0; i < 8; i++) {
      particles.push({
        x,
        y,
        vx: (Math.random() - 0.5) * 160,
        vy: (Math.random() - 0.5) * 160,
        life: 0.32,
        t: 0,
        color,
      });
    }
  }
  function updateParticles(dt) {
    for (const p of particles) {
      p.t += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    particles = particles.filter((p) => p.t < p.life);
  }

  const POWER_TYPES = ["rapid", "spread", "shield", "life", "pierce"];
  function maybeDropPowerup(x, y) {
    if (Math.random() > POWERUP_DROP_CHANCE) return;
    let pool = POWER_TYPES.filter((t) => t !== "pierce" || currentSector().specialPower === "pierce");
    const type = pool[Math.floor(Math.random() * pool.length)];
    powerups.push({ x, y, type, vy: POWERUP_FALL_SPEED });
  }

  function applyPowerup(type) {
    sfx.powerup();
    if (type === "life") {
      lives = Math.min(5, lives + 1);
      renderLives();
      return;
    }
    if (type === "shield") {
      shieldPowerTimer = 6;
    } else {
      activePower[type] = 8;
    }
    renderPowerups();
  }

  function killInvader(inv, pos, size) {
    inv.alive = false;
    score += typeScore(inv.type, inv.row);
    spawnExplosion(pos.x + size.w / 2, pos.y + size.h / 2, inv.type === "grunt" || inv.type === "tank" ? currentSector().alienMid : currentSector().accent);
    sfx.invaderHit();
    maybeDropPowerup(pos.x + size.w / 2, pos.y);
    if (inv.type === "splitter") {
      const accent = currentSector().accent;
      for (let i = 0; i < 2; i++) {
        shards.push({
          x: pos.x + size.w / 2,
          y: pos.y + size.h / 2,
          vx: i === 0 ? -70 : 70,
          vy: 90,
          hp: 1,
          color: accent,
        });
      }
    }
  }

  function checkCollisions() {
    for (let bi = playerBullets.length - 1; bi >= 0; bi--) {
      const b = playerBullets[bi];
      let consumed = false;

      if (ufo && ufo.active) {
        if (rectsOverlap(b.x - BULLET_W / 2, b.y, BULLET_W, BULLET_H, ufo.x, ufo.y, UFO_W, UFO_H)) {
          score += ufo.value;
          spawnExplosion(ufo.x + UFO_W / 2, ufo.y + UFO_H / 2, "#ff3d7a");
          sfx.ufoBonus();
          ufo.active = false;
          consumed = true;
        }
      }

      if (!consumed && boss && boss.active) {
        if (rectsOverlap(b.x - BULLET_W / 2, b.y, BULLET_W, BULLET_H, boss.x, boss.y, boss.w, boss.h)) {
          boss.hp -= 1;
          sfx.bossHit();
          spawnExplosion(b.x, b.y, currentSector().danger);
          if (boss.hp <= 0) {
            boss.active = false;
            score += 500 + wave * 50;
            spawnExplosion(boss.x + boss.w / 2, boss.y + boss.h / 2, currentSector().danger);
            spawnExplosion(boss.x + boss.w / 2, boss.y + boss.h / 2, currentSector().phosphor);
            sfx.bossExplode();
          }
          consumed = !(activePower.pierce > 0);
        }
      }

      if (!consumed) {
        for (const inv of invaders) {
          if (!inv.alive) continue;
          const pos = invaderScreenPos(inv);
          const size = invaderSize(inv);
          if (rectsOverlap(b.x - BULLET_W / 2, b.y, BULLET_W, BULLET_H, pos.x, pos.y, size.w, size.h)) {
            inv.hp -= 1;
            if (inv.hp <= 0) {
              killInvader(inv, pos, size);
            } else {
              spawnExplosion(b.x, b.y, currentSector().phosphor);
              sfx.bossHit();
            }
            consumed = !(activePower.pierce > 0);
            break;
          }
        }
      }

      if (!consumed) {
        for (let si = shards.length - 1; si >= 0; si--) {
          const s = shards[si];
          if (rectsOverlap(b.x - BULLET_W / 2, b.y, BULLET_W, BULLET_H, s.x - 4, s.y - 4, 8, 8)) {
            score += 10;
            spawnExplosion(s.x, s.y, s.color);
            sfx.invaderHit();
            shards.splice(si, 1);
            consumed = !(activePower.pierce > 0);
            break;
          }
        }
      }

      if (!consumed && hitShieldBlock(b.x - BULLET_W / 2, b.y, BULLET_W, BULLET_H)) {
        consumed = true;
      }

      if (consumed) playerBullets.splice(bi, 1);
    }

    for (let bi = invaderBullets.length - 1; bi >= 0; bi--) {
      const b = invaderBullets[bi];
      let consumed = false;
      const invulnerable = invulnTimer > 0 || shieldPowerTimer > 0;

      if (hitShieldBlock(b.x - BULLET_W / 2, b.y, BULLET_W, BULLET_H)) {
        consumed = true;
      } else if (
        !invulnerable &&
        rectsOverlap(b.x - BULLET_W / 2, b.y, BULLET_W, BULLET_H, player.x - PLAYER_W / 2, playerY() - PLAYER_H / 2, PLAYER_W, PLAYER_H)
      ) {
        consumed = true;
        loseLife();
      }

      if (consumed) invaderBullets.splice(bi, 1);
    }

    // diving invaders that reach the player directly
    const invulnerable = invulnTimer > 0 || shieldPowerTimer > 0;
    for (const inv of invaders) {
      if (!inv.alive || !inv.diving) continue;
      if (
        !invulnerable &&
        rectsOverlap(inv.diveX, inv.diveY, INVADER_W, INVADER_H, player.x - PLAYER_W / 2, playerY() - PLAYER_H / 2, PLAYER_W, PLAYER_H)
      ) {
        inv.alive = false;
        spawnExplosion(inv.diveX + INVADER_W / 2, inv.diveY + INVADER_H / 2, currentSector().alienMid);
        loseLife();
      }
    }

    // player catching a falling power-up
    for (let pi = powerups.length - 1; pi >= 0; pi--) {
      const p = powerups[pi];
      if (rectsOverlap(p.x - 6, p.y - 6, 12, 12, player.x - PLAYER_W / 2, playerY() - PLAYER_H / 2, PLAYER_W, PLAYER_H)) {
        applyPowerup(p.type);
        powerups.splice(pi, 1);
      }
    }

    updateHud();
  }

  function loseLife() {
    lives -= 1;
    sfx.playerHit();
    spawnExplosion(player.x, playerY(), currentSector().danger);
    renderLives();
    if (lives <= 0) {
      endGame();
    } else {
      invulnTimer = RESPAWN_INVULN;
    }
  }

  function checkWaveClear() {
    if (state !== "playing") return;
    if (aliveInvaders().length > 0) return;
    if (invaders.some((inv) => inv.diving && inv.alive)) return;
    if (boss && boss.active) return;
    state = "wavecomplete";
    sfx.waveClear();
    waveBannerLine1.textContent = "WAVE " + String(wave).padStart(2, "0") + " CLEAR";
    waveBannerLine2.textContent = "";
    waveBanner.classList.remove("hidden");
    waveBannerTimer = 1.4;
  }

  function update(dt) {
    for (const s of stars) s.phase += dt * s.speed;

    if (state === "playing") {
      updatePlayer(dt);
      updateFormation(dt);
      if (state !== "playing") return;
      updateDiving(dt);
      updateBoss(dt);
      maybeFire();
      updateBullets(dt);
      updateShards(dt);
      updatePowerups(dt);
      updateUfo(dt);
      updateParticles(dt);
      checkCollisions();
      checkWaveClear();
    } else if (state === "wavecomplete") {
      updateParticles(dt);
      waveBannerTimer -= dt;
      if (waveBannerTimer <= 0) {
        wave += 1;
        if (isBossWave(wave)) {
          state = "bossincoming";
          sfx.bossWarning();
          waveBannerLine1.textContent = "WARNING";
          waveBannerLine2.textContent = "HOSTILE CARRIER INBOUND";
          waveBannerTimer = 1.7;
        } else {
          waveBanner.classList.add("hidden");
          spawnWave(wave);
          state = "playing";
          updateHud();
        }
      }
    } else if (state === "bossincoming") {
      updateParticles(dt);
      waveBannerTimer -= dt;
      if (waveBannerTimer <= 0) {
        waveBanner.classList.add("hidden");
        spawnWave(wave);
        state = "playing";
        updateHud();
      }
    }
  }

  // ---------------------------------------------------------------------
  // Drawing
  // ---------------------------------------------------------------------
  function drawStars() {
    const sector = currentSector();
    for (const s of stars) {
      const alpha = 0.35 + 0.5 * (0.5 + 0.5 * Math.sin(s.phase));
      ctx.globalAlpha = alpha;
      ctx.fillStyle = sector.starColor;
      ctx.fillRect(s.x, s.y, s.r, s.r);
    }
    ctx.globalAlpha = 1;
  }

  // Pixel bitmaps for the non-grunt enemy types ("1" = body, "2" = dark
  // detail). Two frames each, swapped on every formation step.
  const SHOOTER_BITMAPS = [
    [
      "1....11....1",
      "11..1111..11",
      "111111111111",
      "111221122111",
      ".1111111111.",
      "..11.11.11..",
      "...1.11.1...",
      ".....11.....",
    ],
    [
      ".....11.....",
      "1..111111..1",
      "111111111111",
      "111221122111",
      ".1111111111.",
      "..11.11.11..",
      "..1..11..1..",
      ".....11.....",
    ],
  ];
  const TANK_BITMAPS = [
    [
      "1......1......1",
      "11....111....11",
      "111111111111111",
      "111.1111111.111",
      "111.2211122.111",
      "111111111111111",
      ".1111111111111.",
      "..11.11111.11..",
      ".11...111...11.",
      "11.....1.....11",
    ],
    [
      "1......1......1",
      "11....111....11",
      "111111111111111",
      "111.1111111.111",
      "111.2211122.111",
      "111111111111111",
      ".1111111111111.",
      "..11.11111.11..",
      "..11..111..11..",
      ".11....1....11.",
    ],
  ];
  function drawBitmap(rows, w, h, fill, dark) {
    const px = w / rows[0].length, py = h / rows.length;
    for (let r = 0; r < rows.length; r++) {
      for (let c = 0; c < rows[r].length; c++) {
        const ch = rows[r][c];
        if (ch === ".") continue;
        ctx.fillStyle = ch === "2" ? dark : fill;
        ctx.fillRect(c * px, r * py, px + 0.05, py + 0.05);
      }
    }
  }

  function drawInvader(inv) {
    const pos = invaderScreenPos(inv);
    const size = invaderSize(inv);
    const sector = currentSector();
    const dmgFrac = inv.hp / inv.maxHp;
    let fill = inv.row === 0 ? sector.alienBright : inv.row <= 2 ? sector.alienMid : sector.alienLow;
    if (inv.type === "tank") fill = dmgFrac > 0.66 ? sector.alienBright : dmgFrac > 0.33 ? sector.alienMid : sector.alienLow;
    if (inv.type === "shooter") fill = sector.accent;
    if (inv.type === "splitter") fill = sector.accent;
    const dark = "#050a18";

    const w = size.w, h = size.h;
    ctx.save();
    ctx.translate(pos.x, pos.y);
    if (inv.type === "splitter") {
      // diamond crystal with a crack down the middle (it splits in two)
      ctx.translate(w / 2, h / 2);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = fill;
      ctx.fillRect(-w / 2.8, -h / 2.8, w / 1.4, h / 1.4);
      ctx.rotate(-Math.PI / 4);
      ctx.fillStyle = dark;
      ctx.fillRect(-1, -h / 2.2, 2, h / 1.1);
      ctx.restore();
      return;
    }
    if (inv.type === "shooter") {
      drawBitmap(SHOOTER_BITMAPS[marchFrame], w, h, fill, dark);
      ctx.restore();
      return;
    }
    if (inv.type === "tank") {
      drawBitmap(TANK_BITMAPS[marchFrame], w, h, fill, dark);
      ctx.restore();
      return;
    }
    ctx.fillStyle = fill;
    const legSpread = marchFrame === 0 ? 2 : -2;
    ctx.fillRect(4, 0, w - 8, h - 6);
    ctx.fillRect(0, 4, w, 6);
    ctx.fillRect(2 + legSpread, h - 4, 4, 4);
    ctx.fillRect(w - 6 - legSpread, h - 4, 4, 4);
    ctx.fillStyle = dark;
    ctx.fillRect(6, 5, 3, 3);
    ctx.fillRect(w - 9, 5, 3, 3);
    ctx.restore();
  }

  function drawShards() {
    for (const s of shards) {
      ctx.fillStyle = s.color;
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate(Math.PI / 4);
      ctx.fillRect(-3, -3, 6, 6);
      ctx.restore();
    }
  }

  function drawShields() {
    for (const shield of shields) {
      for (const blk of shield.blocks) {
        const alpha = blk.hp >= 2 ? 1 : 0.5;
        ctx.globalAlpha = alpha;
        ctx.fillStyle = currentSector().phosphor;
        ctx.fillRect(shield.x + blk.c * shield.block, shield.y + blk.r * shield.block, shield.block - 1, shield.block - 1);
      }
    }
    ctx.globalAlpha = 1;
  }

  function drawPlayer() {
    if (invulnTimer > 0 && Math.floor(invulnTimer * 12) % 2 === 0) return;
    const sector = currentSector();
    const x = player.x, y = playerY();
    if (shieldPowerTimer > 0) {
      ctx.strokeStyle = sector.danger;
      ctx.globalAlpha = 0.7;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, PLAYER_W * 0.85, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.fillStyle = sector.phosphor;
    ctx.fillRect(x - 2, y - PLAYER_H / 2, 4, PLAYER_H / 2);
    ctx.fillRect(x - PLAYER_W / 2, y, PLAYER_W, PLAYER_H / 2);
    ctx.fillRect(x - PLAYER_W / 2 - 3, y + PLAYER_H / 2 - 4, PLAYER_W + 6, 4);
  }

  function drawBullets() {
    const sector = currentSector();
    ctx.fillStyle = sector.bulletColor;
    for (const b of playerBullets) ctx.fillRect(b.x - BULLET_W / 2, b.y, BULLET_W, BULLET_H);
    ctx.fillStyle = sector.danger;
    for (const b of invaderBullets) ctx.fillRect(b.x - BULLET_W / 2, b.y, BULLET_W, BULLET_H);
  }

  function drawUfo() {
    if (!ufo || !ufo.active) return;
    const ux = ufo.x, uy = ufo.y;
    // glass dome
    ctx.fillStyle = "#ffd1e2";
    ctx.beginPath();
    ctx.arc(ux + UFO_W / 2, uy + 4, 6, Math.PI, 0);
    ctx.fill();
    // saucer: upper deck + wider rim
    ctx.fillStyle = "#ff3d7a";
    ctx.fillRect(ux + 4, uy + 4, UFO_W - 8, 3);
    ctx.fillRect(ux, uy + 7, UFO_W, 3);
    ctx.fillStyle = "#b8245a";
    ctx.fillRect(ux + 5, uy + 10, UFO_W - 10, 2);
    // running lights along the rim, chasing
    const blink = Math.floor(performance.now() / 140) % 3;
    for (let i = 0; i < 3; i++) {
      ctx.fillStyle = i === blink ? "#fff6c2" : "#7a1236";
      ctx.fillRect(ux + 6 + i * 7, uy + 8, 2, 1.5);
    }
  }

  function drawBoss() {
    if (!boss || !boss.active) return;
    const sector = currentSector();
    const wobble = Math.sin(boss.bob * 3) * 3;
    ctx.fillStyle = boss.enraged ? sector.danger : sector.phosphorMid;
    ctx.fillRect(boss.x, boss.y + wobble, boss.w, boss.h);
    ctx.fillStyle = sector.phosphorBright;
    ctx.fillRect(boss.x + 8, boss.y + wobble + 8, boss.w - 16, 8);
    ctx.fillStyle = "#04170a";
    ctx.fillRect(boss.x + 14, boss.y + wobble + 10, 6, 4);
    ctx.fillRect(boss.x + boss.w - 20, boss.y + wobble + 10, 6, 4);
  }

  function drawPowerups() {
    const labelColor = { rapid: "#39ff6a", spread: "#ff3d7a", shield: "#ffb020", life: "#eafff0", pierce: "#ffcf3d" };
    for (const p of powerups) {
      ctx.fillStyle = labelColor[p.type] || "#fff";
      ctx.fillRect(p.x - 6, p.y - 6, 12, 12);
      ctx.fillStyle = "#04170a";
      ctx.fillRect(p.x - 4, p.y - 4, 8, 8);
    }
  }

  function drawParticles() {
    for (const p of particles) {
      const alpha = 1 - p.t / p.life;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - 1.5, p.y - 1.5, 3, 3);
    }
    ctx.globalAlpha = 1;
  }

  function draw() {
    ctx.clearRect(0, 0, VIRTUAL_W, VIRTUAL_H);
    ctx.fillStyle = "#050f08";
    ctx.fillRect(0, 0, VIRTUAL_W, VIRTUAL_H);
    drawStars();

    if (state === "playing" || state === "wavecomplete" || state === "bossincoming") {
      drawShields();
      for (const inv of invaders) if (inv.alive) drawInvader(inv);
      drawShards();
      drawBoss();
      drawUfo();
      drawPowerups();
      drawBullets();
      drawParticles();
      drawPlayer();
    } else {
      drawIdleScene();
    }
  }

  let idleScene = null;
  function drawIdleScene() {
    if (!idleScene) {
      idleScene = { invaders: buildInvaders(INVADER_COLS, INVADER_ROWS, 1, currentSector()), shields: buildShields() };
    }
    for (const shield of idleScene.shields) {
      for (const blk of shield.blocks) {
        ctx.fillStyle = currentSector().phosphor;
        ctx.fillRect(shield.x + blk.c * shield.block, shield.y + blk.r * shield.block, shield.block - 1, shield.block - 1);
      }
    }
    for (const inv of idleScene.invaders) {
      const pos = { x: inv.baseX, y: inv.baseY };
      const size = invaderSize(inv);
      const savedOffX = formationOffsetX, savedOffY = formationOffsetY;
      formationOffsetX = 0;
      formationOffsetY = 0;
      drawInvader(inv);
      formationOffsetX = savedOffX;
      formationOffsetY = savedOffY;
    }
    ctx.fillStyle = currentSector().phosphor;
    const x = VIRTUAL_W / 2, y = playerY();
    ctx.fillRect(x - 2, y - PLAYER_H / 2, 4, PLAYER_H / 2);
    ctx.fillRect(x - PLAYER_W / 2, y, PLAYER_W, PLAYER_H / 2);
    ctx.fillRect(x - PLAYER_W / 2 - 3, y + PLAYER_H / 2 - 4, PLAYER_W + 6, 4);
  }

  // ---------------------------------------------------------------------
  // Main loop
  // ---------------------------------------------------------------------
  function frame(t) {
    if (!lastTime) lastTime = t;
    let dt = (t - lastTime) / 1000;
    lastTime = t;
    dt = Math.min(dt, 1 / 30);

    update(dt);
    draw();

    requestAnimationFrame(frame);
  }

  // ---------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------
  function boot() {
    resizeCanvas();
    stars = makeStars();
    player = newPlayer();
    playerBullets = [];
    invaderBullets = [];
    invaders = [];
    shields = [];
    particles = [];
    shards = [];
    powerups = [];
    formationOffsetX = 0;
    formationOffsetY = 0;
    gameWrap.classList.toggle("sector-omega", currentSectorId === "sector-omega");
    startHiscoreEl.textContent = "HI-SCORE " + pad6(hiScore);
    hiScoreEl.textContent = pad6(hiScore);
    startSectorTag.textContent = currentSector().name;
    draw();
    requestAnimationFrame(frame);
  }

  try {
    boot();
  } catch (e) {
    console.error("[Galactic Defenders] boot() failed:", e);
  }
})();
