import fs from 'fs';
import path from 'path';
import { runTraining, type TrainingConfig } from './runTraining';

// ==== 比較したいalphaと、途中経過を保存するエピソード数 ====
const BASE: Omit<TrainingConfig, 'alpha'> = {
  episodes: 600, // チェックポイントは600までしか使わないので、そこで打ち切る
  maxSteps: 200,
  gamma: 0.95,
  epsilonStart: 1.0,
  epsilonMin: 0.05,
  epsilonDecay: 0.995,
  logWindow: 100,
};

const ALPHAS = [0.01, 0.1, 0.5];
// 学習曲線の伸びは対数的(序盤に急成長し、600あたりで頭打ち)なので、
// 均等割りではなく序盤を細かく刻んだ間隔にする
const CHECKPOINTS = [20, 50, 100, 250, 600];
// ====================================================

const dir = path.join(__dirname, 'snapshots');
fs.mkdirSync(dir, { recursive: true });

for (const alpha of ALPHAS) {
  console.log(`\n=== alpha=${alpha} で学習しながらスナップショットを保存 ===`);
  runTraining(
    { ...BASE, alpha },
    undefined,
    (episode, agent) => {
      const file = path.join(dir, `alpha-${alpha}-ep${episode}.json`);
      fs.writeFileSync(file, JSON.stringify(agent.toJSON()));
      console.log(`  ep${episode} 保存: ${file}`);
    },
    CHECKPOINTS,
  );
}
