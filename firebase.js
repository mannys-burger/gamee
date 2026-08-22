/* =====================================================================
   MANNY'S BURGER — firebase.js
   Firebase v9 (modular) initialization + Firestore leaderboard sync
   + lightweight anti-cheat (time-vs-score validation + payload hashing)
   ===================================================================== */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore,
  collection,
  addDoc,
  query,
  orderBy,
  limit,
  onSnapshot,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

/* ---------------------------------------------------------------------
   1. FIREBASE CONFIG
   Replace with your actual project credentials (Firebase console →
   Project settings → General → "Your apps" → SDK setup and config).
   --------------------------------------------------------------------- */
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID",
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const SCORES_COLLECTION = "mannys_scores";

/* ---------------------------------------------------------------------
   2. ANTI-CHEAT — Time vs. Score validation
   ---------------------------------------------------------------------
   These constants MUST mirror the difficulty curve in game.js.
   They define the theoretical *best possible* scoring rate so we can
   reject payloads that are mathematically impossible to have earned
   in the reported play time.
   --------------------------------------------------------------------- */
const POINTS_PER_CATCH = 10;

// Fastest an ingredient can ever fall/spawn once max difficulty is
// reached (seconds between spawns at the difficulty ceiling).
// Must match MIN_SPAWN_INTERVAL in game.js.
const MIN_SPAWN_INTERVAL_SEC = 0.28;

// A generous multiplier so we never punish a genuinely great human
// player — only reject scores that are wildly beyond physical reach
// (e.g. a modified client submitting huge numbers instantly).
const LENIENCY_FACTOR = 1.6;

// Nobody can score anything meaningful in under this many seconds.
const MIN_PLAUSIBLE_SECONDS = 1.5;

/**
 * Returns true if `score` is plausible given `elapsedSeconds` of play.
 */
export function isScorePlausible(score, elapsedSeconds) {
  if (score < 0 || !Number.isFinite(score)) return false;
  if (score === 0) return true;
  if (elapsedSeconds < MIN_PLAUSIBLE_SECONDS) return false;

  const maxCatchesPossible = (elapsedSeconds / MIN_SPAWN_INTERVAL_SEC) * LENIENCY_FACTOR;
  const maxScorePossible = maxCatchesPossible * POINTS_PER_CATCH;

  return score <= maxScorePossible;
}

/* ---------------------------------------------------------------------
   3. LIGHTWEIGHT PAYLOAD SIGNING
   ---------------------------------------------------------------------
   This is NOT cryptographically secure (that requires a server /
   Cloud Function to be tamper-proof). It's a basic deterrent that
   makes casual network tampering (e.g. editing the score in devtools
   right before the request fires) detectable, since the signature
   won't match if any field is altered after signing.

   For real production hardening, verify + write scores from a
   Cloud Function / server using Firestore security rules that block
   direct client writes.
   --------------------------------------------------------------------- */
const SIGNING_SALT = "mannys-burger-2026"; // change this per-deployment

function simpleHash(str) {
  // djb2-style string hash — fast, deterministic, good enough to detect tampering
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 33) ^ str.charCodeAt(i);
  }
  // unsigned 32-bit hex string
  return (hash >>> 0).toString(16);
}

function signPayload({ name, phone, score, startTime, endTime }) {
  const raw = `${name}|${phone}|${score}|${startTime}|${endTime}|${SIGNING_SALT}`;
  return simpleHash(raw);
}

/* ---------------------------------------------------------------------
   4. SUBMIT SCORE
   ---------------------------------------------------------------------
   Called when the player quits or the tab closes.
   `startTime` / `endTime` are epoch ms timestamps captured by game.js.
   --------------------------------------------------------------------- */
export async function submitScore({ name, phone, score, startTime, endTime }) {
  const elapsedSeconds = Math.max(0, (endTime - startTime) / 1000);

  if (!isScorePlausible(score, elapsedSeconds)) {
    console.warn(
      `[anti-cheat] Rejected score ${score} — implausible for ${elapsedSeconds.toFixed(1)}s of play.`
    );
    return { ok: false, reason: "implausible_score" };
  }

  const cleanName = String(name || "Player").trim().slice(0, 40);
  const cleanPhone = String(phone || "").trim().slice(0, 20);

  const signature = signPayload({ name: cleanName, phone: cleanPhone, score, startTime, endTime });

  try {
    await addDoc(collection(db, SCORES_COLLECTION), {
      name: cleanName,
      phone: cleanPhone,
      score,
      startTime,
      endTime,
      elapsedSeconds,
      signature,
      createdAt: serverTimestamp(),
    });
    return { ok: true };
  } catch (err) {
    console.error("[firebase] Failed to submit score:", err);
    return { ok: false, reason: "network_error", error: err };
  }
}

/**
 * Fire-and-forget variant safe to call from a `beforeunload` /
 * `pagehide` handler, where we can't reliably await a promise.
 * Uses the same validation + write path but never blocks unload.
 */
export function submitScoreOnExit(payload) {
  submitScore(payload).catch((err) => console.error("[firebase] exit submit failed:", err));
}

/* ---------------------------------------------------------------------
   5. REAL-TIME TOP-5 LEADERBOARD LISTENER
   --------------------------------------------------------------------- */
export function listenTopScores(callback, topN = 5) {
  const q = query(collection(db, SCORES_COLLECTION), orderBy("score", "desc"), limit(topN));

  return onSnapshot(
    q,
    (snapshot) => {
      const scores = snapshot.docs.map((doc) => {
        const data = doc.data();
        return {
          id: doc.id,
          name: data.name,
          phone: data.phone,
          score: data.score,
        };
      });
      callback(scores);
    },
    (err) => {
      console.error("[firebase] Leaderboard listener error:", err);
      callback([], err);
    }
  );
}
