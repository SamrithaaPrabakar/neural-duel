// Turns the raw world into a small discrete state key for the Q-table.
// Everything here is a *bucket*, not a raw number — that's what keeps the
// state space (and therefore the Q-table) tiny enough to learn live.

const DX_BUCKETS = ["farLeft", "left", "close", "right", "farRight"];
const HEALTH_BUCKETS = ["low", "mid", "high"];

function bucketDx(dx, arenaWidth) {
  const norm = dx / arenaWidth; // -1..1, positive = target is to the right
  if (norm < -0.3) return "farLeft";
  if (norm < -0.08) return "left";
  if (norm <= 0.08) return "close";
  if (norm <= 0.3) return "right";
  return "farRight";
}

function bucketHealth(hp, maxHp) {
  const frac = hp / maxHp;
  if (frac <= 0.3) return "low";
  if (frac <= 0.65) return "mid";
  return "high";
}

function actionBucket(fighter) {
  if (fighter.state === "attack" || fighter.state === "heavy") return "attacking";
  if (fighter.state === "special") return "special";
  if (fighter.state === "block") return "blocking";
  if (fighter.state === "dash") return "dashing";
  return "neutral";
}

// dx is (other.x - self.x) so the bucket is from `self`'s point of view.
export function discretizeState(self, other, arenaWidth) {
  const dx = other.x - self.x;
  return [
    bucketDx(dx, arenaWidth),
    bucketHealth(self.hp, self.maxHp),
    bucketHealth(other.hp, other.maxHp),
    self.onGround ? "grounded" : "airborne",
    actionBucket(other),
    self.meter >= 100 ? "meterReady" : "meterCharging",
  ].join(",");
}

export { DX_BUCKETS, HEALTH_BUCKETS };
