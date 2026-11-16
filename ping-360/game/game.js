/* Ping 360 — vanilla JS + Canvas2D, no external assets. Part of dailygametree.com. */

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
  const SOUND_MUTED_KEY = "p360_muted";
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

  const sfx = {
    hitPaddle(rally) {
      const pitch = Math.min(760, 300 + rally * 16);
      playTone({ freq: pitch, type: "square", duration: 0.06, volume: 0.14 });
    },
    escape() {
      playTone({ freq: 420, endFreq: 90, type: "sawtooth", duration: 0.45, volume: 0.2 });
    },
    gameOver() {
      playTone({ freq: 380, endFreq: 40, type: "sawtooth", duration: 0.9, volume: 0.22 });
    },
    levelUp() {
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
  // Virtual resolution + canvas fit (letterboxed, square arena kept at a
  // fixed aspect ratio rather than stretched to the device).
  // ---------------------------------------------------------------------
  const VIRTUAL_W = 600;
  const VIRTUAL_H = 600;
  const CX = VIRTUAL_W / 2;
  const CY = VIRTUAL_H / 2;
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

  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }
  function wrapAngle(a) {
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    return a;
  }

  // ---------------------------------------------------------------------
  // Input — keyboard (held) to rotate, an on-screen rotate pad (held),
  // and direct drag anywhere on the ring to place the paddle instantly.
  // ---------------------------------------------------------------------
  const keys = { left: false, right: false };

  window.addEventListener("keydown", (e) => {
    if (e.code === "ArrowLeft" || e.code === "KeyA") {
      keys.left = true;
      e.preventDefault();
    } else if (e.code === "ArrowRight" || e.code === "KeyD") {
      keys.right = true;
      e.preventDefault();
    } else if (e.code === "Space" || e.code === "Enter") {
      if (state === "start" || state === "gameover") {
        e.preventDefault();
        startGame();
      }
    }
  });
  window.addEventListener("keyup", (e) => {
    if (e.code === "ArrowLeft" || e.code === "KeyA") keys.left = false;
    else if (e.code === "ArrowRight" || e.code === "KeyD") keys.right = false;
  });

  const isTouchDevice = "ontouchstart" in window || navigator.maxTouchPoints > 0;
  if (isTouchDevice) dpad.classList.remove("hidden");

  dpad.querySelectorAll(".dpad-btn").forEach((btn) => {
    const dir = btn.dataset.dir; // "left" | "right"
    const set = (v) => (keys[dir] = v);
    btn.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      set(true);
    });
    btn.addEventListener("pointerup", () => set(false));
    btn.addEventListener("pointercancel", () => set(false));
    btn.addEventListener("pointerleave", () => set(false));
  });

  let dragActive = false;
  let dragTargetAngle = null;
  function updateDragFromTouch(e) {
    const t = e.changedTouches[0];
    const rect = canvas.getBoundingClientRect();
    const relX = ((t.clientX - rect.left) / rect.width) * VIRTUAL_W;
    const relY = ((t.clientY - rect.top) / rect.height) * VIRTUAL_H;
    dragTargetAngle = Math.atan2(relY - CY, relX - CX);
  }
  canvas.addEventListener(
    "touchstart",
    (e) => {
      dragActive = true;
      updateDragFromTouch(e);
    },
    { passive: true }
  );
  canvas.addEventListener(
    "touchmove",
    (e) => {
      if (dragActive) updateDragFromTouch(e);
    },
    { passive: true }
  );
  canvas.addEventListener("touchend", () => {
    dragActive = false;
  });

  // ---------------------------------------------------------------------
  // Persistent high score
  // ---------------------------------------------------------------------
  const HIGH_SCORE_KEY = "pong360HighScore";
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
  const RING_R = 250;
  const PADDLE_THICKNESS = 22;
  const BALL_R = 9;
  const PLAYER_ANGULAR_SPEED = 2.7; // rad/s
  const BASE_HALF_WIDTH = 0.42; // rad, ~24°
  const MIN_HALF_WIDTH = 0.18; // rad, ~10°
  const HALF_WIDTH_SHRINK_PER_LEVEL = 0.02;
  const BASE_BALL_SPEED = 65; // deliberately super slow — it ramps up from here
  const MAX_BALL_SPEED = 620;
  const SPEED_HIT_INC = 15;
  const SPEED_LEVEL_INC = 12;
  const MAX_DEFLECT = 0.85; // extra rad of spin added at the paddle's edge
  const POINTS_PER_LEVEL = 5;
  const READY_DURATION = 0.8;
  const ESCAPE_DURATION = 0.5; // how long a missed ball keeps flying outward before reset
  const EXTRA_LIFE_THRESHOLDS = [500, 1200, 2200, 3500];

  function halfWidthFor(lvl) {
    return Math.max(MIN_HALF_WIDTH, BASE_HALF_WIDTH - lvl * HALF_WIDTH_SHRINK_PER_LEVEL);
  }

  // ---------------------------------------------------------------------
  // Game state
  // ---------------------------------------------------------------------
  let state = "start"; // start | serve | playing | gameover
  let stateTimer = 0;
  let score = 0;
  let lives = 3;
  let level = 0;
  let pointsWon = 0;
  let nextExtraLifeIdx = 0;

  let paddleAngle = -Math.PI / 2; // paddle center angle, 0 = +x axis, screen-clockwise
  // Ball position/velocity are relative to the ring's center (CX, CY).
  let ball = { x: 0, y: 0, vx: 0, vy: 0, speed: BASE_BALL_SPEED, rallyCount: 0 };
  let effects = []; // transient hit/miss spark bursts: { x, y, color, born, life }

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

  function maybeLevelUp() {
    const newLevel = Math.floor(pointsWon / POINTS_PER_LEVEL);
    if (newLevel === level) return;
    level = newLevel;
    hudLevelEl.textContent = String(level + 1);
    sfx.levelUp();
  }

  function spawnEffect(angle, color, kind) {
    const x = CX + Math.cos(angle) * RING_R;
    const y = CY + Math.sin(angle) * RING_R;
    effects.push({ x, y, angle, color, kind, born: performance.now(), life: kind === "miss" ? 500 : 260 });
  }

  function prepareServe() {
    state = "serve";
    stateTimer = READY_DURATION;
    ball.x = 0;
    ball.y = 0;
    ball.vx = 0;
    ball.vy = 0;
    ball.rallyCount = 0;
  }

  function launchServe() {
    const angle = Math.random() * Math.PI * 2;
    const speed = BASE_BALL_SPEED + level * SPEED_LEVEL_INC;
    ball.speed = speed;
    ball.vx = Math.cos(angle) * speed;
    ball.vy = Math.sin(angle) * speed;
    state = "playing";
  }

  // Called the instant the ball crosses the boundary where the paddle
  // wasn't covering it. Rather than snapping straight back to a fresh
  // serve, the ball keeps flying outward (and fading) for a beat so a
  // miss actually reads as "the ball got away" — including on the very
  // last life, where it now plays out before the game-over screen
  // appears instead of cutting to it instantly.
  function handleMiss(angle) {
    spawnEffect(angle, "#c8c8c8", "miss");
    sfx.escape();
    lives--;
    renderLives();
    state = "escaped";
    stateTimer = ESCAPE_DURATION;
  }

  function paddleBounce(nx, ny, diff, halfW) {
    const vDotN = ball.vx * nx + ball.vy * ny;
    let rvx = ball.vx - 2 * vDotN * nx;
    let rvy = ball.vy - 2 * vDotN * ny;

    // Hitting off-center from the paddle's middle adds extra spin, just
    // like an angled real-world paddle — rewards aiming, not just timing.
    const offset = clamp(diff / halfW, -1, 1);
    const extra = offset * MAX_DEFLECT;
    const c = Math.cos(extra), s = Math.sin(extra);
    const rx = rvx * c - rvy * s;
    const ry = rvx * s + rvy * c;

    ball.speed = Math.min(MAX_BALL_SPEED, ball.speed + SPEED_HIT_INC);
    const mag = Math.hypot(rx, ry) || 1;
    ball.vx = (rx / mag) * ball.speed;
    ball.vy = (ry / mag) * ball.speed;

    const safeD = RING_R - BALL_R - 2;
    ball.x = nx * safeD;
    ball.y = ny * safeD;
    ball.rallyCount++;

    const bonus = Math.min(150, ball.rallyCount * 8);
    addScore(20 + bonus);
    pointsWon++;
    maybeLevelUp();
    spawnEffect(Math.atan2(ny, nx), "#ffffff", "hit");
    sfx.hitPaddle(ball.rallyCount);
  }

  function updatePaddle(dt) {
    if (dragActive && dragTargetAngle != null) {
      paddleAngle = dragTargetAngle;
      return;
    }
    let v = 0;
    if (keys.left) v -= 1;
    if (keys.right) v += 1;
    if (v === 0) return;
    // Fixed rotation direction: left always spins the paddle
    // counterclockwise around the ring, right always spins it clockwise,
    // regardless of where the paddle currently sits.
    paddleAngle = wrapAngle(paddleAngle + v * PLAYER_ANGULAR_SPEED * dt);
  }

  function updateBall(dt) {
    const prevD = Math.hypot(ball.x, ball.y);
    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;
    const d = Math.hypot(ball.x, ball.y);

    // A single shared threshold, checked both "before" and "after" the
    // move this frame — a plain crossing test with no dead zone. (An
    // earlier version compared prevD against one cutoff and d against a
    // slightly different one, leaving a hair's-width gap between them;
    // any frame whose ball happened to land inside that gap would never
    // satisfy the "still inside" half of the check again, so it could
    // sail through the boundary forever with no bounce and no miss.)
    const collideAt = RING_R - BALL_R;
    if (prevD < collideAt && d >= collideAt) {
      const nx = ball.x / d;
      const ny = ball.y / d;
      const ballAngle = Math.atan2(ny, nx);
      const diff = wrapAngle(ballAngle - paddleAngle);
      const halfW = halfWidthFor(level);
      if (Math.abs(diff) <= halfW) {
        paddleBounce(nx, ny, diff, halfW);
      } else {
        handleMiss(ballAngle);
      }
    }
  }

  function updateEffects() {
    const now = performance.now();
    effects = effects.filter((e) => now - e.born < e.life);
  }

  function update(dt) {
    updateEffects();
    if (state === "serve") {
      updatePaddle(dt);
      stateTimer -= dt;
      if (stateTimer <= 0) launchServe();
      return;
    }
    if (state === "escaped") {
      // No boundary/paddle checks here on purpose — the ball just keeps
      // sailing outward on its last heading so the miss is visible.
      ball.x += ball.vx * dt;
      ball.y += ball.vy * dt;
      stateTimer -= dt;
      if (stateTimer <= 0) {
        if (lives <= 0) endGame();
        else prepareServe();
      }
      return;
    }
    if (state !== "playing") return;
    updatePaddle(dt);
    updateBall(dt);
  }

  // ---------------------------------------------------------------------
  // Drawing — a strict black/white/gray CRT-monitor look: a faint grid,
  // a screen-bezel border, a dashed court ring, a glowing white paddle
  // arc, and a blocky square ball (the more authentic shape for this
  // look, per the black-and-white cover art it now matches).
  // ---------------------------------------------------------------------
  function drawBackdrop() {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, VIRTUAL_W, VIRTUAL_H);

    ctx.strokeStyle = "rgba(255,255,255,0.05)";
    ctx.lineWidth = 1;
    for (let x = 0; x <= VIRTUAL_W; x += 40) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, VIRTUAL_H);
      ctx.stroke();
    }
    for (let y = 0; y <= VIRTUAL_H; y += 40) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(VIRTUAL_W, y);
      ctx.stroke();
    }

    ctx.strokeStyle = "rgba(255,255,255,0.3)";
    ctx.lineWidth = 2;
    ctx.strokeRect(8, 8, VIRTUAL_W - 16, VIRTUAL_H - 16);
  }

  function drawRing() {
    // arena floor
    const g = ctx.createRadialGradient(CX, CY, 0, CX, CY, RING_R);
    g.addColorStop(0, "#181818");
    g.addColorStop(1, "#000000");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(CX, CY, RING_R, 0, Math.PI * 2);
    ctx.fill();

    // boundary guide (dashed)
    ctx.strokeStyle = "rgba(255,255,255,0.5)";
    ctx.lineWidth = 2;
    ctx.setLineDash([10, 10]);
    ctx.beginPath();
    ctx.arc(CX, CY, RING_R, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  function drawPaddle() {
    const halfW = halfWidthFor(level);
    ctx.save();
    ctx.shadowColor = "#ffffff";
    ctx.shadowBlur = 16;
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = PADDLE_THICKNESS;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.arc(CX, CY, RING_R, paddleAngle - halfW, paddleAngle + halfW);
    ctx.stroke();
    ctx.restore();
  }

  function drawBall(alpha) {
    ctx.save();
    ctx.globalAlpha = alpha == null ? 1 : Math.max(0, alpha);
    ctx.shadowColor = "#ffffff";
    ctx.shadowBlur = 16;
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(CX + ball.x, CY + ball.y, BALL_R, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawEffects() {
    const now = performance.now();
    effects.forEach((e) => {
      const t = (now - e.born) / e.life;
      const alpha = 1 - t;
      const spread = e.kind === "miss" ? 34 : 22;
      ctx.save();
      ctx.globalAlpha = Math.max(0, alpha);
      ctx.strokeStyle = e.color;
      ctx.shadowColor = e.color;
      ctx.shadowBlur = 12;
      ctx.lineWidth = 2.5;
      for (let i = 0; i < 8; i++) {
        const a = (Math.PI * 2 * i) / 8;
        const r0 = 6 + t * spread * 0.3;
        const r1 = 6 + t * spread;
        ctx.beginPath();
        ctx.moveTo(e.x + Math.cos(a) * r0, e.y + Math.sin(a) * r0);
        ctx.lineTo(e.x + Math.cos(a) * r1, e.y + Math.sin(a) * r1);
        ctx.stroke();
      }
      ctx.restore();
    });
  }

  function draw() {
    ctx.clearRect(0, 0, VIRTUAL_W, VIRTUAL_H);
    drawBackdrop();

    drawRing();
    drawPaddle();
    if (state === "playing" || state === "serve") drawBall();
    else if (state === "escaped") drawBall(stateTimer / ESCAPE_DURATION);
    drawEffects();

    if (state === "serve") {
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.font = "bold 26px 'Baloo 2', sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("READY", CX, CY - 40);
    }
  }

  // ---------------------------------------------------------------------
  // Screens
  // ---------------------------------------------------------------------
  function startGame() {
    sfx.click();
    score = 0;
    lives = 3;
    level = 0;
    pointsWon = 0;
    nextExtraLifeIdx = 0;
    effects = [];
    paddleAngle = -Math.PI / 2;
    scoreEl.textContent = "0";
    hudLevelEl.textContent = "1";
    renderLives();
    startScreen.classList.add("hidden");
    gameoverScreen.classList.add("hidden");
    hud.classList.remove("hidden");
    prepareServe();
  }

  function endGame() {
    state = "gameover";
    sfx.gameOver();
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
    draw();

    requestAnimationFrame(frame);
  }

  try {
    boot();
  } catch (e) {
    console.error("[Ping 360] boot() failed:", e);
  }
})();
