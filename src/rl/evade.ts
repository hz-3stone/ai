import fs from 'fs';
import path from 'path';
import { QLearningAgent } from './qlearning';
import { evadeState } from './evadeEnv';

// 学習済みの「逃げるAI」で青(player)を操作する。赤(enemy)は別途 `npm run chase` などで
// 動かしておくこと。学習時と同じ速さ倍率を再現するため、選んだ方向を複数回まとめて
// POST /move する (move.tsの複数文字バッチをそのまま利用)。
const SERVER = 'http://localhost:3000';
const INTERVAL_MS = 100;
const SPEED_RATIO = 7; // 学習時と合わせる (整数のみ対応。trainEvade.tsのSPEED_ENDと揃えること)

const qtablePath = process.argv[2] ? path.resolve(process.argv[2]) : path.join(__dirname, 'evadeQtable.json');
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
  const state = evadeState(px, py, ex, ey);
  const action = agent.chooseAction(state, 0); // epsilon=0: 常に学習済みの最善手
  await fetch(`${SERVER}/move`, { method: 'POST', body: action.repeat(SPEED_RATIO) });
};

console.log(`学習済みの逃げるAI(青)が ${SERVER} で赤から逃げます (Ctrl+Cで停止)`);

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
