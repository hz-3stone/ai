import fs from 'fs';
import path from 'path';
import { CoinEnv, type CoinEnvOptions } from './coinEnv';
import { QLearningAgent } from './qlearning';

// 4つの「詰み対策」実験を横並びで比較するための共通評価ハーネス。
// epsilon=0(貪欲方策、本番と同じ)でランダム局面をN回走らせ、クリア率とavg歩数を出すだけ。
// CoinEnvOptionsを変えるだけで、追加学習なしの案(stuckRescue)もそのまま評価できる。
export const evaluateCoinPolicy = (
  qtablePath: string,
  coinCount: number,
  ordered: boolean,
  options: CoinEnvOptions,
  episodes: number,
  maxSteps: number,
): { clearRate: number; avgSteps: number } => {
  const qtable = JSON.parse(fs.readFileSync(qtablePath, 'utf8'));
  const agent = QLearningAgent.fromJSON(qtable);
  const env = new CoinEnv(coinCount, ordered, options);

  let clearedCount = 0;
  let totalSteps = 0;
  for (let i = 0; i < episodes; i++) {
    let state = env.reset();
    let steps = 0;
    for (; steps < maxSteps; steps++) {
      const action = agent.chooseAction(state, 0);
      const { state: nextState, done } = env.step(action);
      state = nextState;
      if (done) {
        clearedCount++;
        steps++;
        break;
      }
    }
    totalSteps += steps;
  }
  return { clearRate: (clearedCount / episodes) * 100, avgSteps: totalSteps / episodes };
};

// CLIから直接実行した場合: 指定したQテーブル+オプションで評価だけ行う
// 使い方: eval:coin -- <qtablePath> <optionsJSON> [episodes] [maxSteps] [ordered] [coinCount]
if (require.main === module) {
  const qtablePath = path.resolve(process.argv[2] ?? path.join(__dirname, 'coinQtable.json'));
  const optionsArg = process.argv[3] ? JSON.parse(process.argv[3]) : {};
  const episodes = Number(process.argv[4]) || 10000;
  const maxSteps = Number(process.argv[5]) || 1000;
  const ordered = process.argv[6] === 'true';
  const coinCount = Number(process.argv[7]) || 4;
  console.log(`Qテーブル: ${qtablePath}`);
  console.log(`オプション: ${JSON.stringify(optionsArg)} ordered=${ordered} coinCount=${coinCount}`);
  const result = evaluateCoinPolicy(qtablePath, coinCount, ordered, optionsArg, episodes, maxSteps);
  console.log(
    `${episodes}エピソード中: クリア率 ${result.clearRate.toFixed(2)}% / avg歩数 ${result.avgSteps.toFixed(1)}`,
  );
}
