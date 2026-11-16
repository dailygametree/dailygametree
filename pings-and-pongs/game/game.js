/* Pings and Pongs — vanilla JS + Canvas2D, no external assets. Part of dailygametree.com. */

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
  const SOUND_MUTED_KEY = "pp_muted";
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

  const sfx = {
    hitPaddle(rally) {
      const pitch = Math.min(720, 300 + rally * 14);
      playTone({ freq: pitch, type: "square", duration: 0.06, volume: 0.14 });
    },
    hitWall() {
      playNoise({ duration: 0.05, volume: 0.08, filterFreq: 1800 });
    },
    score() {
      [0, 1, 2].forEach((i) => playTone({ freq: 440 + i * 160, type: "triangle", duration: 0.11, volume: 0.16, delay: i * 0.07 }));
    },
    loseLife() {
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
  // Virtual resolution + canvas fit (letterboxed court, kept at a fixed
  // aspect ratio rather than stretched to the device).
  // ---------------------------------------------------------------------
  const VIRTUAL_W = 800;
  const VIRTUAL_H = 450;
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

  // ---------------------------------------------------------------------
  // Input — keyboard (held), an on-screen up/down pad (held), and direct
  // vertical drag on the court itself.
  // ---------------------------------------------------------------------
  const keys = { up: false, down: false };

  window.addEventListener("keydown", (e) => {
    if (e.code === "ArrowUp" || e.code === "KeyW") {
      keys.up = true;
      e.preventDefault();
    } else if (e.code === "ArrowDown" || e.code === "KeyS") {
      keys.down = true;
      e.preventDefault();
    } else if (e.code === "Space" || e.code === "Enter") {
      if (state === "start" || state === "gameover") {
        e.preventDefault();
        startGame();
      }
    }
  });
  window.addEventListener("keyup", (e) => {
    if (e.code === "ArrowUp" || e.code === "KeyW") keys.up = false;
    else if (e.code === "ArrowDown" || e.code === "KeyS") keys.down = false;
  });

  const isTouchDevice = "ontouchstart" in window || navigator.maxTouchPoints > 0;
  if (isTouchDevice) dpad.classList.remove("hidden");

  dpad.querySelectorAll(".dpad-btn").forEach((btn) => {
    const dir = btn.dataset.dir; // "up" | "down"
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
  let dragTargetY = null;
  function updateDragFromTouch(e) {
    const t = e.changedTouches[0];
    const rect = canvas.getBoundingClientRect();
    const relY = clamp((t.clientY - rect.top) / rect.height, 0, 1);
    dragTargetY = relY * VIRTUAL_H;
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
  const HIGH_SCORE_KEY = "pingsAndPongsHighScore";
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
  const PADDLE_W = 14;
  const PADDLE_MARGIN = 26;
  const PADDLE_H_BASE = 92;
  const PADDLE_H_MIN = 56;
  const BALL_SIZE = 14;
  const PLAYER_SPEED = 460;
  const BALL_BASE_SPEED = 300;
  const BALL_MAX_SPEED = 620;
  const BALL_SPEED_HIT_INC = 16;
  const BALL_SPEED_LEVEL_INC = 10;
  const MAX_BOUNCE_ANGLE = (52 * Math.PI) / 180;
  const POINTS_PER_LEVEL = 3;
  const READY_DURATION = 0.9;
  const EXTRA_LIFE_THRESHOLDS = [500, 1200, 2200, 3500];
  const AI_SPEED_BASE = 260;
  const AI_SPEED_LEVEL_INC = 16;
  const AI_SPEED_MAX = 560;
  const AI_RETARGET_INTERVAL = 0.32;

  function paddleHFor(lvl) {
    return Math.max(PADDLE_H_MIN, PADDLE_H_BASE - lvl * 3);
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
  let pendingServeDir = 1;

  let player = { cy: VIRTUAL_H / 2, h: PADDLE_H_BASE };
  let ai = { cy: VIRTUAL_H / 2, h: PADDLE_H_BASE, retargetTimer: 0, target: VIRTUAL_H / 2 };
  let ball = { x: VIRTUAL_W / 2, y: VIRTUAL_H / 2, vx: 0, vy: 0, speed: BALL_BASE_SPEED, rallyCount: 0 };

  function resetPositions() {
    player = { cy: VIRTUAL_H / 2, h: paddleHFor(level) };
    ai = { cy: VIRTUAL_H / 2, h: paddleHFor(level), retargetTimer: 0, target: VIRTUAL_H / 2 };
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

  function maybeLevelUp() {
    const newLevel = Math.floor(pointsWon / POINTS_PER_LEVEL);
    if (newLevel === level) return;
    level = newLevel;
    hudLevelEl.textContent = String(level + 1);
    const h = paddleHFor(level);
    player.h = h;
    ai.h = h;
    player.cy = clamp(player.cy, h / 2, VIRTUAL_H - h / 2);
    ai.cy = clamp(ai.cy, h / 2, VIRTUAL_H - h / 2);
    sfx.levelUp();
  }

  function prepareServe() {
    state = "serve";
    stateTimer = READY_DURATION;
    ball.x = VIRTUAL_W / 2;
    ball.y = VIRTUAL_H / 2;
    ball.vx = 0;
    ball.vy = 0;
    ball.rallyCount = 0;
    pendingServeDir = Math.random() < 0.5 ? -1 : 1;
  }

  function launchServe() {
    const angle = (Math.random() * 2 - 1) * MAX_BOUNCE_ANGLE * 0.5;
    const speed = BALL_BASE_SPEED + level * BALL_SPEED_LEVEL_INC;
    ball.speed = speed;
    ball.vx = Math.cos(angle) * speed * pendingServeDir;
    ball.vy = Math.sin(angle) * speed;
    state = "playing";
  }

  function loseLife() {
    lives--;
    renderLives();
    sfx.loseLife();
    if (lives <= 0) {
      endGame();
      return;
    }
    prepareServe();
  }

  function pointScored(winner) {
    if (winner === "player") {
      const bonus = Math.min(200, ball.rallyCount * 15);
      addScore(100 + bonus);
      pointsWon++;
      sfx.score();
      maybeLevelUp();
      prepareServe();
    } else {
      loseLife();
    }
  }

  function paddleBounce(side) {
    const paddle = side === "player" ? player : ai;
    const rel = clamp((ball.y - paddle.cy) / (paddle.h / 2), -1, 1);
    const angle = rel * MAX_BOUNCE_ANGLE;
    ball.speed = Math.min(BALL_MAX_SPEED, ball.speed + BALL_SPEED_HIT_INC);
    const dir = side === "player" ? 1 : -1;
    ball.vx = Math.cos(angle) * ball.speed * dir;
    ball.vy = Math.sin(angle) * ball.speed;
    ball.x = side === "player" ? PADDLE_MARGIN + PADDLE_W + BALL_SIZE / 2 : VIRTUAL_W - PADDLE_MARGIN - PADDLE_W - BALL_SIZE / 2;
    ball.rallyCount++;
    sfx.hitPaddle(ball.rallyCount);
  }

  function updatePaddles(dt) {
    // Player: direct drag while a touch is active, otherwise velocity from
    // keyboard/pad input.
    if (dragActive && dragTargetY != null) {
      player.cy = clamp(dragTargetY, player.h / 2, VIRTUAL_H - player.h / 2);
    } else {
      let v = 0;
      if (keys.up) v -= 1;
      if (keys.down) v += 1;
      player.cy = clamp(player.cy + v * PLAYER_SPEED * dt, player.h / 2, VIRTUAL_H - player.h / 2);
    }

    // AI: re-picks an imperfect target every AI_RETARGET_INTERVAL seconds
    // (rather than every frame) so it reads as a deliberate opponent
    // rather than a twitchy one, and gets more accurate as the level
    // climbs. When the ball is heading away from it, it drifts back
    // toward center instead of hovering at the last spot.
    ai.retargetTimer -= dt;
    if (ai.retargetTimer <= 0) {
      ai.retargetTimer = AI_RETARGET_INTERVAL;
      const skill = Math.min(0.96, 0.5 + level * 0.06);
      const error = (Math.random() * 2 - 1) * (1 - skill) * 90;
      ai.target = ball.vx > 0 ? ball.y + error : VIRTUAL_H / 2 + error * 0.4;
    }
    const aiSpeed = Math.min(AI_SPEED_MAX, AI_SPEED_BASE + level * AI_SPEED_LEVEL_INC);
    const diff = ai.target - ai.cy;
    const step = clamp(diff, -aiSpeed * dt, aiSpeed * dt);
    ai.cy = clamp(ai.cy + step, ai.h / 2, VIRTUAL_H - ai.h / 2);
  }

  function updateBall(dt) {
    const r = BALL_SIZE / 2;
    const prevX = ball.x;
    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;

    if (ball.y - r <= 0) {
      ball.y = r;
      ball.vy = Math.abs(ball.vy);
      sfx.hitWall();
    } else if (ball.y + r >= VIRTUAL_H) {
      ball.y = VIRTUAL_H - r;
      ball.vy = -Math.abs(ball.vy);
      sfx.hitWall();
    }

    const playerFace = PADDLE_MARGIN + PADDLE_W;
    const aiFace = VIRTUAL_W - PADDLE_MARGIN - PADDLE_W;

    if (ball.vx < 0 && prevX - r > playerFace && ball.x - r <= playerFace) {
      if (ball.y + r >= player.cy - player.h / 2 && ball.y - r <= player.cy + player.h / 2) {
        paddleBounce("player");
      }
    } else if (ball.vx > 0 && prevX + r < aiFace && ball.x + r >= aiFace) {
      if (ball.y + r >= ai.cy - ai.h / 2 && ball.y - r <= ai.cy + ai.h / 2) {
        paddleBounce("ai");
      }
    }

    if (ball.x + r < 0) {
      pointScored("ai");
    } else if (ball.x - r > VIRTUAL_W) {
      pointScored("player");
    }
  }

  function update(dt) {
    if (state === "serve") {
      updatePaddles(dt);
      stateTimer -= dt;
      if (stateTimer <= 0) launchServe();
      return;
    }
    if (state !== "playing") return;
    updatePaddles(dt);
    updateBall(dt);
  }

  // ---------------------------------------------------------------------
  // Drawing
  // ---------------------------------------------------------------------
  function roundRectPath(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawPaddle(x, cy, h, color) {
    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = 14;
    ctx.fillStyle = color;
    roundRectPath(x, cy - h / 2, PADDLE_W, h, 6);
    ctx.fill();
    ctx.restore();
  }

  function drawBall() {
    ctx.save();
    ctx.shadowColor = "#ffd166";
    ctx.shadowBlur = 18;
    ctx.fillStyle = "#ffe9b0";
    roundRectPath(ball.x - BALL_SIZE / 2, ball.y - BALL_SIZE / 2, BALL_SIZE, BALL_SIZE, 4);
    ctx.fill();
    ctx.restore();
  }

  function draw() {
    ctx.clearRect(0, 0, VIRTUAL_W, VIRTUAL_H);

    const g = ctx.createLinearGradient(0, 0, 0, VIRTUAL_H);
    g.addColorStop(0, "#101538");
    g.addColorStop(1, "#05060f");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, VIRTUAL_W, VIRTUAL_H);

    // goal-line glows
    ctx.save();
    ctx.globalAlpha = 0.5;
    let gl = ctx.createLinearGradient(0, 0, 26, 0);
    gl.addColorStop(0, "rgba(255,92,115,0.35)");
    gl.addColorStop(1, "rgba(255,92,115,0)");
    ctx.fillStyle = gl;
    ctx.fillRect(0, 0, 26, VIRTUAL_H);
    let gr = ctx.createLinearGradient(VIRTUAL_W - 26, 0, VIRTUAL_W, 0);
    gr.addColorStop(0, "rgba(91,227,123,0)");
    gr.addColorStop(1, "rgba(91,227,123,0.35)");
    ctx.fillStyle = gr;
    ctx.fillRect(VIRTUAL_W - 26, 0, 26, VIRTUAL_H);
    ctx.restore();

    ctx.strokeStyle = "rgba(255,255,255,0.16)";
    ctx.lineWidth = 3;
    ctx.setLineDash([10, 12]);
    ctx.beginPath();
    ctx.moveTo(VIRTUAL_W / 2, 6);
    ctx.lineTo(VIRTUAL_W / 2, VIRTUAL_H - 6);
    ctx.stroke();
    ctx.setLineDash([]);

    drawPaddle(PADDLE_MARGIN, player.cy, player.h, "#5be37b");
    drawPaddle(VIRTUAL_W - PADDLE_MARGIN - PADDLE_W, ai.cy, ai.h, "#ff5c73");

    if (state === "playing" || state === "serve") drawBall();

    if (state === "serve") {
      ctx.fillStyle = "rgba(234,255,240,0.9)";
      ctx.font = "bold 26px 'Baloo 2', sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("READY", VIRTUAL_W / 2, VIRTUAL_H / 2 - 44);
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
    scoreEl.textContent = "0";
    hudLevelEl.textContent = "1";
    renderLives();
    startScreen.classList.add("hidden");
    gameoverScreen.classList.add("hidden");
    hud.classList.remove("hidden");
    resetPositions();
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
    console.error("[Pings and Pongs] boot() failed:", e);
  }
})();
