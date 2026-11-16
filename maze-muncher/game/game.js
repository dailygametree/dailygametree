/* Maze Muncher — vanilla JS + Canvas2D, no external assets. Part of dailygametree.com. */

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
  const gameoverTitle = document.getElementById("gameover-title");
  const finalScoreEl = document.getElementById("final-score");
  const bestScoreEl = document.getElementById("best-score");
  const hud = document.getElementById("hud");
  const scoreEl = document.getElementById("score");
  const hudLevelEl = document.getElementById("hud-level");
  const livesDotsEl = document.getElementById("lives-dots");
  const muteBtn = document.getElementById("mute-btn");
  const muteWaves = muteBtn.querySelector(".mute-waves");
  const muteSlash = muteBtn.querySelector(".mute-slash");
  const dpad = document.getElementById("dpad");

  // ---------------------------------------------------------------------
  // Sound — tiny SFX synthesized on the fly with the Web Audio API, no
  // external audio files. Every sound is a short oscillator and/or
  // filtered-noise burst with a fast envelope; nothing is ever loaded.
  // The AudioContext is created lazily on the first user gesture, since
  // browsers refuse to make sound before one.
  // ---------------------------------------------------------------------
  const SOUND_MUTED_KEY = "mm_muted";
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

  function playTone({ freq = 440, endFreq = null, type = "sine", duration = 0.12, volume = 0.16, attack = 0.005, delay = 0 }) {
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

  function playNoise({ duration = 0.15, volume = 0.14, filterFreq = 1200, delay = 0 }) {
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

  // Seed crunch: a tiny filtered noise tick plus a short soft blip whose
  // pitch steps through a pentatonic scale, so eating a run of seeds plays
  // a little rising-and-falling melody.
  const CRUNCH_NOTES = [523, 587, 659, 784, 880, 784, 659, 587];
  let crunchIdx = 0;
  const sfx = {
    chomp() {
      crunchIdx = (crunchIdx + 1) % CRUNCH_NOTES.length;
      playNoise({ duration: 0.03, volume: 0.05, filterFreq: 3200 });
      playTone({ freq: CRUNCH_NOTES[crunchIdx], type: "triangle", duration: 0.06, volume: 0.06 });
    },
    pellet() {
      [0, 1, 2].forEach((i) => playTone({ freq: 660 + i * 220, type: "sine", duration: 0.12, volume: 0.13, delay: i * 0.05 }));
      playNoise({ duration: 0.25, volume: 0.06, filterFreq: 5200, delay: 0.05 });
    },
    eatGhost() {
      playTone({ freq: 300, type: "triangle", duration: 0.07, volume: 0.18 });
      playTone({ freq: 460, type: "triangle", duration: 0.09, volume: 0.18, delay: 0.06 });
      playTone({ freq: 680, type: "triangle", duration: 0.12, volume: 0.18, delay: 0.12 });
    },
    death() {
      playNoise({ duration: 0.18, volume: 0.18, filterFreq: 900 });
      playTone({ freq: 392, type: "triangle", duration: 0.16, volume: 0.16, delay: 0.12 });
      playTone({ freq: 330, type: "triangle", duration: 0.16, volume: 0.16, delay: 0.3 });
      playTone({ freq: 262, type: "triangle", duration: 0.32, volume: 0.16, delay: 0.48 });
    },
    levelClear() {
      [0, 1, 2, 3].forEach((i) => playTone({ freq: 420 + i * 120, type: "square", duration: 0.13, volume: 0.14, delay: i * 0.11 }));
    },
    extraLife() {
      playTone({ freq: 520, type: "triangle", duration: 0.12, volume: 0.16 });
      playTone({ freq: 780, type: "triangle", duration: 0.18, volume: 0.16, delay: 0.1 });
    },
    click() {
      playTone({ freq: 680, type: "square", duration: 0.045, volume: 0.08 });
    },
  };

  // Ambient hum — a low, softly pulsing drone (volume tremolo, steady pitch)
  // that only plays during active gameplay (never behind the menus) and
  // pulses faster while a star-berry is active. Fully synthesized, respects
  // the mute toggle.
  let sirenOsc = null, sirenGain = null, sirenLfo = null;
  function startSiren() {
    if (muted || sirenOsc) return;
    const ctx = ensureAudio();
    if (!ctx) return;
    sirenOsc = ctx.createOscillator();
    sirenGain = ctx.createGain();
    sirenLfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    sirenOsc.type = "triangle";
    sirenOsc.frequency.value = 110;
    sirenLfo.type = "sine";
    sirenLfo.frequency.value = 1.2;
    lfoGain.gain.value = 0.018;
    sirenGain.gain.value = 0.026;
    sirenLfo.connect(lfoGain).connect(sirenGain.gain);
    sirenOsc.connect(sirenGain).connect(ctx.destination);
    sirenOsc.start();
    sirenLfo.start();
  }
  function stopSiren() {
    if (sirenOsc) {
      try {
        sirenOsc.stop();
        sirenLfo.stop();
      } catch (e) {}
    }
    sirenOsc = sirenGain = sirenLfo = null;
  }
  function setSirenExcited(on) {
    if (!sirenOsc) return;
    sirenOsc.frequency.value = on ? 147 : 110;
    sirenLfo.frequency.value = on ? 3.2 : 1.2;
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
    if (muted) stopSiren();
    else if (state === "playing") startSiren();
  });
  updateMuteButton();

  // ---------------------------------------------------------------------
  // Maze data — two original, procedurally-built, hand-verified layouts
  // (fully connected, mirrored left/right, one tunnel row, one ghost
  // house). Levels alternate between them. '#' wall, '.' dot, 'o' power
  // pellet, ' ' open floor with no pellet, '=' ghost-house door (ghosts
  // only).
  // ---------------------------------------------------------------------
  const MAZE_LEVELS = [
    {
      rows: 23, cols: 19,
      tunnelRow: 11,
      house: { top: 9, bottom: 13, left: 6, right: 12, midC: 9 },
      playerStart: [16, 9],
      ghostStarts: [[11, 7], [11, 8], [11, 10], [11, 11]],
      grid: [
        ".......#...#.......",
        "######.#.#.#.######",
        "..o#...#...#...#o..",
        ".#.#.###.#.###.#.#.",
        "...#.....#.....#...",
        ".#.#.###.#.###.#.#.",
        ".........#.........",
        ".#.###.#.#.#.###.#.",
        ".#.#....   ....#.#.",
        ".###.###===###.###.",
        ".#...##     ##...#.",
        "...####     ####...",
        ".#.#.##     ##.#.#.",
        ".#.#.#########.#.#.",
        "...#.....#.....#...",
        ".#.#.###.#.###.#.#.",
        ".#.#...#...#...#.#.",
        ".#.#####.#.#####.#.",
        ".#.#...#...#...#.#.",
        ".#.#.#.#.#.#.#.#.#.",
        "..o#.....#.....#o..",
        ".###.###.#.###.###.",
        ".....#...#...#.....",
      ],
    },
    {
      rows: 23, cols: 19,
      tunnelRow: 11,
      house: { top: 9, bottom: 13, left: 6, right: 12, midC: 9 },
      playerStart: [14, 9],
      ghostStarts: [[11, 7], [11, 8], [11, 10], [11, 11]],
      grid: [
        "...#...........#...",
        "##.#.###.#.###.#.##",
        ".#o#.....#.....#o#.",
        ".#.#####.#.#####.#.",
        ".#...#.......#...#.",
        ".###.#.#.#.#.#.###.",
        ".......#.#.#.......",
        ".#####.#.#.#.#####.",
        "...#...#   #...#...",
        "##.#.###===###.#.##",
        ".#...##     ##...#.",
        "...#.##     ##.#...",
        ".....##     ##.....",
        ".#.#.#########.#.#.",
        ".#...#.......#...#.",
        ".#######.#.#######.",
        ".........#.........",
        "##.#.#.#####.#.#.##",
        ".#.#...........#.#.",
        ".#.#.###.#.###.#.#.",
        "..o#...#...#...#o..",
        ".###.#.#.#.#.#.###.",
        ".....#...#...#.....",
      ],
    },
  ];

  const GHOST_INFO = [
    { name: "Rue", color: "#ff4fa3", dark: "#9c1f5e" },
    { name: "Marm", color: "#ffb03a", dark: "#9a5d0e" },
    { name: "Blip", color: "#a77bff", dark: "#5a33b0" },
    { name: "Fizz", color: "#3fd3c0", dark: "#16796c" },
  ];

  const TILE = 20;

  const UP = { dx: 0, dy: -1 };
  const DOWN = { dx: 0, dy: 1 };
  const LEFT = { dx: -1, dy: 0 };
  const RIGHT = { dx: 1, dy: 0 };
  const NONE = { dx: 0, dy: 0 };
  const DIRS = [UP, DOWN, LEFT, RIGHT];

  function sameDir(a, b) {
    return a.dx === b.dx && a.dy === b.dy;
  }
  function isZero(a) {
    return a.dx === 0 && a.dy === 0;
  }
  function wrapCol(c, cols) {
    return ((c % cols) + cols) % cols;
  }

  // ---------------------------------------------------------------------
  // Maze helpers (operate on the current `maze` runtime object)
  // ---------------------------------------------------------------------
  let maze = null; // { rows, cols, tunnelRow, house, grid: string[], dots: bool[][] }

  function buildMaze(levelIdx) {
    const def = MAZE_LEVELS[levelIdx % MAZE_LEVELS.length];
    const grid = def.grid.map((row) => row.split(""));
    const dots = grid.map((row) => row.map((ch) => ch === "." || ch === "o"));
    let dotCount = 0;
    for (const row of dots) for (const d of row) if (d) dotCount++;
    return {
      rows: def.rows,
      cols: def.cols,
      tunnelRow: def.tunnelRow,
      house: def.house,
      grid,
      dots,
      dotCount,
      playerStart: def.playerStart,
      ghostStarts: def.ghostStarts,
    };
  }

  function tileChar(r, c) {
    if (r < 0 || r >= maze.rows) return "#";
    const cc = wrapCol(c, maze.cols);
    return maze.grid[r][cc];
  }
  function isOpenFor(r, c, forGhost) {
    const t = tileChar(r, c);
    if (t === "#") return false;
    if (t === "=") return !!forGhost;
    return true;
  }

  // ---------------------------------------------------------------------
  // Virtual resolution + canvas fit (letterboxed, maze keeps its aspect
  // ratio rather than stretching to the device).
  // ---------------------------------------------------------------------
  let VIRTUAL_W = 19 * TILE;
  let VIRTUAL_H = 23 * TILE;
  let dpr = 1;

  function resizeCanvas() {
    const wrap = document.getElementById("game-wrap");
    const availW = wrap.clientWidth - 16;
    const availH = wrap.clientHeight - 16;
    const scale = Math.max(0.5, Math.min(availW / VIRTUAL_W, availH / VIRTUAL_H));
    dpr = Math.max(1, Math.min(2.5, window.devicePixelRatio || 1));
    const cssW = Math.round(VIRTUAL_W * scale);
    const cssH = Math.round(VIRTUAL_H * scale);
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    canvas.style.width = cssW + "px";
    canvas.style.height = cssH + "px";
    const s = canvas.width / VIRTUAL_W;
    ctx.setTransform(s, 0, 0, s, 0, 0);
  }
  window.addEventListener("resize", resizeCanvas);
  window.addEventListener("orientationchange", resizeCanvas);

  // ---------------------------------------------------------------------
  // Input
  // ---------------------------------------------------------------------
  let queuedDir = RIGHT;

  function setQueuedDir(d) {
    queuedDir = d;
  }

  window.addEventListener("keydown", (e) => {
    if (e.code === "ArrowUp" || e.code === "KeyW") setQueuedDir(UP);
    else if (e.code === "ArrowDown" || e.code === "KeyS") setQueuedDir(DOWN);
    else if (e.code === "ArrowLeft" || e.code === "KeyA") setQueuedDir(LEFT);
    else if (e.code === "ArrowRight" || e.code === "KeyD") setQueuedDir(RIGHT);
    else if (e.code === "Space" || e.code === "Enter") {
      if (state === "start" || state === "gameover") {
        e.preventDefault();
        startGame();
      }
    }
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) e.preventDefault();
  });

  const isTouchDevice = "ontouchstart" in window || navigator.maxTouchPoints > 0;
  if (isTouchDevice) dpad.classList.remove("hidden");

  dpad.querySelectorAll(".dpad-btn").forEach((btn) => {
    const dir = { up: UP, down: DOWN, left: LEFT, right: RIGHT }[btn.dataset.dir];
    btn.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      setQueuedDir(dir);
    });
  });

  let touchStart = null;
  canvas.addEventListener(
    "touchstart",
    (e) => {
      const t = e.changedTouches[0];
      touchStart = { x: t.clientX, y: t.clientY };
    },
    { passive: true }
  );
  canvas.addEventListener(
    "touchmove",
    (e) => {
      if (!touchStart) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - touchStart.x;
      const dy = t.clientY - touchStart.y;
      const THRESH = 18;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < THRESH) return;
      if (Math.abs(dx) > Math.abs(dy)) setQueuedDir(dx > 0 ? RIGHT : LEFT);
      else setQueuedDir(dy > 0 ? DOWN : UP);
      touchStart = { x: t.clientX, y: t.clientY };
    },
    { passive: true }
  );
  canvas.addEventListener("touchend", () => {
    touchStart = null;
  });

  // ---------------------------------------------------------------------
  // Persistent high score
  // ---------------------------------------------------------------------
  const HIGH_SCORE_KEY = "mazeMuncherHighScore";
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
  let highScore = loadHighScore();

  // ---------------------------------------------------------------------
  // Game constants
  // ---------------------------------------------------------------------
  const DOT_SCORE = 10;
  const PELLET_SCORE = 50;
  const GHOST_SCORE_BASE = 250;
  const EXTRA_LIFE_THRESHOLDS = [10000, 25000, 50000, 75000];
  const READY_DURATION = 1.4;
  const DYING_DURATION = 1.1;
  const LEVEL_CLEAR_DURATION = 1.6;
  const MODE_SCHEDULE = [6, 18, 8, 22, 4, 24, 4, 999];
  const SCATTER_CORNERS = [
    { r: 1, c: 1 },
    { r: 1, c: 17 },
    { r: 21, c: 1 },
    { r: 21, c: 17 },
  ];
  const GHOST_RELEASE_BASE = [0, 3, 7, 12];

  function playerSpeedForLevel(level) {
    return 6.4 + Math.min(1.2, level * 0.06);
  }
  function ghostSpeedForLevel(level) {
    return 5.5 + Math.min(1.8, level * 0.1);
  }
  function frightSpeedForLevel(level) {
    return Math.max(3.0, 4.2 - level * 0.08);
  }
  function frightDurationForLevel(level) {
    return Math.max(2, 7 - level * 0.4);
  }

  // ---------------------------------------------------------------------
  // Game state
  // ---------------------------------------------------------------------
  let state = "start"; // start | ready | playing | dying | levelclear | gameover
  let level = 0;
  let score = 0;
  let lives = 3;
  let nextExtraLifeIdx = 0;
  let player, ghosts, comboMultiplier, stateTimer, globalMode, modeIdx, modeTimer, dotsRemaining;
  let rngSeed = 1;
  function rng() {
    rngSeed ^= rngSeed << 13;
    rngSeed >>>= 0;
    rngSeed ^= rngSeed >>> 17;
    rngSeed ^= rngSeed << 5;
    rngSeed >>>= 0;
    return (rngSeed >>> 0) / 4294967296;
  }

  function newPlayer() {
    const [r, c] = maze.playerStart;
    return { tile: { r, c }, dir: NONE, progress: 0, facing: RIGHT, mouthT: 0 };
  }

  function newGhosts() {
    return maze.ghostStarts.map((pos, i) => ({
      idx: i,
      tile: { r: pos[0], c: pos[1] },
      dir: NONE,
      progress: 0,
      state: "inHouse", // inHouse | exiting | scatter | chase | frightened | eaten
      releaseTimer: Math.max(0, GHOST_RELEASE_BASE[i] - level * 0.6),
      respawnTimer: 0,
      bob: Math.random() * Math.PI * 2,
    }));
  }

  function resetPositions() {
    player = newPlayer();
    ghosts = newGhosts();
    comboMultiplier = 1;
    globalMode = "scatter";
    modeIdx = 0;
    modeTimer = MODE_SCHEDULE[0];
  }

  function startLevel(lvl) {
    level = lvl;
    maze = buildMaze(level);
    dotsRemaining = maze.dotCount;
    // The player never has to "find" the dot under their own feet.
    maze.dots[maze.playerStart[0]][maze.playerStart[1]] = false;
    dotsRemaining--;
    resetPositions();
    hudLevelEl.textContent = String(level + 1);
    state = "ready";
    stateTimer = READY_DURATION;
  }

  function startGame() {
    sfx.click();
    score = 0;
    lives = 3;
    nextExtraLifeIdx = 0;
    scoreEl.textContent = "0";
    renderLives();
    startScreen.classList.add("hidden");
    gameoverScreen.classList.add("hidden");
    hud.classList.remove("hidden");
    startLevel(0);
    startSiren();
  }

  function renderLives() {
    livesDotsEl.innerHTML = "";
    for (let i = 0; i < lives; i++) {
      const d = document.createElement("span");
      d.className = "life-dot";
      livesDotsEl.appendChild(d);
    }
  }

  function addScore(n) {
    score += n;
    scoreEl.textContent = String(score);
    if (nextExtraLifeIdx < EXTRA_LIFE_THRESHOLDS.length && score >= EXTRA_LIFE_THRESHOLDS[nextExtraLifeIdx]) {
      nextExtraLifeIdx++;
      lives++;
      renderLives();
      sfx.extraLife();
    }
  }

  function endGame() {
    state = "gameover";
    stopSiren();
    sfx.death();
    hud.classList.add("hidden");
    if (score > highScore) {
      highScore = score;
      saveHighScore(highScore);
    }
    gameoverTitle.textContent = "Game Over";
    finalScoreEl.textContent = "Score: " + score;
    bestScoreEl.textContent = "Best: " + highScore;
    gameoverScreen.classList.remove("hidden");
  }

  startBtn.addEventListener("click", startGame);
  restartBtn.addEventListener("click", startGame);


  // ---------------------------------------------------------------------
  // Movement — shared tile-boundary stepping model. Every entity moves
  // continuously between tile centers; direction changes are only
  // evaluated once a tile center is reached (classic grid-chaser feel).
  // ---------------------------------------------------------------------
  function playerFloatPos() {
    return { r: player.tile.r + player.dir.dy * player.progress, c: player.tile.c + player.dir.dx * player.progress };
  }
  function ghostFloatPos(g) {
    return { r: g.tile.r + g.dir.dy * g.progress, c: g.tile.c + g.dir.dx * g.progress };
  }

  function stepPlayer(dt) {
    // Instant reversal, even mid-tile — always allowed, matches how these
    // games feel responsive to control.
    if (!isZero(player.dir) && sameDir(queuedDir, { dx: -player.dir.dx, dy: -player.dir.dy }) && player.progress > 0) {
      const aheadTile = { r: player.tile.r + player.dir.dy, c: wrapCol(player.tile.c + player.dir.dx, maze.cols) };
      player.tile = aheadTile;
      player.dir = queuedDir;
      player.facing = queuedDir;
      player.progress = 1 - player.progress;
    }

    if (isZero(player.dir)) {
      if (isOpenFor(player.tile.r + queuedDir.dy, player.tile.c + queuedDir.dx, false)) {
        player.dir = queuedDir;
        player.facing = queuedDir;
      }
      return;
    }

    const speed = playerSpeedForLevel(level);
    player.progress += speed * dt;
    while (player.progress >= 1) {
      player.progress -= 1;
      player.tile = { r: player.tile.r + player.dir.dy, c: wrapCol(player.tile.c + player.dir.dx, maze.cols) };
      eatAt(player.tile.r, player.tile.c);
      if (isOpenFor(player.tile.r + queuedDir.dy, player.tile.c + queuedDir.dx, false)) {
        player.dir = queuedDir;
        player.facing = queuedDir;
      } else if (!isOpenFor(player.tile.r + player.dir.dy, player.tile.c + player.dir.dx, false)) {
        player.dir = NONE;
        player.progress = 0;
        break;
      }
    }
  }

  function eatAt(r, c) {
    const cc = wrapCol(c, maze.cols);
    if (!maze.dots[r] || !maze.dots[r][cc]) return;
    maze.dots[r][cc] = false;
    dotsRemaining--;
    const wasPellet = maze.grid[r][cc] === "o";
    if (wasPellet) {
      addScore(PELLET_SCORE);
      comboMultiplier = 1;
      sfx.pellet();
      frightenGhosts();
    } else {
      addScore(DOT_SCORE);
      sfx.chomp();
    }
    if (dotsRemaining <= 0) {
      state = "levelclear";
      stateTimer = LEVEL_CLEAR_DURATION;
      stopSiren();
      sfx.levelClear();
    }
  }

  function frightenGhosts() {
    const duration = frightDurationForLevel(level);
    for (const g of ghosts) {
      if (g.state === "scatter" || g.state === "chase" || g.state === "frightened") {
        g.state = "frightened";
        g.frightTimer = duration;
        g.dir = { dx: -g.dir.dx, dy: -g.dir.dy };
      }
    }
    setSirenExcited(true);
  }

  // Deliberately NOT the door tile itself — a BFS target has to sit past
  // the threshold the caller cares about, or the ghost stops right on
  // the door (satisfying "reached the door") without ever actually
  // crossing it into the corridor or the room.
  function exitTarget() {
    return { r: maze.house.top - 1, c: maze.house.midC };
  }
  function houseCenterTile() {
    return { r: Math.floor((maze.house.top + maze.house.bottom) / 2), c: maze.house.midC };
  }

  function houseInteriorCenter(g) {
    return g.tile.r > maze.house.top && g.tile.r < maze.house.bottom && g.tile.c > maze.house.left && g.tile.c < maze.house.right;
  }

  function chaseTargetFor(idx) {
    const p = playerFloatPos();
    const pTile = { r: player.tile.r, c: player.tile.c };
    switch (idx) {
      case 0:
        return pTile;
      case 1: {
        const d = isZero(player.dir) ? player.facing : player.dir;
        return { r: pTile.r + d.dy * 3, c: pTile.c + d.dx * 3 };
      }
      case 2: {
        // Cuts off the escape route: aims three tiles behind the player.
        const d = isZero(player.dir) ? player.facing : player.dir;
        return { r: pTile.r - d.dy * 3, c: pTile.c - d.dx * 3 };
      }
      case 3: {
        const g3 = ghosts[3];
        const dist = (g3.tile.r - pTile.r) ** 2 + (g3.tile.c - pTile.c) ** 2;
        return dist < 36 ? SCATTER_CORNERS[3] : pTile;
      }
      default:
        return pTile;
    }
  }

  function ghostDecide(g, target, opts) {
    const forGhost = opts && opts.throughDoor;
    const reverse = { dx: -g.dir.dx, dy: -g.dir.dy };
    let candidates = [];
    for (const d of DIRS) {
      if (!isZero(g.dir) && sameDir(d, reverse)) continue;
      const nr = g.tile.r + d.dy, nc = g.tile.c + d.dx;
      if (isOpenFor(nr, nc, forGhost)) candidates.push(d);
    }
    if (candidates.length === 0) {
      const nr = g.tile.r + reverse.dy, nc = g.tile.c + reverse.dx;
      if (isOpenFor(nr, nc, forGhost)) candidates = [reverse];
    }
    if (candidates.length === 0) {
      g.dir = NONE;
      return;
    }
    if (opts && opts.random) {
      g.dir = candidates[Math.floor(rng() * candidates.length)];
      return;
    }
    let best = null,
      bestD = Infinity;
    for (const d of candidates) {
      const nr = g.tile.r + d.dy, nc = g.tile.c + d.dx;
      const dist = (nr - target.r) ** 2 + (nc - target.c) ** 2;
      if (dist < bestD) {
        bestD = dist;
        best = d;
      }
    }
    g.dir = best;
  }

  // Guaranteed shortest-path direction toward an exact tile, used when a
  // ghost *must* actually arrive (heading home after being eaten, or
  // leaving the house) rather than just move plausibly. The greedy
  // nearest-to-target heuristic above is fine for roaming chase/scatter
  // behaviour, but it only ever compares straight-line distance and
  // refuses to reverse — right next to a target that can trap it in an
  // endless back-and-forth instead of ever stepping onto the target tile.
  // A real BFS has no such blind spot, so it's used instead for the one
  // case where getting stuck is a visible bug rather than just quirky AI.
  function bfsDirTo(sr, sc, tr, tc, forGhost) {
    if (sr === tr && sc === tc) return NONE;
    const startKey = sr + "," + sc;
    const visited = new Set([startKey]);
    const queue = [{ r: sr, c: sc, dir: null }];
    let head = 0;
    while (head < queue.length) {
      const cur = queue[head++];
      for (const d of DIRS) {
        const nr = cur.r + d.dy, nc = wrapCol(cur.c + d.dx, maze.cols);
        if (!isOpenFor(nr, nc, forGhost)) continue;
        const key = nr + "," + nc;
        if (visited.has(key)) continue;
        visited.add(key);
        const firstDir = cur.dir || d;
        if (nr === tr && nc === tc) return firstDir;
        queue.push({ r: nr, c: nc, dir: firstDir });
      }
    }
    return null; // target unreachable — shouldn't happen in a connected maze
  }

  function stepGhost(g, dt) {
    if (g.state === "inHouse") {
      g.bob += dt * 3;
      g.releaseTimer -= dt;
      if (g.releaseTimer <= 0) g.state = "exiting";
      return;
    }

    const homing = g.state === "exiting" || g.state === "eaten"; // must reliably arrive at the door
    let speed, target, opts;
    if (g.state === "exiting") {
      speed = ghostSpeedForLevel(level) * 0.7;
      target = exitTarget();
      opts = { throughDoor: true };
    } else if (g.state === "eaten") {
      speed = ghostSpeedForLevel(level) * 1.6;
      target = houseCenterTile();
      opts = { throughDoor: true };
    } else if (g.state === "frightened") {
      speed = frightSpeedForLevel(level);
      target = null;
      opts = { random: true };
    } else {
      speed = ghostSpeedForLevel(level);
      target = g.state === "scatter" ? SCATTER_CORNERS[g.idx] : chaseTargetFor(g.idx);
      opts = {};
    }

    if (g.state === "frightened") {
      g.frightTimer -= dt;
      if (g.frightTimer <= 0.001) {
        g.state = globalMode;
        setSirenExcited(ghosts.some((o) => o.state === "frightened"));
      }
    }

    function decide() {
      if (homing) {
        const d = bfsDirTo(g.tile.r, g.tile.c, target.r, target.c, true);
        g.dir = d || NONE;
      } else {
        ghostDecide(g, target, opts);
      }
    }

    if (isZero(g.dir)) decide();

    g.progress += speed * dt;
    while (g.progress >= 1) {
      g.progress -= 1;
      g.tile = { r: g.tile.r + g.dir.dy, c: wrapCol(g.tile.c + g.dir.dx, maze.cols) };

      if (g.state === "exiting" && g.tile.r <= maze.house.top - 1) {
        g.state = globalMode;
        break;
      }
      if (g.state === "eaten" && houseInteriorCenter(g)) {
        g.state = "inHouse";
        g.releaseTimer = 1.4;
        g.progress = 0;
        g.dir = NONE;
        return;
      }

      if (!homing) {
        target = g.state === "scatter" ? SCATTER_CORNERS[g.idx] : g.state === "chase" ? chaseTargetFor(g.idx) : target;
      }
      decide();
      if (isZero(g.dir)) {
        g.progress = 0;
        break;
      }
    }
  }

  // ---------------------------------------------------------------------
  // Update
  // ---------------------------------------------------------------------
  function updateGlobalMode(dt) {
    modeTimer -= dt;
    if (modeTimer <= 0 && modeIdx < MODE_SCHEDULE.length - 1) {
      modeIdx++;
      modeTimer = MODE_SCHEDULE[modeIdx];
      globalMode = modeIdx % 2 === 0 ? "scatter" : "chase";
      for (const g of ghosts) {
        if (g.state === "scatter" || g.state === "chase") g.state = globalMode;
      }
    }
  }

  function checkCollisions() {
    const p = playerFloatPos();
    for (const g of ghosts) {
      if (g.state === "inHouse" || g.state === "exiting" || g.state === "eaten") continue;
      const gp = ghostFloatPos(g);
      const dist2 = (p.r - gp.r) ** 2 + (p.c - gp.c) ** 2;
      if (dist2 < 0.32) {
        if (g.state === "frightened") {
          g.state = "eaten";
          addScore(GHOST_SCORE_BASE * comboMultiplier);
          comboMultiplier = Math.min(8, comboMultiplier * 2);
          sfx.eatGhost();
        } else {
          loseLife();
          return;
        }
      }
    }
  }

  function loseLife() {
    lives--;
    renderLives();
    sfx.death();
    if (lives <= 0) {
      endGame();
      return;
    }
    state = "dying";
    stateTimer = DYING_DURATION;
    stopSiren();
  }

  function update(dt) {
    if (state === "ready") {
      stateTimer -= dt;
      if (stateTimer <= 0) {
        state = "playing";
        startSiren();
      }
      return;
    }
    if (state === "dying") {
      stateTimer -= dt;
      if (stateTimer <= 0) {
        resetPositions();
        state = "ready";
        stateTimer = READY_DURATION;
      }
      return;
    }
    if (state === "levelclear") {
      stateTimer -= dt;
      if (stateTimer <= 0) startLevel(level + 1);
      return;
    }
    if (state !== "playing") return;

    updateGlobalMode(dt);
    stepPlayer(dt);
    for (const g of ghosts) stepGhost(g, dt);
    checkCollisions();
  }

  // ---------------------------------------------------------------------
  // Drawing
  // ---------------------------------------------------------------------
  function tileToPx(r, c) {
    return { x: c * TILE + TILE / 2, y: r * TILE + TILE / 2 };
  }

  function drawMaze() {
    // night-garden floor
    ctx.fillStyle = "#120d1c";
    ctx.fillRect(0, 0, VIRTUAL_W, VIRTUAL_H);

    for (let r = 0; r < maze.rows; r++) {
      for (let c = 0; c < maze.cols; c++) {
        const ch = maze.grid[r][c];
        const x = c * TILE, y = r * TILE;
        if (ch === "#") {
          // plum stone block with a lit top edge
          ctx.fillStyle = "#2c2340";
          roundRect(x + 1, y + 1, TILE - 2, TILE - 2, 5);
          ctx.fill();
          ctx.fillStyle = "#43365f";
          roundRect(x + 2, y + 2, TILE - 4, 5, 3);
          ctx.fill();
          ctx.strokeStyle = "#1a1328";
          ctx.lineWidth = 1;
          roundRect(x + 1, y + 1, TILE - 2, TILE - 2, 5);
          ctx.stroke();
        } else if (ch === "=") {
          // amber gate posts across the burrow entrance
          ctx.fillStyle = "#e8a33d";
          for (let k = 0; k < 3; k++) ctx.fillRect(x + 3 + k * 6, y + TILE / 2 - 4, 2.5, 8);
        }
      }
    }

    // seeds + star-berries
    const pulse = 0.82 + 0.18 * Math.sin(performance.now() / 200);
    for (let r = 0; r < maze.rows; r++) {
      for (let c = 0; c < maze.cols; c++) {
        if (!maze.dots[r][c]) continue;
        const { x, y } = tileToPx(r, c);
        if (maze.grid[r][c] === "o") {
          drawStar(x, y, 6.2 * pulse, 2.8 * pulse, "#ffd166", "#ff9f1c");
        } else {
          // small mint seed gem (diamond)
          ctx.fillStyle = "#9ff0c0";
          ctx.beginPath();
          ctx.moveTo(x, y - 2.6);
          ctx.lineTo(x + 2, y);
          ctx.lineTo(x, y + 2.6);
          ctx.lineTo(x - 2, y);
          ctx.closePath();
          ctx.fill();
        }
      }
    }
  }

  function drawStar(x, y, outer, inner, fill, glow) {
    ctx.save();
    ctx.shadowColor = glow;
    ctx.shadowBlur = 8;
    ctx.fillStyle = fill;
    ctx.beginPath();
    const spin = performance.now() / 1400;
    for (let k = 0; k < 10; k++) {
      const a = spin + (k * Math.PI) / 5 - Math.PI / 2;
      const rr = k % 2 === 0 ? outer : inner;
      if (k === 0) ctx.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
      else ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
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

  function dirAngle(d) {
    if (d.dx === 1) return 0;
    if (d.dx === -1) return Math.PI;
    if (d.dy === 1) return Math.PI / 2;
    if (d.dy === -1) return -Math.PI / 2;
    return 0;
  }

  function drawPlayer() {
    const pos = playerFloatPos();
    const px = pos.c * TILE + TILE / 2;
    const wrappedPx = ((px % VIRTUAL_W) + VIRTUAL_W) % VIRTUAL_W;
    const py = pos.r * TILE + TILE / 2;
    const moving = state === "playing" && !isZero(player.dir);
    if (moving) player.mouthT += 0.018 * (playerSpeedForLevel(level) * 60);
    const mouthOpen = moving ? 0.18 + 0.24 * Math.abs(Math.sin(player.mouthT * 0.02)) : 0.06;

    ctx.save();
    ctx.translate(wrappedPx, py);
    if (state === "dying") {
      const t = 1 - Math.max(0, stateTimer / DYING_DURATION);
      ctx.scale(1 - t * 0.9, 1 - t * 0.9);
      ctx.rotate(t * Math.PI * 2);
    }
    ctx.rotate(dirAngle(player.facing));

    // Munch: a green beetle seen from above, facing +x
    const radius = TILE / 2 - 1.5;
    const wiggle = moving ? Math.sin(player.mouthT * 0.03) * 1.6 : 0;

    // legs (three per side), scuttling while moving
    ctx.strokeStyle = "#1f8a3c";
    ctx.lineWidth = 1.3;
    ctx.lineCap = "round";
    for (let k = -1; k <= 1; k++) {
      for (const side of [-1, 1]) {
        const lx = k * 3.6;
        ctx.beginPath();
        ctx.moveTo(lx, side * radius * 0.55);
        ctx.lineTo(lx + (k === 0 ? wiggle : -wiggle) * side, side * (radius + 2.6));
        ctx.stroke();
      }
    }

    // shell
    ctx.fillStyle = "#5be37b";
    ctx.strokeStyle = "#1f8a3c";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.ellipse(-1, 0, radius * 0.92, radius * 0.82, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // wing-case seam + two shell spots
    ctx.beginPath();
    ctx.moveTo(-radius * 0.9, 0);
    ctx.lineTo(radius * 0.35, 0);
    ctx.stroke();
    ctx.fillStyle = "#3cb860";
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(-3.2, side * 3, 1.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // head
    ctx.fillStyle = "#3fbf62";
    ctx.beginPath();
    ctx.arc(radius * 0.72, 0, radius * 0.48, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // mandibles: open and close as Munch crunches
    const spread = 1.2 + mouthOpen * 7;
    ctx.strokeStyle = "#12351b";
    ctx.lineWidth = 1.5;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(radius * 1.1, side * 1.6);
      ctx.quadraticCurveTo(radius * 1.45, side * (spread + 0.5), radius * 1.55, side * spread * 0.35);
      ctx.stroke();
    }

    // eyes
    for (const side of [-1, 1]) {
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(radius * 0.86, side * 2.3, 1.7, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#12351b";
      ctx.beginPath();
      ctx.arc(radius * 0.98, side * 2.3, 0.9, 0, Math.PI * 2);
      ctx.fill();
    }

    // antennae with gold tips
    ctx.strokeStyle = "#1f8a3c";
    ctx.lineWidth = 1.1;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(radius * 0.95, side * 2.6);
      ctx.quadraticCurveTo(radius * 1.25, side * 6, radius * 1.05, side * 8.2);
      ctx.stroke();
      ctx.fillStyle = "#ffd166";
      ctx.beginPath();
      ctx.arc(radius * 1.05, side * 8.2, 1.3, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  function drawGhost(g) {
    const info = GHOST_INFO[g.idx];
    const pos = ghostFloatPos(g);
    const px = ((pos.c * TILE + TILE / 2) % VIRTUAL_W + VIRTUAL_W) % VIRTUAL_W;
    const py = pos.r * TILE + TILE / 2 + (g.state === "inHouse" ? Math.sin(g.bob) * 2 : 0);
    const r = TILE / 2 - 1.5;

    ctx.save();
    ctx.translate(px, py);

    const eaten = g.state === "eaten";
    const frightened = g.state === "frightened";
    const flashing = frightened && g.frightTimer < 1.6 && Math.floor(g.frightTimer * 6) % 2 === 0;

    const spin = performance.now() / 900 + g.idx * 1.3;

    if (eaten) {
      // a faint, see-through pod drifting back to the burrow
      ctx.globalAlpha = 0.28;
      ctx.fillStyle = info.color;
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.75, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 0.6;
      ctx.strokeStyle = info.color;
      ctx.setLineDash([2, 2]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.95, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      ctx.restore();
      return;
    }

    // Scared Thornbugs turn pale lilac with drooping spikes, flashing back
    // to their own colour just before the star-berry wears off.
    const body = frightened ? (flashing ? info.color : "#e3dbf3") : info.color;
    const edge = frightened ? (flashing ? info.dark : "#9b8fb8") : info.dark;
    const outerR = frightened ? r * 0.98 : r * 1.16;
    const innerR = r * 0.74;
    const points = 9;

    ctx.fillStyle = body;
    ctx.strokeStyle = edge;
    ctx.lineWidth = 1.2;
    ctx.lineJoin = "round";
    ctx.beginPath();
    for (let k = 0; k < points * 2; k++) {
      const a = spin + (k * Math.PI) / points;
      const rr = k % 2 === 0 ? outerR : innerR;
      const wob = frightened ? Math.sin(performance.now() / 120 + k) * 0.6 : 0;
      const px2 = Math.cos(a) * (rr + wob), py2 = Math.sin(a) * (rr + wob);
      if (k === 0) ctx.moveTo(px2, py2);
      else ctx.lineTo(px2, py2);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // one big eye
    const lookDx = g.dir.dx * 1.4, lookDy = g.dir.dy * 1.4;
    ctx.fillStyle = "#fbf8ff";
    ctx.beginPath();
    ctx.arc(0, 0, 3.6, 0, Math.PI * 2);
    ctx.fill();
    if (frightened && !flashing) {
      // dizzy swirl
      ctx.strokeStyle = "#5a4d78";
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      for (let t = 0; t < 1; t += 0.05) {
        const a = t * Math.PI * 4 + performance.now() / 150;
        const rr = 0.4 + t * 2.4;
        if (t === 0) ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
        else ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
      }
      ctx.stroke();
    } else {
      ctx.fillStyle = "#1b1530";
      ctx.beginPath();
      ctx.arc(lookDx, lookDy, 1.8, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  function drawOverlayText(text, sub) {
    ctx.save();
    ctx.textAlign = "center";
    ctx.fillStyle = "#ffe38a";
    ctx.font = "bold 16px 'Baloo 2', sans-serif";
    ctx.fillText(text, VIRTUAL_W / 2, VIRTUAL_H / 2 - 4);
    if (sub) {
      ctx.font = "12px 'Nunito', sans-serif";
      ctx.fillStyle = "#cbd5f5";
      ctx.fillText(sub, VIRTUAL_W / 2, VIRTUAL_H / 2 + 14);
    }
    ctx.restore();
  }

  function draw() {
    if (!maze) return;
    drawMaze();
    if (state !== "dying") for (const g of ghosts) drawGhost(g);
    drawPlayer();
    if (state === "ready") drawOverlayText("READY!");
    else if (state === "levelclear") drawOverlayText("MAZE CLEARED!", "Level " + (level + 2) + " next");
  }

  // ---------------------------------------------------------------------
  // Main loop
  // ---------------------------------------------------------------------
  let lastTime = 0;
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
    maze = buildMaze(0);
    dotsRemaining = maze.dotCount;
    player = newPlayer();
    ghosts = newGhosts();
    draw();

    requestAnimationFrame(frame);
  }

  try {
    boot();
  } catch (e) {
    console.error("[Maze Muncher] boot() failed:", e);
  }
})();
