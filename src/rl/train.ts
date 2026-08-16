import fs from 'fs';
import path from 'path';
import { runTraining, type TrainingConfig } from './runTraining';

// ==== ハイパーパラメータ (ここをいじって実験する) ====
const CONFIG: TrainingConfig = {
  episodes: 3000,
  maxSteps: 200,
  alpha: 0.1,
  gamma: 0.95,
  epsilonStart: 1.0,
  epsilonMin: 0.05,
  epsilonDecay: 0.995,
  logWindow: 100,
};
// ====================================================

const { agent, log } = runTraining(CONFIG, (entry) => {
  console.log(
    `episode ${entry.episode}\tavg steps(直近${CONFIG.logWindow}): ${entry.avgSteps.toFixed(1)}\tepsilon: ${entry.epsilon.toFixed(3)}\tQテーブルの状態数: ${entry.stateCount}`,
  );
});

const qtablePath = path.join(__dirname, 'qtable.json');
fs.writeFileSync(qtablePath, JSON.stringify(agent.toJSON()));
console.log(`Qテーブルを保存しました: ${qtablePath}`);

const logPath = path.join(__dirname, 'training-log.json');
fs.writeFileSync(logPath, JSON.stringify(log));
console.log(`学習ログを保存しました: ${logPath}`);
