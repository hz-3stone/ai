import fs from 'fs';
import path from 'path';
import { ChaseEnv } from './chaseEnv';
import { QLearningAgent } from './qlearning';

// 既存のchaseQtable.jsonを読み込み、そこから続きで学習する「追加学習」スクリプト。
// ゼロから学習し直すのではなく、苦手だった状況(壁際・角)の出現確率を上げることで
// そこだけ重点的に経験を積ませる。学習の幅そのものは狭めない(全方位からの
// スタートも一定確率で残す)ので、「一見悪手に見える手」を締め出すことはない。

// ==== ハイパーパラメータ ====
const EPISODES = 50000;
const MAX_STEPS = 600; // trainChase.tsと揃える(コイン全回収には複数セルの移動が必要なため)
const ALPHA = 0.1;
const GAMMA = 0.95;
const EPSILON_START = 0.4; // 既存の学習を大きく壊さないよう、ゼロからの学習より控えめにする
const EPSILON_MIN = 0.05;
const EPSILON_DECAY = 0.9998;
const LOG_WINDOW = 100;

const EVADER_SPEED_MIN = 2.0;
const EVADER_SPEED_MAX = 7.0;
const NEAR_WALL_PROBABILITY = 0.7; // x/y軸それぞれこの確率で壁際スタートにする(角になる確率は0.7^2=49%)
// ====================================================

const chaseQtablePath = path.join(__dirname, 'chaseQtable.json');
const existing = JSON.parse(fs.readFileSync(chaseQtablePath, 'utf8'));
const agent = QLearningAgent.fromJSON(existing, ALPHA, GAMMA); // alpha/gammaを指定して学習を再開する
console.log(`既存のQテーブルを読み込みました (状態数: ${agent.stateCount})`);

const env = new ChaseEnv();
env.setEvaderSpeedRange(EVADER_SPEED_MIN, EVADER_SPEED_MAX);
env.setChaserNearWallProbability(NEAR_WALL_PROBABILITY);

let epsilon = EPSILON_START;
const recentSteps: number[] = [];
const recentCaught: number[] = [];
const recentCleared: number[] = []; // evaderが全コイン回収でクリアしたら1、それ以外は0

for (let episode = 1; episode <= EPISODES; episode++) {
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
      steps++;
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
    console.log(
      `episode ${episode}\tavg決着歩数(直近${LOG_WINDOW}): ${avgSteps.toFixed(1)}\t捕獲成功率: ${catchRate.toFixed(1)}%\tクリア(敗北)率: ${clearRate.toFixed(1)}%\tepsilon: ${epsilon.toFixed(3)}\tQテーブルの状態数: ${agent.stateCount}`,
    );
  }
}

fs.writeFileSync(chaseQtablePath, JSON.stringify(agent.toJSON()));
console.log(`Qテーブルを保存しました: ${chaseQtablePath} (状態数: ${agent.stateCount})`);
