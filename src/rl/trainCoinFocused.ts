import fs from 'fs';
import path from 'path';
import type { Coin } from '../coins';
import { CoinEnv } from './coinEnv';
import { QLearningAgent } from './qlearning';

// findCoinStuckScenarios.tsが見つけた「詰みパターン」を重点的に再現させて追加学習する。
// 苦手な局面「だけ」を延々とやらせると他の場面で退化する恐れがあるため、
// 一定確率でしか詰みパターンを使わず、残りは普通のランダム局面のままにして
// 全体の実力は落とさずに苦手な穴だけを埋める。
//
// 重要: チェックポイント選定にepsilon-greedy(探索込み)の学習中クリア率を使うと、
// 探索に助けられて実際より良く見えてしまい、実力が落ちていても気づけない
// (最初の実行で実際に起きた: 学習中98%→本番相当のepsilon=0評価では35%だった)。
// そのため一定間隔で完全にランダムな局面からepsilon=0(貪欲方策)で評価し、
// その結果が一番良かった時点のQテーブルだけを採用する。
const EPISODES = 15000;
const MAX_STEPS = 800;
const ALPHA = 0.05; // 前回の比較実験で一番安定した値を踏襲する
const GAMMA = 0.95;
const EPSILON_START = 0.5;
const EPSILON_MIN = 0.05;
const EPSILON_DECAY = Math.pow(EPSILON_MIN / EPSILON_START, 1 / (EPISODES * 0.8));
const LOG_WINDOW = 100;
const STUCK_PROBABILITY = 0.3; // 詰みパターンに寄せすぎて全体の実力を壊さないよう控えめにする

const EVAL_INTERVAL = 1000; // このエピソード数ごとに、探索なし(epsilon=0)の実力を測る
const EVAL_EPISODES = 200; // 評価はランダム局面のみ(詰みパターンには寄せない、本番相当の指標にするため)

const qtablePath = path.join(__dirname, 'coinQtable.json');
const agent = QLearningAgent.fromJSON(JSON.parse(fs.readFileSync(qtablePath, 'utf8')), ALPHA, GAMMA);
console.log(`既存のQテーブルを読み込みました (状態数: ${agent.stateCount})`);

const scenarios: { coins: Coin[]; runnerX: number; runnerY: number }[] = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'coinStuckScenarios.json'), 'utf8'),
);
console.log(`詰みパターン: ${scenarios.length}件`);

const env = new CoinEnv(4, false);
const evalEnv = new CoinEnv(4, false); // 学習中のenvと状態を混ぜないよう評価専用に分ける

const evaluateGreedy = (): { clearRate: number; avgSteps: number } => {
  let clearedCount = 0;
  let totalSteps = 0;
  for (let i = 0; i < EVAL_EPISODES; i++) {
    let state = evalEnv.reset();
    let steps = 0;
    for (; steps < MAX_STEPS; steps++) {
      const action = agent.chooseAction(state, 0); // epsilon=0: 本番と同じ貪欲方策
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

let epsilon = EPSILON_START;
const recentSteps: number[] = [];
const recentCleared: number[] = [];

let best: { episode: number; clearRate: number; avgSteps: number; qtable: Record<string, number[]> } | null = null;

for (let episode = 1; episode <= EPISODES; episode++) {
  const fromStuck = Math.random() < STUCK_PROBABILITY;
  let state: string;
  if (fromStuck) {
    const s = scenarios[(Math.random() * scenarios.length) | 0];
    state = env.loadScenario(s.coins, s.runnerX, s.runnerY);
  } else {
    state = env.reset();
  }

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
      `episode ${episode}\tavg歩数(直近${LOG_WINDOW}): ${avgSteps.toFixed(1)}\t学習中クリア率(epsilon込み): ${clearRate.toFixed(1)}%\tepsilon: ${epsilon.toFixed(3)}\tQテーブルの状態数: ${agent.stateCount}`,
    );
  }

  if (episode % EVAL_INTERVAL === 0) {
    const { clearRate: evalClearRate, avgSteps: evalAvgSteps } = evaluateGreedy();
    console.log(
      `  >> [評価] episode ${episode}\tepsilon=0でのクリア率: ${evalClearRate.toFixed(1)}%\tavg歩数: ${evalAvgSteps.toFixed(1)}`,
    );
    const better =
      !best || evalClearRate > best.clearRate || (evalClearRate === best.clearRate && evalAvgSteps < best.avgSteps);
    if (better) {
      best = { episode, clearRate: evalClearRate, avgSteps: evalAvgSteps, qtable: agent.toJSON() };
    }
  }
}

if (!best) throw new Error('ベストスナップショットが記録されませんでした');

const outPath = path.join(__dirname, 'coinQtable.focused.json');
fs.writeFileSync(outPath, JSON.stringify(best.qtable));
console.log(
  `\nベスト: episode ${best.episode} (epsilon=0クリア率${best.clearRate.toFixed(1)}%, avg歩数${best.avgSteps.toFixed(1)})`,
);
console.log(`Qテーブルを保存しました: ${outPath}`);
