import fs from 'fs';
import path from 'path';
import { QLearningAgent } from './qlearning';
import { evadeState } from './evadeEnv';

// 学習済みQテーブルで赤(enemy)に青(player)を追いかけさせる。
// デフォルトはchaseQtable.json (evadeQtable.jsonの7倍速evaderを固定相手に自己対戦で
// 鍛え直したchaser)。元のqtable.json (静止ターゲットに近づく方策) を試したい場合は
// 引数で明示的に指定すること — ただし状態表現(壁情報の有無)が異なるため、
// qtable.jsonを渡すと状態が噛み合わず正しく動作しない。
// 事前に `npm start` でサーバーを立ち上げ、ブラウザで http://localhost:3000 を開いておくこと。
const SERVER = 'http://localhost:3000';
const INTERVAL_MS = 100;

const qtablePath = process.argv[2] ? path.resolve(process.argv[2]) : path.join(__dirname, 'chaseQtable.json');
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
  const state = evadeState(ex, ey, px, py); // enemy(自分)の壁との距離 + playerとの相対位置
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
