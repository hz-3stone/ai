import fs from 'fs';
import path from 'path';
import { Circle, type Direction } from '../circle';
import { relativeState } from './env';
import { QLearningAgent } from './qlearning';

const WIDTH = 400, HEIGHT = 400, R = 20, STEP = 4;
const TOUCH_DISTANCE = R * 2;

const REL_BUCKET = 40; // 追手との相対位置のバケツ幅。壁の次元が増える分、chase(20)より粗くして状態数を抑える
const WALL_BUCKET = 40; // 壁までの距離をこの幅で離散化する
const WALL_BUCKET_MAX = 4; // これ以上遠ければ「壁は関係ない」として一つにまとめる

const CAUGHT_PENALTY = -100;
const SURVIVE_REWARD = 1; // 1歩生き延びるごとの小さな報酬
const SHAPING_SCALE = 1; // 追手との距離が1px伸びる/縮むごとの報酬 (追いかける側と符号が逆)

const WALL_SAFE_DISTANCE = 80; // この距離より壁に近いとペナルティが発生する
const WALL_PENALTY_SCALE = 0.01; // 壁に1px近づくごとのペナルティの強さ。x/yそれぞれに掛かるので、角(両方近い)は自然と2倍になる

export interface EvadeStepResult {
  state: string;
  reward: number;
  done: boolean;
}

// 追手(chaser)の動きは、既存の学習済み「近づく」方策をそのまま使う (固定・学習しない)
const chaserQtablePath = path.join(__dirname, 'qtable.json');
const chaserAgent = QLearningAgent.fromJSON(JSON.parse(fs.readFileSync(chaserQtablePath, 'utf8')));

const wallBucket = (distance: number): number => Math.min(Math.floor(distance / WALL_BUCKET), WALL_BUCKET_MAX);

const distToWalls = (x: number, y: number): { x: number; y: number } => ({
  x: Math.min(x - R, WIDTH - R - x),
  y: Math.min(y - R, HEIGHT - R - y),
});

// 学習(EvadeEnv)と推論(evade.ts)で同じ状態表現を使うための共通関数
export const evadeState = (runnerX: number, runnerY: number, chaserX: number, chaserY: number): string => {
  const rel = relativeState(chaserX - runnerX, chaserY - runnerY, REL_BUCKET);
  const wall = distToWalls(runnerX, runnerY);
  return `${rel},${wallBucket(wall.x)},${wallBucket(wall.y)}`;
};

// 壁(角ならその分2軸とも)に近いほど大きくなるペナルティ。捕まっていなくても、
// 壁際に居続けること自体を「なんとなく嫌」だと学ばせるための恒常的な減点
const wallPenalty = (x: number, y: number): number => {
  const wall = distToWalls(x, y);
  const penaltyX = Math.max(0, WALL_SAFE_DISTANCE - wall.x) * WALL_PENALTY_SCALE;
  const penaltyY = Math.max(0, WALL_SAFE_DISTANCE - wall.y) * WALL_PENALTY_SCALE;
  return penaltyX + penaltyY;
};

// Circleを2体(runner/chaser)使い、逃げる側の状態と報酬を定義する環境。
// 状態には「追手との相対位置」だけでなく「壁までの距離」も含める。相対位置だけだと
// 壁際に追い詰められている状況を区別できず、簡単に捕まってしまうため。
export class EvadeEnv {
  private runner = new Circle(WIDTH, HEIGHT, R, STEP); // 青(学習対象): 逃げる
  private chaser = new Circle(WIDTH, HEIGHT, R, STEP); // 赤(固定方策): 追う
  private prevDistance = 0;
  private runnerSpeedRatio = 1; // chaserを1としたときのrunnerの速さ倍率 (カリキュラム学習用)
  private moveBudget = 0; // 端数の移動量を積み立てておき、小数倍の速さも表現する

  constructor() {
    this.placeRandom();
  }

  // chaserを1としたときのrunnerの速さ倍率を設定する。整数倍でなくても、
  // 端数を積み立てて平均的にその倍率になるようmove()を追加で呼ぶことで表現する。
  setRunnerSpeedRatio = (ratio: number): void => {
    this.runnerSpeedRatio = ratio;
  };

  private placeRandom = (): void => {
    this.runner.x = R + Math.random() * (WIDTH - R * 2);
    this.runner.y = R + Math.random() * (HEIGHT - R * 2);
    this.chaser.x = R + Math.random() * (WIDTH - R * 2);
    this.chaser.y = R + Math.random() * (HEIGHT - R * 2);
    this.prevDistance = this.distance();
    this.moveBudget = 0;
  };

  private distance = (): number =>
    Math.hypot(this.runner.x - this.chaser.x, this.runner.y - this.chaser.y);

  // 状態 = 「追手との相対位置」+「上下左右の壁までの距離」
  private state = (): string => evadeState(this.runner.x, this.runner.y, this.chaser.x, this.chaser.y);

  reset = (): string => {
    this.placeRandom();
    return this.state();
  };

  private moveRunner = (action: Direction): void => {
    this.runner.move(action); // 基本の1歩
    this.moveBudget += this.runnerSpeedRatio - 1; // 残り(倍率-1)歩分を積み立てる
    while (this.moveBudget >= 1) {
      this.runner.move(action);
      this.moveBudget -= 1;
    }
  };

  step = (action: Direction): EvadeStepResult => {
    this.moveRunner(action);

    // 追手は固定方策で「今のrunnerに一番近づく方向」へ動く (chase.tsと同じロジック)
    const chaserState = relativeState(this.runner.x - this.chaser.x, this.runner.y - this.chaser.y);
    this.chaser.move(chaserAgent.chooseAction(chaserState, 0));

    const newDistance = this.distance();
    const shaping = (newDistance - this.prevDistance) * SHAPING_SCALE; // 離れたら+, 近づかれたら-
    this.prevDistance = newDistance;
    const penalty = wallPenalty(this.runner.x, this.runner.y);

    if (newDistance <= TOUCH_DISTANCE) {
      return { state: this.state(), reward: CAUGHT_PENALTY - penalty, done: true };
    }
    return { state: this.state(), reward: SURVIVE_REWARD + shaping - penalty, done: false };
  };
}
