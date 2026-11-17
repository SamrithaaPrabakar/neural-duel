// Cross-session persistence via localStorage. Wrapped defensively: private
// browsing, blocked site data, or a full quota must never crash the game —
// they just mean progress doesn't carry over this time.

const STORAGE_KEY = "neural-duel-save-v1";

export function emptyLifetime() {
  return { matches: 0, wins: 0, losses: 0, currentStreak: 0, bestStreak: 0 };
}

export function loadSave() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return {
      qlearner: parsed.qlearner && typeof parsed.qlearner === "object" ? parsed.qlearner : null,
      lifetime: parsed.lifetime && typeof parsed.lifetime === "object" ? { ...emptyLifetime(), ...parsed.lifetime } : emptyLifetime(),
    };
  } catch {
    return null;
  }
}

export function writeSave({ qlearner, lifetime }) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, qlearner, lifetime }));
    return true;
  } catch {
    return false;
  }
}

export function clearSave() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore — nothing to clear if storage isn't available
  }
}
