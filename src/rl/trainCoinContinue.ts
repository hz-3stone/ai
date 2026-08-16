import fs from 'fs';
import path from 'path';
import { CoinEnv, type CoinEnvOptions } from './coinEnv';
import { QLearningAgent } from './qlearning';

// coinQtable.nearestRescue.json(既に4枚クリア率98%達成済み)からさらに追加学習して、
// 1万エピソード基準でのクリア率100%を目指す。
// state空間が小さく翻訳不変(相対位置バケツのみ、自由選択モードのようなマスクの組み合わせ
// 爆発が無い)なぶん、以前free-choiceモデルで起きた「追加学習するほど悪化する」問題は
// 起きにくいはずだが、必ずepsilon=0の実測評価でチェックポイントを選ぶ(推測に頼らない)。
// 使い方: npm run train:coin-continue -- <inputQtable> <outputName> <episodes> [alpha]
const inputPath = path.resolve(process.argv[2] ?? path.join(__dirname, 'coinQtable.nearestRescue.json'));
const outputName = process.argv[3] ?? 'nearestRescue.continued';
const EPISODES = Number(process.argv[4]) || 20000;
const ALPHA = Number(process.argv[5]) || 0.05;

const OPTIONS: CoinEnvOptions = { nearestOrder: true, stuckRescue: true };
const MAX_STEPS = 800;
const GAMMA = 0.95;
const EPSILON_START = 0.3; // 既に高性能なので、大きく壊さないよう控えめな探索にする
const EPSILON_MIN = 0.05;
const EPSILON_DECAY = Math.pow(EPSILON_MIN / EPSILON_START, 1 / (EPISODES * 0.8));
const LOG_WINDOW = 100;
const EVAL_INTERVAL = 1000;
const EVAL_EPISODES = 300; // 100%に近い実力を見たいので少し多めにする

const agent = QLearningAgent.fromJSON(JSON.parse(fs.readFileSync(inputPath, 'utf8')), ALPHA, GAMMA);
console.log(`読み込み: ${inputPath} (状態数: ${agent.stateCount}) alpha=${ALPHA} episodes=${EPISODES}`);

const env = new CoinEnv(4, true, OPTIONS);

const evaluateGreedy = (): { clearRate: number; avgSteps: number } => {
  const evalEnv = new CoinEnv(4, true, OPTIONS);
  let clearedCount = 0;
  let totalSteps = 0;
  for (let i = 0; i < EVAL_EPISODES; i++) {
    let state = evalEnv.reset();
    let steps = 0;
    for (; steps < MAX_STEPS; steps++) {
      const action = agent.chooseAction(state, 0);
      const { state: nextState, done } = evalEnv.step(action);
      state = nextState;
      if (done) {
        clearedCount++;
        steps++;
        break;
      }
    }
    totalSteps += steps;
  }
  return { clearRate: (clearedCount / EVAL_EPISODES) * 100, avgSteps: totalSteps / EVAL_EPISODES };
};

// 開始時点の実力を記録しておく(改善したかどうかの基準にする)
const startEval = evaluateGreedy();
console.log(`開始時点のepsilon=0クリア率: ${startEval.clearRate.toFixed(1)}% avg歩数: ${startEval.avgSteps.toFixed(1)}`);

let epsilon = EPSILON_START;
const recentSteps: number[] = [];
const recentCleared: number[] = [];

let best: { episode: number; clearRate: number; avgSteps: number; qtable: Record<string, number[]> } = {
  episode: 0,
  clearRate: startEval.clearRate,
  avgSteps: startEval.avgSteps,
  qtable: agent.toJSON(),
};

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
      `episode ${episode}\tavg歩数: ${avgSteps.toFixed(1)}\t学習中クリア率: ${clearRate.toFixed(1)}%\tepsilon: ${epsilon.toFixed(3)}\t状態数: ${agent.stateCount}`,
    );
  }

  if (episode % EVAL_INTERVAL === 0 || episode === EPISODES) {
    const evalResult = evaluateGreedy();
    console.log(
      `  >> [評価] episode ${episode}\tepsilon=0クリア率: ${evalResult.clearRate.toFixed(1)}%\tavg歩数: ${evalResult.avgSteps.toFixed(1)}`,
    );
    const better =
      evalResult.clearRate > best.clearRate ||
      (evalResult.clearRate === best.clearRate && evalResult.avgSteps < best.avgSteps);
    if (better) {
      best = { episode, clearRate: evalResult.clearRate, avgSteps: evalResult.avgSteps, qtable: agent.toJSON() };
    }
  }
}

console.log(
  `\nベスト: episode ${best.episode} (epsilon=0クリア率${best.clearRate.toFixed(1)}%, avg歩数${best.avgSteps.toFixed(1)}) — 開始時点(${startEval.clearRate.toFixed(1)}%)と比較`,
);

const outPath = path.join(__dirname, `coinQtable.${outputName}.json`);
fs.writeFileSync(outPath, JSON.stringify(best.qtable));
console.log(`保存しました: ${outPath}`);
