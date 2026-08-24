/* =====================================================================
   MANNY'S BURGER — game.js (Safe Version with Null Checks)
   ===================================================================== */

import { listenTopScores, submitScore, submitScoreOnExit } from "./firebase.js";

/* ---------------------------------------------------------------------
   0. ASSET PLACEHOLDERS
   --------------------------------------------------------------------- */
const ASSET_PATHS = {
  background: "assets/background.png",
  tray: "assets/tray.png",
  bunBottom: "assets/bun_bottom.png",
  lettuce: "assets/lettuce.png",
  tomato: "assets/tomato.png",
  onion: "assets/onion.png",
  cheese: "assets/cheese.png",
  patty: "assets/patty.png",
  bunTop: "assets/bun_top.png",
};

const INGREDIENT_TYPES = ["bunBottom", "lettuce", "tomato", "onion", "cheese", "patty", "bunTop"];

const INGREDIENT_NAMES = {
  bunBottom: "الخبز السفلي 🍞",
  lettuce: "الخس الطازج 🥬",
  tomato: "الطماطم 🍅",
  onion: "البصل 🧅",
  cheese: "الجبنة الذائبة 🧀",
  patty: "برجر اللحم 🥩",
  bunTop: "الخبز العلوي 🍔"
};

const STACK_CSS_CLASSES = {
  bunBottom: "bg-bun-bottom",
  lettuce: "bg-lettuce",
  tomato: "bg-tomato",
  onion: "bg-onion",
  cheese: "bg-cheese",
  patty: "bg-patty",
  bunTop: "bg-bun-top"
};

/* ---------------------------------------------------------------------
   1. DIFFICULTY & PROGRESSION TUNING
   --------------------------------------------------------------------- */
const POINTS_PER_CATCH = 10;
const MAX_MISSES = 3; 

const BASE_SPAWN_INTERVAL = 0.9;
const MIN_SPAWN_INTERVAL = 0.28;
const SPAWN_RAMP = 0.006;

const BASE_FALL_SPEED = 220;
const MAX_FALL_SPEED = 900;
const FALL_RAMP = 1.5;

const STAGE_SCORE = 300;

/* ---------------------------------------------------------------------
   2. DOM REFERENCES (With Optional Safety)
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
const ctx = canvas ? canvas.getContext("2d") : null;
const scoreValueEl = document.getElementById("scoreValue");
const hudPlayerNameEl = document.getElementById("hudPlayerName");
const quitBtn = document.getElementById("quitBtn");
const comboToastEl = document.getElementById("comboToast");
const missesHeartsEl = document.getElementById("livesContainer");

const burgerStackEl = document.getElementById("burgerStack");

const phaseOverlayEl = document.getElementById("phaseOverlay");
const phaseTitleEl = document.getElementById("phaseTitle");
const phaseSubEl = document.getElementById("phaseSub");
const resumePhaseBtn = document.getElementById("resumePhaseBtn");

const gameoverTitleEl = document.getElementById("gameoverTitle");
const gameoverSubEl = document.getElementById("gameoverSub");
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
  misses: 0,
  currentStage: 0,
  running: false,
  isPaused: false,
  startTime: 0,
  endTime: 0,
  ingredients: [],
  particles: [],
  currentBurger: [],
  spawnTimer: 0,
  lastFrameTime: 0,
  trayFlash: 0,
  tray: { x: 0, y: 0, w: 0, h: 0, targetX: 0 },
};

const images = {};

/* ---------------------------------------------------------------------
   4. ASSET LOADING
   --------------------------------------------------------------------- */
function loadImage(key, src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      images[key] = img;
      resolve(img);
    };
    img.onerror = () => {
      resolve(null);
    };
    img.src = src;
  });
}

async function preloadAssets() {
  const entries = Object.entries(ASSET_PATHS);
  await Promise.all(entries.map(([key, src]) => loadImage(key, src)));
}

/* ---------------------------------------------------------------------
   5. CANVAS SIZING
   --------------------------------------------------------------------- */
let dpr = Math.min(window.devicePixelRatio || 1, 2);

function resizeCanvas() {
  if (!canvas || !ctx) return;
  const rect = canvas.getBoundingClientRect();
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const w = rect.width;
  const h = rect.height;
  state.tray.w = Math.min(108, w * 0.28);
  state.tray.h = state.tray.w * 0.22;
  state.tray.y = h - state.tray.h - 34;
  if (state.tray.x === 0) {
    state.tray.x = w / 2 - state.tray.w / 2;
    state.tray.targetX = state.tray.x;
  }
}

window.addEventListener("resize", resizeCanvas);
window.addEventListener("orientationchange", () => setTimeout(resizeCanvas, 200));

/* ---------------------------------------------------------------------
   6. INPUT HANDLING
   --------------------------------------------------------------------- */
function clampTrayX(x) {
  if (!canvas) return x;
  const rect = canvas.getBoundingClientRect();
  return Math.max(0, Math.min(rect.width - state.tray.w, x));
}

function setTrayTargetFromClientX(clientX) {
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  const localX = clientX - rect.left;
  state.tray.targetX = clampTrayX(localX - state.tray.w / 2);
}

if (canvas) {
  canvas.addEventListener("touchstart", (e) => {
    e.preventDefault();
    setTrayTargetFromClientX(e.touches[0].clientX);
  }, { passive: false });

  canvas.addEventListener("touchmove", (e) => {
    e.preventDefault();
    setTrayTargetFromClientX(e.touches[0].clientX);
  }, { passive: false });

  let mouseDown = false;
  canvas.addEventListener("mousedown", (e) => {
    mouseDown = true;
    setTrayTargetFromClientX(e.clientX);
  });
  window.addEventListener("mousemove", (e) => {
    if (mouseDown) setTrayTargetFromClientX(e.clientX);
  });
  window.addEventListener("mouseup", () => (mouseDown = false));
}

const KEY_SPEED = 480;
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
   7. SPAWNING, DIFFICULTY & PHASE PROGRESSION
   --------------------------------------------------------------------- */
function currentSpawnInterval() {
  return Math.max(MIN_SPAWN_INTERVAL, BASE_SPAWN_INTERVAL - state.score * SPAWN_RAMP);
}

function currentFallSpeed() {
  return Math.min(MAX_FALL_SPEED, BASE_FALL_SPEED + state.score * FALL_RAMP);
}

function currentIngredientType() {
  const stageIndex = Math.floor(state.score / STAGE_SCORE);
  if (stageIndex < INGREDIENT_TYPES.length) {
    return INGREDIENT_TYPES[stageIndex];
  }
  return INGREDIENT_TYPES[Math.floor(Math.random() * INGREDIENT_TYPES.length)];
}

function spawnIngredient() {
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  const type = currentIngredientType();
  const size = Math.min(58, rect.width * 0.16);
  const x = Math.random() * (rect.width - size);

  state.ingredients.push({
    type,
    x,
    y: -size,
    size,
    vy: currentFallSpeed(),
    rotation: (Math.random() - 0.5) * 0.3,
  });
}

/* ---------------------------------------------------------------------
   8. SIDE PANEL STACK & PHASE OVERLAY LOGIC
   --------------------------------------------------------------------- */
function addIngredientToSideStack(type) {
  if (!burgerStackEl) return;
  const item = document.createElement("div");
  const cssClass = STACK_CSS_CLASSES[type] || "bg-bun-bottom";
  item.className = `stack-item ${cssClass}`;
  burgerStackEl.appendChild(item);
}

function clearSideStack() {
  if (burgerStackEl) burgerStackEl.innerHTML = "";
}

function checkPhaseProgress(newScore) {
  const newStage = Math.floor(newScore / STAGE_SCORE);
  if (newStage > state.currentStage) {
    state.currentStage = newStage;
    triggerPhasePause(newStage);
  }
}

function triggerPhasePause(stageIndex) {
  state.isPaused = true;
  const ingredientKey = INGREDIENT_TYPES[stageIndex % INGREDIENT_TYPES.length];
  const ingredientName = INGREDIENT_NAMES[ingredientKey] || "مكون جديد";

  if (phaseOverlayEl) {
    if (phaseTitleEl) phaseTitleEl.textContent = `المرحلة ${stageIndex + 1}!`;
    if (phaseSubEl) phaseSubEl.textContent = `استعد لتجميع: ${ingredientName} (المس الشاشة للمتابعة)`;
    phaseOverlayEl.classList.add("active");

    const handleTap = (e) => {
      e.preventDefault();
      resumeGameFromPhase();
      phaseOverlayEl.removeEventListener("click", handleTap);
      phaseOverlayEl.removeEventListener("touchstart", handleTap);
    };
    phaseOverlayEl.addEventListener("click", handleTap);
    phaseOverlayEl.addEventListener("touchstart", handleTap, { passive: false });

  } else {
    setTimeout(resumeGameFromPhase, 1200);
  }
}

function resumeGameFromPhase() {
  if (phaseOverlayEl) phaseOverlayEl.classList.remove("active");
  state.isPaused = false;
  state.lastFrameTime = performance.now();
}

if (resumePhaseBtn) {
  resumePhaseBtn.addEventListener("click", resumeGameFromPhase);
}

/* ---------------------------------------------------------------------
   9. PARTICLES
   --------------------------------------------------------------------- */
function spawnCatchParticles(x, y) {
  const colors = ["#f2b705", "#ffffff", "#d99a00"];
  for (let i = 0; i < 7; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 60 + Math.random() * 90;
    state.particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 40,
      life: 0.45,
      age: 0,
      color: colors[Math.floor(Math.random() * colors.length)],
      size: 2 + Math.random() * 3,
    });
  }
}

function updateParticles(dt) {
  for (let i = state.particles.length - 1; i >= 0; i--) {
    const p = state.particles[i];
    p.age += dt;
    if (p.age >= p.life) {
      state.particles.splice(i, 1);
      continue;
    }
    p.vy += 260 * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
  }
}

function drawParticles() {
  if (!ctx) return;
  for (const p of state.particles) {
    const t = 1 - p.age / p.life;
    ctx.globalAlpha = Math.max(0, t);
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/* ---------------------------------------------------------------------
   10. GAME LOOP HELPERS
   --------------------------------------------------------------------- */
function updateTray(dt) {
  if (keys.left) state.tray.targetX = clampTrayX(state.tray.targetX - KEY_SPEED * dt);
  if (keys.right) state.tray.targetX = clampTrayX(state.tray.targetX + KEY_SPEED * dt);

  const followSpeed = 18;
  state.tray.x += (state.tray.targetX - state.tray.x) * Math.min(1, followSpeed * dt);

  if (state.trayFlash > 0) state.trayFlash = Math.max(0, state.trayFlash - dt * 3);
}

function rectsOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function showComboToast(x, y, text = "+10") {
  if (!comboToastEl) return;
  comboToastEl.textContent = text;
  comboToastEl.style.left = `${x}px`;
  comboToastEl.style.top = `${y}px`;
  comboToastEl.classList.remove("show");
  void comboToastEl.offsetWidth;
  comboToastEl.classList.add("show");
}

function updateMissesHUD() {
  if (!missesHeartsEl) return;
  const hearts = missesHeartsEl.querySelectorAll(".heart");
  hearts.forEach((el, i) => el.classList.toggle("lost", i < state.misses));
}

function updateIngredients(dt) {
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  const trayRect = { x: state.tray.x, y: state.tray.y, w: state.tray.w, h: state.tray.h };

  for (let i = state.ingredients.length - 1; i >= 0; i--) {
    const item = state.ingredients[i];
    item.y += item.vy * dt;

    const itemRect = { x: item.x, y: item.y, w: item.size, h: item.size };

    if (rectsOverlap(itemRect, trayRect)) {
      state.score += POINTS_PER_CATCH;
      if (scoreValueEl) scoreValueEl.textContent = state.score;
      state.trayFlash = 1;

      if (!state.currentBurger.includes(item.type)) {
        state.currentBurger.push(item.type);
        addIngredientToSideStack(item.type);

        if (state.currentBurger.length === INGREDIENT_TYPES.length) {
          state.score += 50;
          if (scoreValueEl) scoreValueEl.textContent = state.score;
          showComboToast(rect.width / 2, rect.height * 0.4, "برجر كامل! +50");
          state.currentBurger = [];
          setTimeout(clearSideStack, 600);
        }
      }

      showComboToast(item.x + item.size / 2, state.tray.y - 10, "+10");
      spawnCatchParticles(item.x + item.size / 2, item.y + item.size / 2);

      if (state.score % 100 === 0) {
        showComboToast(rect.width / 2, rect.height * 0.32, `🔥 ${state.score}`);
      }

      checkPhaseProgress(state.score);

      state.ingredients.splice(i, 1);
      continue;
    }

    if (item.y > rect.height + item.size) {
      state.ingredients.splice(i, 1);
      state.misses += 1;
      updateMissesHUD();
      if (state.misses >= MAX_MISSES) {
        endGame("missed");
        return;
      }
    }
  }
}

/* ---------------------------------------------------------------------
   11. DRAWING
   --------------------------------------------------------------------- */
function drawBackground() {
  if (!canvas || !ctx) return;
  const rect = canvas.getBoundingClientRect();
  if (images.background) {
    ctx.drawImage(images.background, 0, 0, rect.width, rect.height);
    return;
  }
  ctx.fillStyle = "#0b0b0c";
  ctx.fillRect(0, 0, rect.width, rect.height);

  const gradient = ctx.createRadialGradient(
    rect.width / 2, rect.height * 0.25, 10,
    rect.width / 2, rect.height * 0.25, rect.width * 0.9
  );
  gradient.addColorStop(0, "rgba(242, 183, 5, 0.10)");
  gradient.addColorStop(1, "rgba(242, 183, 5, 0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, rect.width, rect.height);
}

function drawTray() {
  if (!canvas || !ctx) return;
  const t = state.tray;
  const rect = canvas.getBoundingClientRect();

  if (images.tray) {
    ctx.drawImage(images.tray, t.x, t.y, t.w, t.h);
    return;
  }

  const legWidth = t.w * 0.09;
  const legHeight = Math.max(14, rect.height - (t.y + t.h) - 4);
  const legY = t.y + t.h;

  ctx.fillStyle = "#5c3a1a";
  ctx.fillRect(t.x + t.w * 0.08, legY, legWidth, legHeight);
  ctx.fillRect(t.x + t.w * 0.92 - legWidth, legY, legWidth, legHeight);

  const glow = state.trayFlash;
  ctx.fillStyle = "#a9691f";
  ctx.strokeStyle = glow > 0 ? "#ffe27a" : "#f2b705";
  ctx.lineWidth = 2 + glow * 2;
  ctx.beginPath();
  ctx.roundRect(t.x, t.y, t.w, t.h, 6);
  ctx.fill();
  ctx.stroke();

  ctx.strokeStyle = "rgba(0,0,0,0.18)";
  ctx.lineWidth = 1;
  const planks = 4;
  for (let i = 1; i < planks; i++) {
    const px = t.x + (t.w / planks) * i;
    ctx.beginPath();
    ctx.moveTo(px, t.y + 3);
    ctx.lineTo(px, t.y + t.h - 3);
    ctx.stroke();
  }
}

function drawIngredientFallback(type, size) {
  if (!ctx) return;
  const r = size / 2;
  switch (type) {
    case "bunBottom":
    case "bunTop": {
      ctx.fillStyle = "#d99a00";
      ctx.beginPath();
      ctx.ellipse(0, 0, r, r * 0.78, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#f7f5f0";
      for (let i = -2; i <= 2; i++) {
        ctx.beginPath();
        ctx.ellipse(i * (r * 0.32), -r * 0.15, r * 0.06, r * 0.1, 0.3, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case "lettuce": {
      ctx.fillStyle = "#6bbf59";
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const ang = (i / 10) * Math.PI * 2;
        const rr = r * (0.75 + (i % 2) * 0.25);
        const px = Math.cos(ang) * rr;
        const py = Math.sin(ang) * rr;
        i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      break;
    }
    case "tomato": {
      ctx.fillStyle = "#e2483d";
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.85, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.5)";
      ctx.lineWidth = 1.5;
      for (let i = 0; i < 5; i++) {
        const ang = (i / 5) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(Math.cos(ang) * r * 0.8, Math.sin(ang) * r * 0.8);
        ctx.stroke();
      }
      break;
    }
    case "onion": {
      ctx.strokeStyle = "#e9d5f5";
      ctx.lineWidth = size * 0.09;
      ctx.beginPath();
      ctx.ellipse(0, 0, r * 0.85, r * 0.55, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = "#c9a6de";
      ctx.lineWidth = size * 0.05;
      ctx.beginPath();
      ctx.ellipse(0, 0, r * 0.5, r * 0.32, 0, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }
    case "cheese": {
      ctx.fillStyle = "#ffcf3f";
      ctx.beginPath();
      ctx.moveTo(-r, 0);
      ctx.lineTo(0, -r * 0.75);
      ctx.lineTo(r, 0);
      ctx.lineTo(0, r * 0.75);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case "patty": {
      ctx.fillStyle = "#6b4226";
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.85, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,0.35)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(-r * 0.4, -r * 0.2);
      ctx.lineTo(r * 0.4, -r * 0.2);
      ctx.moveTo(-r * 0.4, r * 0.2);
      ctx.lineTo(r * 0.4, r * 0.2);
      ctx.stroke();
      break;
    }
    default: {
      ctx.fillStyle = "#f2b705";
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawIngredients() {
  if (!ctx) return;
  for (const item of state.ingredients) {
    const img = images[item.type];
    ctx.save();
    ctx.translate(item.x + item.size / 2, item.y + item.size / 2);
    ctx.rotate(item.rotation);
    if (img) {
      ctx.drawImage(img, -item.size / 2, -item.size / 2, item.size, item.size);
    } else {
      drawIngredientFallback(item.type, item.size);
    }
    ctx.restore();
  }
}

function gameLoop(timestamp) {
  if (!state.running) return;

  if (state.isPaused) {
    state.lastFrameTime = timestamp;
    requestAnimationFrame(gameLoop);
    return;
  }

  if (!state.lastFrameTime) state.lastFrameTime = timestamp;
  const dt = Math.min(0.05, (timestamp - state.lastFrameTime) / 1000);
  state.lastFrameTime = timestamp;

  state.spawnTimer += dt;
  if (state.spawnTimer >= currentSpawnInterval()) {
    state.spawnTimer = 0;
    spawnIngredient();
  }

  updateTray(dt);
  updateIngredients(dt);
  if (!state.running) return;
  updateParticles(dt);

  if (canvas && ctx) {
    const rect = canvas.getBoundingClientRect();
    ctx.clearRect(0, 0, rect.width, rect.height);
    drawBackground();
    drawParticles();
    drawIngredients();
    drawTray();
  }

  requestAnimationFrame(gameLoop);
}

/* ---------------------------------------------------------------------
   12. SCREEN TRANSITIONS & ERROR HANDLING FIX
   --------------------------------------------------------------------- */
function showScreen(name) {
  Object.values(screens).forEach((el) => {
    if (el) el.classList.remove("active");
  });
  if (screens[name]) screens[name].classList.add("active");
}

function startGame() {
  state.score = 0;
  state.misses = 0;
  state.currentStage = 0;
  state.isPaused = false;
  state.ingredients = [];
  state.particles = [];
  state.currentBurger = []; 
  state.spawnTimer = 0;
  state.lastFrameTime = 0;
  state.startTime = Date.now();
  state.running = true;

  if (scoreValueEl) scoreValueEl.textContent = "0";
  if (hudPlayerNameEl) hudPlayerNameEl.textContent = state.player.name;
  updateMissesHUD();
  clearSideStack();

  showScreen("game");
  resizeCanvas();
  requestAnimationFrame(gameLoop);
}

async function endGame(reason = "quit") {
  if (!state.running) return;
  state.running = false;
  state.endTime = Date.now();

  if (gameoverTitleEl) {
    if (reason === "missed") {
      gameoverTitleEl.innerHTML = `Game <span class="accent">Over!</span>`;
    } else {
      gameoverTitleEl.innerHTML = `Nice <span class="accent">Stack!</span>`;
    }
  }

  if (gameoverSubEl) {
    gameoverSubEl.textContent = reason === "missed" ? "لقد خسرت الـ 3 قلوب — وهذه هي النتيجة النهائية" : "نتيجة اللعب النهائية";
  }

  if (finalScoreEl) finalScoreEl.textContent = state.score;
  
  if (submitStatusEl) {
    submitStatusEl.textContent = "جاري حفظ النتيجة…";
    submitStatusEl.className = "submit-status";
  }
  
  showScreen("gameover"); 

  try {
    const result = await submitScore({
      name: state.player.name,
      phone: state.player.phone,
      score: state.score,
      startTime: state.startTime,
      endTime: state.endTime,
    });

    if (submitStatusEl) {
      if (result && result.ok) {
        submitStatusEl.textContent = "تم حفظ النتيجة بنجاح!";
        submitStatusEl.className = "submit-status ok";
      } else if (result && result.reason === "implausible_score") {
        submitStatusEl.textContent = "تعذر التحقق من النتيجة ولم يتم حفظها.";
        submitStatusEl.className = "submit-status error";
      } else {
        submitStatusEl.textContent = "تعذر حفظ النتيجة — يرجى التأكد من الاتصال بالإنترنت.";
        submitStatusEl.className = "submit-status error";
      }
    }
  } catch (error) {
    console.error("Firebase submit error:", error);
    if (submitStatusEl) {
      submitStatusEl.textContent = "تعذر حفظ النتيجة — يرجى التأكد من الاتصال بالإنترنت.";
      submitStatusEl.className = "submit-status error";
    }
  }
}

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
   13. LEADERBOARD RENDERING
   --------------------------------------------------------------------- */
function maskPhone(phone) {
  if (!phone || phone.length < 4) return phone || "";
  return `${phone.slice(0, 3)}••••${phone.slice(-2)}`;
}

function renderLeaderboard(scores) {
  if (!leaderboardList) return;
  leaderboardList.innerHTML = "";

  if (!scores || scores.length === 0) {
    leaderboardList.innerHTML = `<li class="lb-empty">لا توجد نتائج بعد — كن أول المتصدرين!</li>`;
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
   14. UI EVENT WIRING
   --------------------------------------------------------------------- */
registerForm?.addEventListener("submit", (e) => {
  e.preventDefault();
  const name = nameInput?.value.trim();
  const phone = phoneInput?.value.trim();
  if (!name || !phone) return;

  state.player.name = name;
  state.player.phone = phone;
  if (startBtn) startBtn.disabled = true;

  startGame();
  if (startBtn) startBtn.disabled = false;
});

quitBtn?.addEventListener("click", () => endGame("quit"));

playAgainBtn?.addEventListener("click", () => {
  showScreen("register");
});

goLeaderboardBtn?.addEventListener("click", () => {
  leaderboardOverlay?.classList.add("show");
});

viewLeaderboardBtn?.addEventListener("click", () => {
  leaderboardOverlay?.classList.add("show");
});

closeLeaderboardBtn?.addEventListener("click", () => {
  leaderboardOverlay?.classList.remove("show");
});

/* ---------------------------------------------------------------------
   15. BOOT
   --------------------------------------------------------------------- */
(async function boot() {
  showScreen("register");
  resizeCanvas();
  await preloadAssets();
})();
