import fs from 'fs';
import path from 'path';
import type { Coin } from '../coins';
import { CoinEnv, type CoinEnvOptions } from './coinEnv';
import { QLearningAgent } from './qlearning';

const qtablePath = path.join(__dirname, 'coinQtable.nearestRescue.continued2.json');
const OPTIONS: CoinEnvOptions = { nearestOrder: true, stuckRescue: true };
const agent = QLearningAgent.fromJSON(JSON.parse(fs.readFileSync(qtablePath, 'utf8')));

const failures: { coins: Coin[]; runnerX: number; runnerY: number }[] = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'coinFailures.json'), 'utf8'),
);

const index = Number(process.argv[2]) || 0;
const f = failures[index];
console.log(`シナリオ${index}:`, JSON.stringify(f));

const env = new CoinEnv(4, true, OPTIONS);
let state = env.loadScenario(f.coins, f.runnerX, f.runnerY);
const seen = new Map<string, number>();
for (let steps = 0; steps < 300; steps++) {
  const action = agent.chooseAction(state, 0);
  const { state: nextState, done } = env.step(action);
  const snap = env.snapshot();
  const key = `${snap.runnerX},${snap.runnerY}`;
  const repeatCount = (seen.get(key) ?? 0) + 1;
  seen.set(key, repeatCount);
  if (steps < 40 || repeatCount > 1) {
    console.log(steps, 'state=', state, 'action=', action, 'next=', nextState, 'pos=', key, 'repeat=', repeatCount, 'done=', done);
  }
  state = nextState;
  if (done) {
    console.log('クリアしました');
    break;
  }
}
