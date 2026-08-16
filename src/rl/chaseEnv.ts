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

const speedBucket = (ratio: number): number => Math.round(ratio);

// 学習(ChaseEnv)と推論(chase.ts)で同じ状態表現を使うための共通関数。
// evadeStateに「今のevaderの速さ倍率」を加えることで、同じ位置関係でも相手が
// 速いか遅いかで別の状態として扱えるようにする(でないと、速さの違う経験が
// 同じ状態を奪い合って上書きし合ってしまう)
export const chaseState = (
  chaserX: number,
  chaserY: number,
  evaderX: number,
  evaderY: number,
  evaderSpeedRatio: number,
): string => `${evadeState(chaserX, chaserY, evaderX, evaderY)},${speedBucket(evaderSpeedRatio)}`;

// Circleを2体(chaser/evader)使い、追いかける側の状態と報酬を定義する環境。
// evadeEnv.tsと対称の関係にある(evadeStateは「自分の壁との距離+相手との相対位置」という
// 幾何学的に対称な計算なので、chaserの視点でもそのまま使い回せる)
export class ChaseEnv {
  private chaser = new Circle(WIDTH, HEIGHT, R, STEP); // 赤(学習対象): 追いかける
  private evader = new Circle(WIDTH, HEIGHT, R, STEP); // 青(固定方策): 逃げる
  private prevDistance = 0;
  private evaderSpeedRatio = 1; // chaserを1としたときのevaderの速さ倍率
  private speedMin = 1;
  private speedMax = 1;
  private moveBudget = 0; // 端数の移動量を積み立てておき、小数倍の速さも表現する

  constructor() {
    this.placeRandom();
  }

  // この範囲でevaderの速さをエピソードごとにランダム化する。
  // 速いevader/遅いevaderのどちらが来ても対応できるように鍛えるための設定
  setEvaderSpeedRange = (min: number, max: number): void => {
    this.speedMin = min;
    this.speedMax = max;
  };

  private placeRandom = (): void => {
    this.chaser.x = R + Math.random() * (WIDTH - R * 2);
    this.chaser.y = R + Math.random() * (HEIGHT - R * 2);
    this.evader.x = R + Math.random() * (WIDTH - R * 2);
    this.evader.y = R + Math.random() * (HEIGHT - R * 2);
    this.prevDistance = this.distance();
    this.moveBudget = 0;
    this.evaderSpeedRatio = this.speedMin + Math.random() * (this.speedMax - this.speedMin);
  };

  private distance = (): number =>
    Math.hypot(this.chaser.x - this.evader.x, this.chaser.y - this.evader.y);

  // 状態 = 「evaderとの相対位置」+「自分(chaser)の壁までの距離」+「今のevaderの速さ」
  private state = (): string =>
    chaseState(this.chaser.x, this.chaser.y, this.evader.x, this.evader.y, this.evaderSpeedRatio);

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
