/**
 * Rise - game.js
 * An original vertical "keep the balloon alive" climber.
 * All visuals are drawn procedurally on <canvas> - no external art assets,
 * no third-party audio, nothing copied from any existing game.
 */

(() => {
  "use strict";

  // ------------------------------------------------------------------
  // Canvas & sizing
  // ------------------------------------------------------------------
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  let W = 0, H = 0, DPR = 1;

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2.5);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.floor(W * DPR);
    canvas.height = Math.floor(H * DPR);
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }
  window.addEventListener("resize", resize);
  resize();

  // ------------------------------------------------------------------
  // Tiny helpers
  // ------------------------------------------------------------------
  const rand = (a, b) => a + Math.random() * (b - a);
  const randInt = (a, b) => Math.floor(rand(a, b + 1));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const dist2 = (x1, y1, x2, y2) => (x1 - x2) ** 2 + (y1 - y2) ** 2;

  function lerpColor(c1, c2, t) {
    const a = c1.match(/\d+/g).map(Number);
    const b = c2.match(/\d+/g).map(Number);
    const r = Math.round(lerp(a[0], b[0], t));
    const g = Math.round(lerp(a[1], b[1], t));
    const bl = Math.round(lerp(a[2], b[2], t));
    return `rgb(${r},${g},${bl})`;
  }

  function luminance(rgbStr) {
    const [r, g, b] = rgbStr.match(/\d+/g).map(Number);
    return 0.299 * r + 0.587 * g + 0.114 * b;
  }

  // ------------------------------------------------------------------
  // Tiny WebAudio synth (no external audio files at all)
  // ------------------------------------------------------------------
  const Sound = (() => {
    let actx = null;
    function ensure() {
      if (!actx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (AC) actx = new AC();
      }
      return actx;
    }
    function blip({ freq = 440, dur = 0.12, type = "sine", gain = 0.08, slideTo = null }) {
      const ac = ensure();
      if (!ac) return;
      if (ac.state === "suspended") ac.resume();
      const osc = ac.createOscillator();
      const g = ac.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, ac.currentTime);
      if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, ac.currentTime + dur);
      g.gain.setValueAtTime(gain, ac.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + dur);
      osc.connect(g).connect(ac.destination);
      osc.start();
      osc.stop(ac.currentTime + dur + 0.02);
    }
    return {
      pop: () => blip({ freq: 180, dur: 0.22, type: "sawtooth", gain: 0.12, slideTo: 60 }),
      collect: () => blip({ freq: 660, dur: 0.12, type: "sine", gain: 0.09, slideTo: 990 }),
      shield: () => blip({ freq: 320, dur: 0.25, type: "triangle", gain: 0.1, slideTo: 520 }),
      closeCall: () => blip({ freq: 500, dur: 0.09, type: "square", gain: 0.05, slideTo: 700 }),
      gameOver: () => blip({ freq: 220, dur: 0.6, type: "sawtooth", gain: 0.12, slideTo: 40 }),
      achievement: () => {
        [520, 660, 880].forEach((freq, i) => {
          setTimeout(() => blip({ freq, dur: 0.16, type: "sine", gain: 0.07 }), i * 90);
        });
      },
      unlock: () => ensure(),
    };
  })();

  // ------------------------------------------------------------------
  // Background music
  //
  // Looped theme track with a mute toggle remembered in localStorage.
  // ------------------------------------------------------------------
  const Music = (() => {
    const LOCAL_MUTE_KEY = "rise_music_muted_v1";
    const audio = new Audio("assets/audio/theme.mp3");
    audio.loop = true;
    audio.volume = 0.5;
    audio.preload = "auto";

    let localMuted = false;
    try {
      localMuted = localStorage.getItem(LOCAL_MUTE_KEY) === "1";
    } catch {
      /* storage unavailable - default to unmuted */
    }
    audio.muted = localMuted;

    let started = false;

    function currentlyMuted() {
      return localMuted;
    }

    function updateIcon() {
      const muted = currentlyMuted();
      const btn = document.getElementById("muteBtn");
      if (!btn) return;
      btn.classList.toggle("isMuted", muted);
      document.querySelector(".muteIconOn").classList.toggle("hidden", muted);
      document.querySelector(".muteIconOff").classList.toggle("hidden", !muted);
    }

    function start() {
      if (started) return;
      started = true;
      audio.play().catch(() => {
        started = false; // autoplay blocked - retry on the next gesture
      });
    }

    function setLocalMuted(m) {
      localMuted = m;
      audio.muted = m;
      try {
        localStorage.setItem(LOCAL_MUTE_KEY, m ? "1" : "0");
      } catch {
        /* ignore */
      }
    }

    function toggle() {
      setLocalMuted(!localMuted);
      updateIcon();
    }

    document.addEventListener("visibilitychange", () => {
      if (document.hidden) audio.pause();
      else if (started) audio.play().catch(() => {});
    });

    return { start, toggle, updateIcon, _audio: audio };
  })();

  // ------------------------------------------------------------------
  // Input: pointer (drag to steer) + keyboard
  //
  // Only one of these drives the balloon at a time ("mode"). Without this,
  // a single tap/drag would permanently lock out the keyboard (or vice
  // versa) because whichever branch ran later in the update loop always
  // won. Now whichever input the player used most recently takes over.
  // ------------------------------------------------------------------
  const input = { pointerX: null, left: false, right: false, mode: null };

  canvas.addEventListener("pointerdown", (e) => {
    input.mode = "pointer";
    input.pointerX = e.clientX;
  });
  canvas.addEventListener("pointermove", (e) => {
    if (input.mode === "pointer" && (e.buttons > 0 || e.pointerType === "touch")) {
      input.pointerX = e.clientX;
    }
  });
  window.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft" || e.key === "a" || e.key === "A") {
      input.left = true;
      input.mode = "keys";
    }
    if (e.key === "ArrowRight" || e.key === "d" || e.key === "D") {
      input.right = true;
      input.mode = "keys";
    }
    if (e.key === "Escape") togglePause();
  });
  window.addEventListener("keyup", (e) => {
    if (e.key === "ArrowLeft" || e.key === "a" || e.key === "A") input.left = false;
    if (e.key === "ArrowRight" || e.key === "d" || e.key === "D") input.right = false;
  });

  // ------------------------------------------------------------------
  // Sky bands - background gradient shifts with altitude (original
  // visual signature; nothing here references any specific game's art)
  // ------------------------------------------------------------------
  const SKY_BANDS = [
    { alt: 0, top: "rgb(255,205,150)", bot: "rgb(255,150,140)" }, // dawn
    { alt: 400, top: "rgb(120,190,255)", bot: "rgb(200,230,255)" }, // day
    { alt: 1200, top: "rgb(255,150,110)", bot: "rgb(120,90,150)" }, // dusk
    { alt: 2200, top: "rgb(15,20,60)", bot: "rgb(60,40,100)" }, // night
    { alt: 3400, top: "rgb(4,6,20)", bot: "rgb(20,15,45)" }, // stratosphere
  ];

  function skyColors(altitude) {
    let i = 0;
    while (i < SKY_BANDS.length - 1 && altitude >= SKY_BANDS[i + 1].alt) i++;
    const cur = SKY_BANDS[i];
    const next = SKY_BANDS[Math.min(i + 1, SKY_BANDS.length - 1)];
    const span = Math.max(1, next.alt - cur.alt);
    const t = clamp((altitude - cur.alt) / span, 0, 1);
    return {
      top: lerpColor(cur.top, next.top, t),
      bot: lerpColor(cur.bot, next.bot, t),
    };
  }

  // Drifting background clouds (parallax, purely decorative circles)
  let bgClouds = [];
  function seedClouds() {
    bgClouds = Array.from({ length: 10 }, () => ({
      x: rand(0, W),
      y: rand(0, H),
      r: rand(30, 90),
      speed: rand(6, 18),
      alpha: rand(0.08, 0.22),
    }));
  }

  // ------------------------------------------------------------------
  // Balloon (player)
  // ------------------------------------------------------------------
  const balloon = {
    x: 0,
    y: 0,
    targetX: 0,
    r: 26,
    alive: true,
    invuln: 0,
    shield: 0,
    wobble: 0,
    tilt: 0,
  };

  const BALLOON_COLOR = { a: "#ffd569", b: "#ff5d73" };

  function resetBalloon() {
    balloon.x = W / 2;
    balloon.targetX = W / 2;
    balloon.y = H * 0.72; // lower third - more sky above to react to incoming hazards
    balloon.alive = true;
    balloon.invuln = 0;
    balloon.shield = 0;
    balloon.wobble = 0;
    balloon.tilt = 0;
  }

  // ------------------------------------------------------------------
  // World / run state
  // ------------------------------------------------------------------
  const world = {
    altitude: 0, // meters climbed = score
    scrollSpeed: 120, // px/s, ramps up
    spawnTimer: 0,
    nextSpawnIn: 1.2,
    obstacles: [],
    collectibles: [],
    particles: [],
    toastTimer: 0,
    deathTimer: 0,
    starsThisRun: 0, // stars collected this life
    closeCallsThisRun: 0, // close calls this life
  };

  function difficultyScrollSpeed(alt) {
    return clamp(120 + alt * 0.06, 120, 420);
  }
  function difficultySpawnGap(alt) {
    return clamp(1.15 - alt * 0.00025, 0.45, 1.15);
  }

  // ---- Obstacle factories --------------------------------------------------
  // Every hazard is a simple procedurally-drawn vector shape (no sprites).
  function spawnObstacle() {
    const kinds = ["spikeCloud", "fanBlade", "spikeBall", "birdSweep"];
    // unlock later hazards as altitude increases, for a gentle ramp
    const alt = world.altitude;
    const pool = kinds.filter((k, idx) => alt > idx * 250 - 250);
    const kind = pool[randInt(0, pool.length - 1)];
    const x = rand(60, W - 60);

    const base = { kind, x, y: -80, hit: false, grazed: false, r: 30 };

    if (kind === "spikeCloud") {
      base.r = rand(28, 40);
      base.spikes = randInt(6, 9);
    } else if (kind === "fanBlade") {
      base.r = rand(34, 46);
      base.angle = rand(0, Math.PI * 2);
      base.spin = rand(1.5, 3) * (Math.random() < 0.5 ? -1 : 1);
    } else if (kind === "spikeBall") {
      base.r = rand(20, 28);
      base.driftDir = Math.random() < 0.5 ? -1 : 1;
      base.driftSpeed = rand(30, 70);
      base.spin = rand(1, 2);
    } else if (kind === "birdSweep") {
      base.r = 18;
      base.flapT = rand(0, 10);
      base.driftDir = Math.random() < 0.5 ? -1 : 1;
      base.driftSpeed = rand(80, 140);
    }
    world.obstacles.push(base);
  }

  function spawnCollectible() {
    const r = Math.random();
    const kind = r < 0.72 ? "star" : "helium";
    world.collectibles.push({
      kind,
      x: rand(50, W - 50),
      y: -60,
      r: kind === "helium" ? 16 : 12,
      spin: rand(1, 3),
      angle: 0,
      taken: false,
    });
  }

  // ------------------------------------------------------------------
  // Screens / UI plumbing
  // ------------------------------------------------------------------
  const screens = {
    menu: document.getElementById("menuScreen"),
    howto: document.getElementById("howToScreen"),
    pause: document.getElementById("pauseScreen"),
    gameover: document.getElementById("gameOverScreen"),
  };
  const hud = document.getElementById("hud");
  const altitudeEl = document.getElementById("altitude");
  const shieldChipEl = document.getElementById("shieldChip");
  const toastEl = document.getElementById("toast");

  let state = "menu"; // menu | playing | paused | gameover | howto

  function showOnly(name) {
    Object.values(screens).forEach((s) => s.classList.add("hidden"));
    if (name && screens[name]) screens[name].classList.remove("hidden");
    hud.classList.toggle("hidden", state !== "playing" && state !== "paused");
  }

  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.remove("hidden");
    toastEl.style.opacity = "1";
    world.toastTimer = 1.1;
  }

  // ------------------------------------------------------------------
  // Game flow
  // ------------------------------------------------------------------
  function startRun() {
    Sound.unlock();
    world.altitude = 0;
    world.scrollSpeed = 120;
    world.spawnTimer = 0;
    world.nextSpawnIn = 1.0;
    world.obstacles = [];
    world.collectibles = [];
    world.particles = [];
    world.starsThisRun = 0;
    world.closeCallsThisRun = 0;
    resetBalloon();
    seedClouds();
    state = "playing";
    showOnly(null);
    hud.classList.remove("hidden");
  }

  function togglePause() {
    if (state === "playing") {
      state = "paused";
      showOnly("pause");
    } else if (state === "paused") {
      state = "playing";
      showOnly(null);
      hud.classList.remove("hidden");
    }
  }

  const BEST_KEY = "rise_local_best_v1";
  function getBest() {
    try {
      return parseInt(localStorage.getItem(BEST_KEY) || "0", 10) || 0;
    } catch {
      return 0;
    }
  }

  function endRun() {
    state = "gameover";
    Sound.gameOver();
    const finalAlt = Math.floor(world.altitude);
    const prevBest = getBest();
    const isNewBest = finalAlt > prevBest;
    if (isNewBest) {
      try {
        localStorage.setItem(BEST_KEY, String(finalAlt));
      } catch {
        /* ignore */
      }
    }
    document.getElementById("finalAltitude").textContent = `${finalAlt} m`;
    document.getElementById("newBest").classList.toggle("hidden", !isNewBest);
    document.getElementById("submitStatus").textContent = `Best: ${Math.max(prevBest, finalAlt)} m`;
    showOnly("gameover");
  }

  // ------------------------------------------------------------------
  // Update
  // ------------------------------------------------------------------
  function updatePlaying(dt) {
    if (!balloon.alive) {
      // little pop-reaction beat before the game-over screen takes over
      for (const p of world.particles) {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vy += 260 * dt;
        p.life -= dt;
      }
      world.particles = world.particles.filter((p) => p.life > 0);
      world.deathTimer -= dt;
      if (world.deathTimer <= 0) endRun();
      return;
    }

    // steering: whichever input mode was used most recently is in control
    if (input.mode === "keys") {
      if (input.left) balloon.targetX -= 380 * dt;
      if (input.right) balloon.targetX += 380 * dt;
    } else if (input.mode === "pointer" && input.pointerX != null) {
      balloon.targetX = input.pointerX;
    }
    balloon.targetX = clamp(balloon.targetX, balloon.r + 4, W - balloon.r - 4);

    const prevX = balloon.x;
    balloon.x = lerp(balloon.x, balloon.targetX, clamp(dt * 8, 0, 1));
    balloon.tilt = clamp((balloon.x - prevX) * 1.6, -18, 18);
    balloon.wobble += dt * 4;

    if (balloon.invuln > 0) balloon.invuln -= dt;
    if (balloon.shield > 0) balloon.shield -= dt;

    // difficulty ramp
    world.scrollSpeed = difficultyScrollSpeed(world.altitude);
    world.altitude += (world.scrollSpeed * dt) / 12; // scale px->"meters"

    // spawns
    world.spawnTimer += dt;
    if (world.spawnTimer >= world.nextSpawnIn) {
      world.spawnTimer = 0;
      world.nextSpawnIn = difficultySpawnGap(world.altitude) * rand(0.8, 1.3);
      spawnObstacle();
      if (Math.random() < 0.55) spawnCollectible();
    }

    // clouds drift
    for (const c of bgClouds) {
      c.y += (world.scrollSpeed * 0.35 + c.speed) * dt;
      if (c.y - c.r > H) {
        c.y = -c.r;
        c.x = rand(0, W);
      }
    }

    // obstacles
    for (const o of world.obstacles) {
      o.y += world.scrollSpeed * dt;
      if (o.kind === "fanBlade") o.angle += o.spin * dt;
      if (o.kind === "spikeBall") {
        o.angle = (o.angle || 0) + o.spin * dt;
        o.x += o.driftDir * o.driftSpeed * dt;
        if (o.x < o.r || o.x > W - o.r) o.driftDir *= -1;
      }
      if (o.kind === "birdSweep") {
        o.flapT += dt * 10;
        o.x += o.driftDir * o.driftSpeed * dt;
        if (o.x < o.r + 10 || o.x > W - o.r - 10) o.driftDir *= -1;
      }

      if (!o.hit) {
        const d = Math.sqrt(dist2(o.x, o.y, balloon.x, balloon.y));
        const hitDist = o.r + balloon.r - 6;
        const grazeDist = o.r + balloon.r + 16;

        if (d < hitDist) {
          if (balloon.invuln <= 0 && balloon.shield <= 0) {
            o.hit = true;
            popBalloon();
          } else if (balloon.shield > 0) {
            o.hit = true; // shield absorbs it silently
            spawnBurst(o.x, o.y, "#8ecdff");
          }
        } else if (!o.grazed && d < grazeDist) {
          o.grazed = true;
          world.altitude += 6; // close-call bonus
          world.closeCallsThisRun++;
          Sound.closeCall();
          toast("Close call! +6m");
        }
      }
    }
    world.obstacles = world.obstacles.filter((o) => o.y - o.r < H + 60);

    // collectibles
    for (const c of world.collectibles) {
      c.y += world.scrollSpeed * dt;
      c.angle += c.spin * dt;
      if (!c.taken) {
        const d = Math.sqrt(dist2(c.x, c.y, balloon.x, balloon.y));
        if (d < c.r + balloon.r) {
          c.taken = true;
          if (c.kind === "star") {
            world.altitude += 10;
            world.starsThisRun++;
            Sound.collect();
            spawnBurst(c.x, c.y, "#ffd23f");
          } else {
            balloon.shield = 4.5;
            Sound.shield();
            toast("Shield up!");
            spawnBurst(c.x, c.y, "#8ecdff");
          }
        }
      }
    }
    world.collectibles = world.collectibles.filter((c) => !c.taken && c.y - c.r < H + 40);

    // particles
    for (const p of world.particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 260 * dt;
      p.life -= dt;
    }
    world.particles = world.particles.filter((p) => p.life > 0);

    if (world.toastTimer > 0) {
      world.toastTimer -= dt;
      if (world.toastTimer <= 0) toastEl.classList.add("hidden");
    }

    shieldChipEl.classList.toggle("hidden", balloon.shield <= 0);
    altitudeEl.textContent = `${Math.floor(world.altitude)} m`;

    // checked once per frame (after every altitude-affecting event above
    // has applied for this frame - base climb, close-call bonus, stars)
  }

  function popBalloon() {
    balloon.alive = false;
    world.deathTimer = 0.5;
    spawnBurst(balloon.x, balloon.y, BALLOON_COLOR.b);
    Sound.pop();
  }

  function spawnBurst(x, y, color) {
    for (let i = 0; i < 14; i++) {
      const a = rand(0, Math.PI * 2);
      const speed = rand(60, 220);
      world.particles.push({
        x, y,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed,
        life: rand(0.3, 0.7),
        maxLife: 0.7,
        r: rand(2, 5),
        color,
      });
    }
  }

  // ------------------------------------------------------------------
  // Draw
  // ------------------------------------------------------------------
  function drawBackground() {
    const { top, bot } = skyColors(world.altitude);
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, top);
    g.addColorStop(1, bot);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // stars appear once we're high enough (night/stratosphere)
    if (world.altitude > 1800) {
      const starAlpha = clamp((world.altitude - 1800) / 800, 0, 0.9);
      ctx.fillStyle = `rgba(255,255,255,${starAlpha})`;
      for (let i = 0; i < 40; i++) {
        const sx = (i * 97 + 31) % W;
        const sy = (i * 53 + 17) % H;
        ctx.fillRect(sx, sy, 2, 2);
      }
    }

    ctx.save();
    for (const c of bgClouds) {
      ctx.globalAlpha = c.alpha;
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.ellipse(c.x, c.y, c.r, c.r * 0.6, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawBalloon() {
    if (!balloon.alive) return;
    const colorSet = BALLOON_COLOR;
    const bobY = Math.sin(balloon.wobble) * 3;

    ctx.save();
    ctx.translate(balloon.x, balloon.y + bobY);
    ctx.rotate((balloon.tilt * Math.PI) / 180);

    if (balloon.shield > 0) {
      ctx.save();
      ctx.globalAlpha = 0.35 + Math.sin(balloon.wobble * 3) * 0.1;
      ctx.strokeStyle = "#8ecdff";
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(0, 0, balloon.r + 12, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // string
    ctx.strokeStyle = "rgba(255,255,255,0.5)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, balloon.r);
    ctx.lineTo(0, balloon.r + 16);
    ctx.stroke();

    // balloon body
    const grad = ctx.createRadialGradient(-balloon.r * 0.35, -balloon.r * 0.4, 4, 0, 0, balloon.r * 1.3);
    grad.addColorStop(0, colorSet.a);
    grad.addColorStop(1, colorSet.b);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.ellipse(0, 0, balloon.r * 0.92, balloon.r, 0, 0, Math.PI * 2);
    ctx.fill();

    // highlight
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.beginPath();
    ctx.ellipse(-balloon.r * 0.32, -balloon.r * 0.42, balloon.r * 0.22, balloon.r * 0.32, -0.4, 0, Math.PI * 2);
    ctx.fill();

    // knot
    ctx.fillStyle = colorSet.b;
    ctx.beginPath();
    ctx.moveTo(-5, balloon.r - 2);
    ctx.lineTo(5, balloon.r - 2);
    ctx.lineTo(0, balloon.r + 6);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  }

  function drawObstacle(o) {
    ctx.save();
    ctx.translate(o.x, o.y);

    if (o.kind === "spikeCloud") {
      ctx.fillStyle = "#f4f6fb";
      ctx.beginPath();
      ctx.arc(0, 0, o.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#e2536b";
      for (let i = 0; i < o.spikes; i++) {
        const a = (i / o.spikes) * Math.PI * 2;
        const sx = Math.cos(a) * o.r;
        const sy = Math.sin(a) * o.r;
        const ex = Math.cos(a) * (o.r + 12);
        const ey = Math.sin(a) * (o.r + 12);
        const perpX = Math.cos(a + Math.PI / 2) * 5;
        const perpY = Math.sin(a + Math.PI / 2) * 5;
        ctx.beginPath();
        ctx.moveTo(sx + perpX, sy + perpY);
        ctx.lineTo(sx - perpX, sy - perpY);
        ctx.lineTo(ex, ey);
        ctx.closePath();
        ctx.fill();
      }
    } else if (o.kind === "fanBlade") {
      ctx.rotate(o.angle);
      ctx.fillStyle = "#3d4560";
      ctx.beginPath();
      ctx.arc(0, 0, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#9aa3c2";
      for (let i = 0; i < 4; i++) {
        ctx.save();
        ctx.rotate((i * Math.PI) / 2);
        ctx.beginPath();
        ctx.ellipse(o.r * 0.55, 0, o.r * 0.55, 9, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    } else if (o.kind === "spikeBall") {
      ctx.rotate(o.angle);
      ctx.fillStyle = "#2c2f3d";
      ctx.beginPath();
      ctx.arc(0, 0, o.r * 0.7, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#2c2f3d";
      ctx.lineWidth = 4;
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * o.r * 0.6, Math.sin(a) * o.r * 0.6);
        ctx.lineTo(Math.cos(a) * o.r, Math.sin(a) * o.r);
        ctx.stroke();
      }
    } else if (o.kind === "birdSweep") {
      // Adaptive contrast: a dark silhouette reads fine at dawn/day, but
      // disappears against the night/stratosphere bands - so the bird's
      // fill and outline swap to stay legible against whatever's behind it.
      const lum = luminance(skyColors(world.altitude).top);
      const light = lum < 140;
      const body = light ? "#f4f7ff" : "#252a3a";
      const outline = light ? "rgba(20,24,40,0.55)" : "rgba(255,255,255,0.45)";
      const flap = Math.sin(o.flapT) * 9 + 5; // wingtip lift, 4..14
      const dir = o.driftDir >= 0 ? 1 : -1;

      ctx.scale(dir, 1); // face the way it's flying
      ctx.fillStyle = body;
      ctx.strokeStyle = outline;
      ctx.lineWidth = 1.6;
      ctx.lineJoin = "round";

      // a simple, readable gull-in-flight silhouette: two swept wings
      // meeting a small rounded body, drawn as one closed shape.
      ctx.beginPath();
      ctx.moveTo(0, 3);
      ctx.quadraticCurveTo(-9, -2, -22, -flap);
      ctx.quadraticCurveTo(-12, 1, -3, 2);
      ctx.quadraticCurveTo(0, -3, 3, 2);
      ctx.quadraticCurveTo(12, 1, 22, -flap);
      ctx.quadraticCurveTo(9, -2, 0, 3);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawCollectible(c) {
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.rotate(c.angle);
    if (c.kind === "star") {
      ctx.fillStyle = "#ffd23f";
      ctx.beginPath();
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
        const a2 = a + Math.PI / 5;
        ctx.lineTo(Math.cos(a) * c.r, Math.sin(a) * c.r);
        ctx.lineTo(Math.cos(a2) * c.r * 0.45, Math.sin(a2) * c.r * 0.45);
      }
      ctx.closePath();
      ctx.fill();
    } else {
      ctx.fillStyle = "#8ecdff";
      ctx.beginPath();
      ctx.ellipse(0, 0, c.r * 0.8, c.r, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.6)";
      ctx.fillRect(-c.r * 0.15, -c.r * 0.5, c.r * 0.3, c.r * 0.4);
    }
    ctx.restore();
  }

  function drawParticles() {
    for (const p of world.particles) {
      ctx.globalAlpha = clamp(p.life / p.maxLife, 0, 1);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function render() {
    drawBackground();
    if (state === "playing" || state === "paused") {
      for (const o of world.obstacles) drawObstacle(o);
      for (const c of world.collectibles) drawCollectible(c);
      drawParticles();
      drawBalloon();
    }
  }

  // ------------------------------------------------------------------
  // Main loop
  // ------------------------------------------------------------------
  let lastT = performance.now();
  function loop(t) {
    let dt = (t - lastT) / 1000;
    lastT = t;
    dt = Math.min(dt, 0.05); // clamp for tab-switch spikes

    if (state === "playing") updatePlaying(dt);
    render();
    requestAnimationFrame(loop);
  }

  // ------------------------------------------------------------------
  // Wire up UI
  // ------------------------------------------------------------------
  document.getElementById("playBtn").addEventListener("click", startRun);
  document.getElementById("howToBtn").addEventListener("click", () => {
    state = "howto";
    showOnly("howto");
  });
  document.getElementById("backFromHow").addEventListener("click", () => {
    state = "menu";
    showOnly("menu");
  });
  document.getElementById("pauseBtn").addEventListener("click", togglePause);
  document.getElementById("resumeBtn").addEventListener("click", togglePause);
  document.getElementById("quitBtn").addEventListener("click", () => {
    state = "menu";
    showOnly("menu");
  });
  document.getElementById("retryBtn").addEventListener("click", startRun);
  document.getElementById("backToMenuBtn").addEventListener("click", () => {
    state = "menu";
    showOnly("menu");
  });
  document.getElementById("muteBtn").addEventListener("click", () => Music.toggle());

  // ------------------------------------------------------------------
  // Boot
  // ------------------------------------------------------------------
  seedClouds();
  showOnly("menu");

  // Dev-only hook, never used by players: `?debug=1` exposes internal
  // state so we can jump altitude/spawn hazards on demand while testing.
  if (location.search.includes("debug")) {
    window.__rise = {
      world, balloon, spawnObstacle, skyColors, luminance, Music,
    };
  }

  // Music can't autoplay before a user gesture in any modern browser, so
  // start it on whichever gesture happens first - menu button, a key
  // press, or a stray tap - rather than tying it to the Play button only.
  window.addEventListener("pointerdown", () => Music.start(), { once: true });
  window.addEventListener("keydown", () => Music.start(), { once: true });

  Music.updateIcon();
  requestAnimationFrame((t) => {
    lastT = t;
    requestAnimationFrame(loop);
  });
})();
