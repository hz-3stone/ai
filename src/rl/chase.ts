import fs from 'fs';
import path from 'path';
import { QLearningAgent } from './qlearning';
import { chaseState } from './chaseEnv';

// 学習済みQテーブルで赤(enemy)に青(player)を追いかけさせる。
// デフォルトはchaseQtable.json (evaderの速さ2〜7倍をランダム化しながら自己対戦で
// 鍛え直したchaser。状態に相手の速さも含むため、速い/遅いどちらの相手にも対応できる)。
// 状態表現が異なるため、元のqtable.jsonを渡しても正しく動作しない。
// 第2引数で「今playerが何倍速で動いているか」を伝える(自動検出はしていない。
// evade.tsに渡した速さ倍率と揃えること。省略時は2)。
// 事前に `npm start` でサーバーを立ち上げ、ブラウザで http://localhost:3000 を開いておくこと。
const SERVER = 'http://localhost:3000';
const INTERVAL_MS = 100;
const PLAYER_SPEED_RATIO = process.argv[3] ? Number(process.argv[3]) : 2;

const qtablePath = process.argv[2] ? path.resolve(process.argv[2]) : path.join(__dirname, 'chaseQtable.json');
const qtable = JSON.parse(fs.readFileSync(qtablePath, 'utf8'));
const agent = QLearningAgent.fromJSON(qtable);
console.log(`Qテーブル: ${qtablePath} (想定するplayerの速さ倍率: ${PLAYER_SPEED_RATIO})`);

const parseState = (text: string) => {
  const [px, py, ex, ey] = text.split(',').map(Number);
  return { px, py, ex, ey };
};

const tick = async (): Promise<void> => {
  const res = await fetch(`${SERVER}/state`);
  const { px, py, ex, ey } = parseState(await res.text());
  // enemy(自分)の壁との距離 + playerとの相対位置 + playerの速さ倍率
  const state = chaseState(ex, ey, px, py, PLAYER_SPEED_RATIO);
  const action = agent.chooseAction(state, 0); // epsilon=0: 常に学習済みの最善手
  await fetch(`${SERVER}/move-enemy`, { method: 'POST', body: action });
};

console.log(`学習済みエージェント(赤)が ${SERVER} でプレイヤーを追いかけます (Ctrl+Cで停止)`);

// 前のtickの完了を待ってから次を予約する自己再帰ループ (setIntervalだとリクエストが積み重なるため)
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
