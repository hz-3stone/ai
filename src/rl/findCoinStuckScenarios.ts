import fs from 'fs';
import path from 'path';
import { remainingMask, type Coin } from '../coins';
import { CoinEnv } from './coinEnv';
import { QLearningAgent } from './qlearning';

// 学習なし(epsilon=0の貪欲方策)でcoinQtable.jsonを大量に走らせ、
// 「詰みパターン」(同じ座標に戻ってきて抜け出せなくなるループ)を機械的に見つける。
// 判定にはバケツ化された状態文字列ではなく、実座標(+コイン取得マスク)の完全一致を使う。
// バケツ幅(20)がSTEP(4)より大きいため、同じバケツ内を数歩かけて前進するだけでも
// 状態文字列は数歩そのまま変わらない(=正常な前進でも状態が「再訪」される)。
// 実座標が完全に一致した場合のみ、環境が決定的である以上、以後は必ず同じ手順を
// 繰り返す=絶対に詰む、と判定できる。
const EPISODES = 10000;
const MAX_STEPS = 1000; // ループ検知に使う保険の上限(通常はループ検知の方が先に効く)

const qtablePath = process.argv[2] ? path.resolve(process.argv[2]) : path.join(__dirname, 'coinQtable.json');
const outScenariosPath = process.argv[3] ? path.resolve(process.argv[3]) : path.join(__dirname, 'coinStuckScenarios.json');
const qtable = JSON.parse(fs.readFileSync(qtablePath, 'utf8'));
const agent = QLearningAgent.fromJSON(qtable);
console.log(`Qテーブル: ${qtablePath}`);

const env = new CoinEnv(4, false);

interface StuckScenario {
  coins: Coin[];
  runnerX: number;
  runnerY: number;
}

const stuck: StuckScenario[] = [];
let clearedCount = 0;

const positionKey = (): string => {
  const { coins, runnerX, runnerY } = env.snapshot();
  return `${runnerX},${runnerY},${remainingMask(coins)}`;
};

for (let episode = 1; episode <= EPISODES; episode++) {
  let state = env.reset();
  const scenario = env.snapshot(); // このエピソードの初期局面(コイン+開始位置)を記録しておく
  const seen = new Set<string>([positionKey()]);

  for (let steps = 0; steps < MAX_STEPS; steps++) {
    const action = agent.chooseAction(state, 0);
    const { state: nextState, done } = env.step(action);
    if (done) {
      clearedCount++;
      break;
    }
    const key = positionKey();
    if (seen.has(key)) {
      stuck.push(scenario);
      break;
    }
    seen.add(key);
    state = nextState;
  }

  if (episode % 1000 === 0) {
    console.log(`episode ${episode}: ここまでの詰み検出数 ${stuck.length}件 / クリア ${clearedCount}件`);
  }
}

console.log(
  `\n${EPISODES}エピソード中: 詰み ${stuck.length}件 (${((stuck.length / EPISODES) * 100).toFixed(2)}%) / クリア ${clearedCount}件 (${((clearedCount / EPISODES) * 100).toFixed(2)}%)`,
);

fs.writeFileSync(outScenariosPath, JSON.stringify(stuck));
console.log(`詰みパターンを保存しました: ${outScenariosPath} (${stuck.length}件)`);
