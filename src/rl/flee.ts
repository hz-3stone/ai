import fs from 'fs';
import path from 'path';
import { QLearningAgent } from './qlearning';
import { relativeState } from './env';

// 学習済みQテーブルをそのまま流用して、赤(enemy)を青(player)から逃げさせる。
// このQテーブルは「ターゲットに近づく」方策しか学習していないが、
// 実際の相対位置の符号を反転させて渡すと、エージェントは「反対側にいる
// (架空の)ターゲットに近づこう」とする。それは結果的に本物のplayerから
// 遠ざかる方向と一致するため、再学習なしでそのまま「逃げる」挙動が作れる。
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
  const state = relativeState(ex - px, ey - py); // 符号を反転 (本来は px-ex, py-ey)
  const action = agent.chooseAction(state, 0); // epsilon=0: 常に学習済みの最善手
  await fetch(`${SERVER}/move-enemy`, { method: 'POST', body: action });
};

console.log(`学習済みエージェント(赤)が ${SERVER} でプレイヤーから逃げます (Ctrl+Cで停止)`);

// 前のtickの完了を待ってから次を予約する自己再帰ループ (setIntervalだとリクエストが積み重なるため)
const loop = async (): Promise<void> => {
  await tick().catch((err) => console.error(err));
  setTimeout(loop, INTERVAL_MS);
};
loop();
