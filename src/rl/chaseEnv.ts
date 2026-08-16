import fs from 'fs';
import path from 'path';
import { Circle, type Direction } from '../circle';
import { evadeState } from './evadeEnv';
import { QLearningAgent } from './qlearning';

const WIDTH = 400, HEIGHT = 400, R = 20, STEP = 4;
const TOUCH_DISTANCE = R * 2;

const CATCH_REWARD = 100;
const STEP_PENALTY = -1; // 1歩ごとの小さな罰 (早く捕まえるほど良い)
const SHAPING_SCALE = 1; // evaderとの距離が1px縮む/伸びるごとの報酬

export interface ChaseStepResult {
  state: string;
  reward: number;
  done: boolean;
}

// evader(逃げる側)の動きは、既存の学習済み「逃げる」方策をそのまま使う (固定・学習しない)
const evaderQtablePath = path.join(__dirname, 'evadeQtable.json');
const evaderAgent = QLearningAgent.fromJSON(JSON.parse(fs.readFileSync(evaderQtablePath, 'utf8')));

// Circleを2体(chaser/evader)使い、追いかける側の状態と報酬を定義する環境。
// evadeEnv.tsと対称の関係にある(evadeStateは「自分の壁との距離+相手との相対位置」という
// 幾何学的に対称な計算なので、chaserの視点でもそのまま使い回せる)
export class ChaseEnv {
  private chaser = new Circle(WIDTH, HEIGHT, R, STEP); // 赤(学習対象): 追いかける
  private evader = new Circle(WIDTH, HEIGHT, R, STEP); // 青(固定方策): 逃げる
  private prevDistance = 0;
  private evaderSpeedRatio = 1; // chaserを1としたときのevaderの速さ倍率
  private moveBudget = 0; // 端数の移動量を積み立てておき、小数倍の速さも表現する

  constructor() {
    this.placeRandom();
  }

  setEvaderSpeedRatio = (ratio: number): void => {
    this.evaderSpeedRatio = ratio;
  };

  private placeRandom = (): void => {
    this.chaser.x = R + Math.random() * (WIDTH - R * 2);
    this.chaser.y = R + Math.random() * (HEIGHT - R * 2);
    this.evader.x = R + Math.random() * (WIDTH - R * 2);
    this.evader.y = R + Math.random() * (HEIGHT - R * 2);
    this.prevDistance = this.distance();
    this.moveBudget = 0;
  };

  private distance = (): number =>
    Math.hypot(this.chaser.x - this.evader.x, this.chaser.y - this.evader.y);

  // 状態 = 「evaderとの相対位置」+「自分(chaser)の壁までの距離」
  private state = (): string => evadeState(this.chaser.x, this.chaser.y, this.evader.x, this.evader.y);

  reset = (): string => {
    this.placeRandom();
    return this.state();
  };

  private moveEvader = (action: Direction): void => {
    this.evader.move(action);
    this.moveBudget += this.evaderSpeedRatio - 1;
    while (this.moveBudget >= 1) {
      this.evader.move(action);
      this.moveBudget -= 1;
    }
  };

  step = (action: Direction): ChaseStepResult => {
    this.chaser.move(action);

    // evaderは固定方策で「今のchaserから一番遠ざかる方向」へ動く (evade.tsと同じロジック)
    const evaderState = evadeState(this.evader.x, this.evader.y, this.chaser.x, this.chaser.y);
    this.moveEvader(evaderAgent.chooseAction(evaderState, 0));

    const newDistance = this.distance();
    const shaping = (this.prevDistance - newDistance) * SHAPING_SCALE; // 近づいたら+, 離れたら-
    this.prevDistance = newDistance;

    if (newDistance <= TOUCH_DISTANCE) {
      return { state: this.state(), reward: CATCH_REWARD + shaping, done: true };
    }
    return { state: this.state(), reward: STEP_PENALTY + shaping, done: false };
  };
}
