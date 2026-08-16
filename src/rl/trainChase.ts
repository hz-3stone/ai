import fs from 'fs';
import path from 'path';
import { ChaseEnv } from './chaseEnv';
import { QLearningAgent } from './qlearning';

// ==== ハイパーパラメータ ====
const EPISODES = 150000; // 状態に速さ倍率が加わり状態数が増える分、多めに学習する
const MAX_STEPS = 300; // これだけ捕まえられなければ打ち切る
const ALPHA = 0.1;
const GAMMA = 0.95;
const EPSILON_START = 1.0;
const EPSILON_MIN = 0.05;
const EPSILON_DECAY = 0.9999; // エピソード数が増えた分、探索期間も伸ばす(ep30000あたりで下限に到達)
const LOG_WINDOW = 100;

// 自己対戦(交互学習): 今のevadeQtable.json(2倍速で学習した逃げるAI)を固定相手にする。
// 速いevaderでも遅いevaderでも柔軟に対応できるよう、evaderの速さをエピソードごとに
// この範囲でランダム化する(状態に速さ自体を含めているので、速さごとに別の状況として学習できる)
const EVADER_SPEED_MIN = 2.0;
const EVADER_SPEED_MAX = 7.0;
// ====================================================

const env = new ChaseEnv();
env.setEvaderSpeedRange(EVADER_SPEED_MIN, EVADER_SPEED_MAX);
const agent = new QLearningAgent(ALPHA, GAMMA);

let epsilon = EPSILON_START;
const recentSteps: number[] = []; // 捕まえるまでの歩数 (捕まえられなければMAX_STEPS)
const recentCaught: number[] = []; // 捕まえられたら1, 逃げ切られたら0

for (let episode = 1; episode <= EPISODES; episode++) {
  let state = env.reset();
  let steps = 0;
  let caught = 0;

  for (; steps < MAX_STEPS; steps++) {
    const action = agent.chooseAction(state, epsilon);
    const { state: nextState, reward, done } = env.step(action);
    agent.update(state, action, reward, nextState);
    state = nextState;
    if (done) {
      caught = 1;
      steps++;
      break;
    }
  }

  recentSteps.push(steps);
  if (recentSteps.length > LOG_WINDOW) recentSteps.shift();
  recentCaught.push(caught);
  if (recentCaught.length > LOG_WINDOW) recentCaught.shift();
  epsilon = Math.max(EPSILON_MIN, epsilon * EPSILON_DECAY);

  if (episode % LOG_WINDOW === 0) {
    const avgSteps = recentSteps.reduce((a, b) => a + b, 0) / recentSteps.length;
    const catchRate = (recentCaught.reduce((a, b) => a + b, 0) / recentCaught.length) * 100;
    console.log(
      `episode ${episode}\tavg捕獲歩数(直近${LOG_WINDOW}): ${avgSteps.toFixed(1)}\t捕獲成功率: ${catchRate.toFixed(1)}%\tepsilon: ${epsilon.toFixed(3)}\tQテーブルの状態数: ${agent.stateCount}`,
    );
  }
}

const qtablePath = path.join(__dirname, 'chaseQtable.json');
fs.writeFileSync(qtablePath, JSON.stringify(agent.toJSON()));
console.log(`Qテーブルを保存しました: ${qtablePath}`);
