import { Env } from './env';
import { QLearningAgent } from './qlearning';

export interface TrainingConfig {
  episodes: number;
  maxSteps: number; // 1エピソードの最大歩数 (これを超えたらタイムアウトで打ち切り)
  alpha: number; // 学習率
  gamma: number; // 割引率
  epsilonStart: number; // 最初は100%ランダムに探索
  epsilonMin: number; // 探索率の下限
  epsilonDecay: number; // 1エピソードごとに epsilon *= この値
  logWindow: number; // この件数ごとの平均をログに残す
}

export interface LogEntry {
  episode: number;
  avgSteps: number;
  avgReward: number;
  epsilon: number;
  stateCount: number;
}

export interface TrainingResult {
  agent: QLearningAgent;
  log: LogEntry[];
}

// train.ts と compare.ts の両方から使う、学習ループそのもの
export const runTraining = (
  config: TrainingConfig,
  onLog?: (entry: LogEntry) => void,
  // 指定したエピソード数に到達した時点のエージェントのスナップショットを受け取る (学習途中の挙動を見比べるため)
  onCheckpoint?: (episode: number, agent: QLearningAgent) => void,
  checkpoints: number[] = [],
): TrainingResult => {
  const env = new Env();
  const agent = new QLearningAgent(config.alpha, config.gamma);

  let epsilon = config.epsilonStart;
  const recentSteps: number[] = [];
  const recentRewards: number[] = [];
  const log: LogEntry[] = [];

  for (let episode = 1; episode <= config.episodes; episode++) {
    let state = env.reset();
    let steps = 0;
    let totalReward = 0;

    for (; steps < config.maxSteps; steps++) {
      const action = agent.chooseAction(state, epsilon);
      const { state: nextState, reward, done } = env.step(action);
      agent.update(state, action, reward, nextState);
      state = nextState;
      totalReward += reward;
      if (done) break;
    }

    recentSteps.push(steps);
    if (recentSteps.length > config.logWindow) recentSteps.shift();
    recentRewards.push(totalReward);
    if (recentRewards.length > config.logWindow) recentRewards.shift();
    epsilon = Math.max(config.epsilonMin, epsilon * config.epsilonDecay);

    if (episode % config.logWindow === 0) {
      const avgSteps = recentSteps.reduce((a, b) => a + b, 0) / recentSteps.length;
      const avgReward = recentRewards.reduce((a, b) => a + b, 0) / recentRewards.length;
      const entry: LogEntry = { episode, avgSteps, avgReward, epsilon, stateCount: agent.stateCount };
      log.push(entry);
      onLog?.(entry);
    }

    if (checkpoints.includes(episode)) onCheckpoint?.(episode, agent);
  }

  return { agent, log };
};
