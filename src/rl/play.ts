import fs from 'fs';
import path from 'path';
import { QLearningAgent } from './qlearning';
import { relativeState } from './env';

// 学習済みQテーブルを使って、動いている move.ts サーバーの circle を実際に動かす。
// 事前に `npm start` でサーバーを立ち上げ、ブラウザで http://localhost:3000 を開いておくこと。
// 第1引数でQテーブルのパスを指定できる (省略時は qtable.json)。例: npm run play -- src/rl/snapshots/alpha-0.5-ep300.json
const SERVER = 'http://localhost:3000';
const INTERVAL_MS = 100;

const qtablePath = process.argv[2] ? path.resolve(process.argv[2]) : path.join(__dirname, 'qtable.json');
const qtable = JSON.parse(fs.readFileSync(qtablePath, 'utf8'));
const agent = QLearningAgent.fromJSON(qtable);
console.log(`Qテーブル: ${qtablePath}`);

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

// setIntervalだと前回のtickが終わる前に次が発火し、通信が詰まった際にリクエストが
// 無限に積み重なってしまう。前のtickの完了を待ってから次を予約する自己再帰ループにする。
let warned = false;
const loop = async (): Promise<void> => {
  await tick().catch((err) => {
    if (!warned) {
      warned = true;
      console.error(`${SERVER} に接続できません。別ターミナルで先に \`npm start\` を実行してください。`, err);
    }
  });
  setTimeout(loop, INTERVAL_MS);
};
loop();
