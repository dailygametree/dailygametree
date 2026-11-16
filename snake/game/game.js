/* Snake — vanilla JS + Canvas2D, no external assets. Part of dailygametree.com. */

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
  const bestLiveEl = document.getElementById("best-live");
  const muteBtn = document.getElementById("mute-btn");
  const muteWaves = muteBtn.querySelector(".mute-waves");
  const muteSlash = muteBtn.querySelector(".mute-slash");

  // ---------------------------------------------------------------------
  // Sound — tiny SFX synthesized on the fly with the Web Audio API, no
  // external audio files. Every sound is a short oscillator with a fast
  // envelope; nothing is ever loaded.
  //
  // The AudioContext is created lazily on the first user gesture, since
  // browsers refuse to make sound before one.
  // ---------------------------------------------------------------------
  const SOUND_MUTED_KEY = "snake_muted";
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

  function playTone({ freq = 440, endFreq = null, type = "sine", duration = 0.1, volume = 0.16, attack = 0.005, delay = 0 }) {
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

  const sfx = {
    eat() {
      playTone({ freq: 520, endFreq: 720, type: "square", duration: 0.07, volume: 0.14 });
    },
    turn() {
      playTone({ freq: 300, type: "sine", duration: 0.02, volume: 0.03 });
    },
    gameover() {
      playTone({ freq: 380, endFreq: 80, type: "sawtooth", duration: 0.45, volume: 0.18 });
    },
    click() {
      playTone({ freq: 680, type: "square", duration: 0.045, volume: 0.09 });
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
  // Grid + canvas sizing — the grid's column/row count is derived from
  // the screen's aspect ratio so cells stay roughly square-ish and a
  // comfortable touch size on any device. The grid is only recomputed
  // when a round isn't in progress (start/gameover), so an in-progress
  // snake never finds itself outside a shrunken board.
  // ---------------------------------------------------------------------
  let COLS = 15;
  let ROWS = 21;
  let cellSize = 24;
  let offsetX = 0;
  let offsetY = 0;
  let dpr = Math.max(1, Math.min(2.5, window.devicePixelRatio || 1));

  function computeGrid() {
    const wrap = document.getElementById("game-wrap");
    const w = wrap.clientWidth;
    const h = wrap.clientHeight;
    // Square board: one grid size for both axes, sized off whichever
    // screen dimension is tighter (on a phone that's the width).
    const side = Math.min(w, h);
    const target = Math.max(16, Math.min(30, Math.round(side / 16)));
    const n = Math.max(11, Math.min(23, Math.round(side / target)));
    COLS = n;
    ROWS = n;
  }

  function resizeCanvas() {
    const wrap = document.getElementById("game-wrap");
    const displayW = wrap.clientWidth;
    const displayH = wrap.clientHeight;

    if (state !== "playing") computeGrid();

    dpr = Math.max(1, Math.min(2.5, window.devicePixelRatio || 1));
    canvas.width = Math.round(displayW * dpr);
    canvas.height = Math.round(displayH * dpr);
    canvas.style.width = displayW + "px";
    canvas.style.height = displayH + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    cellSize = Math.floor(Math.min(displayW / COLS, displayH / ROWS));
    offsetX = Math.round((displayW - cellSize * COLS) / 2);
    offsetY = Math.round((displayH - cellSize * ROWS) / 2);
  }
  window.addEventListener("resize", resizeCanvas);
  window.addEventListener("orientationchange", resizeCanvas);

  // ---------------------------------------------------------------------
  // Input — arrow keys/WASD (absolute direction) on desktop, a single
  // tap on the left/right half of the board (turn left/right relative to
  // the current heading) on touch — simpler than a 4-way D-pad, since a
  // moving snake only ever needs "turn left" or "turn right".
  // ---------------------------------------------------------------------
  const DIRS = {
    up: { x: 0, y: -1 },
    down: { x: 0, y: 1 },
    left: { x: -1, y: 0 },
    right: { x: 1, y: 0 },
  };

  function setNextDir(d) {
    // Ignore a reversal into the snake's own neck (that's not a legal
    // move in classic snake — it would just be instant death).
    if (dir.x === -d.x && dir.y === -d.y && snake.length > 1) return;
    nextDir = d;
    if (state === "start" || state === "gameover") startGame();
  }

  function queueDir(name) {
    const d = DIRS[name];
    if (d) setNextDir(d);
  }

  // Clockwise order of headings as seen on screen (down is +y): turning
  // right/left just steps one place forward/back through this cycle
  // relative to whichever way the snake is already facing.
  const CLOCKWISE = [DIRS.right, DIRS.down, DIRS.left, DIRS.up];
  function queueTurn(clockwise) {
    const idx = CLOCKWISE.findIndex((d) => d.x === dir.x && d.y === dir.y);
    const next = CLOCKWISE[(idx + (clockwise ? 1 : 3)) % 4];
    setNextDir(next);
  }

  window.addEventListener("keydown", (e) => {
    if (e.code === "ArrowUp" || e.code === "KeyW") queueDir("up");
    else if (e.code === "ArrowDown" || e.code === "KeyS") queueDir("down");
    else if (e.code === "ArrowLeft" || e.code === "KeyA") queueDir("left");
    else if (e.code === "ArrowRight" || e.code === "KeyD") queueDir("right");
    else if (e.code === "Space" && (state === "start" || state === "gameover")) {
      e.preventDefault();
      startGame();
    } else return;
    e.preventDefault();
  });

  // Tap the left/right half of the board to turn that way. (The start
  // and game-over overlays sit on top of the canvas and have their own
  // buttons, so this only ever fires during actual play.)
  canvas.addEventListener("pointerdown", (e) => {
    if (state !== "playing") return;
    const rect = canvas.getBoundingClientRect();
    const half = rect.left + rect.width / 2;
    queueTurn(e.clientX >= half);
  });

  // ---------------------------------------------------------------------
  // Persistent high score
  // ---------------------------------------------------------------------
  const HIGH_SCORE_KEY = "snakeHighScore";
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
  const FOOD_COLORS = ["#ef5b3c", "#f5a623", "#2f8ae5", "#8b5cf6"];
  const BASE_TICK = 0.15; // seconds per move at the start
  const MIN_TICK = 0.078; // fastest the snake ever moves
  const POINTS_PER_FOOD = 1;

  let state = "start"; // 'start' | 'playing' | 'gameover'
  let snake, prevSnake, dir, nextDir, food, foodColor, score, tickTimer, tickInterval;

  function tickIntervalForScore(s) {
    // Each point is one food eaten now, so this ramps every 4 food eaten.
    const speedUps = Math.floor(s / 4);
    return Math.max(MIN_TICK, BASE_TICK - speedUps * 0.006);
  }

  function randomEmptyCell() {
    while (true) {
      const c = { x: Math.floor(Math.random() * COLS), y: Math.floor(Math.random() * ROWS) };
      if (!snake.some((s) => s.x === c.x && s.y === c.y)) return c;
    }
  }

  function spawnFood() {
    food = randomEmptyCell();
    foodColor = FOOD_COLORS[Math.floor(Math.random() * FOOD_COLORS.length)];
  }

  function resetGame() {
    const cx = Math.floor(COLS / 2);
    const cy = Math.floor(ROWS / 2);
    snake = [
      { x: cx - 1, y: cy },
      { x: cx - 2, y: cy },
      { x: cx - 3, y: cy },
    ];
    dir = { x: 1, y: 0 };
    nextDir = dir;
    prevSnake = snake.map((s) => ({ x: s.x, y: s.y }));
    score = 0;
    tickTimer = 0;
    tickInterval = tickIntervalForScore(0);
    spawnFood();
    scoreEl.textContent = "0";
  }

  function startGame() {
    sfx.click();
    resizeCanvas(); // safe to lock in a fresh grid — no round was in progress
    resetGame();
    state = "playing";
    startScreen.classList.add("hidden");
    gameoverScreen.classList.add("hidden");
    hud.classList.remove("hidden");
  }

  function endGame() {
    state = "gameover";
    sfx.gameover();
    hud.classList.add("hidden");
    const finalScore = score;
    if (finalScore > highScore) {
      highScore = finalScore;
      saveHighScore(highScore);
    }
    finalScoreEl.textContent = "Score: " + finalScore;
    bestScoreEl.textContent = "Best: " + highScore;
    gameoverScreen.classList.remove("hidden");
  }

  startBtn.addEventListener("click", startGame);
  restartBtn.addEventListener("click", startGame);


  // ---------------------------------------------------------------------
  // Update — advances the snake one cell every tickInterval seconds
  // ---------------------------------------------------------------------
  function step() {
    // Snapshot the pre-move positions so draw() can interpolate a smooth
    // slide between them and the post-move positions, instead of the
    // snake visibly popping forward one cell at a time.
    prevSnake = snake.map((s) => ({ x: s.x, y: s.y }));
    dir = nextDir;
    const head = snake[0];
    const newHead = { x: head.x + dir.x, y: head.y + dir.y };

    if (newHead.x < 0 || newHead.x >= COLS || newHead.y < 0 || newHead.y >= ROWS) {
      endGame();
      return;
    }
    // Self-collision — the tail cell is about to move away unless the
    // snake is growing this step, so it doesn't count as an obstacle.
    const willGrow = newHead.x === food.x && newHead.y === food.y;
    const bodyToCheck = willGrow ? snake : snake.slice(0, -1);
    if (bodyToCheck.some((s) => s.x === newHead.x && s.y === newHead.y)) {
      endGame();
      return;
    }

    snake.unshift(newHead);
    if (willGrow) {
      score += POINTS_PER_FOOD;
      scoreEl.textContent = String(score);
      tickInterval = tickIntervalForScore(score);
      sfx.eat();
      spawnFood();
    } else {
      snake.pop();
    }
  }

  function update(dt) {
    if (state !== "playing") return;
    tickTimer += dt;
    while (tickTimer >= tickInterval && state === "playing") {
      tickTimer -= tickInterval;
      step();
    }
  }

  // ---------------------------------------------------------------------
  // Draw
  // ---------------------------------------------------------------------
  const BOARD_A = "#b2da5b";
  const BOARD_B = "#a7cf4f";
  const SNAKE_BODY = "#7c4dff";
  const SNAKE_OUTLINE = "#5522b8";

  function cellRect(gx, gy) {
    return {
      x: offsetX + gx * cellSize,
      y: offsetY + gy * cellSize,
      w: cellSize,
      h: cellSize,
    };
  }

  function drawBoard() {
    const w = canvas.width / dpr;
    const h = canvas.height / dpr;
    ctx.fillStyle = "#dfe4e8";
    ctx.fillRect(0, 0, w, h);
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const r = cellRect(x, y);
        ctx.fillStyle = (x + y) % 2 === 0 ? BOARD_A : BOARD_B;
        ctx.fillRect(r.x, r.y, r.w, r.h);
      }
    }
  }

  function drawFood() {
    const r = cellRect(food.x, food.y);
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    const radius = r.w * 0.34;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fillStyle = foodColor;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx - radius * 0.32, cy - radius * 0.32, radius * 0.32, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,255,255,0.45)";
    ctx.fill();
  }

  // Drawn as one continuous rounded tube through the centre of every
  // segment (round line joins/caps do the work) rather than as separate
  // squares — this is what makes it read as a single long snake instead
  // of a row of tiles.
  function drawSnake() {
    // Interpolate every segment between where it was at the start of the
    // current tick (prevSnake) and where it ends up (snake), by how far
    // through that tick we are. That turns the per-cell jump into a
    // continuous slide, at whatever frame rate the display runs.
    const t = state === "playing" ? Math.min(1, tickTimer / tickInterval) : 1;
    const pts = snake.map((seg, i) => {
      const from = i < prevSnake.length ? prevSnake[i] : seg;
      const fx = offsetX + from.x * cellSize + cellSize / 2;
      const fy = offsetY + from.y * cellSize + cellSize / 2;
      const tx = offsetX + seg.x * cellSize + cellSize / 2;
      const ty = offsetY + seg.y * cellSize + cellSize / 2;
      return { x: fx + (tx - fx) * t, y: fy + (ty - fy) * t };
    });

    const bodyWidth = cellSize * 0.72;

    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);

    // A slightly wider, darker stroke first gives the tube a defined
    // edge/depth, then the true body color is stroked on top of it.
    ctx.strokeStyle = SNAKE_OUTLINE;
    ctx.lineWidth = bodyWidth + cellSize * 0.14;
    ctx.stroke();
    ctx.strokeStyle = SNAKE_BODY;
    ctx.lineWidth = bodyWidth;
    ctx.stroke();

    // Eyes on the head, facing the direction of travel.
    const head = pts[0];
    const eyeR = Math.max(1.5, cellSize * 0.09);
    const forward = dir;
    const side = { x: -forward.y, y: forward.x };
    const eyeOffsetF = cellSize * 0.16;
    const eyeOffsetS = cellSize * 0.18;
    for (const s of [-1, 1]) {
      const ex = head.x + forward.x * eyeOffsetF + side.x * eyeOffsetS * s;
      const ey = head.y + forward.y * eyeOffsetF + side.y * eyeOffsetS * s;
      ctx.beginPath();
      ctx.arc(ex, ey, eyeR, 0, Math.PI * 2);
      ctx.fillStyle = "#fff";
      ctx.fill();
      ctx.beginPath();
      ctx.arc(ex + forward.x * eyeR * 0.4, ey + forward.y * eyeR * 0.4, eyeR * 0.5, 0, Math.PI * 2);
      ctx.fillStyle = "#1f2330";
      ctx.fill();
    }
  }

  function draw() {
    drawBoard();
    drawFood();
    drawSnake();
    bestLiveEl.textContent = String(Math.max(highScore, score));
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
    computeGrid();
    resizeCanvas();
    resetGame(); // populate a static idle scene behind the start screen
    draw();

    requestAnimationFrame(frame);
  }

  try {
    boot();
  } catch (e) {
    console.error("[Snake] boot() failed:", e);
  }
})();
