// Cross-session persistence via localStorage. Wrapped defensively: private
// browsing, blocked site data, or a full quota must never crash the game —
// they just mean progress doesn't carry over this time.

const STORAGE_KEY = "neural-duel-save-v1";

export function emptyLifetime() {
  return { matches: 0, wins: 0, losses: 0, currentStreak: 0, bestStreak: 0, history: [] };
}

export function emptyProgress() {
  return { highestUnlockedLevel: 1 };
}

export function emptyWallet() {
  return { coins: 0, bonusStatPoints: 0 };
}

export function loadSave() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const lifetime = parsed.lifetime && typeof parsed.lifetime === "object"
      ? { ...emptyLifetime(), ...parsed.lifetime, history: Array.isArray(parsed.lifetime.history) ? parsed.lifetime.history : [] }
      : emptyLifetime();
    const progress = parsed.progress && typeof parsed.progress === "object"
      ? { ...emptyProgress(), ...parsed.progress }
      : emptyProgress();
    const wallet = parsed.wallet && typeof parsed.wallet === "object"
      ? { ...emptyWallet(), ...parsed.wallet }
      : emptyWallet();
    return {
      qlearner: parsed.qlearner && typeof parsed.qlearner === "object" ? parsed.qlearner : null,
      lifetime,
      progress,
      wallet,
    };
  } catch {
    return null;
  }
}

export function writeSave({ qlearner, lifetime, progress, wallet }) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 3, qlearner, lifetime, progress, wallet }));
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
