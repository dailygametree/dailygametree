/* =========================================================
   Sweet Smash
   Endless match-3 candy puzzle. Part of dailygametree.com.
   ========================================================= */

// ---------- Local best score ----------
const LocalBest = {
  key: 'sweet-smash-best-score',
  get() { return Number(localStorage.getItem(this.key) || 0); },
  set(v) {
    if (v > this.get()) localStorage.setItem(this.key, String(v));
  }
};

// ---------- Sound — tiny SFX synthesized on the fly (Web Audio API), no
// external audio files. The AudioContext is created lazily on the first
// user gesture, since browsers refuse to make sound before one. ----------
const MUTE_KEY = 'sweet-smash-muted';
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

const sfx = {
  swap() {
    playTone({ freq: 380, endFreq: 520, type: 'sine', duration: 0.06, volume: 0.1 });
  },
  select() {
    playTone({ freq: 500, type: 'sine', duration: 0.04, volume: 0.06 });
  },
  invalid() {
    playTone({ freq: 220, endFreq: 160, type: 'triangle', duration: 0.12, volume: 0.1 });
  },
  match(comboLevel) {
    const base = 780 + Math.min(comboLevel - 1, 5) * 110;
    playTone({ freq: base, endFreq: base * 1.6, type: 'sine', duration: 0.1, volume: 0.14 });
    if (comboLevel > 1) {
      playTone({ freq: base * 1.5, type: 'square', duration: 0.06, volume: 0.08, delay: 0.05 });
    }
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
  const rect = canvas.parentElement.getBoundingClientRect();
  W = rect.width;
  H = rect.height;
  canvas.width = Math.round(W * DPR);
  canvas.height = Math.round(H * DPR);
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  layoutGrid();
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', resize);
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', resize);
}

// ---------- Utility ----------
function rand(a, b) { return a + Math.random() * (b - a); }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function lerp(a, b, t) { return a + (b - a) * t; }
function easeOutQuad(t) { return 1 - (1 - t) * (1 - t); }

function roundRectPath(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// ---------- Game constants ----------
const SIZE = 8;
const CANDY_TYPES = [
  { emoji: '🍬', bg: '#ff4757' },
  { emoji: '🍭', bg: '#3f8efc' },
  { emoji: '🍫', bg: '#a5672e' },
  { emoji: '🍩', bg: '#ffca3a' },
  { emoji: '🍪', bg: '#ff8c3f' },
  { emoji: '🧁', bg: '#9b5de5' },
];
const SWAP_DURATION = 0.15;
const CLEAR_DURATION = 0.18;
const FALL_DURATION = 0.22;

// ---------- Grid layout ----------
let cellSize = 40, gridX = 0, gridY = 0;

function layoutGrid() {
  const headerH = clamp(H * 0.12, 64, 100);
  const sidePad = Math.max(12, W * 0.03);
  const bottomPad = Math.max(16, H * 0.03);
  const availW = W - sidePad * 2;
  const availH = H - headerH - bottomPad;
  cellSize = Math.max(18, Math.floor(Math.min(availW, availH) / SIZE));
  const gridPixelSize = cellSize * SIZE;
  gridX = (W - gridPixelSize) / 2;
  gridY = headerH + Math.max(0, (availH - gridPixelSize) / 2);
}

// ---------- Board state ----------
let board = [];
let selected = null;
let dragStart = null;
let dragTriggered = false;

let animating = false;
let phase = 'idle'; // 'idle' | 'swap' | 'swapback' | 'clear' | 'fall'
let phaseElapsed = 0;
let phaseDuration = 0;
let pendingSwap = null;
let swapPair = null;
let clearingCells = [];
let fallingCells = [];
let cascadeLevel = 0;

let score = 0;
let elapsedTime = 0;
let running = false;

let particles = [];
let popups = [];

function makeCandy(type, row, col) {
  return { type, row, col, visRow: row, visCol: col, fromRow: row, fromCol: col, scale: 1, alpha: 1 };
}

function typeAvoidingMatch(r, c) {
  const forbidden = new Set();
  if (c >= 2 && board[r][c - 1] && board[r][c - 2] && board[r][c - 1].type === board[r][c - 2].type) {
    forbidden.add(board[r][c - 1].type);
  }
  if (r >= 2 && board[r - 1][c] && board[r - 2][c] && board[r - 1][c].type === board[r - 2][c].type) {
    forbidden.add(board[r - 1][c].type);
  }
  let type;
  let tries = 0;
  do {
    type = Math.floor(Math.random() * CANDY_TYPES.length);
    tries++;
  } while (forbidden.has(type) && tries < 20);
  return type;
}

function createBoard() {
  board = [];
  for (let r = 0; r < SIZE; r++) {
    board.push([]);
    for (let c = 0; c < SIZE; c++) {
      board[r].push(makeCandy(typeAvoidingMatch(r, c), r, c));
    }
  }
  if (!hasValidMove()) reshuffleBoard();
}

function findMatchGroups() {
  const groups = [];
  for (let r = 0; r < SIZE; r++) {
    let runStart = 0;
    for (let c = 1; c <= SIZE; c++) {
      const sameAsPrev = c < SIZE && board[r][c] && board[r][c - 1] && board[r][c].type === board[r][c - 1].type;
      if (!sameAsPrev) {
        const runLen = c - runStart;
        if (runLen >= 3) {
          const cells = [];
          for (let k = runStart; k < c; k++) cells.push(board[r][k]);
          groups.push(cells);
        }
        runStart = c;
      }
    }
  }
  for (let c = 0; c < SIZE; c++) {
    let runStart = 0;
    for (let r = 1; r <= SIZE; r++) {
      const sameAsPrev = r < SIZE && board[r][c] && board[r - 1][c] && board[r][c].type === board[r - 1][c].type;
      if (!sameAsPrev) {
        const runLen = r - runStart;
        if (runLen >= 3) {
          const cells = [];
          for (let k = runStart; k < r; k++) cells.push(board[k][c]);
          groups.push(cells);
        }
        runStart = r;
      }
    }
  }
  return groups;
}

function swapTypesForTest(r1, c1, r2, c2) {
  const t = board[r1][c1].type;
  board[r1][c1].type = board[r2][c2].type;
  board[r2][c2].type = t;
}

function hasValidMove() {
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (c < SIZE - 1) {
        swapTypesForTest(r, c, r, c + 1);
        const has = findMatchGroups().length > 0;
        swapTypesForTest(r, c, r, c + 1);
        if (has) return true;
      }
      if (r < SIZE - 1) {
        swapTypesForTest(r, c, r + 1, c);
        const has = findMatchGroups().length > 0;
        swapTypesForTest(r, c, r + 1, c);
        if (has) return true;
      }
    }
  }
  return false;
}

function shuffleArrayInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

function reshuffleBoard() {
  const types = [];
  for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) types.push(board[r][c].type);
  let attempts = 0;
  let ok = false;
  while (attempts < 300 && !ok) {
    shuffleArrayInPlace(types);
    let i = 0;
    for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) board[r][c].type = types[i++];
    ok = findMatchGroups().length === 0 && hasValidMove();
    attempts++;
  }
}

// ---------- Swap / resolve state machine ----------
function isAdjacent(a, b) {
  return (Math.abs(a.row - b.row) === 1 && a.col === b.col) ||
         (Math.abs(a.col - b.col) === 1 && a.row === b.row);
}

function performSwapAnimation(r1, c1, r2, c2, phaseName) {
  const a = board[r1][c1], b = board[r2][c2];
  a.fromRow = a.visRow; a.fromCol = a.visCol;
  b.fromRow = b.visRow; b.fromCol = b.visCol;
  board[r1][c1] = b; board[r2][c2] = a;
  a.row = r2; a.col = c2;
  b.row = r1; b.col = c1;
  swapPair = [a, b];
  phase = phaseName;
  phaseElapsed = 0;
  phaseDuration = SWAP_DURATION;
  animating = true;
}

function beginSwap(r1, c1, r2, c2) {
  if (animating || !running) return;
  pendingSwap = { r1, c1, r2, c2 };
  performSwapAnimation(r1, c1, r2, c2, 'swap');
  sfx.swap();
}

function beginSwapBack() {
  const { r1, c1, r2, c2 } = pendingSwap;
  performSwapAnimation(r1, c1, r2, c2, 'swapback');
  sfx.invalid();
}

function beginClear(groups) {
  const allMatched = new Set();
  let roundScore = 0;
  for (const g of groups) {
    for (const cell of g) allMatched.add(cell);
    const size = g.length;
    const base = size === 3 ? 30 : size === 4 ? 60 : 100;
    roundScore += base;
  }
  const multiplier = 1 + (cascadeLevel - 1) * 0.5;
  roundScore = Math.round(roundScore * multiplier);
  score += roundScore;
  updateHud();

  clearingCells = [...allMatched];
  for (const c of clearingCells) {
    const px = gridX + c.visCol * cellSize + cellSize / 2;
    const py = gridY + c.visRow * cellSize + cellSize / 2;
    spawnCandyParticles(px, py, CANDY_TYPES[c.type].bg);
  }
  const centerCell = clearingCells[Math.floor(clearingCells.length / 2)];
  const popupX = gridX + centerCell.visCol * cellSize + cellSize / 2;
  const popupY = gridY + centerCell.visRow * cellSize;
  spawnPopup(popupX, popupY, cascadeLevel > 1 ? `+${roundScore} COMBO x${cascadeLevel}` : `+${roundScore}`, cascadeLevel > 1 ? '#ffe066' : '#fff');
  sfx.match(cascadeLevel);

  phase = 'clear';
  phaseElapsed = 0;
  phaseDuration = CLEAR_DURATION;
  animating = true;
}

function finishClearAndDropNew() {
  for (const c of clearingCells) {
    board[c.row][c.col] = null;
  }
  clearingCells = [];

  fallingCells = [];
  for (let col = 0; col < SIZE; col++) {
    let writeRow = SIZE - 1;
    for (let row = SIZE - 1; row >= 0; row--) {
      const cell = board[row][col];
      if (cell) {
        if (writeRow !== row) {
          board[writeRow][col] = cell;
          board[row][col] = null;
          cell.fromRow = cell.visRow;
          cell.fromCol = cell.visCol;
          cell.row = writeRow;
          fallingCells.push(cell);
        }
        writeRow--;
      }
    }
    let spawnOffset = 1;
    for (let row = writeRow; row >= 0; row--) {
      const type = Math.floor(Math.random() * CANDY_TYPES.length);
      const newCell = makeCandy(type, row, col);
      newCell.visRow = -spawnOffset;
      newCell.fromRow = -spawnOffset;
      board[row][col] = newCell;
      fallingCells.push(newCell);
      spawnOffset++;
    }
  }

  phase = 'fall';
  phaseElapsed = 0;
  phaseDuration = FALL_DURATION;
}

function advancePhase(dt) {
  if (phase === 'idle') return;
  phaseElapsed += dt;
  const t = clamp(phaseElapsed / phaseDuration, 0, 1);
  const eased = easeOutQuad(t);

  if (phase === 'swap' || phase === 'swapback') {
    for (const c of swapPair) {
      c.visRow = lerp(c.fromRow, c.row, eased);
      c.visCol = lerp(c.fromCol, c.col, eased);
    }
    if (t >= 1) {
      for (const c of swapPair) { c.visRow = c.row; c.visCol = c.col; }
      if (phase === 'swap') {
        const groups = findMatchGroups();
        if (groups.length > 0) {
          cascadeLevel = 1;
          beginClear(groups);
        } else {
          beginSwapBack();
        }
      } else {
        phase = 'idle';
        animating = false;
      }
    }
  } else if (phase === 'clear') {
    for (const c of clearingCells) {
      c.scale = 1 - eased;
      c.alpha = 1 - eased;
    }
    if (t >= 1) {
      finishClearAndDropNew();
    }
  } else if (phase === 'fall') {
    for (const c of fallingCells) {
      c.visRow = lerp(c.fromRow, c.row, eased);
    }
    if (t >= 1) {
      for (const c of fallingCells) c.visRow = c.row;
      const groups = findMatchGroups();
      if (groups.length > 0) {
        cascadeLevel += 1;
        beginClear(groups);
      } else {
        phase = 'idle';
        animating = false;
        cascadeLevel = 0;
        // Endless mode: the board is never force-reshuffled mid-game —
        // running out of valid moves anywhere on the board *is* the fail
        // condition, same as classic non-level match-3 games.
        if (!hasValidMove()) {
          endGame();
        }
      }
    }
  }
}

// ---------- Particles & popups ----------
function spawnCandyParticles(x, y, color) {
  const n = 8;
  for (let i = 0; i < n; i++) {
    const a = rand(0, Math.PI * 2);
    const speed = rand(80, 260);
    particles.push({
      x, y,
      vx: Math.cos(a) * speed,
      vy: Math.sin(a) * speed - 60,
      life: rand(0.35, 0.6),
      age: 0,
      color,
      size: rand(2.5, 5.5),
    });
  }
}

function spawnPopup(x, y, text, color) {
  popups.push({ x, y, text, color, age: 0, life: 0.9 });
}

function updateParticles(dt) {
  for (const p of particles) {
    p.age += dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += 700 * dt;
  }
  particles = particles.filter(p => p.age < p.life);
}

function updatePopups(dt) {
  for (const pop of popups) pop.age += dt;
  popups = popups.filter(p => p.age < p.life);
}

// ---------- Input ----------
function getPos(e) {
  const rect = canvas.getBoundingClientRect();
  if (e.touches && e.touches.length) {
    return { x: e.touches[0].clientX - rect.left, y: e.touches[0].clientY - rect.top };
  }
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

function cellFromPixel(px, py) {
  const col = Math.floor((px - gridX) / cellSize);
  const row = Math.floor((py - gridY) / cellSize);
  if (row < 0 || row >= SIZE || col < 0 || col >= SIZE) return null;
  return { row, col };
}

function onPointerDown(e) {
  if (!running || animating) return;
  const p = getPos(e);
  const cell = cellFromPixel(p.x, p.y);
  if (!cell) return;
  dragStart = { row: cell.row, col: cell.col, px: p.x, py: p.y };
  dragTriggered = false;
}

function onPointerMove(e) {
  if (!dragStart || dragTriggered || animating) return;
  const p = getPos(e);
  const dx = p.x - dragStart.px;
  const dy = p.y - dragStart.py;
  const threshold = cellSize * 0.35;
  if (Math.abs(dx) < threshold && Math.abs(dy) < threshold) return;
  let targetRow = dragStart.row, targetCol = dragStart.col;
  if (Math.abs(dx) > Math.abs(dy)) targetCol += dx > 0 ? 1 : -1;
  else targetRow += dy > 0 ? 1 : -1;
  if (targetRow < 0 || targetRow >= SIZE || targetCol < 0 || targetCol >= SIZE) return;
  dragTriggered = true;
  selected = null;
  beginSwap(dragStart.row, dragStart.col, targetRow, targetCol);
  e.preventDefault();
}

function onPointerUp() {
  if (!dragStart) { return; }
  if (!dragTriggered && !animating && running) {
    const cell = { row: dragStart.row, col: dragStart.col };
    if (selected && selected.row === cell.row && selected.col === cell.col) {
      selected = null;
    } else if (selected && isAdjacent(selected, cell)) {
      const s = selected;
      selected = null;
      beginSwap(s.row, s.col, cell.row, cell.col);
    } else {
      selected = cell;
      sfx.select();
    }
  }
  dragStart = null;
  dragTriggered = false;
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
  const pad = cellSize * 0.35;
  const trayX = gridX - pad, trayY = gridY - pad;
  const trayW = cellSize * SIZE + pad * 2, trayH = cellSize * SIZE + pad * 2;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur = 24;
  ctx.shadowOffsetY = 8;
  const trayGrad = ctx.createLinearGradient(trayX, trayY, trayX, trayY + trayH);
  trayGrad.addColorStop(0, 'rgba(255,255,255,0.22)');
  trayGrad.addColorStop(1, 'rgba(10,24,50,0.28)');
  ctx.fillStyle = trayGrad;
  roundRectPath(trayX, trayY, trayW, trayH, cellSize * 0.3);
  ctx.fill();
  ctx.restore();
}

function drawCandy(cell) {
  if (cell.alpha <= 0) return;
  const cx = gridX + cell.visCol * cellSize + cellSize / 2;
  const cy = gridY + cell.visRow * cellSize + cellSize / 2;
  const def = CANDY_TYPES[cell.type];
  ctx.save();
  ctx.globalAlpha = cell.alpha;
  ctx.translate(cx, cy);
  ctx.scale(cell.scale, cell.scale);

  const pad = cellSize * 0.08;
  const size = cellSize - pad * 2;
  const radius = cellSize * 0.28;

  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur = 7;
  ctx.shadowOffsetY = 4;
  ctx.fillStyle = def.bg;
  roundRectPath(-size / 2, -size / 2, size, size, radius);
  ctx.fill();
  ctx.shadowColor = 'transparent';

  // Glossy hard-candy shine, classic Candy Crush tile treatment.
  const shine = ctx.createLinearGradient(-size / 2, -size / 2, size / 2, size / 2);
  shine.addColorStop(0, 'rgba(255,255,255,0.6)');
  shine.addColorStop(0.45, 'rgba(255,255,255,0.08)');
  shine.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = shine;
  roundRectPath(-size / 2, -size / 2, size, size, radius);
  ctx.fill();

  // Crisp white edge for a "candy button" pop against the busy background.
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.lineWidth = Math.max(1, cellSize * 0.035);
  roundRectPath(-size / 2 + 1, -size / 2 + 1, size - 2, size - 2, radius - 1);
  ctx.stroke();

  ctx.font = `${cellSize * 0.58}px serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(def.emoji, 0, cellSize * 0.02);
  ctx.restore();
}

function drawBoard() {
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const cell = board[r][c];
      if (cell) drawCandy(cell);
    }
  }
  if (selected) {
    const x = gridX + selected.col * cellSize;
    const y = gridY + selected.row * cellSize;
    ctx.save();
    ctx.strokeStyle = '#ffe066';
    ctx.lineWidth = Math.max(2, cellSize * 0.06);
    ctx.shadowColor = '#ffe066';
    ctx.shadowBlur = 12;
    roundRectPath(x + 2, y + 2, cellSize - 4, cellSize - 4, cellSize * 0.24);
    ctx.stroke();
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
    const rise = pop.age * 50;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = pop.color;
    ctx.font = '700 22px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(pop.text, pop.x, pop.y - rise);
    ctx.globalAlpha = 1;
  }
}

// ---------- Update ----------
function update(dt) {
  if (running) {
    elapsedTime += dt;
    updateTimerHud();
  }
  advancePhase(dt);
  updateParticles(dt);
  updatePopups(dt);
}

// ---------- Main loop ----------
let lastTime = 0;
function loop(ts) {
  const dt = Math.min((ts - lastTime) / 1000, 0.033);
  lastTime = ts;

  update(dt);

  drawBackground();
  drawBoard();
  drawParticles();
  drawPopups();

  requestAnimationFrame(loop);
}

// ---------- HUD ----------
const scoreEl = document.getElementById('score-display');
const timerEl = document.getElementById('timer-display');
const timerBadge = document.getElementById('timer-badge');
const screenTitle = document.getElementById('screen-title');
const screenGameover = document.getElementById('screen-gameover');
const countdownEl = document.getElementById('countdown');
const finalScoreEl = document.getElementById('final-score');
const finalBestLabel = document.getElementById('final-best-label');
const bestScoreLabel = document.getElementById('best-score-label');
const muteBtn = document.getElementById('btn-mute');

function updateHud() {
  scoreEl.textContent = String(score);
}

function updateTimerHud() {
  const t = Math.max(0, Math.floor(elapsedTime));
  const mins = Math.floor(t / 60);
  const secs = t % 60;
  timerEl.textContent = `${mins}:${String(secs).padStart(2, '0')}`;
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

// ---------- Game flow ----------
function resetState() {
  score = 0;
  elapsedTime = 0;
  selected = null;
  dragStart = null;
  dragTriggered = false;
  animating = false;
  phase = 'idle';
  cascadeLevel = 0;
  particles = [];
  popups = [];
  createBoard();
  updateHud();
  updateTimerHud();
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
  resize();
  createBoard();
  drawBackground();
  drawBoard();
  updateBestLabel(bestScoreLabel);
  updateTimerHud();
}

try {
  boot();
} catch (e) {
  console.error('[Sweet Smash] boot() failed:', e);
}
