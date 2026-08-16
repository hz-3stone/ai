import fs from 'fs';
import path from 'path';
import { CoinEnv } from './coinEnv';
import { QLearningAgent } from './qlearning';

// 青(evader)の「コインを集める」だけに絞ったカリキュラム学習。鬼は一切登場させない。
// コイン1枚を狙う課題はqtable.json(元の「固定ターゲットに近づく」学習)と状態のキーが
// 完全に一致するので、ゼロからではなくそこから始める。
// 1枚→2枚→3枚→4枚は「順番を指定して1つずつ狙わせる」ことで、複数コインが出てきても
// 状態のキーは(常に「今の目標への相対位置」1つだけなので)変わらず、単に
// "1エピソード内で連続成功しなければならない回数"だけが増える難易度になる。
//
// このスクリプトは「順番指定」までの共通部分だけを担当する(coinQtable.stage4.jsonに保存)。
// 最後の「順番を教えずに自分で選ぶ」段階は状態が変わり不安定になりやすかったため、
// trainCoinFinal.tsで episodes/alpha を変えた複数パターンを並列に試して比較する

// ==== ハイパーパラメータ (ここをいじって実験する) ====
const MAX_STEPS = 800; // 4枚を順番に回るのに必要な歩数を見込んで余裕を持たせる
const ALPHA = 0.1;
const GAMMA = 0.95;
const EPSILON_MIN = 0.05;
const EPSILON_DECAY = 0.999;
const LOG_WINDOW = 100;

const STAGES = [
  // qtable.jsonが既にほぼ解けている課題なので、探索は控えめに始める
  { coinCount: 1, ordered: true, episodes: 3000, epsilonStart: 0.3 },
  { coinCount: 2, ordered: true, episodes: 5000, epsilonStart: 0.5 },
  { coinCount: 3, ordered: true, episodes: 5000, epsilonStart: 0.5 },
  { coinCount: 4, ordered: true, episodes: 5000, epsilonStart: 0.5 },
];
// ====================================================

const baseQtablePath = path.join(__dirname, 'qtable.json');
const agent = QLearningAgent.fromJSON(JSON.parse(fs.readFileSync(baseQtablePath, 'utf8')), ALPHA, GAMMA);
console.log(`qtable.jsonから開始します (状態数: ${agent.stateCount})`);

for (const stage of STAGES) {
  const env = new CoinEnv(stage.coinCount, stage.ordered);
  let epsilon = stage.epsilonStart;
  const recentSteps: number[] = [];
  const recentCleared: number[] = [];

  console.log(`\n=== ステージ: コイン${stage.coinCount}枚 / ${stage.ordered ? '順番指定' : '自分で判断'} ===`);

  for (let episode = 1; episode <= stage.episodes; episode++) {
    let state = env.reset();
    let steps = 0;
    let cleared = 0;

    for (; steps < MAX_STEPS; steps++) {
      const action = agent.chooseAction(state, epsilon);
      const { state: nextState, reward, done } = env.step(action);
      agent.update(state, action, reward, nextState);
      state = nextState;
      if (done) {
        cleared = 1;
        steps++;
        break;
      }
    }

    recentSteps.push(steps);
    if (recentSteps.length > LOG_WINDOW) recentSteps.shift();
    recentCleared.push(cleared);
    if (recentCleared.length > LOG_WINDOW) recentCleared.shift();
    epsilon = Math.max(EPSILON_MIN, epsilon * EPSILON_DECAY);

    if (episode % LOG_WINDOW === 0) {
      const avgSteps = recentSteps.reduce((a, b) => a + b, 0) / recentSteps.length;
      const clearRate = (recentCleared.reduce((a, b) => a + b, 0) / recentCleared.length) * 100;
      console.log(
        `episode ${episode}\tavg歩数(直近${LOG_WINDOW}): ${avgSteps.toFixed(1)}\tクリア率: ${clearRate.toFixed(1)}%\tepsilon: ${epsilon.toFixed(3)}\tQテーブルの状態数: ${agent.stateCount}`,
      );
    }
  }
}

const outPath = path.join(__dirname, 'coinQtable.stage4.json');
fs.writeFileSync(outPath, JSON.stringify(agent.toJSON()));
console.log(`\nQテーブルを保存しました: ${outPath}`);
