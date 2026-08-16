import fs from 'fs';
import path from 'path';
import { EvadeEnv } from './evadeEnv';
import { QLearningAgent } from './qlearning';

// ==== ハイパーパラメータ (ここをいじって実験する) ====
const EPISODES = 10000; // 2倍速は学習が不安定になりやすいので、7倍速の時より多めにする
const MAX_STEPS = 600; // コイン全回収には複数セルの移動が必要なため、300だとクリアがほぼ発生しない
const ALPHA = 0.1;
const GAMMA = 0.95;
const EPSILON_START = 1.0;
const EPSILON_MIN = 0.05;
const EPSILON_DECAY = 0.998;
const LOG_WINDOW = 100;

// 本番想定の2倍速で学習する。7倍速は「まず動くところまで仕上げる」ための足がかりとして
// 先に仕上げ済み(evadeQtable.jsonは一旦上書きされる。必要なら学習前に別名で退避すること)。
// SPEED_START/ENDを変えればカリキュラム(徐々に難化)にも戻せる
const SPEED_START = 2.0;
const SPEED_END = 2.0;
// ====================================================

const env = new EvadeEnv();
const agent = new QLearningAgent(ALPHA, GAMMA);

let epsilon = EPSILON_START;
const recentSteps: number[] = []; // 生き延びた歩数 (決着しなければMAX_STEPS)
const recentCaught: number[] = []; // 捕まったら1、それ以外は0
const recentCleared: number[] = []; // 全コイン回収でクリアしたら1、それ以外は0

for (let episode = 1; episode <= EPISODES; episode++) {
  const progress = (episode - 1) / (EPISODES - 1); // 0 -> 1
  env.setRunnerSpeedRatio(SPEED_START + (SPEED_END - SPEED_START) * progress);

  let state = env.reset();
  let steps = 0;
  let caught = 0;
  let cleared = 0;

  for (; steps < MAX_STEPS; steps++) {
    const action = agent.chooseAction(state, epsilon);
    const { state: nextState, reward, done, outcome } = env.step(action);
    agent.update(state, action, reward, nextState);
    state = nextState;
    if (done) {
      if (outcome === 'caught') caught = 1;
      if (outcome === 'cleared') cleared = 1;
      steps++; // 決着したこの1歩分もカウントする
      break;
    }
  }

  recentSteps.push(steps);
  if (recentSteps.length > LOG_WINDOW) recentSteps.shift();
  recentCaught.push(caught);
  if (recentCaught.length > LOG_WINDOW) recentCaught.shift();
  recentCleared.push(cleared);
  if (recentCleared.length > LOG_WINDOW) recentCleared.shift();
  epsilon = Math.max(EPSILON_MIN, epsilon * EPSILON_DECAY);

  if (episode % LOG_WINDOW === 0) {
    const avgSteps = recentSteps.reduce((a, b) => a + b, 0) / recentSteps.length;
    const catchRate = (recentCaught.reduce((a, b) => a + b, 0) / recentCaught.length) * 100;
    const clearRate = (recentCleared.reduce((a, b) => a + b, 0) / recentCleared.length) * 100;
    const speedRatio = SPEED_START + (SPEED_END - SPEED_START) * progress;
    console.log(
      `episode ${episode}\t速さ倍率: ${speedRatio.toFixed(2)}\tavg生存歩数(直近${LOG_WINDOW}): ${avgSteps.toFixed(1)}\t捕獲率: ${catchRate.toFixed(1)}%\tクリア率: ${clearRate.toFixed(1)}%\tepsilon: ${epsilon.toFixed(3)}\tQテーブルの状態数: ${agent.stateCount}`,
    );
  }
}

const qtablePath = path.join(__dirname, 'evadeQtable.json');
fs.writeFileSync(qtablePath, JSON.stringify(agent.toJSON()));
console.log(`Qテーブルを保存しました: ${qtablePath}`);
