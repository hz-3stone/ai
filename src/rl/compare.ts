import fs from 'fs';
import path from 'path';
import { runTraining, type TrainingConfig } from './runTraining';

// ==== 比較したいハイパーパラメータをここに並べる ====
const BASE: Omit<TrainingConfig, 'alpha'> = {
  episodes: 3000,
  maxSteps: 200,
  gamma: 0.95,
  epsilonStart: 1.0,
  epsilonMin: 0.05,
  epsilonDecay: 0.995,
  logWindow: 100,
};

const RUNS = [
  { label: 'alpha=0.01 (低い)', config: { ...BASE, alpha: 0.01 } },
  { label: 'alpha=0.1 (今の設定)', config: { ...BASE, alpha: 0.1 } },
  { label: 'alpha=0.5 (高い)', config: { ...BASE, alpha: 0.5 } },
];
// ====================================================

const results = RUNS.map(({ label, config }) => {
  console.log(`\n=== ${label} で学習開始 ===`);
  const { log } = runTraining(config, (entry) => {
    if (entry.episode % 500 === 0) {
      console.log(`  episode ${entry.episode}\tavg steps: ${entry.avgSteps.toFixed(1)}`);
    }
  });
  return { label, config, log };
});

const outPath = path.join(__dirname, 'comparison-log.json');
fs.writeFileSync(outPath, JSON.stringify(results));
console.log(`\n比較ログを保存しました: ${outPath}`);
