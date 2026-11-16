/* =========================================================
   Chop Shop Chef
   Swipe-to-slice vegetable game. Part of dailygametree.com.
   ========================================================= */

// ---------- Local best score ----------
const LocalBest = {
  key: 'vegetable-ninja-best-score',
  get() { return Number(localStorage.getItem(this.key) || 0); },
  set(v) {
    if (v > this.get()) localStorage.setItem(this.key, String(v));
  }
};

// ---------- Sound — tiny SFX synthesized on the fly (Web Audio API), no
// external audio files. The AudioContext is created lazily on the first
// user gesture, since browsers refuse to make sound before one. ----------
const MUTE_KEY = 'vegetable-ninja-muted';
let muted = false;
try { muted = localStorage.getItem(MUTE_KEY) === '1'; } catch (e) {}

let audioCtx = null;
function ensureAudio() {
  if (audioCtx) return audioCtx;
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    audioCtx = Ctx ? new Ctx() : null;
  } catch (e) { audioCtx = null; }
  return audioCtx;
}
function resumeAudio() {
  const ctx = ensureAudio();
  if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
}
window.addEventListener('pointerdown', resumeAudio, { once: true });
window.addEventListener('keydown', resumeAudio, { once: true });

function playTone({ freq = 440, endFreq = null, type = 'sine', duration = 0.1, volume = 0.16, attack = 0.005, delay = 0 }) {
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

function playNoise({ duration = 0.3, volume = 0.2, filterFreq = 900, delay = 0 }) {
  if (muted) return;
  const ctx = ensureAudio();
  if (!ctx) return;
  const t0 = ctx.currentTime + delay;
  const bufferSize = Math.max(1, Math.floor(ctx.sampleRate * duration));
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;

  const noise = ctx.createBufferSource();
  noise.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(filterFreq, t0);
  filter.frequency.exponentialRampToValueAtTime(Math.max(80, filterFreq * 0.2), t0 + duration);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(volume, t0);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);

  noise.connect(filter).connect(gain).connect(ctx.destination);
  noise.start(t0);
  noise.stop(t0 + duration + 0.02);
}

// A blade whoosh: noise swept through a narrow bandpass filter from a
// bright "shhk" down through mid frequencies, with a fast attack and
// decay — this is what actually reads as a slice, unlike a plain tone.
function playWhoosh({ duration = 0.1, volume = 0.22, startFreq = 3800, endFreq = 700, q = 0.8, delay = 0 } = {}) {
  if (muted) return;
  const ctx = ensureAudio();
  if (!ctx) return;
  const t0 = ctx.currentTime + delay;
  const bufferSize = Math.max(1, Math.floor(ctx.sampleRate * duration));
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;

  const noise = ctx.createBufferSource();
  noise.buffer = buffer;

  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.Q.value = q;
  filter.frequency.setValueAtTime(startFreq, t0);
  filter.frequency.exponentialRampToValueAtTime(endFreq, t0 + duration);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(volume, t0 + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);

  noise.connect(filter).connect(gain).connect(ctx.destination);
  noise.start(t0);
  noise.stop(t0 + duration + 0.02);
}

const sfx = {
  slice() {
    playWhoosh({ duration: rand(0.09, 0.11), startFreq: rand(3400, 4200), endFreq: rand(600, 900), volume: 0.24 });
    // A brief high "shing" layered on top for a touch of blade shimmer.
    playTone({ freq: rand(2600, 3400), type: 'sine', duration: 0.05, volume: 0.05, attack: 0.002, delay: 0.008 });
  },
  combo(count) {
    const n = Math.min(count, 4);
    for (let i = 0; i < n; i++) {
      playTone({ freq: 900 + i * 160, type: 'square', duration: 0.06, volume: 0.1, delay: i * 0.035 });
    }
  },
  bomb() {
    playNoise({ duration: 0.35, volume: 0.3, filterFreq: 1400 });
    playTone({ freq: 140, endFreq: 40, type: 'sawtooth', duration: 0.4, volume: 0.22 });
  },
  miss() {
    playTone({ freq: 220, endFreq: 140, type: 'triangle', duration: 0.18, volume: 0.14 });
  },
  gameOver() {
    playTone({ freq: 380, endFreq: 80, type: 'sawtooth', duration: 0.5, volume: 0.18 });
  },
  click() {
    playTone({ freq: 680, type: 'square', duration: 0.045, volume: 0.09 });
  },
};

// ---------- Canvas setup ----------
const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');
let W = 0, H = 0, DPR = 1;

function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  // Measure the actual laid-out container (which uses 100dvh) rather than
  // window.innerWidth/innerHeight — on mobile those can momentarily
  // disagree with the visible viewport as the browser chrome shows/hides.
  const rect = canvas.parentElement.getBoundingClientRect();
  W = rect.width;
  H = rect.height;
  canvas.width = Math.round(W * DPR);
  canvas.height = Math.round(H * DPR);
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', resize);
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', resize);
}
resize();

// ---------- Utility ----------
function rand(a, b) { return a + Math.random() * (b - a); }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

function distToSegment(px, py, ax, ay, bx, by) {
  const abx = bx - ax, aby = by - ay;
  const apx = px - ax, apy = py - ay;
  const abLen2 = abx * abx + aby * aby;
  let t = abLen2 > 0 ? (apx * abx + apy * aby) / abLen2 : 0;
  t = clamp(t, 0, 1);
  const cx = ax + abx * t, cy = ay + aby * t;
  const dx = px - cx, dy = py - cy;
  return Math.sqrt(dx * dx + dy * dy);
}

// ---------- Game constants ----------
const BASE_GRAVITY = 1700;
const VEG_TYPES = [
  { emoji: '🥕', radius: 34 },
  { emoji: '🍅', radius: 32 },
  { emoji: '🥦', radius: 36 },
  { emoji: '🌽', radius: 34 },
  { emoji: '🍆', radius: 34 },
  { emoji: '🧅', radius: 32 },
  { emoji: '🥔', radius: 32 },
  { emoji: '🫑', radius: 32 },
];
const BOMB = { emoji: '💣', radius: 34 };

// ---------- Game state ----------
let objects = [];      // flying vegetables & bombs
let particles = [];    // juice / explosion particles
let popups = [];       // floating score text
let trail = [];        // pointer trail points {x,y,t}
let strokeSliceCount = 0;

let score = 0;
let lives = 3;
let elapsed = 0;
let nextSpawnAt = 0;
let running = false;
let lastTime = 0;
let screenFlash = 0;

const scoreEl = document.getElementById('score-display');
const livesEls = document.querySelectorAll('#lives-display .life');
const screenTitle = document.getElementById('screen-title');
const screenGameover = document.getElementById('screen-gameover');
const countdownEl = document.getElementById('countdown');
const finalScoreEl = document.getElementById('final-score');
const finalBestLabel = document.getElementById('final-best-label');
const bestScoreLabel = document.getElementById('best-score-label');
const muteBtn = document.getElementById('btn-mute');

function updateHud() {
  scoreEl.textContent = String(score);
  livesEls.forEach((el, i) => {
    el.classList.toggle('lost', i >= lives);
  });
}

function updateBestLabel(el) {
  const best = LocalBest.get();
  el.textContent = best > 0 ? `Best: ${best}` : '';
}

function updateMuteButton() {
  muteBtn.textContent = muted ? '🔇' : '🔊';
  muteBtn.setAttribute('aria-pressed', muted ? 'true' : 'false');
  muteBtn.setAttribute('aria-label', muted ? 'Unmute sound' : 'Mute sound');
}
updateMuteButton();

muteBtn.addEventListener('click', () => {
  muted = !muted;
  try { localStorage.setItem(MUTE_KEY, muted ? '1' : '0'); } catch (e) {}
  updateMuteButton();
});

// ---------- Spawning ----------
// Launch velocity and horizontal drift are derived from the current
// screen size (H/W) rather than fixed pixel constants, so vegetables
// always arc up and back down within the visible play area — on a tall
// desktop window or a short mobile portrait screen alike.
function spawnWave() {
  const t = elapsed;
  const count = t > 45 ? (Math.random() < 0.35 ? 3 : 2)
              : t > 18 ? (Math.random() < 0.3 ? 2 : 1)
              : 1;
  const bombChance = clamp(0.06 + t * 0.0025, 0.06, 0.22);
  const sizeFactor = clamp(Math.min(W, H) / 800, 0.72, 1.15);

  for (let i = 0; i < count; i++) {
    const isBomb = Math.random() < bombChance;
    const def = isBomb ? BOMB : pick(VEG_TYPES);
    const radius = def.radius * sizeFactor;

    // Gravity ramps mildly with elapsed time for a snappier late-game feel
    // (shorter hang time), captured per-object so a game-wide change mid
    // flight can't retroactively alter an object already in the air.
    const g = BASE_GRAVITY + t * 3.5;
    // Apex reaches 45-60% up the screen from the spawn point — scales
    // with H automatically, so it never flies off the top regardless of
    // device height.
    const apexHeight = rand(0.45, 0.6) * H;
    const vy = -Math.sqrt(2 * g * apexHeight);
    const hangTime = (2 * Math.abs(vy)) / g;

    // Horizontal drift is capped as a fraction of the screen width over
    // the object's full hang time, so it can't drift off either side —
    // scales with W the same way vy scales with H. The cap also accounts
    // for the object's own radius (not just its center point), and for
    // its actual spawn x, so the sprite's edge — not just its anchor —
    // never reaches the screen edge.
    const edgeMargin = radius * 1.1;
    const safeMinX = edgeMargin;
    const safeMaxX = Math.max(safeMinX, W - edgeMargin);
    const spawnMinX = Math.min(Math.max(safeMinX, W * 0.25), safeMaxX);
    const spawnMaxX = Math.max(Math.min(safeMaxX, W * 0.75), spawnMinX);
    const x = spawnMinX < spawnMaxX ? rand(spawnMinX, spawnMaxX) : W / 2;

    const driftCap = Math.min(0.16 * W, x - safeMinX, safeMaxX - x);
    const maxDrift = Math.max(0, driftCap);
    const vx = hangTime > 0 && maxDrift > 0 ? rand(-1, 1) * (maxDrift / hangTime) : 0;

    objects.push({
      id: Math.random().toString(36).slice(2),
      emoji: def.emoji,
      radius,
      isBomb,
      x, y: H + radius + rand(0, 40),
      vx, vy, g,
      rotation: rand(0, Math.PI * 2),
      vrot: rand(-3, 3),
      sliced: false,
      missed: false,
    });
  }
}

function scheduleNextSpawn() {
  const t = elapsed;
  const interval = clamp(1250 - t * 9, 420, 1250);
  nextSpawnAt = elapsed + interval / 1000 + rand(-0.05, 0.05);
}

// ---------- Particles & popups ----------
function spawnJuice(x, y, color) {
  const n = 10;
  for (let i = 0; i < n; i++) {
    const a = rand(0, Math.PI * 2);
    const speed = rand(120, 420);
    particles.push({
      x, y,
      vx: Math.cos(a) * speed,
      vy: Math.sin(a) * speed - 100,
      life: rand(0.4, 0.8),
      age: 0,
      color,
      size: rand(3, 7),
    });
  }
}

function spawnExplosion(x, y) {
  const n = 26;
  for (let i = 0; i < n; i++) {
    const a = rand(0, Math.PI * 2);
    const speed = rand(200, 650);
    particles.push({
      x, y,
      vx: Math.cos(a) * speed,
      vy: Math.sin(a) * speed,
      life: rand(0.5, 1.0),
      age: 0,
      color: pick(['#ff8a00', '#ff3d00', '#ffd500', '#5a5a5a']),
      size: rand(4, 10),
    });
  }
  screenFlash = 0.55;
}

function spawnPopup(x, y, text, color) {
  popups.push({ x, y, text, color, age: 0, life: 0.9 });
}

// ---------- Slicing ----------
function trySlice(ax, ay, bx, by) {
  for (const obj of objects) {
    if (obj.sliced || obj.missed) continue;
    const d = distToSegment(obj.x, obj.y, ax, ay, bx, by);
    if (d < obj.radius + 6) {
      sliceObject(obj);
    }
  }
}

function sliceObject(obj) {
  obj.sliced = true;
  if (obj.isBomb) {
    spawnExplosion(obj.x, obj.y);
    sfx.bomb();
    endGame();
    return;
  }
  strokeSliceCount++;
  const base = 10;
  score += base;
  sfx.slice();
  spawnJuice(obj.x, obj.y, pick(['#ff5252', '#8bc34a', '#ff9800', '#ffca28']));
  spawnPopup(obj.x, obj.y - obj.radius, `+${base}`, '#fff');
  updateHud();
}

function finalizeStroke() {
  if (strokeSliceCount >= 2) {
    const bonus = (strokeSliceCount - 1) * 5;
    score += bonus;
    sfx.combo(strokeSliceCount);
    spawnPopup(lastPointerPos.x, lastPointerPos.y - 40, `COMBO x${strokeSliceCount} +${bonus}`, '#ffd35c');
    updateHud();
  }
  strokeSliceCount = 0;
}

// ---------- Input ----------
let pointerDown = false;
let lastPointerPos = { x: 0, y: 0 };

function getPos(e) {
  const rect = canvas.getBoundingClientRect();
  if (e.touches && e.touches.length) {
    return { x: e.touches[0].clientX - rect.left, y: e.touches[0].clientY - rect.top };
  }
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

function onPointerDown(e) {
  if (!running) return;
  pointerDown = true;
  strokeSliceCount = 0;
  const p = getPos(e);
  lastPointerPos = p;
  trail.push({ x: p.x, y: p.y, t: performance.now() });
}

function onPointerMove(e) {
  if (!running || !pointerDown) return;
  const p = getPos(e);
  trail.push({ x: p.x, y: p.y, t: performance.now() });
  if (trail.length > 20) trail.shift();
  trySlice(lastPointerPos.x, lastPointerPos.y, p.x, p.y);
  lastPointerPos = p;
  e.preventDefault();
}

function onPointerUp() {
  if (!pointerDown) return;
  pointerDown = false;
  finalizeStroke();
}

canvas.addEventListener('mousedown', onPointerDown);
canvas.addEventListener('mousemove', onPointerMove);
window.addEventListener('mouseup', onPointerUp);
canvas.addEventListener('touchstart', (e) => { onPointerDown(e); }, { passive: true });
canvas.addEventListener('touchmove', (e) => { onPointerMove(e); }, { passive: false });
canvas.addEventListener('touchend', onPointerUp);
canvas.addEventListener('touchcancel', onPointerUp);

// ---------- Rendering ----------
function drawBackground() {
  ctx.clearRect(0, 0, W, H);
  // The wooden chopping board is a CSS background behind the (otherwise
  // transparent) canvas — this is just a light wash so falling vegetables
  // and the slice trail stay legible over the busy wood grain.
  ctx.fillStyle = 'rgba(10, 8, 5, 0.18)';
  ctx.fillRect(0, 0, W, H);

  if (screenFlash > 0) {
    ctx.fillStyle = `rgba(255,80,20,${screenFlash * 0.5})`;
    ctx.fillRect(0, 0, W, H);
    screenFlash = Math.max(0, screenFlash - 0.03);
  }
}

function drawTrail() {
  if (trail.length < 2) return;
  const now = performance.now();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (let i = 1; i < trail.length; i++) {
    const a = trail[i - 1], b = trail[i];
    const age = (now - b.t) / 180;
    if (age > 1) continue;
    const alpha = 1 - age;
    const width = 14 * alpha + 2;
    ctx.strokeStyle = `rgba(255,255,255,${alpha * 0.85})`;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  // prune old trail points
  trail = trail.filter(p => now - p.t < 200);
}

function drawObjects() {
  for (const obj of objects) {
    if (obj.sliced) continue;
    ctx.save();
    ctx.translate(obj.x, obj.y);

    // Soft dark halo behind the object, drawn before rotation so it stays
    // a clean circle regardless of spin. Against the old flat navy canvas
    // vegetables had plenty of contrast for free; against the busier,
    // similarly-warm wood grain they need this to keep reading clearly
    // instead of blending in.
    const halo = ctx.createRadialGradient(0, 0, obj.radius * 0.15, 0, 0, obj.radius * 1.25);
    halo.addColorStop(0, 'rgba(0,0,0,0.4)');
    halo.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(0, 0, obj.radius * 1.25, 0, Math.PI * 2);
    ctx.fill();

    ctx.rotate(obj.rotation);
    ctx.font = `${obj.radius * 2}px serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0,0,0,0.45)';
    ctx.shadowBlur = 12;
    ctx.shadowOffsetY = 4;
    ctx.fillText(obj.emoji, 0, 0);
    ctx.restore();
  }
}

function drawParticles() {
  for (const p of particles) {
    const alpha = clamp(1 - p.age / p.life, 0, 1);
    ctx.fillStyle = p.color;
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawPopups() {
  for (const pop of popups) {
    const alpha = clamp(1 - pop.age / pop.life, 0, 1);
    const rise = pop.age * 60;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = pop.color;
    ctx.font = '700 26px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(pop.text, pop.x, pop.y - rise);
    ctx.globalAlpha = 1;
  }
}

// ---------- Update ----------
function update(dt) {
  elapsed += dt;

  if (elapsed >= nextSpawnAt) {
    spawnWave();
    scheduleNextSpawn();
  }

  for (const obj of objects) {
    if (obj.sliced || obj.missed) continue;
    obj.x += obj.vx * dt;
    obj.y += obj.vy * dt;
    obj.vy += obj.g * dt;
    obj.rotation += obj.vrot * dt;

    // Hard safety net, independent of the spawn-time math above: whatever
    // the cause — a viewport resize mid-flight (mobile browser chrome
    // showing/hiding), an edge case in the launch calculation — no object
    // is ever allowed to actually leave the screen through the left,
    // right, or top. The margin is the object's full radius, so its
    // whole silhouette stays on-screen, not just its center point; it
    // bounces gently off an invisible wall instead of vanishing.
    const marginX = obj.radius;
    if (obj.x < marginX) {
      obj.x = marginX;
      obj.vx = Math.abs(obj.vx) * 0.5;
    } else if (obj.x > W - marginX) {
      obj.x = W - marginX;
      obj.vx = -Math.abs(obj.vx) * 0.5;
    }
    if (obj.y < obj.radius) {
      obj.y = obj.radius;
      obj.vy = Math.abs(obj.vy) * 0.3;
    }

    if (obj.y > H + obj.radius + 60) {
      obj.missed = true;
      if (!obj.isBomb) {
        lives -= 1;
        sfx.miss();
        updateHud();
        screenFlash = 0.4;
        if (lives <= 0) {
          endGame();
        }
      }
    }
  }
  objects = objects.filter(o => !o.missed && (o.y < H + o.radius + 80));

  for (const p of particles) {
    p.age += dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += 900 * dt;
  }
  particles = particles.filter(p => p.age < p.life);

  for (const pop of popups) pop.age += dt;
  popups = popups.filter(p => p.age < p.life);
}

// ---------- Main loop ----------
function loop(ts) {
  if (!running) return;
  const dt = Math.min((ts - lastTime) / 1000, 0.033);
  lastTime = ts;

  update(dt);

  drawBackground();
  drawParticles();
  drawObjects();
  drawTrail();
  drawPopups();

  requestAnimationFrame(loop);
}

// ---------- Game flow ----------
function resetState() {
  objects = [];
  particles = [];
  popups = [];
  trail = [];
  score = 0;
  lives = 3;
  elapsed = 0;
  nextSpawnAt = 0.6;
  screenFlash = 0;
  updateHud();
}

function startCountdown(cb) {
  countdownEl.classList.remove('hidden');
  let n = 3;
  countdownEl.textContent = String(n);
  const iv = setInterval(() => {
    n -= 1;
    if (n <= 0) {
      clearInterval(iv);
      countdownEl.classList.add('hidden');
      cb();
    } else {
      countdownEl.textContent = String(n);
    }
  }, 700);
}

function startGame() {
  resize();
  screenTitle.classList.add('hidden');
  screenGameover.classList.add('hidden');
  resetState();
  startCountdown(() => {
    running = true;
    lastTime = performance.now();
    requestAnimationFrame(loop);
  });
}

function endGame() {
  if (!running) return;
  running = false;
  sfx.gameOver();
  LocalBest.set(score);
  finalScoreEl.textContent = String(score);
  updateBestLabel(finalBestLabel);
  screenGameover.classList.remove('hidden');
}

// ---------- Wire up UI ----------
function withClick(fn) {
  return (...args) => { sfx.click(); fn(...args); };
}
document.getElementById('btn-play').addEventListener('click', withClick(startGame));
document.getElementById('btn-retry').addEventListener('click', withClick(startGame));

// ---------- Boot ----------
function boot() {
  updateBestLabel(bestScoreLabel);
}

try {
  boot();
} catch (e) {
  console.error('[Chop Shop Chef] boot() failed:', e);
}
