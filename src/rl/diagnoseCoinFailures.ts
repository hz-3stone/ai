import fs from 'fs';
import path from 'path';
import type { Coin } from '../coins';
import { CoinEnv, type CoinEnvOptions } from './coinEnv';
import { QLearningAgent } from './qlearning';

// 残り約0.3〜0.5%の失敗が何なのかを直接調べる。MAX_STEPS以内にクリアしなかった
// エピソードの初期局面とトレースを記録する
const qtablePath = path.resolve(process.argv[2] ?? path.join(__dirname, 'coinQtable.nearestRescue.continued2.json'));
const OPTIONS: CoinEnvOptions = { nearestOrder: true, stuckRescue: true };
const EPISODES = 10000;
const MAX_STEPS = 1000;

const agent = QLearningAgent.fromJSON(JSON.parse(fs.readFileSync(qtablePath, 'utf8')));
const env = new CoinEnv(4, true, OPTIONS);

let failCount = 0;
const failures: { coins: Coin[]; runnerX: number; runnerY: number }[] = [];

for (let episode = 1; episode <= EPISODES; episode++) {
  let state = env.reset();
  const scenario = env.snapshot();
  let cleared = false;
  for (let steps = 0; steps < MAX_STEPS; steps++) {
    const action = agent.chooseAction(state, 0);
    const { state: nextState, done } = env.step(action);
    state = nextState;
    if (done) {
      cleared = true;
      break;
    }
  }
  if (!cleared) {
    failCount++;
    if (failures.length < 20) failures.push(scenario);
  }
}

console.log(`${EPISODES}エピソード中の失敗: ${failCount}件 (${((failCount / EPISODES) * 100).toFixed(2)}%)`);
fs.writeFileSync(path.join(__dirname, 'coinFailures.json'), JSON.stringify(failures));
console.log(`失敗シナリオ(最大20件)を保存: coinFailures.json`);
