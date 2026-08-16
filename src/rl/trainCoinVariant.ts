import fs from 'fs';
import path from 'path';
import { CoinEnv, type CoinEnvOptions } from './coinEnv';
import { QLearningAgent } from './qlearning';

// 「詰み対策」の各実験(反対方向ペナルティ/時間経過ペナルティ/ランダム順番ターゲット)を
// 同じカリキュラム学習パイプラインで試すための共通スクリプト。
// 使い方: npm run train:coin-variant -- <variant名> <CoinEnvOptionsのJSON> [--skip-free-choice]
//
// 例:
//   train:coin-variant -- antiReverse '{"antiReversePenalty":5}'
//   train:coin-variant -- timePenalty '{"timePenaltyScale":0.002}'
//   train:coin-variant -- randomOrder '{"randomOrder":true}' --skip-free-choice
//
// チェックポイント選定はepsilon-greedy中の指標を信用せず、必ずepsilon=0(貪欲方策)での
// 実測クリア率で行う(前回、探索に助けられた見かけ上のクリア率だけを信じて選んだ結果、
// 実際にはベースラインより悪いモデルを「ベスト」として保存してしまった反省を踏まえる)。

const variantName = process.argv[2];
const options: CoinEnvOptions = JSON.parse(process.argv[3] ?? '{}');
const skipFreeChoice = process.argv.includes('--skip-free-choice');
if (!variantName) throw new Error('variant名を指定してください (例: antiReverse)');

console.log(`variant=${variantName} options=${JSON.stringify(options)} skipFreeChoice=${skipFreeChoice}`);

const MAX_STEPS = 800;
const ALPHA = 0.1;
const GAMMA = 0.95;
const LOG_WINDOW = 100;
const EVAL_INTERVAL = 1000;
const EVAL_EPISODES = 200;

const baseQtablePath = path.join(__dirname, 'qtable.json'); // 固定ターゲット1枚取得の学習済みQテーブル(ブートストラップ)
let agent = QLearningAgent.fromJSON(JSON.parse(fs.readFileSync(baseQtablePath, 'utf8')), ALPHA, GAMMA);
console.log(`ブートストラップQテーブルを読み込みました (状態数: ${agent.stateCount})`);

// epsilon=0(貪欲方策)で実測評価する。学習中envとは別のenvを使う(状態を混ぜない)
const evaluateGreedy = (coinCount: number, ordered: boolean): { clearRate: number; avgSteps: number } => {
  const evalEnv = new CoinEnv(coinCount, ordered, options);
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

interface StageConfig {
  label: string;
  coinCount: number;
  ordered: boolean;
  episodes: number;
  epsilonStart: number;
  epsilonMin: number;
}

const runStage = (stage: StageConfig): void => {
  const env = new CoinEnv(stage.coinCount, stage.ordered, options);
  const epsilonDecay = Math.pow(stage.epsilonMin / stage.epsilonStart, 1 / (stage.episodes * 0.8));
  let epsilon = stage.epsilonStart;
  const recentSteps: number[] = [];
  const recentCleared: number[] = [];

  let best: { episode: number; clearRate: number; avgSteps: number; qtable: Record<string, number[]> } | null = null;

  for (let episode = 1; episode <= stage.episodes; episode++) {
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
    epsilon = Math.max(stage.epsilonMin, epsilon * epsilonDecay);

    if (episode % LOG_WINDOW === 0 && recentCleared.length === LOG_WINDOW) {
      const avgSteps = recentSteps.reduce((a, b) => a + b, 0) / recentSteps.length;
      const clearRate = (recentCleared.reduce((a, b) => a + b, 0) / recentCleared.length) * 100;
      console.log(
        `[${stage.label}] episode ${episode}\tavg歩数: ${avgSteps.toFixed(1)}\t学習中クリア率: ${clearRate.toFixed(1)}%\tepsilon: ${epsilon.toFixed(3)}\t状態数: ${agent.stateCount}`,
      );
    }

    if (episode % EVAL_INTERVAL === 0 || episode === stage.episodes) {
      const evalResult = evaluateGreedy(stage.coinCount, stage.ordered);
      console.log(
        `  >> [${stage.label}] [評価] episode ${episode}\tepsilon=0クリア率: ${evalResult.clearRate.toFixed(1)}%\tavg歩数: ${evalResult.avgSteps.toFixed(1)}`,
      );
      const better =
        !best ||
        evalResult.clearRate > best.clearRate ||
        (evalResult.clearRate === best.clearRate && evalResult.avgSteps < best.avgSteps);
      if (better) {
        best = { episode, clearRate: evalResult.clearRate, avgSteps: evalResult.avgSteps, qtable: agent.toJSON() };
      }
    }
  }

  if (!best) throw new Error(`[${stage.label}] ベストスナップショットが記録されませんでした`);
  console.log(
    `[${stage.label}] ベスト: episode ${best.episode} (epsilon=0クリア率${best.clearRate.toFixed(1)}%, avg歩数${best.avgSteps.toFixed(1)})`,
  );
  // 次のステージへはベストスナップショットの状態を引き継ぐ(不安定化した終盤の状態ではなく)
  agent = QLearningAgent.fromJSON(best.qtable, ALPHA, GAMMA);
};

const CURRICULUM_STAGES: StageConfig[] = [
  { label: 'stage1(1枚)', coinCount: 1, ordered: true, episodes: 3000, epsilonStart: 0.3, epsilonMin: 0.05 },
  { label: 'stage2(2枚)', coinCount: 2, ordered: true, episodes: 5000, epsilonStart: 0.5, epsilonMin: 0.05 },
  { label: 'stage3(3枚)', coinCount: 3, ordered: true, episodes: 5000, epsilonStart: 0.5, epsilonMin: 0.05 },
  { label: 'stage4(4枚)', coinCount: 4, ordered: true, episodes: 5000, epsilonStart: 0.5, epsilonMin: 0.05 },
];

for (const stage of CURRICULUM_STAGES) runStage(stage);

const stage4Path = path.join(__dirname, `coinQtable.${variantName}.stage4.json`);
fs.writeFileSync(stage4Path, JSON.stringify(agent.toJSON()));
console.log(`stage4を保存しました: ${stage4Path}`);

if (!skipFreeChoice) {
  runStage({
    label: 'free-choice',
    coinCount: 4,
    ordered: false,
    episodes: 15000,
    epsilonStart: 0.5,
    epsilonMin: 0.05,
  });
}

const outPath = path.join(__dirname, `coinQtable.${variantName}.json`);
fs.writeFileSync(outPath, JSON.stringify(agent.toJSON()));
console.log(`\n最終Qテーブルを保存しました: ${outPath} (状態数: ${agent.stateCount})`);
