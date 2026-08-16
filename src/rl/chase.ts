import fs from 'fs';
import path from 'path';
import { QLearningAgent } from './qlearning';
import { relativeState } from './env';

// 学習済みQテーブルをそのまま流用して、赤(enemy)に青(player)を追いかけさせる。
// このQテーブルは「静止したターゲットに近づく」ために学習したものであり、
// 動くプレイヤーを追いかける訓練は一切していない。そのままでどう動くかを見るための実験。
// 事前に `npm start` でサーバーを立ち上げ、ブラウザで http://localhost:3000 を開いておくこと。
// 第1引数でQテーブルのパスを指定できる (省略時は qtable.json)。
const SERVER = 'http://localhost:3000';
const INTERVAL_MS = 100;

const qtablePath = process.argv[2] ? path.resolve(process.argv[2]) : path.join(__dirname, 'qtable.json');
const qtable = JSON.parse(fs.readFileSync(qtablePath, 'utf8'));
const agent = QLearningAgent.fromJSON(qtable);
console.log(`Qテーブル: ${qtablePath}`);

const parseState = (text: string) => {
  const [px, py, ex, ey] = text.split(',').map(Number);
  return { px, py, ex, ey };
};

const tick = async (): Promise<void> => {
  const res = await fetch(`${SERVER}/state`);
  const { px, py, ex, ey } = parseState(await res.text());
  const state = relativeState(px - ex, py - ey); // enemyから見た「プレイヤーとの相対位置」
  const action = agent.chooseAction(state, 0); // epsilon=0: 常に学習済みの最善手
  await fetch(`${SERVER}/move-enemy`, { method: 'POST', body: action });
};

console.log(`学習済みエージェント(赤)が ${SERVER} でプレイヤーを追いかけます (Ctrl+Cで停止)`);

// 前のtickの完了を待ってから次を予約する自己再帰ループ (setIntervalだとリクエストが積み重なるため)
const loop = async (): Promise<void> => {
  await tick().catch((err) => console.error(err));
  setTimeout(loop, INTERVAL_MS);
};
loop();
