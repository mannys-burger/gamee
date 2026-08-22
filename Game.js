/* =====================================================================
   MANNY'S BURGER — game.js
   Canvas game loop, physics, input handling, progressive difficulty,
   and screen flow. Talks to firebase.js for leaderboard + score submit.
   ===================================================================== */

import { listenTopScores, submitScore, submitScoreOnExit } from "./firebase.js";

/* ---------------------------------------------------------------------
   0. ASSET PLACEHOLDERS
   Swap these paths for your real art. Keep the keys the same.
   --------------------------------------------------------------------- */
const ASSET_PATHS = {
  background: "assets/background.png", // full-bleed black/gold/white pattern
  tray: "assets/tray.png",              // wooden catcher board
  bunBottom: "assets/bun_bottom.png",
  lettuce: "assets/lettuce.png",
  tomato: "assets/tomato.png",
  onion: "assets/onion.png",
  cheese: "assets/cheese.png",
  patty: "assets/patty.png",
  bunTop: "assets/bun_top.png",
};

// Order also defines a natural "build the burger" visual variety
const INGREDIENT_TYPES = ["bunBottom", "lettuce", "tomato", "onion", "cheese", "patty", "bunTop"];

/* ---------------------------------------------------------------------
   1. DIFFICULTY TUNING
   NOTE: MIN_SPAWN_INTERVAL here mirrors MIN_SPAWN_INTERVAL_SEC in
   firebase.js — keep them in sync so anti-cheat math matches reality.
   --------------------------------------------------------------------- */
const POINTS_PER_CATCH = 10;

const BASE_SPAWN_INTERVAL = 1.15;   // seconds between spawns at score 0
const MIN_SPAWN_INTERVAL = 0.45;    // fastest possible spawn rate (matches firebase.js)
const SPAWN_RAMP = 0.0035;          // spawn interval reduction per point scored

const BASE_FALL_SPEED = 160;        // px/sec at score 0
const MAX_FALL_SPEED = 620;         // px/sec ceiling
const FALL_RAMP = 0.9;              // px/sec added per point scored

/* ---------------------------------------------------------------------
   2. DOM REFERENCES
   --------------------------------------------------------------------- */
const screens = {
  register: document.getElementById("screen-register"),
  game: document.getElementById("screen-game"),
  gameover: document.getElementById("screen-gameover"),
};

const registerForm = document.getElementById("registerForm");
const nameInput = document.getElementById("playerName");
const phoneInput = document.getElementById("playerPhone");
const startBtn = document.getElementById("startBtn");

const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");
const scoreValueEl = document.getElementById("scoreValue");
const hudPlayerNameEl = document.getElementById("hudPlayerName");
const quitBtn = document.getElementById("quitBtn");
const comboToastEl = document.getElementById("comboToast");

const finalScoreEl = document.getElementById("finalScore");
const submitStatusEl = document.getElementById("submitStatus");
const playAgainBtn = document.getElementById("playAgainBtn");
const goLeaderboardBtn = document.getElementById("goLeaderboardBtn");

const leaderboardOverlay = document.getElementById("leaderboardOverlay");
const leaderboardList = document.getElementById("leaderboardList");
const viewLeaderboardBtn = document.getElementById("viewLeaderboardBtn");
const closeLeaderboardBtn = document.getElementById("closeLeaderboardBtn");

/* ---------------------------------------------------------------------
   3. GAME STATE
   --------------------------------------------------------------------- */
const state = {
  player: { name: "", phone: "" },
  score: 0,
  running: false,
  startTime: 0,
  endTime: 0,
  ingredients: [],
  spawnTimer: 0,
  lastFrameTime: 0,
  tray: { x: 0, y: 0, w: 0, h: 0, targetX: 0 },
};

const images = {};
let assetsReady = false;

/* ---------------------------------------------------------------------
   4. ASSET LOADING (with graceful placeholder fallback)
   --------------------------------------------------------------------- */
function loadImage(key, src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null); // fall back to a drawn placeholder if missing
    img.src = src;
    images[key] = img;
  });
}

async function preloadAssets() {
  const entries = Object.entries(ASSET_PATHS);
  await Promise.all(entries.map(([key, src]) => loadImage(key, src)));
  assetsReady = true;
}

/* ---------------------------------------------------------------------
   5. CANVAS SIZING (mobile-first, DPR aware)
   --------------------------------------------------------------------- */
let dpr = Math.min(window.devicePixelRatio || 1, 2);

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // Re-anchor the tray on resize
  const w = rect.width;
  const h = rect.height;
  state.tray.w = Math.min(120, w * 0.32);
  state.tray.h = state.tray.w * 0.42;
  state.tray.y = h - state.tray.h - 28;
  if (state.tray.x === 0) {
    state.tray.x = w / 2 - state.tray.w / 2;
    state.tray.targetX = state.tray.x;
  }
}

window.addEventListener("resize", resizeCanvas);
window.addEventListener("orientationchange", () => setTimeout(resizeCanvas, 200));

/* ---------------------------------------------------------------------
   6. INPUT — touch drag, mouse drag, arrow keys
   --------------------------------------------------------------------- */
function clampTrayX(x) {
  const rect = canvas.getBoundingClientRect();
  return Math.max(0, Math.min(rect.width - state.tray.w, x));
}

function setTrayTargetFromClientX(clientX) {
  const rect = canvas.getBoundingClientRect();
  const localX = clientX - rect.left;
  state.tray.targetX = clampTrayX(localX - state.tray.w / 2);
}

canvas.addEventListener(
  "touchstart",
  (e) => {
    e.preventDefault();
    setTrayTargetFromClientX(e.touches[0].clientX);
  },
  { passive: false }
);

canvas.addEventListener(
  "touchmove",
  (e) => {
    e.preventDefault();
    setTrayTargetFromClientX(e.touches[0].clientX);
  },
  { passive: false }
);

let mouseDown = false;
canvas.addEventListener("mousedown", (e) => {
  mouseDown = true;
  setTrayTargetFromClientX(e.clientX);
});
window.addEventListener("mousemove", (e) => {
  if (mouseDown) setTrayTargetFromClientX(e.clientX);
});
window.addEventListener("mouseup", () => (mouseDown = false));

const KEY_SPEED = 480; // px/sec for keyboard control
const keys = { left: false, right: false };
window.addEventListener("keydown", (e) => {
  if (e.key === "ArrowLeft") keys.left = true;
  if (e.key === "ArrowRight") keys.right = true;
});
window.addEventListener("keyup", (e) => {
  if (e.key === "ArrowLeft") keys.left = false;
  if (e.key === "ArrowRight") keys.right = false;
});

/* ---------------------------------------------------------------------
   7. SPAWNING & DIFFICULTY CURVE
   --------------------------------------------------------------------- */
function currentSpawnInterval() {
  return Math.max(MIN_SPAWN_INTERVAL, BASE_SPAWN_INTERVAL - state.score * SPAWN_RAMP);
}

function currentFallSpeed() {
  return Math.min(MAX_FALL_SPEED, BASE_FALL_SPEED + state.score * FALL_RAMP);
}

function spawnIngredient() {
  const rect = canvas.getBoundingClientRect();
  const type = INGREDIENT_TYPES[Math.floor(Math.random() * INGREDIENT_TYPES.length)];
  const size = Math.min(56, rect.width * 0.15);
  const x = Math.random() * (rect.width - size);

  state.ingredients.push({
    type,
    x,
    y: -size,
    size,
    vy: currentFallSpeed(),
    rotation: (Math.random() - 0.5) * 0.4,
  });
}

/* ---------------------------------------------------------------------
   8. GAME LOOP
   --------------------------------------------------------------------- */
function updateTray(dt) {
  // Keyboard nudges the target directly for responsive desktop play
  if (keys.left) state.tray.targetX = clampTrayX(state.tray.targetX - KEY_SPEED * dt);
  if (keys.right) state.tray.targetX = clampTrayX(state.tray.targetX + KEY_SPEED * dt);

  // Smooth follow so touch drag doesn't feel jittery
  const followSpeed = 18;
  state.tray.x += (state.tray.targetX - state.tray.x) * Math.min(1, followSpeed * dt);
}

function rectsOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function showComboToast(x, y) {
  comboToastEl.style.left = `${x}px`;
  comboToastEl.style.top = `${y}px`;
  comboToastEl.classList.remove("show");
  // force reflow so the animation restarts on rapid catches
  void comboToastEl.offsetWidth;
  comboToastEl.classList.add("show");
}

function updateIngredients(dt) {
  const rect = canvas.getBoundingClientRect();
  const trayRect = {
    x: state.tray.x,
    y: state.tray.y,
    w: state.tray.w,
    h: state.tray.h,
  };

  for (let i = state.ingredients.length - 1; i >= 0; i--) {
    const item = state.ingredients[i];
    item.y += item.vy * dt;

    const itemRect = { x: item.x, y: item.y, w: item.size, h: item.size };

    if (rectsOverlap(itemRect, trayRect)) {
      // CAUGHT!
      state.score += POINTS_PER_CATCH;
      scoreValueEl.textContent = state.score;
      showComboToast(item.x + item.size / 2, state.tray.y - 10);
      state.ingredients.splice(i, 1);
      continue;
    }

    // Missed — no penalty, endless mode, just remove once off-screen
    if (item.y > rect.height + item.size) {
      state.ingredients.splice(i, 1);
    }
  }
}

function drawBackground() {
  const rect = canvas.getBoundingClientRect();
  if (images.background) {
    ctx.drawImage(images.background, 0, 0, rect.width, rect.height);
  } else {
    ctx.fillStyle = "#0b0b0c";
    ctx.fillRect(0, 0, rect.width, rect.height);
  }
}

function drawTray() {
  const t = state.tray;
  if (images.tray) {
    ctx.drawImage(images.tray, t.x, t.y, t.w, t.h);
  } else {
    ctx.fillStyle = "#a9691f";
    ctx.strokeStyle = "#f2b705";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(t.x, t.y, t.w, t.h, 8);
    ctx.fill();
    ctx.stroke();
  }
}

function drawIngredients() {
  for (const item of state.ingredients) {
    const img = images[item.type];
    ctx.save();
    ctx.translate(item.x + item.size / 2, item.y + item.size / 2);
    ctx.rotate(item.rotation);
    if (img) {
      ctx.drawImage(img, -item.size / 2, -item.size / 2, item.size, item.size);
    } else {
      ctx.fillStyle = "#f2b705";
      ctx.beginPath();
      ctx.arc(0, 0, item.size / 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}

function gameLoop(timestamp) {
  if (!state.running) return;

  if (!state.lastFrameTime) state.lastFrameTime = timestamp;
  const dt = Math.min(0.05, (timestamp - state.lastFrameTime) / 1000); // clamp to avoid tab-switch jumps
  state.lastFrameTime = timestamp;

  // Spawning
  state.spawnTimer += dt;
  if (state.spawnTimer >= currentSpawnInterval()) {
    state.spawnTimer = 0;
    spawnIngredient();
  }

  updateTray(dt);
  updateIngredients(dt);

  const rect = canvas.getBoundingClientRect();
  ctx.clearRect(0, 0, rect.width, rect.height);
  drawBackground();
  drawIngredients();
  drawTray();

  requestAnimationFrame(gameLoop);
}

/* ---------------------------------------------------------------------
   9. SCREEN TRANSITIONS
   --------------------------------------------------------------------- */
function showScreen(name) {
  Object.values(screens).forEach((el) => el.classList.remove("active"));
  screens[name].classList.add("active");
}

function startGame() {
  state.score = 0;
  state.ingredients = [];
  state.spawnTimer = 0;
  state.lastFrameTime = 0;
  state.startTime = Date.now();
  state.running = true;

  scoreValueEl.textContent = "0";
  hudPlayerNameEl.textContent = state.player.name;

  showScreen("game");
  resizeCanvas();
  requestAnimationFrame(gameLoop);
}

async function endGame() {
  if (!state.running) return;
  state.running = false;
  state.endTime = Date.now();

  finalScoreEl.textContent = state.score;
  submitStatusEl.textContent = "Saving your score…";
  submitStatusEl.className = "submit-status";
  showScreen("gameover");

  const result = await submitScore({
    name: state.player.name,
    phone: state.player.phone,
    score: state.score,
    startTime: state.startTime,
    endTime: state.endTime,
  });

  if (result.ok) {
    submitStatusEl.textContent = "Score saved! Good luck on the leaderboard.";
    submitStatusEl.className = "submit-status ok";
  } else if (result.reason === "implausible_score") {
    submitStatusEl.textContent = "Score couldn't be verified and wasn't saved.";
    submitStatusEl.className = "submit-status error";
  } else {
    submitStatusEl.textContent = "Couldn't save your score — check your connection.";
    submitStatusEl.className = "submit-status error";
  }
}

/* Best-effort save if the player closes the tab / backgrounds the app
   instead of tapping Quit. Can't await here, so we fire-and-forget. */
function handleUnexpectedExit() {
  if (!state.running) return;
  state.running = false;
  state.endTime = Date.now();
  submitScoreOnExit({
    name: state.player.name,
    phone: state.player.phone,
    score: state.score,
    startTime: state.startTime,
    endTime: state.endTime,
  });
}

window.addEventListener("pagehide", handleUnexpectedExit);
window.addEventListener("beforeunload", handleUnexpectedExit);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") handleUnexpectedExit();
});

/* ---------------------------------------------------------------------
   10. LEADERBOARD RENDERING
   --------------------------------------------------------------------- */
function maskPhone(phone) {
  if (!phone || phone.length < 4) return phone || "";
  return `${phone.slice(0, 3)}••••${phone.slice(-2)}`;
}

function renderLeaderboard(scores) {
  leaderboardList.innerHTML = "";

  if (!scores || scores.length === 0) {
    leaderboardList.innerHTML = `<li class="lb-empty">No scores yet — be the first!</li>`;
    return;
  }

  scores.forEach((entry, i) => {
    const li = document.createElement("li");
    li.className = `rank-${i + 1}`;
    li.innerHTML = `
      <span class="lb-rank">${i + 1}</span>
      <span class="lb-info">
        <span class="lb-name">${escapeHtml(entry.name || "Player")}</span><br />
        <span class="lb-phone">${escapeHtml(maskPhone(entry.phone))}</span>
      </span>
      <span class="lb-score">${entry.score}</span>
    `;
    leaderboardList.appendChild(li);
  });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

listenTopScores(renderLeaderboard);

/* ---------------------------------------------------------------------
   11. UI EVENT WIRING
   --------------------------------------------------------------------- */
registerForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const name = nameInput.value.trim();
  const phone = phoneInput.value.trim();
  if (!name || !phone) return;

  state.player.name = name;
  state.player.phone = phone;
  startBtn.disabled = true;

  startGame();
  startBtn.disabled = false;
});

quitBtn.addEventListener("click", endGame);

playAgainBtn.addEventListener("click", () => {
  showScreen("register");
});

goLeaderboardBtn.addEventListener("click", () => {
  leaderboardOverlay.classList.add("show");
});

viewLeaderboardBtn.addEventListener("click", () => {
  leaderboardOverlay.classList.add("show");
});

closeLeaderboardBtn.addEventListener("click", () => {
  leaderboardOverlay.classList.remove("show");
});

/* ---------------------------------------------------------------------
   12. BOOT
   --------------------------------------------------------------------- */
(async function boot() {
  showScreen("register");
  resizeCanvas();
  await preloadAssets();
})();
