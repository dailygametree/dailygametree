/* Tetromino — vanilla JS + Canvas2D, no external assets. Part of dailygametree.com. */

(function () {
  "use strict";

  // ---------------------------------------------------------------------
  // DOM references
  // ---------------------------------------------------------------------
  const canvas = document.getElementById("board-canvas");
  const ctx = canvas.getContext("2d");
  const skipCanvas = document.getElementById("skip-canvas");
  const skipCtx = skipCanvas.getContext("2d");
  const nextCanvas = document.getElementById("next-canvas");
  const nextCtx = nextCanvas.getContext("2d");

  const hud = document.getElementById("hud");
  const scoreEl = document.getElementById("score");
  const levelEl = document.getElementById("level");
  const linesEl = document.getElementById("lines");

  const startScreen = document.getElementById("start-screen");
  const pauseScreen = document.getElementById("pause-screen");
  const gameoverScreen = document.getElementById("gameover-screen");
  const startBtn = document.getElementById("start-btn");
  const restartBtn = document.getElementById("restart-btn");
  const resumeBtn = document.getElementById("resume-btn");
  const quitBtn = document.getElementById("quit-btn");
  const finalScoreEl = document.getElementById("final-score");
  const bestScoreEl = document.getElementById("best-score");

  const pauseBtn = document.getElementById("pause-btn");
  const muteBtn = document.getElementById("mute-btn");
  const muteWaves = muteBtn.querySelector(".mute-waves");
  const muteSlash = muteBtn.querySelector(".mute-slash");
  const skipBox = document.getElementById("skip-box");
  const skipTouchBtn = document.querySelector('.tc-btn[data-action="skip"]');

  // ---------------------------------------------------------------------
  // Sound — tiny SFX synthesized on the fly with the Web Audio API, no
  // external audio files. The AudioContext is created lazily on the
  // first user gesture, since browsers refuse to make sound before one.
  // ---------------------------------------------------------------------
  const SOUND_MUTED_KEY = "tetromino_muted";
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

  function playTone({ freq = 440, endFreq = null, type = "sine", duration = 0.1, volume = 0.14, attack = 0.004, delay = 0 }) {
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

  function playNoise({ duration = 0.12, volume = 0.16, filterFreq = 1200, delay = 0 }) {
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

  const sfx = {
    move() {
      playTone({ freq: 220, type: "square", duration: 0.02, volume: 0.045 });
    },
    rotate() {
      playTone({ freq: 480, endFreq: 620, type: "square", duration: 0.05, volume: 0.08 });
    },
    softdrop() {
      playTone({ freq: 160, type: "square", duration: 0.02, volume: 0.04 });
    },
    lock() {
      playNoise({ duration: 0.07, volume: 0.12, filterFreq: 500 });
    },
    skip() {
      playTone({ freq: 460, endFreq: 780, type: "triangle", duration: 0.1, volume: 0.1 });
    },
    clear(n) {
      const base = 520;
      for (let i = 0; i < n; i++) {
        playTone({ freq: base + i * 130, type: "square", duration: 0.1, volume: 0.14, delay: i * 0.05 });
      }
    },
    quad() {
      [520, 660, 780, 980].forEach((f, i) => {
        playTone({ freq: f, type: "square", duration: 0.14, volume: 0.16, delay: i * 0.06 });
      });
    },
    levelup() {
      playTone({ freq: 440, endFreq: 880, type: "triangle", duration: 0.3, volume: 0.14 });
    },
    gameover() {
      playTone({ freq: 300, endFreq: 60, type: "sawtooth", duration: 0.55, volume: 0.16 });
    },
    click() {
      playTone({ freq: 640, type: "square", duration: 0.04, volume: 0.08 });
    },
  };

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
  // Piece definitions — four rotation states per piece, each a set of
  // cell offsets within a small bounding box, plus a simple wall-kick
  // offset list.
  // ---------------------------------------------------------------------
  const COLS = 11;
  const ROWS = 20;

  const PIECES = {
    I: {
      color: "var(--i)",
      box: 4,
      rotations: [
        [[0, 1], [1, 1], [2, 1], [3, 1]],
        [[2, 0], [2, 1], [2, 2], [2, 3]],
        [[0, 2], [1, 2], [2, 2], [3, 2]],
        [[1, 0], [1, 1], [1, 2], [1, 3]],
      ],
    },
    O: {
      color: "var(--o)",
      box: 4,
      rotations: [
        [[1, 0], [2, 0], [1, 1], [2, 1]],
        [[1, 0], [2, 0], [1, 1], [2, 1]],
        [[1, 0], [2, 0], [1, 1], [2, 1]],
        [[1, 0], [2, 0], [1, 1], [2, 1]],
      ],
    },
    T: {
      color: "var(--t)",
      box: 3,
      rotations: [
        [[1, 0], [0, 1], [1, 1], [2, 1]],
        [[1, 0], [1, 1], [2, 1], [1, 2]],
        [[0, 1], [1, 1], [2, 1], [1, 2]],
        [[1, 0], [0, 1], [1, 1], [1, 2]],
      ],
    },
    S: {
      color: "var(--s)",
      box: 3,
      rotations: [
        [[1, 0], [2, 0], [0, 1], [1, 1]],
        [[1, 0], [1, 1], [2, 1], [2, 2]],
        [[1, 1], [2, 1], [0, 2], [1, 2]],
        [[0, 0], [0, 1], [1, 1], [1, 2]],
      ],
    },
    Z: {
      color: "var(--z)",
      box: 3,
      rotations: [
        [[0, 0], [1, 0], [1, 1], [2, 1]],
        [[2, 0], [1, 1], [2, 1], [1, 2]],
        [[0, 1], [1, 1], [1, 2], [2, 2]],
        [[1, 0], [0, 1], [1, 1], [0, 2]],
      ],
    },
    J: {
      color: "var(--j)",
      box: 3,
      rotations: [
        [[0, 0], [0, 1], [1, 1], [2, 1]],
        [[1, 0], [2, 0], [1, 1], [1, 2]],
        [[0, 1], [1, 1], [2, 1], [2, 2]],
        [[1, 0], [1, 1], [0, 2], [1, 2]],
      ],
    },
    L: {
      color: "var(--l)",
      box: 3,
      rotations: [
        [[2, 0], [0, 1], [1, 1], [2, 1]],
        [[1, 0], [1, 1], [1, 2], [2, 2]],
        [[0, 1], [1, 1], [2, 1], [0, 2]],
        [[0, 0], [1, 0], [1, 1], [1, 2]],
      ],
    },
  };
  PIECES.V = {
    color: "var(--v)",
    box: 2,
    rotations: [
      [[0, 0], [0, 1], [1, 1]],
      [[0, 0], [1, 0], [0, 1]],
      [[0, 0], [1, 0], [1, 1]],
      [[1, 0], [0, 1], [1, 1]],
    ],
  };
  const TYPES = Object.keys(PIECES);

  // A simple "try nearby offsets" list that keeps rotation feeling
  // forgiving near walls and the floor.
  const KICKS = [
    [0, 0], [-1, 0], [1, 0], [0, -1], [-1, -1], [1, -1], [-2, 0], [2, 0], [0, -2],
  ];

  function resolveColor(cssVar) {
    // Cached per color so we don't call getComputedStyle every frame.
    if (!resolveColor.cache) resolveColor.cache = {};
    if (resolveColor.cache[cssVar]) return resolveColor.cache[cssVar];
    const m = /var\((--[\w-]+)\)/.exec(cssVar);
    const value = m
      ? getComputedStyle(document.documentElement).getPropertyValue(m[1]).trim()
      : cssVar;
    resolveColor.cache[cssVar] = value;
    return value;
  }

  // ---------------------------------------------------------------------
  // Canvas sizing — board is always exactly COLS x ROWS cells; only the
  // pixel size of each cell scales to fit whatever space is available.
  // ---------------------------------------------------------------------
  let cellSize = 24;
  let offsetX = 0;
  let offsetY = 0;
  let dpr = Math.max(1, Math.min(2.5, window.devicePixelRatio || 1));

  function resizeCanvas() {
    dpr = Math.max(1, Math.min(2.5, window.devicePixelRatio || 1));

    const displayW = canvas.clientWidth;
    const displayH = canvas.clientHeight;
    canvas.width = Math.round(displayW * dpr);
    canvas.height = Math.round(displayH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    cellSize = Math.floor(Math.min(displayW / COLS, displayH / ROWS));
    offsetX = Math.round((displayW - cellSize * COLS) / 2);
    offsetY = Math.round((displayH - cellSize * ROWS) / 2);
  }
  window.addEventListener("resize", resizeCanvas);
  window.addEventListener("orientationchange", resizeCanvas);

  // ---------------------------------------------------------------------
  // Bag randomizer — every full bag contains each shape exactly once,
  // in a random order, so droughts of one piece never happen.
  // ---------------------------------------------------------------------
  let bag = [];
  function refillBagIfNeeded() {
    while (bag.length < TYPES.length) {
      const shuffled = TYPES.slice();
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      bag.push(...shuffled);
    }
  }
  function nextFromBag() {
    refillBagIfNeeded();
    return bag.shift();
  }

  // ---------------------------------------------------------------------
  // Persistent high score
  // ---------------------------------------------------------------------
  const HIGH_SCORE_KEY = "tetrominoHighScore";
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
  const LOCK_DELAY = 0.5; // seconds a grounded piece may sit before locking
  const MAX_LOCK_RESETS = 15; // player moves/rotates that can each buy more time
  const SOFT_DROP_INTERVAL = 0.03;

  let state = "start"; // 'start' | 'playing' | 'paused' | 'gameover'
  let grid; // grid[row][col] = color string, or null
  let piece; // { type, rot, x, y }
  const SKIP_COOLDOWN = 30; // seconds between uses of Skip
  let skipCooldown; // seconds remaining; 0 = ready
  let nextQueue;
  let score, level, totalLines;
  let dropInterval, tickTimer;
  let lockTimer, lockResetsUsed;
  let softDropping;

  function shapeCells(type, rot) {
    return PIECES[type].rotations[rot];
  }

  function isValidPosition(cells, px, py) {
    for (const [cx, cy] of cells) {
      const x = px + cx;
      const y = py + cy;
      if (x < 0 || x >= COLS || y >= ROWS) return false;
      if (y >= 0 && grid[y][x]) return false;
    }
    return true;
  }

  function spawnXFor(type) {
    const box = PIECES[type].box;
    return Math.floor((COLS - box) / 2);
  }

  function dropIntervalForLevel(lvl) {
    return Math.max(100, 1000 - (lvl - 1) * 70) / 1000;
  }

  function spawnPieceOfType(type) {
    piece = { type, rot: 0, x: spawnXFor(type), y: -1 };
    lockTimer = 0;
    lockResetsUsed = 0;
    if (!isValidPosition(shapeCells(type, 0), piece.x, piece.y)) {
      endGame();
    }
  }

  function spawnNext() {
    const type = nextQueue.shift();
    nextQueue.push(nextFromBag());
    spawnPieceOfType(type);
  }

  function resetGame() {
    grid = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
    bag = [];
    nextQueue = [nextFromBag(), nextFromBag(), nextFromBag()];
    skipCooldown = 0;
    score = 0;
    level = 1;
    totalLines = 0;
    dropInterval = dropIntervalForLevel(level);
    tickTimer = 0;
    softDropping = false;
    scoreEl.textContent = "0";
    levelEl.textContent = "1";
    linesEl.textContent = "0";
    spawnNext();
  }

  // ---------------------------------------------------------------------
  // Movement, rotation, skip, hard drop
  // ---------------------------------------------------------------------
  function isGrounded() {
    return !isValidPosition(shapeCells(piece.type, piece.rot), piece.x, piece.y + 1);
  }

  function onSuccessfulAdjust() {
    // A move/rotate that lands while grounded buys a little more time
    // before the lock delay finishes, up to a cap — this is what lets a
    // fast player slide a piece under an overhang at the last instant
    // without the piece locking mid-adjustment, while still guaranteeing
    // it eventually settles.
    if (isGrounded()) {
      if (lockResetsUsed < MAX_LOCK_RESETS) {
        lockTimer = 0;
        lockResetsUsed++;
      }
    } else {
      lockTimer = 0;
      lockResetsUsed = 0;
    }
  }

  function tryMove(dx, dy) {
    const nx = piece.x + dx;
    const ny = piece.y + dy;
    if (!isValidPosition(shapeCells(piece.type, piece.rot), nx, ny)) return false;
    piece.x = nx;
    piece.y = ny;
    return true;
  }

  function tryRotate(dir) {
    const rot = (piece.rot + dir + 4) % 4;
    const cells = shapeCells(piece.type, rot);
    for (const [ox, oy] of KICKS) {
      if (isValidPosition(cells, piece.x + ox, piece.y + oy)) {
        piece.rot = rot;
        piece.x += ox;
        piece.y += oy;
        return true;
      }
    }
    return false;
  }

  function ghostY() {
    let y = piece.y;
    while (isValidPosition(shapeCells(piece.type, piece.rot), piece.x, y + 1)) y++;
    return y;
  }

  function lockPiece() {
    const cells = shapeCells(piece.type, piece.rot);
    const color = PIECES[piece.type].color;
    for (const [cx, cy] of cells) {
      const x = piece.x + cx;
      const y = piece.y + cy;
      if (y >= 0 && y < ROWS && x >= 0 && x < COLS) grid[y][x] = color;
    }
    sfx.lock();
    const cleared = clearLines();
    applyScoreForClear(cleared);
    spawnNext();
  }

  function clearLines() {
    let cleared = 0;
    for (let y = ROWS - 1; y >= 0; y--) {
      if (grid[y].every((c) => c !== null)) {
        grid.splice(y, 1);
        grid.unshift(Array(COLS).fill(null));
        cleared++;
        y++; // re-check this row index, now holding what was above it
      }
    }
    return cleared;
  }

  const LINE_SCORES = { 1: 100, 2: 300, 3: 500, 4: 800 };
  function applyScoreForClear(cleared) {
    if (cleared > 0) {
      score += (LINE_SCORES[cleared] || 0) * level;
      totalLines += cleared;
      scoreEl.textContent = String(score);
      linesEl.textContent = String(totalLines);
      if (cleared >= 4) sfx.quad();
      else sfx.clear(cleared);

      const newLevel = Math.floor(totalLines / 10) + 1;
      if (newLevel !== level) {
        level = newLevel;
        dropInterval = dropIntervalForLevel(level);
        levelEl.textContent = String(level);
        sfx.levelup();
      }
    }
  }

  function hardDrop() {
    let dropped = 0;
    while (tryMove(0, 1)) dropped++;
    score += dropped * 2;
    scoreEl.textContent = String(score);
    lockPiece();
  }

  // Skip: throw away the current piece and bring in the next one. Usable
  // once every SKIP_COOLDOWN seconds (the timer only runs while playing).
  function skipPiece() {
    if (state !== "playing" || skipCooldown > 0) return;
    sfx.skip();
    skipCooldown = SKIP_COOLDOWN;
    spawnNext();
  }

  // ---------------------------------------------------------------------
  // Game flow
  // ---------------------------------------------------------------------
  function startGame() {
    sfx.click();
    hud.classList.remove("hidden");
    pauseBtn.classList.remove("hidden");
    resizeCanvas(); // board area's height changes now that the HUD is visible
    resetGame();
    state = "playing";
    startScreen.classList.add("hidden");
    pauseScreen.classList.add("hidden");
    gameoverScreen.classList.add("hidden");
  }

  function endGame() {
    state = "gameover";
    sfx.gameover();
    pauseBtn.classList.add("hidden");
    const finalScore = score;
    if (finalScore > highScore) {
      highScore = finalScore;
      saveHighScore(highScore);
    }
    finalScoreEl.textContent = "Score: " + finalScore;
    bestScoreEl.textContent = "Best: " + highScore;
    gameoverScreen.classList.remove("hidden");
  }

  function togglePause() {
    if (state === "playing") {
      state = "paused";
      sfx.click();
      pauseScreen.classList.remove("hidden");
    } else if (state === "paused") {
      state = "playing";
      sfx.click();
      pauseScreen.classList.add("hidden");
    }
  }

  function quitToMenu() {
    sfx.click();
    state = "start";
    hud.classList.add("hidden");
    pauseBtn.classList.add("hidden");
    pauseScreen.classList.add("hidden");
    gameoverScreen.classList.add("hidden");
    startScreen.classList.remove("hidden");
    resizeCanvas();
  }

  startBtn.addEventListener("click", startGame);
  restartBtn.addEventListener("click", startGame);
  resumeBtn.addEventListener("click", togglePause);
  quitBtn.addEventListener("click", quitToMenu);
  pauseBtn.addEventListener("click", () => {
    if (state === "playing" || state === "paused") togglePause();
  });


  // ---------------------------------------------------------------------
  // Input — keyboard (with delayed-auto-shift for held left/right) and
  // on-screen touch buttons (same actions, with the same auto-repeat for
  // left/right/soft-drop while held).
  // ---------------------------------------------------------------------
  const DAS_DELAY = 0.17; // seconds held before auto-repeat kicks in
  const AR_RATE = 0.05; // seconds between repeats once it does

  let heldDir = 0; // -1, 0, or 1 — left/right currently held
  let dasTimer = 0;
  let arTimer = 0;

  function setHeldDir(dir) {
    if (state !== "playing") return;
    if (heldDir === dir) return;
    heldDir = dir;
    dasTimer = 0;
    arTimer = 0;
    if (dir !== 0) {
      if (tryMove(dir, 0)) {
        sfx.move();
        onSuccessfulAdjust();
      }
    }
  }

  function doRotate(dir) {
    if (state !== "playing") return;
    if (tryRotate(dir)) {
      sfx.rotate();
      onSuccessfulAdjust();
    }
  }

  function setSoftDrop(on) {
    if (state !== "playing") on = false;
    softDropping = on;
  }

  window.addEventListener("keydown", (e) => {
    if (e.repeat) return;
    if (e.code === "Enter" && (state === "start" || state === "gameover")) {
      e.preventDefault();
      startGame();
      return;
    }
    if (e.code === "KeyP" || e.code === "Escape") {
      if (state === "playing" || state === "paused") {
        e.preventDefault();
        togglePause();
      }
      return;
    }
    if (state !== "playing") return;
    if (e.code === "ArrowLeft" || e.code === "KeyA") {
      e.preventDefault();
      setHeldDir(-1);
    } else if (e.code === "ArrowRight" || e.code === "KeyD") {
      e.preventDefault();
      setHeldDir(1);
    } else if (e.code === "ArrowDown" || e.code === "KeyS") {
      e.preventDefault();
      setSoftDrop(true);
    } else if (e.code === "ArrowUp" || e.code === "KeyW" || e.code === "KeyX") {
      e.preventDefault();
      doRotate(1);
    } else if (e.code === "KeyZ" || e.code === "ControlLeft" || e.code === "ControlRight") {
      e.preventDefault();
      doRotate(-1);
    } else if (e.code === "Space") {
      e.preventDefault();
      hardDrop();
    } else if (e.code === "KeyC" || e.code === "ShiftLeft" || e.code === "ShiftRight") {
      e.preventDefault();
      skipPiece();
    }
  });

  window.addEventListener("keyup", (e) => {
    if (e.code === "ArrowLeft" || e.code === "KeyA") {
      if (heldDir === -1) setHeldDir(0);
    } else if (e.code === "ArrowRight" || e.code === "KeyD") {
      if (heldDir === 1) setHeldDir(0);
    } else if (e.code === "ArrowDown" || e.code === "KeyS") {
      setSoftDrop(false);
    }
  });

  // Release held movement if focus/visibility is lost mid-press, so a
  // piece never keeps sliding forever after an Alt-Tab.
  window.addEventListener("blur", () => {
    setHeldDir(0);
    setSoftDrop(false);
  });

  skipBox.addEventListener("click", () => skipPiece());

  for (const btn of document.querySelectorAll(".tc-btn")) {
    const action = btn.dataset.action;
    if (action === "left" || action === "right") {
      const dir = action === "left" ? -1 : 1;
      btn.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        setHeldDir(dir);
      });
      btn.addEventListener("pointerup", () => {
        if (heldDir === dir) setHeldDir(0);
      });
      btn.addEventListener("pointercancel", () => {
        if (heldDir === dir) setHeldDir(0);
      });
      btn.addEventListener("pointerleave", () => {
        if (heldDir === dir) setHeldDir(0);
      });
    } else if (action === "softdrop") {
      btn.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        setSoftDrop(true);
      });
      btn.addEventListener("pointerup", () => setSoftDrop(false));
      btn.addEventListener("pointercancel", () => setSoftDrop(false));
      btn.addEventListener("pointerleave", () => setSoftDrop(false));
    } else if (action === "rotate") {
      btn.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        doRotate(1);
      });
    } else if (action === "harddrop") {
      btn.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        if (state === "playing") hardDrop();
      });
    } else if (action === "skip") {
      btn.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        skipPiece();
      });
    }
  }

  // ---------------------------------------------------------------------
  // Update
  // ---------------------------------------------------------------------
  function update(dt) {
    if (state !== "playing") return;

    if (skipCooldown > 0) skipCooldown = Math.max(0, skipCooldown - dt);

    // Auto-repeat for a held left/right key or touch button.
    if (heldDir !== 0) {
      dasTimer += dt;
      if (dasTimer >= DAS_DELAY) {
        arTimer += dt;
        while (arTimer >= AR_RATE) {
          arTimer -= AR_RATE;
          if (tryMove(heldDir, 0)) {
            sfx.move();
            onSuccessfulAdjust();
          } else {
            break;
          }
        }
      }
    }

    // Gravity — much faster while soft-dropping, and each successful
    // soft-dropped row is worth a point (hard drop scores separately).
    const interval = softDropping ? SOFT_DROP_INTERVAL : dropInterval;
    tickTimer += dt;
    while (tickTimer >= interval && state === "playing") {
      tickTimer -= interval;
      if (tryMove(0, 1)) {
        if (softDropping) {
          score += 1;
          scoreEl.textContent = String(score);
        }
      } else {
        break; // grounded — the lock-delay check below takes over
      }
    }

    // Lock delay — accumulates only while grounded; resets whenever the
    // piece is airborne (see onSuccessfulAdjust for the move/rotate case).
    if (state === "playing") {
      if (isGrounded()) {
        lockTimer += dt;
        if (lockTimer >= LOCK_DELAY) lockPiece();
      } else {
        lockTimer = 0;
        lockResetsUsed = 0;
      }
    }
  }

  // ---------------------------------------------------------------------
  // Draw
  // ---------------------------------------------------------------------
  function drawBlock(targetCtx, x, y, size, color) {
    targetCtx.fillStyle = color;
    targetCtx.fillRect(x, y, size, size);

    const bevel = Math.max(2, Math.round(size * 0.14));
    targetCtx.fillStyle = "rgba(255,255,255,0.35)";
    targetCtx.fillRect(x, y, size, bevel);
    targetCtx.fillRect(x, y, bevel, size);
    targetCtx.fillStyle = "rgba(0,0,0,0.28)";
    targetCtx.fillRect(x, y + size - bevel, size, bevel);
    targetCtx.fillRect(x + size - bevel, y, bevel, size);

    targetCtx.strokeStyle = "rgba(0,0,0,0.35)";
    targetCtx.lineWidth = 1;
    targetCtx.strokeRect(x + 0.5, y + 0.5, size - 1, size - 1);
  }

  function cellPx(gx, gy) {
    return { x: offsetX + gx * cellSize, y: offsetY + gy * cellSize };
  }

  function drawBoard() {
    const w = canvas.width / dpr;
    const h = canvas.height / dpr;
    ctx.clearRect(0, 0, w, h);

    // Board background + subtle grid, inset by the letterboxed offset.
    ctx.fillStyle = "#11151f";
    ctx.fillRect(offsetX, offsetY, cellSize * COLS, cellSize * ROWS);
    ctx.strokeStyle = "rgba(255,255,255,0.04)";
    ctx.lineWidth = 1;
    for (let x = 0; x <= COLS; x++) {
      const px = offsetX + x * cellSize + 0.5;
      ctx.beginPath();
      ctx.moveTo(px, offsetY);
      ctx.lineTo(px, offsetY + cellSize * ROWS);
      ctx.stroke();
    }
    for (let y = 0; y <= ROWS; y++) {
      const py = offsetY + y * cellSize + 0.5;
      ctx.beginPath();
      ctx.moveTo(offsetX, py);
      ctx.lineTo(offsetX + cellSize * COLS, py);
      ctx.stroke();
    }

    // Locked blocks.
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const color = grid[y][x];
        if (color) {
          const p = cellPx(x, y);
          drawBlock(ctx, p.x, p.y, cellSize, resolveColor(color));
        }
      }
    }

    if (state === "playing" || state === "paused") {
      // Ghost — a translucent preview of where the piece will land.
      const gy = ghostY();
      const color = resolveColor(PIECES[piece.type].color);
      for (const [cx, cy] of shapeCells(piece.type, piece.rot)) {
        const y = gy + cy;
        if (y < 0) continue;
        const p = cellPx(piece.x + cx, y);
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.16;
        ctx.fillRect(p.x, p.y, cellSize, cellSize);
        ctx.globalAlpha = 1;
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.strokeRect(p.x + 1, p.y + 1, cellSize - 2, cellSize - 2);
      }

      // Current piece.
      for (const [cx, cy] of shapeCells(piece.type, piece.rot)) {
        const y = piece.y + cy;
        if (y < 0) continue;
        const p = cellPx(piece.x + cx, y);
        drawBlock(ctx, p.x, p.y, cellSize, color);
      }
    }
  }

  // Centers the piece both horizontally in `canvasWidth` and vertically
  // within the [rowY, rowY + rowH) band, using its actual bounding box
  // (pieces vary from 1 to 2 rows tall in their default orientation, so
  // a fixed assumed height would leave the flat I piece off-center).
  function drawMiniPiece(targetCtx, type, canvasWidth, rowY, rowH, size) {
    const cells = shapeCells(type, 0);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const [cx, cy] of cells) {
      minX = Math.min(minX, cx);
      maxX = Math.max(maxX, cx);
      minY = Math.min(minY, cy);
      maxY = Math.max(maxY, cy);
    }
    const w = (maxX - minX + 1) * size;
    const h = (maxY - minY + 1) * size;
    const startX = (canvasWidth - w) / 2 - minX * size;
    const startY = rowY + (rowH - h) / 2 - minY * size;
    const color = resolveColor(PIECES[type].color);
    for (const [cx, cy] of cells) {
      drawBlock(targetCtx, startX + cx * size, startY + cy * size, size, color);
    }
  }

  function drawSkip() {
    const w = skipCanvas.width, h = skipCanvas.height;
    skipCtx.clearRect(0, 0, w, h);
    const ready = skipCooldown <= 0;
    const cx = w / 2, cy = h / 2;

    // Double-arrow "skip" icon
    skipCtx.globalAlpha = ready ? 1 : 0.25;
    skipCtx.fillStyle = "#00e5ff";
    for (const dx of [-14, 8]) {
      skipCtx.beginPath();
      skipCtx.moveTo(cx + dx - 4, cy - 20);
      skipCtx.lineTo(cx + dx + 20, cy);
      skipCtx.lineTo(cx + dx - 4, cy + 20);
      skipCtx.closePath();
      skipCtx.fill();
    }
    skipCtx.globalAlpha = 1;

    if (!ready) {
      // Countdown + a thin progress bar along the bottom
      skipCtx.fillStyle = "#e8eaed";
      skipCtx.font = "bold 34px monospace";
      skipCtx.textAlign = "center";
      skipCtx.textBaseline = "middle";
      skipCtx.fillText(String(Math.ceil(skipCooldown)), cx, cy);
      const frac = 1 - skipCooldown / SKIP_COOLDOWN;
      skipCtx.fillStyle = "rgba(255,255,255,0.15)";
      skipCtx.fillRect(6, h - 10, w - 12, 5);
      skipCtx.fillStyle = "#00e5ff";
      skipCtx.fillRect(6, h - 10, (w - 12) * frac, 5);
    }

    skipBox.classList.toggle("cooling", !ready);
    if (skipTouchBtn) {
      const label = ready ? "SKIP" : String(Math.ceil(skipCooldown));
      if (skipTouchBtn.textContent !== label) skipTouchBtn.textContent = label;
      skipTouchBtn.classList.toggle("cooling", !ready);
    }
  }

  function drawNext() {
    const w = nextCanvas.width, h = nextCanvas.height;
    nextCtx.clearRect(0, 0, w, h);
    const rowH = h / 3;
    for (let i = 0; i < 3 && i < nextQueue.length; i++) {
      drawMiniPiece(nextCtx, nextQueue[i], w, i * rowH, rowH, 16);
    }
  }

  function draw() {
    drawBoard();
    drawSkip();
    drawNext();
  }

  // ---------------------------------------------------------------------
  // Main loop
  // ---------------------------------------------------------------------
  let lastTime = 0;
  function frame(t) {
    if (!lastTime) lastTime = t;
    let dt = (t - lastTime) / 1000;
    lastTime = t;
    dt = Math.min(dt, 1 / 20); // clamp huge gaps (tab switch, etc.)

    update(dt);
    draw();

    requestAnimationFrame(frame);
  }

  // ---------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------
  function boot() {
    resizeCanvas();
    resetGame(); // populate a static idle scene (board + next queue) behind the start screen
    draw();
    requestAnimationFrame(frame);
  }

  try {
    boot();
  } catch (e) {
    console.error("[Tetromino] boot() failed:", e);
  }
})();
