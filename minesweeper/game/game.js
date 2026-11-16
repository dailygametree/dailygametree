/* Minesweeper — vanilla JS + DOM. Part of dailygametree.com.
 * The difficulty is chosen by the page URL: ?mode=beginner|intermediate|expert. */

(function () {
  "use strict";

  // ---------------------------------------------------------------------
  // DOM references
  // ---------------------------------------------------------------------
  const stageEl = document.getElementById("stage");
  const boardFrame = document.getElementById("board-frame");
  const controlRowEl = document.getElementById("control-row");
  const boardScroll = document.getElementById("board-scroll");
  const boardEl = document.getElementById("board");
  const mineCounterEl = document.getElementById("mine-counter");
  const timerEl = document.getElementById("timer");
  const smileyBtn = document.getElementById("smiley-btn");
  const smileyFace = document.getElementById("smiley-face");
  const statusLine = document.getElementById("status-line");
  const statusText = document.getElementById("status-text");

  const startScreen = document.getElementById("start-screen");
  const pauseScreen = document.getElementById("pause-screen");
  const resumeBtn = document.getElementById("resume-btn");
  const quitBtn = document.getElementById("quit-btn");

  const pauseBtn = document.getElementById("pause-btn");
  const muteBtn = document.getElementById("mute-btn");

  const touchControls = document.getElementById("touch-controls");
  const flagModeBtn = document.getElementById("flag-mode-btn");
  const flagModeState = document.getElementById("flag-mode-state");

  // ---------------------------------------------------------------------
  // Sound — tiny SFX synthesized on the fly with the Web Audio API.
  // ---------------------------------------------------------------------
  const SOUND_MUTED_KEY = "minesweeper_muted";
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

  function playNoise({ duration = 0.35, volume = 0.22, filterFreq = 700, delay = 0 }) {
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
    filter.type = "lowpass";
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
    reveal() {
      playTone({ freq: 700, type: "square", duration: 0.02, volume: 0.05 });
    },
    flag() {
      playTone({ freq: 520, endFreq: 680, type: "triangle", duration: 0.06, volume: 0.09 });
    },
    unflag() {
      playTone({ freq: 480, endFreq: 340, type: "triangle", duration: 0.06, volume: 0.08 });
    },
    chord() {
      playTone({ freq: 620, type: "square", duration: 0.03, volume: 0.06 });
    },
    explode() {
      playNoise({ duration: 0.5, volume: 0.26, filterFreq: 500 });
      playTone({ freq: 140, endFreq: 40, type: "sawtooth", duration: 0.4, volume: 0.18, delay: 0.02 });
    },
    win() {
      [520, 660, 780, 1040].forEach((f, i) => {
        playTone({ freq: f, type: "square", duration: 0.14, volume: 0.15, delay: i * 0.09 });
      });
    },
    click() {
      playTone({ freq: 640, type: "square", duration: 0.04, volume: 0.08 });
    },
  };

  function updateMuteButton() {
    muteBtn.innerHTML = muted ? "&#128263;" : "&#128266;";
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
  // Difficulties
  // ---------------------------------------------------------------------
  const DIFFS = {
    beginner: { cols: 9, rows: 9, mines: 10, label: "Beginner" },
    intermediate: { cols: 16, rows: 16, mines: 40, label: "Intermediate" },
    expert: { cols: 30, rows: 16, mines: 99, label: "Expert" },
  };

  const BEST_TIMES_KEY = "minesweeperBestTimes";
  function loadBestTimes() {
    try {
      return JSON.parse(localStorage.getItem(BEST_TIMES_KEY) || "{}");
    } catch (e) {
      return {};
    }
  }
  function saveBestTime(diff, ms) {
    const all = loadBestTimes();
    if (!all[diff] || ms < all[diff]) {
      all[diff] = ms;
      try {
        localStorage.setItem(BEST_TIMES_KEY, JSON.stringify(all));
      } catch (e) {}
      return true;
    }
    return false;
  }
  function getBestTime(diff) {
    return loadBestTimes()[diff] || null;
  }

  // ---------------------------------------------------------------------
  // Mine / flag SVG icons
  // ---------------------------------------------------------------------
  const MINE_SVG =
    '<svg viewBox="0 0 20 20"><g stroke="#000" stroke-width="1.6" stroke-linecap="round">' +
    '<line x1="10" y1="1" x2="10" y2="4"/><line x1="10" y1="16" x2="10" y2="19"/>' +
    '<line x1="1" y1="10" x2="4" y2="10"/><line x1="16" y1="10" x2="19" y2="10"/>' +
    '<line x1="3.5" y1="3.5" x2="5.8" y2="5.8"/><line x1="14.2" y1="14.2" x2="16.5" y2="16.5"/>' +
    '<line x1="16.5" y1="3.5" x2="14.2" y2="5.8"/><line x1="5.8" y1="14.2" x2="3.5" y2="16.5"/>' +
    '</g><circle cx="10" cy="10" r="5.6" fill="#000"/>' +
    '<circle cx="8" cy="8" r="1.3" fill="#fff" opacity="0.85"/></svg>';

  const FLAG_SVG =
    '<svg viewBox="0 0 20 20"><rect x="4" y="17" width="7" height="2" fill="#000"/>' +
    '<line x1="6.5" y1="2" x2="6.5" y2="18" stroke="#000" stroke-width="1.6"/>' +
    '<polygon points="6.5,2.5 16,6 6.5,9.5" fill="#ff6a3d" stroke="#8a2a08" stroke-width="0.6"/></svg>';

  const WRONG_FLAG_SVG =
    MINE_SVG.replace(
      "</svg>",
      '<line x1="2" y1="2" x2="18" y2="18" stroke="#ff0000" stroke-width="2.2"/>' +
        '<line x1="18" y1="2" x2="2" y2="18" stroke="#ff0000" stroke-width="2.2"/></svg>'
    );

  // ---------------------------------------------------------------------
  // Game state
  // ---------------------------------------------------------------------
  let state = "start"; // 'start' | 'playing' | 'paused' | 'ended'
  let currentDiff = "beginner";
  let cols, rows, totalMines;
  let grid; // grid[r][c] = { mine, revealed, flagged, adjacent }
  let firstClickDone = false;
  let revealedCount = 0;
  let flaggedCount = 0;
  let won = false;
  let cellEls; // cellEls[r][c] = DOM element

  let runStart = 0;
  let elapsedBeforePause = 0;
  let timerInterval = null;
  let finalElapsedMs = 0;

  let flagModeOn = false;

  function inBounds(r, c) {
    return r >= 0 && r < rows && c >= 0 && c < cols;
  }

  function forEachNeighbor(r, c, fn) {
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const nr = r + dr, nc = c + dc;
        if (inBounds(nr, nc)) fn(nr, nc);
      }
    }
  }

  // ---------------------------------------------------------------------
  // Board setup
  // ---------------------------------------------------------------------
  function buildEmptyGrid() {
    grid = [];
    for (let r = 0; r < rows; r++) {
      const row = [];
      for (let c = 0; c < cols; c++) {
        row.push({ mine: false, revealed: false, flagged: false, adjacent: 0 });
      }
      grid.push(row);
    }
  }

  function placeMines(excludeR, excludeC) {
    const safe = new Set();
    forEachNeighbor(excludeR, excludeC, (r, c) => safe.add(r + "," + c));
    safe.add(excludeR + "," + excludeC);

    const candidates = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (!safe.has(r + "," + c)) candidates.push([r, c]);
      }
    }
    // Fisher-Yates shuffle, take the first `totalMines`.
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }
    for (let i = 0; i < totalMines && i < candidates.length; i++) {
      const [r, c] = candidates[i];
      grid[r][c].mine = true;
    }
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (grid[r][c].mine) continue;
        let count = 0;
        forEachNeighbor(r, c, (nr, nc) => {
          if (grid[nr][nc].mine) count++;
        });
        grid[r][c].adjacent = count;
      }
    }
  }

  // ---------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------
  function buildBoardDom() {
    boardEl.innerHTML = "";
    boardEl.style.gridTemplateColumns = "repeat(" + cols + ", var(--cell-size))";
    cellEls = [];
    for (let r = 0; r < rows; r++) {
      const rowEls = [];
      for (let c = 0; c < cols; c++) {
        const div = document.createElement("div");
        div.className = "cell hidden-cell bevel-out";
        div.dataset.r = r;
        div.dataset.c = c;
        boardEl.appendChild(div);
        rowEls.push(div);
      }
      cellEls.push(rowEls);
    }
  }

  function renderCell(r, c) {
    const cell = grid[r][c];
    const el = cellEls[r][c];
    if (cell.revealed) {
      el.className = "cell revealed";
      if (cell.mine) {
        if (cell === hitMineCell) el.classList.add("mine-hit");
        el.innerHTML = MINE_SVG;
      } else if (cell.adjacent > 0) {
        el.textContent = String(cell.adjacent);
        el.classList.add("n" + cell.adjacent);
      } else {
        el.textContent = "";
      }
    } else if (cell.flagged) {
      el.className = "cell hidden-cell bevel-out";
      el.innerHTML = FLAG_SVG;
    } else {
      el.className = "cell hidden-cell bevel-out";
      el.innerHTML = "";
    }
  }

  function renderAll() {
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) renderCell(r, c);
  }

  // #board-frame is sized to its own content (width: max-content), so
  // measuring board-scroll's own clientWidth/Height here would be
  // self-referential — it only ever reflects whatever size the board was
  // already rendered at. Instead we measure the true available area from
  // #stage (which fills the remaining space independent of the board's
  // content) and size cells to fill it, leaving room for the frame's own
  // border/padding and the control row above the grid.
  const STAGE_PADDING = 28; // #stage padding: 14px each side
  const FRAME_CHROME = 22; // #board-frame border(3px) + padding(8px), each side
  const SCROLL_PADDING = 6; // #board-scroll padding: 3px each side
  const MAX_CELL = 64;

  function setCellSize() {
    const chromeH = controlRowEl.offsetHeight + statusLine.offsetHeight;
    const availW = stageEl.clientWidth - STAGE_PADDING - FRAME_CHROME - SCROLL_PADDING;
    const availH = stageEl.clientHeight - STAGE_PADDING - FRAME_CHROME - SCROLL_PADDING - chromeH;
    let size = Math.floor(Math.min(availW / cols, availH / rows));
    size = Math.max(14, Math.min(MAX_CELL, size));
    boardEl.style.setProperty("--cell-size", size + "px");
  }
  window.addEventListener("resize", () => {
    if (state !== "start") setCellSize();
  });

  // ---------------------------------------------------------------------
  // Mine counter / timer display
  // ---------------------------------------------------------------------
  function updateMineCounter() {
    let remaining = totalMines - flaggedCount;
    remaining = Math.max(-99, Math.min(999, remaining));
    if (remaining < 0) {
      mineCounterEl.textContent = "-" + String(-remaining).padStart(2, "0");
    } else {
      mineCounterEl.textContent = String(remaining).padStart(3, "0");
    }
  }

  function currentElapsedMs() {
    if (state === "playing") return elapsedBeforePause + (performance.now() - runStart);
    return elapsedBeforePause;
  }

  function updateTimerDisplay() {
    const secs = Math.min(999, Math.floor(currentElapsedMs() / 1000));
    timerEl.textContent = String(secs).padStart(3, "0");
  }

  function startTimer() {
    runStart = performance.now();
    elapsedBeforePause = 0;
    clearInterval(timerInterval);
    timerInterval = setInterval(updateTimerDisplay, 200);
  }
  function pauseTimer() {
    elapsedBeforePause += performance.now() - runStart;
    clearInterval(timerInterval);
  }
  function resumeTimer() {
    runStart = performance.now();
    timerInterval = setInterval(updateTimerDisplay, 200);
  }
  function stopTimer() {
    elapsedBeforePause = currentElapsedMs();
    clearInterval(timerInterval);
  }

  function formatTime(ms) {
    const totalSecs = Math.floor(ms / 1000);
    const m = Math.floor(totalSecs / 60);
    const s = totalSecs % 60;
    return m + ":" + String(s).padStart(2, "0");
  }

  // ---------------------------------------------------------------------
  // Reveal / flag / chord
  // ---------------------------------------------------------------------
  let hitMineCell = null;

  function revealCell(startR, startC) {
    const queue = [[startR, startC]];
    while (queue.length) {
      const [r, c] = queue.shift();
      const cell = grid[r][c];
      if (cell.revealed || cell.flagged) continue;
      cell.revealed = true;
      revealedCount++;
      if (cell.mine) {
        hitMineCell = cell;
        renderCell(r, c);
        continue;
      }
      renderCell(r, c);
      if (cell.adjacent === 0) {
        forEachNeighbor(r, c, (nr, nc) => {
          if (!grid[nr][nc].revealed && !grid[nr][nc].flagged) queue.push([nr, nc]);
        });
      }
    }
  }

  function onCellReveal(r, c) {
    if (state !== "playing") return;
    const cell = grid[r][c];
    if (cell.revealed || cell.flagged) return;

    if (!firstClickDone) {
      firstClickDone = true;
      placeMines(r, c);
      startTimer();
    }

    revealCell(r, c);
    sfx.reveal();

    if (hitMineCell) {
      loseGame();
      return;
    }
    checkWin();
  }

  function onCellFlag(r, c) {
    if (state !== "playing") return;
    const cell = grid[r][c];
    if (cell.revealed) return;
    if (!firstClickDone) return; // classic: can't flag before the board exists in earnest
    cell.flagged = !cell.flagged;
    flaggedCount += cell.flagged ? 1 : -1;
    renderCell(r, c);
    updateMineCounter();
    if (cell.flagged) sfx.flag();
    else sfx.unflag();
  }

  function onCellChord(r, c) {
    if (state !== "playing") return;
    const cell = grid[r][c];
    if (!cell.revealed || cell.adjacent === 0) return;
    let flagCount = 0;
    forEachNeighbor(r, c, (nr, nc) => {
      if (grid[nr][nc].flagged) flagCount++;
    });
    if (flagCount !== cell.adjacent) return;
    sfx.chord();
    forEachNeighbor(r, c, (nr, nc) => {
      const n = grid[nr][nc];
      if (!n.revealed && !n.flagged) revealCell(nr, nc);
    });
    if (hitMineCell) {
      loseGame();
      return;
    }
    checkWin();
  }

  function checkWin() {
    const totalSafe = cols * rows - totalMines;
    if (revealedCount >= totalSafe) {
      winGame();
    }
  }

  // ---------------------------------------------------------------------
  // Win / lose
  // ---------------------------------------------------------------------
  function revealAllMinesOnLoss() {
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const cell = grid[r][c];
        if (cell.mine && !cell.flagged && !cell.revealed) {
          cell.revealed = true;
          renderCell(r, c);
        } else if (!cell.mine && cell.flagged) {
          const el = cellEls[r][c];
          el.className = "cell revealed";
          el.innerHTML = WRONG_FLAG_SVG;
        }
      }
    }
    if (hitMineCell) {
      // Find and mark the exploded cell red.
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (grid[r][c] === hitMineCell) {
            cellEls[r][c].classList.add("mine-hit");
          }
        }
      }
    }
  }

  function autoFlagRemainingMines() {
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const cell = grid[r][c];
        if (cell.mine && !cell.flagged) {
          cell.flagged = true;
          flaggedCount++;
          renderCell(r, c);
        }
      }
    }
    updateMineCounter();
  }

  function loseGame() {
    stopTimer(); // must run before the state flip below — it reads `state`
    state = "ended";
    won = false;
    smileyFace.innerHTML = "&#128565;"; // 😵
    sfx.explode();
    revealAllMinesOnLoss();
    statusLine.classList.remove("hidden");
    statusText.innerHTML = "Boom! Game over.";
  }

  function winGame() {
    stopTimer(); // must run before the state flip below — it reads `state`
    finalElapsedMs = currentElapsedMs();
    state = "ended";
    won = true;
    smileyFace.innerHTML = "&#128526;"; // 😎
    sfx.win();
    autoFlagRemainingMines();
    const isNewBest = saveBestTime(currentDiff, finalElapsedMs);
    statusLine.classList.remove("hidden");
    statusText.innerHTML =
      "You win! Time: " + formatTime(finalElapsedMs) +
      (isNewBest ? " — new best!" : "");
  }

  // ---------------------------------------------------------------------
  // Game flow
  // ---------------------------------------------------------------------
  function newGame(diff) {
    currentDiff = diff;
    const d = DIFFS[diff];
    cols = d.cols;
    rows = d.rows;
    totalMines = d.mines;
    firstClickDone = false;
    revealedCount = 0;
    flaggedCount = 0;
    hitMineCell = null;
    won = false;
    elapsedBeforePause = 0;
    clearInterval(timerInterval);

    buildEmptyGrid();
    buildBoardDom();
    updateMineCounter();
    timerEl.textContent = "000";
    smileyFace.innerHTML = "&#128578;"; // 🙂
    statusLine.classList.add("hidden");
    statusText.innerHTML = "";

    state = "playing";
    // Unhide the board frame *before* measuring it — its layout (and its
    // children's offsetHeight) only reflects real dimensions once it's
    // actually rendered, not while `display: none` from the .hidden class.
    boardFrame.classList.remove("hidden");
    pauseBtn.classList.remove("hidden");
    startScreen.classList.add("hidden");
    pauseScreen.classList.add("hidden");

    setCellSize();
    renderAll();
  }

  function togglePause() {
    if (state === "playing") {
      state = "paused";
      sfx.click();
      if (firstClickDone) pauseTimer();
      pauseScreen.classList.remove("hidden");
    } else if (state === "paused") {
      state = "playing";
      sfx.click();
      if (firstClickDone) resumeTimer();
      pauseScreen.classList.add("hidden");
    }
  }

  function quitToMenu() {
    sfx.click();
    state = "start";
    clearInterval(timerInterval);
    boardFrame.classList.add("hidden");
    pauseBtn.classList.add("hidden");
    pauseScreen.classList.add("hidden");
    startScreen.classList.remove("hidden");
  }

  // This page plays one difficulty only (set by ?mode= in the URL).
  const MODE = new URLSearchParams(location.search).get("mode");
  const MODE_DIFF = DIFFS[MODE] ? MODE : "beginner";
  for (const btn of document.querySelectorAll(".diff-btn")) {
    if (btn.dataset.diff !== MODE_DIFF) btn.remove();
  }
  for (const btn of document.querySelectorAll(".diff-btn")) {
    btn.addEventListener("click", () => {
      sfx.click();
      newGame(btn.dataset.diff);
    });
  }
  smileyBtn.addEventListener("click", () => {
    sfx.click();
    if (state === "start") return;
    newGame(currentDiff);
  });
  resumeBtn.addEventListener("click", togglePause);
  quitBtn.addEventListener("click", quitToMenu);
  pauseBtn.addEventListener("click", () => {
    if (state === "playing" || state === "paused") togglePause();
  });


  // ---------------------------------------------------------------------
  // Input — mouse (left reveal, right flag, dblclick chord) and touch
  // (tap reveal or flag depending on Flag mode, long-press flag, double-tap
  // chord).
  // ---------------------------------------------------------------------
  function cellFromEvent(e) {
    const el = e.target.closest(".cell");
    if (!el) return null;
    return { r: parseInt(el.dataset.r, 10), c: parseInt(el.dataset.c, 10), el };
  }

  boardEl.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    const hit = cellFromEvent(e);
    if (hit) onCellFlag(hit.r, hit.c);
  });

  boardEl.addEventListener("click", (e) => {
    const hit = cellFromEvent(e);
    if (!hit) return;
    if (isCoarsePointer()) return; // touch handled separately below
    onCellReveal(hit.r, hit.c);
  });

  boardEl.addEventListener("dblclick", (e) => {
    const hit = cellFromEvent(e);
    if (hit) onCellChord(hit.r, hit.c);
  });

  boardEl.addEventListener("mousedown", (e) => {
    if (state !== "playing" || e.button !== 0) return;
    smileyFace.innerHTML = "&#128558;"; // 😮
  });
  window.addEventListener("mouseup", () => {
    if (state === "playing") smileyFace.innerHTML = "&#128578;";
  });

  function isCoarsePointer() {
    return window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
  }

  // Touch handling: tap = reveal or flag (Flag mode); long-press = flag;
  // double-tap on a revealed number = chord.
  let touchTimer = null;
  let touchMoved = false;
  let lastTap = { r: -1, c: -1, time: 0 };
  const LONG_PRESS_MS = 420;
  const DOUBLE_TAP_MS = 320;

  boardEl.addEventListener(
    "touchstart",
    (e) => {
      if (state !== "playing") return;
      const touch = e.touches[0];
      const target = document.elementFromPoint(touch.clientX, touch.clientY);
      const el = target && target.closest(".cell");
      if (!el) return;
      touchMoved = false;
      const r = parseInt(el.dataset.r, 10);
      const c = parseInt(el.dataset.c, 10);
      smileyFace.innerHTML = "&#128558;";
      clearTimeout(touchTimer);
      touchTimer = setTimeout(() => {
        if (!touchMoved) {
          onCellFlag(r, c);
          touchTimer = null;
        }
      }, LONG_PRESS_MS);
    },
    { passive: true }
  );

  boardEl.addEventListener(
    "touchmove",
    () => {
      touchMoved = true;
    },
    { passive: true }
  );

  boardEl.addEventListener("touchend", (e) => {
    if (state === "playing") smileyFace.innerHTML = "&#128578;";
    if (state !== "playing") return;
    const stillPending = touchTimer !== null;
    clearTimeout(touchTimer);
    touchTimer = null;
    if (touchMoved || !stillPending) return; // long-press already fired, or finger dragged

    const touch = e.changedTouches[0];
    const target = document.elementFromPoint(touch.clientX, touch.clientY);
    const el = target && target.closest(".cell");
    if (!el) return;
    const r = parseInt(el.dataset.r, 10);
    const c = parseInt(el.dataset.c, 10);

    const now = Date.now();
    const isDoubleTap = lastTap.r === r && lastTap.c === c && now - lastTap.time < DOUBLE_TAP_MS;
    lastTap = { r, c, time: now };

    if (isDoubleTap && grid[r][c].revealed) {
      onCellChord(r, c);
      return;
    }
    if (flagModeOn) onCellFlag(r, c);
    else onCellReveal(r, c);
  });

  flagModeBtn.addEventListener("click", () => {
    flagModeOn = !flagModeOn;
    flagModeBtn.setAttribute("aria-pressed", flagModeOn ? "true" : "false");
    flagModeState.textContent = flagModeOn ? "On" : "Off";
    sfx.click();
  });

  // Release any pending long-press if focus/visibility is lost mid-press.
  window.addEventListener("blur", () => {
    clearTimeout(touchTimer);
    touchTimer = null;
  });

  window.addEventListener("keydown", (e) => {
    if (e.code === "KeyP" || e.code === "Escape") {
      if (state === "playing" || state === "paused") {
        e.preventDefault();
        togglePause();
      }
    }
  });

  // ---------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------
  function boot() {
    // Nothing to draw until a difficulty is chosen — the start screen
    // (visible by default in the HTML) is the idle state.
  }

  try {
    boot();
  } catch (e) {
    console.error("[Minesweeper] boot() failed:", e);
  }
})();
