// Tabular Q-learning: a plain object keyed by "state|action" -> value.
// Classic epsilon-greedy action selection with decaying epsilon, and the
// standard Bellman update. No neural net — this is deliberately a textbook
// RL algorithm so it's easy to explain and small enough to run live.

export class QLearner {
  constructor(actions, { alpha = 0.3, gamma = 0.9, epsilon = 0.9, epsilonMin = 0.05, epsilonDecay = 0.995 } = {}) {
    this.actions = actions;
    this.alpha = alpha;
    this.gamma = gamma;
    this.epsilon = epsilon;
    this.epsilonMin = epsilonMin;
    this.epsilonDecay = epsilonDecay;
    this.q = Object.create(null);
    this.updateCount = 0;
  }

  key(state, action) {
    return `${state}|${action}`;
  }

  valueOf(state, action) {
    const k = this.key(state, action);
    return k in this.q ? this.q[k] : 0;
  }

  bestAction(state, actions = this.actions) {
    let best = actions[0];
    let bestVal = -Infinity;
    for (const a of actions) {
      const v = this.valueOf(state, a);
      if (v > bestVal) { bestVal = v; best = a; }
    }
    return { action: best, value: bestVal };
  }

  // `actions` can be a restricted subset (e.g. "special" masked out while
  // the meter isn't full) so the agent never wastes exploration on a move
  // it's not allowed to take right now.
  chooseAction(state, actions = this.actions) {
    if (Math.random() < this.epsilon) {
      return { action: actions[Math.floor(Math.random() * actions.length)], explored: true };
    }
    return { action: this.bestAction(state, actions).action, explored: false };
  }

  update(state, action, reward, nextState, nextActions = this.actions) {
    const k = this.key(state, action);
    const current = this.valueOf(state, action);
    const nextBest = this.bestAction(nextState, nextActions).value;
    const target = reward + this.gamma * nextBest;
    this.q[k] = current + this.alpha * (target - current);
    this.updateCount++;
  }

  decayEpsilon() {
    this.epsilon = Math.max(this.epsilonMin, this.epsilon * this.epsilonDecay);
  }

  reset() {
    this.q = Object.create(null);
    this.epsilon = 0.9;
    this.updateCount = 0;
  }

  get tableSize() {
    return Object.keys(this.q).length;
  }
}
