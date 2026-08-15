import fs from 'fs';
import path from 'path';
import { Env } from './env';
import { QLearningAgent } from './qlearning';

// ==== ハイパーパラメータ (ここをいじって実験する) ====
const EPISODES = 3000;
const MAX_STEPS = 200; // 1エピソードの最大歩数 (これを超えたらタイムアウトで打ち切り)
const ALPHA = 0.1; // 学習率
const GAMMA = 0.95; // 割引率
const EPSILON_START = 1.0; // 最初は100%ランダムに探索
const EPSILON_MIN = 0.05; // 探索率の下限 (学習後も5%はランダムに動かす)
const EPSILON_DECAY = 0.995; // 1エピソードごとに epsilon *= この値
const LOG_WINDOW = 100; // この件数ごとの平均を表示する
// ====================================================

const env = new Env();
const agent = new QLearningAgent(ALPHA, GAMMA);

let epsilon = EPSILON_START;
const recentSteps: number[] = [];

for (let episode = 1; episode <= EPISODES; episode++) {
  let state = env.reset();
  let steps = 0;

  for (; steps < MAX_STEPS; steps++) {
    const action = agent.chooseAction(state, epsilon);
    const { state: nextState, reward, done } = env.step(action);
    agent.update(state, action, reward, nextState);
    state = nextState;
    if (done) break;
  }

  recentSteps.push(steps);
  if (recentSteps.length > LOG_WINDOW) recentSteps.shift();
  epsilon = Math.max(EPSILON_MIN, epsilon * EPSILON_DECAY);

  if (episode % LOG_WINDOW === 0) {
    const avgSteps = recentSteps.reduce((a, b) => a + b, 0) / recentSteps.length;
    console.log(
      `episode ${episode}\tavg steps(直近${LOG_WINDOW}): ${avgSteps.toFixed(1)}\tepsilon: ${epsilon.toFixed(3)}\tQテーブルの状態数: ${agent.stateCount}`,
    );
  }
}

const qtablePath = path.join(__dirname, 'qtable.json');
fs.writeFileSync(qtablePath, JSON.stringify(agent.toJSON()));
console.log(`Qテーブルを保存しました: ${qtablePath}`);
