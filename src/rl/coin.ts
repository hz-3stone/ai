import fs from 'fs';
import path from 'path';
import type { Coin } from '../coins';
import { OrderedCoinTracker } from './coinEnv';
import { QLearningAgent } from './qlearning';

// 学習済みの「コイン回収AI」で青(player)を操作する。鬼(enemy)は動かさない
// (このQテーブルは鬼が一切いない環境で学習したもの)。
// 事前に `npm start` でサーバーを立ち上げ、ブラウザで http://localhost:3000 を開いておくこと。
// 最近傍固定順(狙う順番を最初に決めたら走行中は変えない)+詰み対策(順番入れ替え/仮目印。
// 移動そのものは常にQテーブル任せ)で、1万エピソード基準クリア率99.99〜100%を達成した方式
const SERVER = 'http://localhost:3000';
const INTERVAL_MS = 100;

const qtablePath = process.argv[2] ? path.resolve(process.argv[2]) : path.join(__dirname, 'coinQtable.json');
const qtable = JSON.parse(fs.readFileSync(qtablePath, 'utf8'));
const agent = QLearningAgent.fromJSON(qtable);
console.log(`Qテーブル: ${qtablePath}`);

const tracker = new OrderedCoinTracker();

const parseState = (text: string): { px: number; py: number; coins: Coin[] } => JSON.parse(text);

const tick = async (): Promise<void> => {
  const res = await fetch(`${SERVER}/state`);
  const { px, py, coins } = parseState(await res.text());
  const state = tracker.next(px, py, coins);
  if (state === 'cleared') return; // 次のコインが生成されるまで待つ
  const action = agent.chooseAction(state, 0); // epsilon=0: 常に学習済みの最善手
  await fetch(`${SERVER}/move`, { method: 'POST', body: action });
};

console.log(`学習済みのコイン回収AI(青)が ${SERVER} でコインを集めます (Ctrl+Cで停止)`);

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
