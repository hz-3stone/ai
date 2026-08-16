import { Circle, type Direction } from '../circle';
import { SpawnPoint } from '../spawnPoint';

const WIDTH = 400, HEIGHT = 400, R = 20, STEP = 4, MIN_DISTANCE = 200;
const TOUCH_DISTANCE = R * 2;
const BUCKET = 20; // dx,dy をこの幅で離散化する (状態数を絞るためのパラメータ)

// 学習(env.ts)と推論(play.ts)で同じ状態表現を使うための共通関数
export const relativeState = (dx: number, dy: number, bucket: number = BUCKET): string =>
  `${Math.round(dx / bucket)},${Math.round(dy / bucket)}`;

// マップが広くなっても、自分中心のこの半径(px)以内しか見えない、という視界制限。
// 400x400だった頃の可動範囲と同じ広さの窓にすることで、以前の感覚を保ちつつ
// 相手が視界外にいる間は状態が爆発しないようにする(範囲外は全部「見えていない」1状態に潰す)
export const VISIBILITY_HALF = 200;

// 見えているかどうかは相対位置(dx,dy)だけで決まるので、自分視点でも相手視点でも結果は同じ
// (符号が違うだけでabsを取るため)。「発見/見失い」の報酬シェーピングにも使い回す
export const isVisible = (dx: number, dy: number): boolean =>
  Math.abs(dx) <= VISIBILITY_HALF && Math.abs(dy) <= VISIBILITY_HALF;

export const visibleRelativeState = (dx: number, dy: number, bucket: number = BUCKET): string => {
  if (!isVisible(dx, dy)) return 'none';
  return relativeState(dx, dy, bucket);
};

const STEP_REWARD = -1;
const GOAL_REWARD = 100;
const SHAPING_SCALE = 1; // 距離が1px縮む/伸びるごとに与える報酬の大きさ

export interface StepResult {
  state: string;
  reward: number;
  done: boolean;
}

// Circle/SpawnPoint をそのまま使い、Qラーニング用に「状態」と「報酬」を定義するだけの薄いラッパー
export class Env {
  private circle = new Circle(WIDTH, HEIGHT, R, STEP);
  private target = new SpawnPoint(WIDTH, HEIGHT, R); // ゴール地点として使う
  private prevDistance = 0;

  constructor() {
    this.target.randomize(this.circle.x, this.circle.y, MIN_DISTANCE);
    this.prevDistance = this.distance();
  }

  private distance = (): number =>
    Math.hypot(this.circle.x - this.target.x, this.circle.y - this.target.y);

  // 状態 = ターゲットとの相対位置 (絶対座標にしないことで汎化させる)
  private state = (): string => relativeState(this.target.x - this.circle.x, this.target.y - this.circle.y);

  reset = (): string => {
    this.circle = new Circle(WIDTH, HEIGHT, R, STEP);
    // 中央固定だと壁際の状況を一度も経験できないため、フィールド内のランダムな位置から始める
    this.circle.x = R + Math.random() * (WIDTH - R * 2);
    this.circle.y = R + Math.random() * (HEIGHT - R * 2);
    this.target.randomize(this.circle.x, this.circle.y, MIN_DISTANCE);
    this.prevDistance = this.distance();
    return this.state();
  };

  step = (action: Direction): StepResult => {
    this.circle.move(action);
    const newDistance = this.distance();
    const shaping = (this.prevDistance - newDistance) * SHAPING_SCALE; // 近づいたら+, 遠ざかったら-
    this.prevDistance = newDistance;

    if (newDistance <= TOUCH_DISTANCE) {
      return { state: this.state(), reward: GOAL_REWARD + shaping, done: true };
    }
    return { state: this.state(), reward: STEP_REWARD + shaping, done: false };
  };
}
