import fs from 'fs';
import path from 'path';
import { ChaseEnv } from './chaseEnv';
import { QLearningAgent } from './qlearning';

// カリキュラム学習の第1段階: evaderを動かさず、「見つけて捕まえる」だけを学ばせる。
// いきなり回避してくる相手を追わせるのは難易度が高すぎたため、まずは索敵+接近という
// 基礎動作をここでゼロから学習し、chaseQtable.jsonの出発点にする。
// (次の段階では、このQテーブルをtrainChaseFocused.tsのように読み込んで続きから
// 動く相手に慣れさせていく想定)

// ==== ハイパーパラメータ ====
const EPISODES = 20000; // 相手が動かないぶん単純なので、本番(150000)より少なめでよい
const MAX_STEPS = 300;
const ALPHA = 0.1;
const GAMMA = 0.95;
const EPSILON_START = 1.0;
const EPSILON_MIN = 0.05;
const EPSILON_DECAY = 0.9998; // ep16000あたりで下限に到達
const LOG_WINDOW = 100;
// ====================================================

const env = new ChaseEnv();
env.setEvaderStationary(true);
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
