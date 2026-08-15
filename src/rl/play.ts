import fs from 'fs';
import path from 'path';
import { QLearningAgent } from './qlearning';
import { relativeState } from './env';

// 学習済みQテーブルを使って、動いている move.ts サーバーの circle を実際に動かす。
// 事前に `npm start` でサーバーを立ち上げ、ブラウザで http://localhost:3000 を開いておくこと。
const SERVER = 'http://localhost:3000';
const INTERVAL_MS = 100;

const qtablePath = path.join(__dirname, 'qtable.json');
const qtable = JSON.parse(fs.readFileSync(qtablePath, 'utf8'));
const agent = QLearningAgent.fromJSON(qtable);

const parseState = (text: string) => {
  const [cx, cy, tx, ty] = text.split(',').map(Number);
  return { cx, cy, tx, ty };
};

const tick = async (): Promise<void> => {
  const res = await fetch(`${SERVER}/state`);
  const { cx, cy, tx, ty } = parseState(await res.text());
  const state = relativeState(tx - cx, ty - cy);
  const action = agent.chooseAction(state, 0); // epsilon=0: 常に学習済みの最善手
  await fetch(`${SERVER}/move`, { method: 'POST', body: action });
};

console.log(`学習済みエージェントが ${SERVER} のcircleを操作します (Ctrl+Cで停止)`);
setInterval(() => {
  tick().catch((err) => console.error(err));
}, INTERVAL_MS);
