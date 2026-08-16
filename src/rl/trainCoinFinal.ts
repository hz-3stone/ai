import fs from 'fs';
import path from 'path';
import { CoinEnv } from './coinEnv';
import { QLearningAgent } from './qlearning';

// trainCoin.tsが作ったcoinQtable.stage4.json(コイン4枚を順番指定で回収できる状態)から続けて、
// 「順番を教えずに自分で選ぶ」最終段階だけを学習する。この段階は状態が変わる(残りマスクが
// 増える)ぶん学習が不安定で、そのまま最後まで回すと終盤にクリア率が悪化することが分かった
// (ピークより弱い状態でエピソードが尽きて終わってしまう)。
// 対策として、学習中の「直近100エピソードのクリア率」が一番良かった時点のQテーブルを
// スナップショットとして覚えておき、最終的にはそれを保存する(最後の状態を無条件には使わない)。
//
// episodes/alphaを変えた複数パターンを並列に試して比較するため、この2つはCLI引数で渡す。
// 使い方: npm run train:coin-final -- <episodes> <alpha>
const EPISODES = Number(process.argv[2]) || 5000;
const ALPHA = Number(process.argv[3]) || 0.1;

const MAX_STEPS = 800;
const GAMMA = 0.95;
const EPSILON_START = 0.8; // 新しい状態(残りマスク)が増えるので探索を厚めに
const EPSILON_MIN = 0.05;
// EPISODESに合わせて、8割進んだあたりでEPSILON_MINに到達するよう自動計算する
const EPSILON_DECAY = Math.pow(EPSILON_MIN / EPSILON_START, 1 / (EPISODES * 0.8));
const LOG_WINDOW = 100;

const stage4Path = path.join(__dirname, 'coinQtable.stage4.json');
const agent = QLearningAgent.fromJSON(JSON.parse(fs.readFileSync(stage4Path, 'utf8')), ALPHA, GAMMA);
console.log(`episodes=${EPISODES} alpha=${ALPHA} で開始 (状態数: ${agent.stateCount})`);

const env = new CoinEnv(4, false); // 4枚・自分で判断

let epsilon = EPSILON_START;
const recentSteps: number[] = [];
const recentCleared: number[] = [];

// 「直近100エピソードのクリア率」が最良だった時点のQテーブルを保持する。
// 同率なら平均歩数が短い(=効率が良い)方を優先する
let best: { episode: number; clearRate: number; avgSteps: number; qtable: Record<string, number[]> } | null = null;

for (let episode = 1; episode <= EPISODES; episode++) {
  let state = env.reset();
  let steps = 0;
  let cleared = 0;

  for (; steps < MAX_STEPS; steps++) {
    const action = agent.chooseAction(state, epsilon);
    const { state: nextState, reward, done } = env.step(action);
    agent.update(state, action, reward, nextState);
    state = nextState;
    if (done) {
      cleared = 1;
      steps++;
      break;
    }
  }

  recentSteps.push(steps);
  if (recentSteps.length > LOG_WINDOW) recentSteps.shift();
  recentCleared.push(cleared);
  if (recentCleared.length > LOG_WINDOW) recentCleared.shift();
  epsilon = Math.max(EPSILON_MIN, epsilon * EPSILON_DECAY);

  if (episode % LOG_WINDOW === 0 && recentCleared.length === LOG_WINDOW) {
    const avgSteps = recentSteps.reduce((a, b) => a + b, 0) / recentSteps.length;
    const clearRate = (recentCleared.reduce((a, b) => a + b, 0) / recentCleared.length) * 100;
    console.log(
      `[e${EPISODES}/a${ALPHA}] episode ${episode}\tavg歩数(直近${LOG_WINDOW}): ${avgSteps.toFixed(1)}\tクリア率: ${clearRate.toFixed(1)}%\tepsilon: ${epsilon.toFixed(3)}\tQテーブルの状態数: ${agent.stateCount}`,
    );

    const better =
      !best || clearRate > best.clearRate || (clearRate === best.clearRate && avgSteps < best.avgSteps);
    if (better) {
      best = { episode, clearRate, avgSteps, qtable: agent.toJSON() };
    }
  }
}

if (!best) throw new Error('ベストスナップショットが記録されませんでした(EPISODESがLOG_WINDOW未満?)');

const outPath = path.join(__dirname, `coinQtable.e${EPISODES}.a${ALPHA}.json`);
fs.writeFileSync(outPath, JSON.stringify(best.qtable));
console.log(
  `\n[e${EPISODES}/a${ALPHA}] ベスト: episode ${best.episode} (クリア率${best.clearRate.toFixed(1)}%, avg歩数${best.avgSteps.toFixed(1)})`,
);
console.log(`Qテーブルを保存しました: ${outPath}`);
