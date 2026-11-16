(() => {
  "use strict";

  const SKIN_KEY = "ft_skin";
  const SKINS = {
    classic: { id: "classic", free: true, name: "Classic", body: "#8a5a2e", outline: "#5e3b1c", mid: "#a0703f", hi: "#c08e56" },
    gold: { id: "gold", free: true, name: "Golden Turd", body: "#f2b93c", outline: "#8a5a0f", mid: "#ffd873", hi: "#fff2b0" },
  };
  const SKIN_ORDER = ["classic", "gold"];
  let currentSkinId = "classic";
  try { currentSkinId = localStorage.getItem(SKIN_KEY) || "classic"; } catch (e) {}
  if (!SKINS[currentSkinId]) currentSkinId = "classic";

  const HIGH_SCORE_KEY = "ft_highscore";
  const SOUND_MUTED_KEY = "ft_muted";

  const gameWrap = document.getElementById("game-wrap");
  const canvas = document.getElementById("gameCanvas");
  const ctx = canvas.getContext("2d");

  const startScreen = document.getElementById("start-screen");
  const gameoverScreen = document.getElementById("gameover-screen");
  const skinsScreen = document.getElementById("skins-screen");
  const hud = document.getElementById("hud");
  const hudScoreEl = document.getElementById("hud-score");
  const startBtn = document.getElementById("start-btn");
  const restartBtn = document.getElementById("restart-btn");
  const startBestEl = document.getElementById("start-best");
  const finalScoreEl = document.getElementById("final-score");
  const bestScoreEl = document.getElementById("best-score");
  const newBestTag = document.getElementById("newbest-tag");
  const muteBtn = document.getElementById("mute-btn");
  const skinsBtnStart = document.getElementById("skins-btn-start");
  const skinsBtnOver = document.getElementById("skins-btn-over");
  const skinsBackBtn = document.getElementById("skins-back-btn");
  const skinListEl = document.getElementById("skin-list");
  const skinsNoteEl = document.getElementById("skins-note");

  // ---------------------------------------------------------------------
  // Sound: procedural, Web Audio API, no files.
  // ---------------------------------------------------------------------
  let audioCtx = null;
  let muted = false;
  try { muted = localStorage.getItem(SOUND_MUTED_KEY) === "1"; } catch (e) {}

  function ensureAudio() {
    if (!audioCtx) {
      try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
      catch (e) { audioCtx = null; }
    }
    return audioCtx;
  }
  function resumeAudio() {
    const ac = ensureAudio();
    if (ac && ac.state === "suspended") ac.resume().catch(() => {});
  }
  window.addEventListener("pointerdown", resumeAudio, { once: true });
  window.addEventListener("keydown", resumeAudio, { once: true });

  function playTone({ freq, endFreq, type = "sine", duration = 0.18, volume = 0.18, attack = 0.006, delay = 0 }) {
    if (muted) return;
    const ac = ensureAudio();
    if (!ac) return;
    const t0 = ac.currentTime + delay;
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (endFreq) osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), t0 + duration);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(volume, t0 + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(gain).connect(ac.destination);
    osc.start(t0);
    osc.stop(t0 + duration + 0.02);
  }

  function playNoise({ duration = 0.16, volume = 0.14, filterFreq = 1200, delay = 0, type = "bandpass" }) {
    if (muted) return;
    const ac = ensureAudio();
    if (!ac) return;
    const t0 = ac.currentTime + delay;
    const bufferSize = Math.floor(ac.sampleRate * duration);
    const buffer = ac.createBuffer(1, bufferSize, ac.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
    const src = ac.createBufferSource();
    src.buffer = buffer;
    const filter = ac.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = filterFreq;
    filter.Q.value = 0.9;
    const gain = ac.createGain();
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(volume, t0 + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    src.connect(filter).connect(gain).connect(ac.destination);
    src.start(t0);
    src.stop(t0 + duration + 0.02);
  }

  const sfx = {
    flap() { playTone({ freq: 260, endFreq: 400, type: "square", duration: 0.09, volume: 0.1, attack: 0.003 }); playNoise({ duration: 0.06, volume: 0.05, filterFreq: 700 }); },
    score() { playTone({ freq: 700, type: "square", duration: 0.08, volume: 0.12 }); playTone({ freq: 940, type: "square", duration: 0.14, volume: 0.12, delay: 0.06 }); },
    hit() { playNoise({ duration: 0.22, volume: 0.22, filterFreq: 400, type: "lowpass" }); playTone({ freq: 150, endFreq: 45, type: "square", duration: 0.28, volume: 0.16, delay: 0.02 }); },
    gameover() { playTone({ freq: 300, endFreq: 70, type: "sawtooth", duration: 0.6, volume: 0.13, attack: 0.01 }); },
    click() { playTone({ freq: 480, type: "square", duration: 0.06, volume: 0.09 }); },
    unlock() {
      playTone({ freq: 520, type: "triangle", duration: 0.12, volume: 0.14 });
      playTone({ freq: 780, type: "triangle", duration: 0.16, volume: 0.14, delay: 0.09 });
      playTone({ freq: 1040, type: "triangle", duration: 0.22, volume: 0.14, delay: 0.18 });
    },
  };

  function updateMuteButton() {
    muteBtn.setAttribute("aria-pressed", muted ? "true" : "false");
  }
  updateMuteButton();
  muteBtn.addEventListener("click", () => {
    muted = !muted;
    try { localStorage.setItem(SOUND_MUTED_KEY, muted ? "1" : "0"); } catch (e) {}
    updateMuteButton();
  });

  // ---------------------------------------------------------------------
  // Canvas sizing (virtual resolution, responsive)
  // ---------------------------------------------------------------------
  const VIRTUAL_W = 400;
  let VIRTUAL_H = 700;
  let dpr = Math.max(1, window.devicePixelRatio || 1);

  function resize() {
    const rect = gameWrap.getBoundingClientRect();
    const w = rect.width, h = rect.height;
    VIRTUAL_H = Math.round(VIRTUAL_W * (h / w));
    dpr = Math.max(1, window.devicePixelRatio || 1);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const scale = (canvas.width / VIRTUAL_W);
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.imageSmoothingEnabled = false;
  }
  window.addEventListener("resize", resize);

  // ---------------------------------------------------------------------
  // Game constants
  // ---------------------------------------------------------------------
  const GRAVITY = 1180;
  const FLAP_VY = -360;
  const MAX_FALL_VY = 640;
  const TURD_X_FRAC = 0.30;
  const TURD_W = 30, TURD_H = 36;
  const TURD_R = 13; // effective collision radius
  const GAP_START = 195;
  const GAP_MIN = 148;
  const PIPE_W = 58;
  const SCROLL_START = 130;
  const SCROLL_MAX = 215;
  const SPAWN_GAP_PX_START = 250;
  const SPAWN_GAP_PX_MIN = 205;
  const GROUND_H = 40;

  // ---------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------
  let state = "start"; // start | playing | gameover
  let turd = { x: 0, y: 0, vy: 0, tilt: 0, squish: 0 };
  let pipes = []; // { x, gapY, gapH, passed }
  let clouds = [];
  let splashes = [];
  let puffs = []; // little dust/poof particles on flap + splat burst
  let score = 0;
  let bestScore = 0;
  let elapsed = 0;
  let scrollSpeed = SCROLL_START;
  let nextSpawnX = 0;
  let shakeTime = 0;
  let idleT = 0;
  let groundScrollX = 0;

  try { bestScore = parseInt(localStorage.getItem(HIGH_SCORE_KEY), 10) || 0; } catch (e) { bestScore = 0; }

  function saveBest(v) {
    bestScore = v;
    try { localStorage.setItem(HIGH_SCORE_KEY, String(v)); } catch (e) {}
  }

  function initClouds() {
    clouds = [];
    for (let i = 0; i < 6; i++) {
      clouds.push({
        x: Math.random() * VIRTUAL_W,
        y: Math.random() * VIRTUAL_H,
        s: 0.7 + Math.random() * 0.6,
        vy: 160 + Math.random() * 120,
        vx: -(10 + Math.random() * 10),
      });
    }
  }
  initClouds();

  function resetGame() {
    turd.x = VIRTUAL_W * TURD_X_FRAC;
    turd.y = VIRTUAL_H * 0.42;
    turd.vy = 0;
    turd.tilt = 0;
    turd.squish = 0;
    pipes = [];
    puffs = [];
    score = 0;
    elapsed = 0;
    scrollSpeed = SCROLL_START;
    nextSpawnX = VIRTUAL_W + 40;
    shakeTime = 0;
    groundScrollX = 0;
    hudScoreEl.textContent = "0";
  }
  resetGame();

  function gapHeightFor(s) {
    const t = Math.min(1, s / 26);
    return GAP_START - (GAP_START - GAP_MIN) * t;
  }
  function spawnGapPxFor(s) {
    const t = Math.min(1, s / 26);
    return SPAWN_GAP_PX_START - (SPAWN_GAP_PX_START - SPAWN_GAP_PX_MIN) * t;
  }
  function scrollSpeedFor(s) {
    const t = Math.min(1, s / 30);
    return SCROLL_START + (SCROLL_MAX - SCROLL_START) * t;
  }

  function spawnPipe() {
    const margin = 60;
    const gapH = gapHeightFor(score);
    const minY = margin + gapH / 2;
    const maxY = VIRTUAL_H - GROUND_H - margin - gapH / 2;
    const gapY = minY + Math.random() * Math.max(10, maxY - minY);
    pipes.push({ x: nextSpawnX, gapY, gapH, passed: false, seed: Math.floor(Math.random() * 1e9) });
    nextSpawnX += spawnGapPxFor(score);
  }

  // ---------------------------------------------------------------------
  // Input
  // ---------------------------------------------------------------------
  function addPuff(x, y, n, spread) {
    for (let i = 0; i < n; i++) {
      puffs.push({
        x: x + (Math.random() - 0.5) * 6,
        y: y + (Math.random() - 0.5) * 6,
        vx: (Math.random() - 0.5) * spread,
        vy: 20 + Math.random() * spread,
        life: 0.35 + Math.random() * 0.25,
        age: 0,
        r: 2 + Math.random() * 2.5,
      });
    }
  }

  function doFlap() {
    if (state === "playing") {
      turd.vy = FLAP_VY;
      turd.squish = 1;
      addPuff(turd.x - 8, turd.y + TURD_H * 0.3, 4, 40);
      sfx.flap();
    } else if (state === "start") {
      newGame();
    }
  }

  gameWrap.addEventListener("pointerdown", (e) => {
    if (e.target.closest("#mute-btn") || e.target.closest(".overlay")) return;
    doFlap();
  });
  window.addEventListener("keydown", (e) => {
    if (e.code === "Space" || e.code === "ArrowUp") {
      e.preventDefault();
      doFlap();
    }
  });

  function newGame() {
    resetGame();
    state = "playing";
    startScreen.classList.add("hidden");
    gameoverScreen.classList.add("hidden");
    hud.classList.remove("hidden");
    sfx.click();
  }

  function endGame() {
    state = "gameover";
    hud.classList.add("hidden");
    sfx.hit();
    setTimeout(() => sfx.gameover(), 120);
    shakeTime = 0.3;
    addPuff(turd.x, turd.y, 14, 90);
    const isNewBest = score > bestScore;
    if (isNewBest) saveBest(score);
    finalScoreEl.textContent = String(score);
    bestScoreEl.textContent = "BEST " + bestScore;
    newBestTag.classList.toggle("hidden", !isNewBest);
    setTimeout(() => {
      gameoverScreen.classList.remove("hidden");
    }, 500);
  }

  muteBtn.addEventListener("click", (e) => e.stopPropagation());

  // ---------------------------------------------------------------------
  // Skins (cosmetic only — every skin is free)
  // ---------------------------------------------------------------------
  function isSkinUnlocked(skinId) {
    return !!SKINS[skinId];
  }

  function selectSkin(skinId) {
    if (!isSkinUnlocked(skinId)) return;
    currentSkinId = skinId;
    try { localStorage.setItem(SKIN_KEY, skinId); } catch (e) {}
    renderSkinsScreen();
    sfx.click();
  }

  function renderSkinsScreen() {
    skinListEl.innerHTML = "";
    SKIN_ORDER.forEach((id) => {
      const skin = SKINS[id];
      const unlocked = isSkinUnlocked(id);
      const selected = currentSkinId === id;
      const card = document.createElement("div");
      card.className = "skin-card" + (selected ? " selected" : "");
      const swatch = document.createElement("div");
      swatch.className = "skin-swatch";
      swatch.style.background = `linear-gradient(160deg, ${skin.hi}, ${skin.body} 60%, ${skin.outline})`;
      const info = document.createElement("div");
      info.className = "skin-info";
      info.innerHTML = `<div class="skin-name">${skin.name}</div>`;
      const actionBtn = document.createElement("button");
      actionBtn.type = "button";
      if (selected) {
        actionBtn.className = "skin-action-btn";
        actionBtn.textContent = "EQUIPPED";
        actionBtn.disabled = true;
      } else {
        actionBtn.className = "skin-action-btn";
        actionBtn.textContent = "EQUIP";
        actionBtn.addEventListener("click", (e) => { e.stopPropagation(); selectSkin(id); });
      }
      card.appendChild(swatch);
      card.appendChild(info);
      card.appendChild(actionBtn);
      skinListEl.appendChild(card);
    });
    skinsNoteEl.textContent = "";
  }

  let skinsReturnState = "start";
  function openSkins(from) {
    skinsReturnState = from;
    renderSkinsScreen();
    startScreen.classList.add("hidden");
    gameoverScreen.classList.add("hidden");
    skinsScreen.classList.remove("hidden");
    sfx.click();
  }
  function closeSkins() {
    skinsScreen.classList.add("hidden");
    if (skinsReturnState === "gameover") gameoverScreen.classList.remove("hidden");
    else startScreen.classList.remove("hidden");
    sfx.click();
  }
  skinsBtnStart.addEventListener("click", (e) => { e.stopPropagation(); openSkins("start"); });
  skinsBtnOver.addEventListener("click", (e) => { e.stopPropagation(); openSkins("gameover"); });
  skinsBackBtn.addEventListener("click", (e) => { e.stopPropagation(); closeSkins(); });

  if (!isSkinUnlocked(currentSkinId)) currentSkinId = "classic";
  renderSkinsScreen();

  startBestEl.textContent = "BEST " + bestScore;

  // ---------------------------------------------------------------------
  // Update
  // ---------------------------------------------------------------------
  function updateClouds(dt) {
    for (const c of clouds) {
      c.x += c.vx * dt;
      c.y += c.vy * dt;
      if (c.y > VIRTUAL_H - GROUND_H || c.x < -10) {
        if (c.y > VIRTUAL_H - GROUND_H) splashes.push({ x: c.x, y: VIRTUAL_H - GROUND_H + 10, age: 0 });
        c.x = Math.random() * (VIRTUAL_W + 40);
        c.y = 30 + Math.random() * 20;
      }
    }
  }
  function updateSplashes(dt) {
    for (const sp of splashes) sp.age += dt;
    splashes = splashes.filter(sp => sp.age < 0.35);
  }
  function updatePuffs(dt) {
    for (const p of puffs) {
      p.age += dt;
      p.x += p.vx * dt;
      p.y -= p.vy * dt * 0.3;
      p.vy *= 0.9;
    }
    puffs = puffs.filter(p => p.age < p.life);
  }

  function updatePlaying(dt) {
    elapsed += dt;
    scrollSpeed = scrollSpeedFor(score);
    groundScrollX -= scrollSpeed * dt;

    turd.vy += GRAVITY * dt;
    if (turd.vy > MAX_FALL_VY) turd.vy = MAX_FALL_VY;
    turd.y += turd.vy * dt;
    const targetTilt = Math.max(-0.45, Math.min(0.95, turd.vy / 420));
    turd.tilt += (targetTilt - turd.tilt) * Math.min(1, dt * 10);
    turd.squish = Math.max(0, turd.squish - dt * 3.2);

    // ceiling / ground
    if (turd.y - TURD_R < 0) {
      turd.y = TURD_R;
      turd.vy = 0;
    }
    if (turd.y + TURD_R > VIRTUAL_H - GROUND_H) {
      turd.y = VIRTUAL_H - GROUND_H - TURD_R;
      endGame();
      return;
    }

    // pipes
    while (nextSpawnX < turd.x + VIRTUAL_W * 1.6) spawnPipe();

    for (const p of pipes) {
      p.x -= scrollSpeed * dt;
    }
    nextSpawnX -= scrollSpeed * dt;
    while (pipes.length && pipes[0].x < -PIPE_W - 10) pipes.shift();

    for (const p of pipes) {
      if (!p.passed && p.x + PIPE_W / 2 < turd.x) {
        p.passed = true;
        score++;
        hudScoreEl.textContent = String(score);
        sfx.score();
      }
      const withinX = turd.x + TURD_R > p.x - PIPE_W / 2 && turd.x - TURD_R < p.x + PIPE_W / 2;
      if (withinX) {
        const topEdge = p.gapY - p.gapH / 2;
        const botEdge = p.gapY + p.gapH / 2;
        if (turd.y - TURD_R * 0.7 < topEdge || turd.y + TURD_R * 0.7 > botEdge) {
          endGame();
          return;
        }
      }
    }

    updateClouds(dt);
    updateSplashes(dt);
    updatePuffs(dt);
  }

  function updateIdle(dt) {
    idleT += dt;
    turd.x = VIRTUAL_W * TURD_X_FRAC;
    turd.y = VIRTUAL_H * 0.42 + Math.sin(idleT * 1.7) * 14;
    turd.tilt = Math.sin(idleT * 1.7) * 0.14;
    turd.squish = Math.max(0, turd.squish - dt * 3.2);
    groundScrollX -= 40 * dt;
    updateClouds(dt);
    updateSplashes(dt);
    updatePuffs(dt);
  }

  // After death: everything freezes where it was at the moment of impact
  // (ground, pipes, the turd itself) except the death-burst dust, which
  // still needs to finish animating and fading out.
  function updateGameoverFreeze(dt) {
    updatePuffs(dt);
  }

  // ---------------------------------------------------------------------
  // Draw
  // ---------------------------------------------------------------------
  function px(x) { return Math.round(x); }

  // ---- sewer scenery ----------------------------------------------------
  // Small seeded RNG so brick shading / stains are stable frame to frame.
  function rng(seed) {
    let t = seed >>> 0;
    return function () {
      t += 0x6d2b79f5;
      let r = Math.imul(t ^ (t >>> 15), 1 | t);
      r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Pre-rendered brick tile (repeats horizontally, scrolls with parallax).
  const BRICK_W = 26, BRICK_H = 13, TILE_W = BRICK_W * 8, TILE_H = BRICK_H * 8;
  let brickPattern = null;
  function buildBrickPattern() {
    const off = document.createElement("canvas");
    off.width = TILE_W; off.height = TILE_H;
    const o = off.getContext("2d");
    o.fillStyle = "#1a2a27"; // mortar
    o.fillRect(0, 0, TILE_W, TILE_H);
    const r = rng(1234);
    const shades = ["#33504a", "#2f4a44", "#37554e", "#2c463f", "#3a5a52", "#30483f"];
    for (let row = 0; row < TILE_H / BRICK_H; row++) {
      const shift = row % 2 ? BRICK_W / 2 : 0;
      for (let col = -1; col < TILE_W / BRICK_W + 1; col++) {
        const x = col * BRICK_W + shift, y = row * BRICK_H;
        o.fillStyle = shades[Math.floor(r() * shades.length)];
        o.fillRect(x + 1, y + 1, BRICK_W - 2, BRICK_H - 2);
        o.fillStyle = "rgba(255,255,255,0.06)"; // top highlight
        o.fillRect(x + 1, y + 1, BRICK_W - 2, 2);
        o.fillStyle = "rgba(0,0,0,0.18)"; // bottom shadow
        o.fillRect(x + 1, y + BRICK_H - 3, BRICK_W - 2, 2);
        if (r() < 0.22) { // moss / grime speckles
          o.fillStyle = r() < 0.5 ? "rgba(110,150,60,0.35)" : "rgba(20,30,20,0.35)";
          o.fillRect(x + 2 + Math.floor(r() * (BRICK_W - 8)), y + 3 + Math.floor(r() * 5), 3 + Math.floor(r() * 4), 2);
        }
      }
    }
    brickPattern = ctx.createPattern(off, "repeat");
  }

  function drawDrainArch(cx, baseY, t) {
    const w = 74, h = 96, top = baseY - h;
    // stone surround
    ctx.fillStyle = "#4a625c";
    ctx.beginPath();
    ctx.moveTo(cx - w / 2 - 8, baseY);
    ctx.lineTo(cx - w / 2 - 8, top + w / 2);
    ctx.arc(cx, top + w / 2, w / 2 + 8, Math.PI, 0);
    ctx.lineTo(cx + w / 2 + 8, baseY);
    ctx.closePath();
    ctx.fill();
    // dark mouth
    const g = ctx.createLinearGradient(0, top, 0, baseY);
    g.addColorStop(0, "#06100e"); g.addColorStop(1, "#0d1c19");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(cx - w / 2, baseY);
    ctx.lineTo(cx - w / 2, top + w / 2);
    ctx.arc(cx, top + w / 2, w / 2, Math.PI, 0);
    ctx.lineTo(cx + w / 2, baseY);
    ctx.closePath();
    ctx.fill();
    // faint glow deep inside the tunnel
    const glow = ctx.createRadialGradient(cx, baseY - 30, 2, cx, baseY - 30, 34);
    glow.addColorStop(0, "rgba(140,220,170,0.22)"); glow.addColorStop(1, "rgba(140,220,170,0)");
    ctx.fillStyle = glow; ctx.fillRect(cx - 40, baseY - 70, 80, 70);
    // iron grate
    ctx.fillStyle = "#1b2422";
    for (let i = -2; i <= 2; i++) ctx.fillRect(px(cx + i * 13 - 1.5), top + 8, 3, h - 8);
    ctx.fillRect(cx - w / 2, top + 44, w, 3);
    ctx.fillStyle = "rgba(160,90,40,0.5)"; // rust
    ctx.fillRect(px(cx - 14), top + 44, 6, 3);
    ctx.fillRect(px(cx + 12), top + 60, 3, 8);
    // trickle of slime-water spilling out
    const flowY = baseY - 6;
    ctx.fillStyle = "rgba(120,190,120,0.55)";
    ctx.fillRect(px(cx - 8), flowY, 16, VIRTUAL_H);
    ctx.fillStyle = "rgba(210,255,200,0.45)";
    const shimmer = Math.floor(t * 18) % 6;
    for (let y = flowY + shimmer; y < VIRTUAL_H; y += 6) ctx.fillRect(px(cx - 4), y, 2, 3);
  }

  function drawWallLamp(cx, cy, t) {
    const flicker = 0.9 + 0.1 * Math.sin(t * 13 + cx) * Math.sin(t * 7.3);
    const glow = ctx.createRadialGradient(cx, cy + 6, 4, cx, cy + 6, 110);
    glow.addColorStop(0, `rgba(255,214,130,${0.34 * flicker})`);
    glow.addColorStop(0.45, `rgba(255,214,130,${0.12 * flicker})`);
    glow.addColorStop(1, "rgba(255,214,130,0)");
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(cx, cy + 6, 110, 0, Math.PI * 2); ctx.fill();
    // bracket
    ctx.fillStyle = "#1b2422";
    ctx.fillRect(cx - 2, cy - 16, 4, 12);
    ctx.fillRect(cx - 9, cy - 6, 18, 4);
    // bulb in a wire cage
    ctx.fillStyle = "#ffe7a8";
    ctx.beginPath(); ctx.arc(cx, cy + 6, 6, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "#1b2422"; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(cx, cy + 6, 8, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx, cy - 2); ctx.lineTo(cx, cy + 14); ctx.moveTo(cx - 8, cy + 6); ctx.lineTo(cx + 8, cy + 6); ctx.stroke();
  }

  function drawCeilingPipe(offset, t) {
    const y = 26;
    // long rusty pipe running along the ceiling
    ctx.fillStyle = "#5b3b24"; ctx.fillRect(0, y, VIRTUAL_W, 16);
    ctx.fillStyle = "#7d5232"; ctx.fillRect(0, y + 2, VIRTUAL_W, 5);
    ctx.fillStyle = "#3a2516"; ctx.fillRect(0, y + 12, VIRTUAL_W, 4);
    const span = 110;
    let o = ((offset % span) + span) % span;
    for (let x = -span + o; x < VIRTUAL_W + span; x += span) {
      // flange + bracket
      ctx.fillStyle = "#4a2f1c"; ctx.fillRect(px(x) - 4, y - 3, 8, 22);
      ctx.fillStyle = "#8a5d3a"; ctx.fillRect(px(x) - 4, y - 3, 8, 3);
      ctx.fillStyle = "#1b2422"; ctx.fillRect(px(x) - 1, 0, 3, y - 3);
      // rust streak running down the wall
      ctx.fillStyle = "rgba(120,70,30,0.22)"; ctx.fillRect(px(x) + 10, y + 16, 5, 40);
    }
  }

  function drawBackground() {
    const t = performance.now() / 1000;
    if (!brickPattern) buildBrickPattern();
    const bgX = groundScrollX;

    // brick wall (slow parallax)
    ctx.save();
    const wallOff = ((bgX * 0.3) % TILE_W + TILE_W) % TILE_W;
    ctx.translate(wallOff - TILE_W, 0);
    ctx.fillStyle = brickPattern;
    ctx.fillRect(0, 0, VIRTUAL_W + TILE_W * 2, VIRTUAL_H);
    ctx.restore();

    // drain outlets along the base of the wall
    const archSpan = 300;
    const archOff = ((bgX * 0.3) % archSpan + archSpan) % archSpan;
    for (let x = -archSpan + archOff + 90; x < VIRTUAL_W + archSpan; x += archSpan) {
      drawDrainArch(px(x), VIRTUAL_H - GROUND_H, t);
    }

    // wall lamps (mid parallax)
    const lampSpan = 240;
    const lampOff = ((bgX * 0.3) % lampSpan + lampSpan) % lampSpan;
    for (let x = -lampSpan + lampOff + 160; x < VIRTUAL_W + lampSpan; x += lampSpan) {
      drawWallLamp(px(x), Math.round(VIRTUAL_H * 0.3), t);
    }

    drawCeilingPipe(bgX * 0.3, t);

    // ceiling shadow + damp green fog low down
    const shade = ctx.createLinearGradient(0, 0, 0, 90);
    shade.addColorStop(0, "rgba(5,12,10,0.65)"); shade.addColorStop(1, "rgba(5,12,10,0)");
    ctx.fillStyle = shade; ctx.fillRect(0, 0, VIRTUAL_W, 90);
    const fog = ctx.createLinearGradient(0, VIRTUAL_H - GROUND_H - 140, 0, VIRTUAL_H - GROUND_H);
    fog.addColorStop(0, "rgba(120,190,140,0)"); fog.addColorStop(1, "rgba(120,190,140,0.16)");
    ctx.fillStyle = fog; ctx.fillRect(0, VIRTUAL_H - GROUND_H - 140, VIRTUAL_W, 140);

    // falling drips
    for (const c of clouds) {
      ctx.fillStyle = "rgba(190,240,215,0.55)";
      ctx.fillRect(px(c.x), px(c.y), 2, Math.round(5 * c.s));
    }
  }

  function drawPipe(p) {
    const topEdge = p.gapY - p.gapH / 2;
    const botEdge = p.gapY + p.gapH / 2;
    const w = PIPE_W;
    const x = px(p.x - w / 2);
    const lip = 12;

    // glazed ceramic body: soft shading across the width, bright glaze streak
    function segment(sx, sy, sw, sh) {
      if (sh <= 0) return;
      const g = ctx.createLinearGradient(sx, 0, sx + sw, 0);
      g.addColorStop(0, "#bdb8ad");
      g.addColorStop(0.18, "#f2efe8");
      g.addColorStop(0.32, "#ffffff");
      g.addColorStop(0.62, "#ece8df");
      g.addColorStop(1, "#a9a397");
      ctx.fillStyle = g;
      ctx.fillRect(sx, sy, sw, sh);
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.fillRect(sx + Math.round(sw * 0.24), sy, 3, sh);
      ctx.strokeStyle = "#4d4a43";
      ctx.lineWidth = 2;
      ctx.strokeRect(sx + 1, sy, sw - 2, sh);
    }

    // stains, clipped to the pipe body; stable per pipe via its seed
    function stains(sx, sy, sw, sh, seed, dripDown) {
      if (sh <= 0) return;
      const r = rng(seed);
      ctx.save();
      ctx.beginPath(); ctx.rect(sx + 2, sy, sw - 4, sh); ctx.clip();
      const n = 3 + Math.floor(r() * 4);
      for (let i = 0; i < n; i++) {
        const bx = sx + 4 + r() * (sw - 16);
        const by = sy + r() * Math.max(1, sh - 10);
        const col = r() < 0.6 ? "rgba(120,82,40," : "rgba(190,160,60,";
        const a = 0.3 + r() * 0.25;
        ctx.fillStyle = col + a + ")";
        // blotchy cluster of pixel blobs
        for (let k = 0; k < 5; k++) {
          ctx.fillRect(px(bx + (r() - 0.5) * 14), px(by + (r() - 0.5) * 10), 4 + Math.floor(r() * 7), 3 + Math.floor(r() * 4));
        }
        // drip streak running down (or up, on the hanging pipe)
        if (r() < 0.6) {
          const len = 10 + r() * 34;
          ctx.fillStyle = col + (a * 0.8) + ")";
          ctx.fillRect(px(bx + 2), dripDown ? by : by - len, 2, len);
        }
      }
      // grimy tide-line just under the lip
      ctx.fillStyle = "rgba(110,90,50,0.22)";
      ctx.fillRect(sx, dripDown ? sy : sy + sh - 6, sw, 6);
      ctx.restore();
    }

    // top pipe (hangs down) — lip at the bottom
    const topBodyH = Math.max(0, topEdge - lip);
    segment(x, 0, w, topBodyH);
    stains(x, 0, w, topBodyH, p.seed, false);
    segment(x - 5, topEdge - lip, w + 10, lip);
    ctx.fillStyle = "rgba(0,0,0,0.12)"; ctx.fillRect(x - 3, topEdge - 3, w + 6, 2);

    // bottom pipe — lip at the top, stains drip downward
    const botBodyY = botEdge + lip;
    segment(x, botBodyY, w, Math.max(0, VIRTUAL_H - botBodyY));
    stains(x, botBodyY, w, VIRTUAL_H - GROUND_H - botBodyY, p.seed ^ 0x5bd1e995, true);
    segment(x - 5, botEdge, w + 10, lip);
    // a crusty brown ring on the bottom lip of some pipes
    if (p.seed % 3 === 0) {
      ctx.fillStyle = "rgba(120,82,40,0.35)";
      ctx.fillRect(x + 6, botEdge + 2, w - 18, 2);
    }
  }

  function drawGround() {
    const gy = VIRTUAL_H - GROUND_H;
    const t = performance.now() / 1000;
    // stone ledge edge
    ctx.fillStyle = "#56706a"; ctx.fillRect(0, gy, VIRTUAL_W, 6);
    ctx.fillStyle = "#6f8a83"; ctx.fillRect(0, gy, VIRTUAL_W, 2);
    // murky sewer water
    const g = ctx.createLinearGradient(0, gy + 6, 0, VIRTUAL_H);
    g.addColorStop(0, "#4f7a3c"); g.addColorStop(1, "#22381d");
    ctx.fillStyle = g; ctx.fillRect(0, gy + 6, VIRTUAL_W, GROUND_H - 6);
    // scrolling ripples
    const tileW = 28;
    const offset = ((groundScrollX % tileW) + tileW) % tileW;
    ctx.fillStyle = "rgba(190,230,150,0.35)";
    for (let x = -tileW + offset; x < VIRTUAL_W; x += tileW) {
      ctx.fillRect(px(x), gy + 9, 12, 2);
      ctx.fillRect(px(x + 14), gy + 19 + Math.round(Math.sin(t * 3 + x) * 1.5), 8, 2);
    }
    ctx.fillStyle = "rgba(10,25,10,0.3)";
    for (let x = -tileW + offset; x < VIRTUAL_W; x += tileW) ctx.fillRect(px(x + 6), gy + 28, 10, 2);
    // drip splashes
    for (const s of splashes) {
      const k = s.age / 0.35;
      ctx.strokeStyle = `rgba(200,240,190,${0.6 * (1 - k)})`;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.ellipse(s.x, s.y, 2 + k * 8, 1 + k * 2.5, 0, 0, Math.PI * 2); ctx.stroke();
    }
  }

  function drawTurd() {
    const skin = SKINS[currentSkinId] || SKINS.classic;
    ctx.save();
    ctx.translate(turd.x, turd.y);
    ctx.rotate(turd.tilt);
    const squish = turd.squish;
    const sx = 1 + squish * 0.14;
    const sy = 1 - squish * 0.14;
    ctx.scale(sx, sy);

    // swirl silhouette via stacked pixel-block tiers (poop-emoji-style shape)
    const PXU = 2.9; // pixel unit size
    const rows = [
      { w: 2, dx: 0 },   // tip
      { w: 4, dx: 0 },
      { w: 4, dx: 0.4 },
      { w: 6, dx: -0.3 },
      { w: 6, dx: 0.2 },
      { w: 8, dx: 0 },
      { w: 8, dx: 0 },
      { w: 10, dx: 0 },
      { w: 10, dx: 0 },
      { w: 11, dx: 0 },
      { w: 11, dx: 0 },
      { w: 11, dx: 0 },
      { w: 9, dx: 0 },
      { w: 7, dx: 0 },
      { w: 5, dx: 0 },
    ];
    const totalH = rows.length * PXU;
    const startY = -totalH / 2;

    rows.forEach((row, i) => {
      const y = startY + i * PXU;
      const w = row.w * PXU;
      const cx = row.dx * PXU;
      // outline, mid body, highlight
      ctx.fillStyle = skin.outline;
      ctx.fillRect(cx - w / 2 - 0.6, y, w + 1.2, PXU + 0.6);
      ctx.fillStyle = skin.body;
      ctx.fillRect(cx - w / 2, y, w, PXU + 0.5);
      ctx.fillStyle = skin.mid;
      ctx.fillRect(cx - w / 2 + w * 0.15, y, w * 0.45, PXU * 0.55);
      if (i < 4) {
        ctx.fillStyle = skin.hi;
        ctx.fillRect(cx - w / 2 + w * 0.2, y, Math.max(1.5, w * 0.3), PXU * 0.6);
      }
    });

    // face (eyes + smile), placed in the mid/upper body
    const faceY = startY + totalH * 0.52;
    ctx.fillStyle = "#fff";
    ctx.beginPath(); ctx.ellipse(-5.5, faceY, 3.4, 4, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(5.5, faceY, 3.4, 4, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#241a0f";
    ctx.beginPath(); ctx.arc(-4.6, faceY + 0.6, 1.7, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(6.4, faceY + 0.6, 1.7, 0, Math.PI * 2); ctx.fill();

    ctx.strokeStyle = "#241a0f";
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.arc(0, faceY + 7, 6, 0.12 * Math.PI, 0.88 * Math.PI);
    ctx.stroke();

    // rosy cheeks
    ctx.fillStyle = "rgba(255, 138, 61, 0.45)";
    ctx.beginPath(); ctx.arc(-9.5, faceY + 4, 2.1, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(10.2, faceY + 4, 2.1, 0, Math.PI * 2); ctx.fill();

    ctx.restore();

    // little stink wisp above (comedic, subtle)
    const wispY = turd.y - totalH_static() - 4;
    drawWisp(turd.x - 3, wispY);
  }
  function totalH_static() { return 15 * 2.9 / 2; }

  function drawWisp(x, y) {
    const t = idleT + elapsed;
    ctx.save();
    ctx.strokeStyle = "rgba(140, 200, 120, 0.55)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i <= 8; i++) {
      const yy = y - i * 2.4;
      const xx = x + Math.sin(i * 0.9 + t * 3) * 3;
      if (i === 0) ctx.moveTo(xx, yy); else ctx.lineTo(xx, yy);
    }
    ctx.stroke();
    ctx.restore();
  }

  function drawPuffs() {
    for (const p of puffs) {
      const a = Math.max(0, 1 - p.age / p.life);
      ctx.fillStyle = `rgba(255, 250, 240, ${a * 0.8})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function draw() {
    ctx.clearRect(0, 0, VIRTUAL_W, VIRTUAL_H);
    let ox = 0, oy = 0;
    if (shakeTime > 0) {
      ox = (Math.random() - 0.5) * 6 * (shakeTime / 0.3);
      oy = (Math.random() - 0.5) * 6 * (shakeTime / 0.3);
    }
    ctx.save();
    ctx.translate(ox, oy);
    drawBackground();
    for (const p of pipes) drawPipe(p);
    drawGround();
    drawPuffs();
    drawTurd();
    ctx.restore();
  }

  // ---------------------------------------------------------------------
  // Main loop
  // ---------------------------------------------------------------------
  let lastT = performance.now();
  function loop(t) {
    let dt = (t - lastT) / 1000;
    lastT = t;
    if (dt > 0.05) dt = 0.05;

    if (state === "playing") updatePlaying(dt);
    else if (state === "gameover") updateGameoverFreeze(dt);
    else updateIdle(dt);

    if (shakeTime > 0) shakeTime = Math.max(0, shakeTime - dt);

    draw();
    requestAnimationFrame(loop);
  }

  function boot() {
    resize();
    requestAnimationFrame((t) => { lastT = t; requestAnimationFrame(loop); });
  }

  try {
    boot();
  } catch (e) {
    console.error("[Flappy Turd] boot() failed:", e);
  }
})();
