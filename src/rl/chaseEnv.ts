import fs from 'fs';
import path from 'path';
import { Circle, OPPOSITE_DIRECTION, type Direction } from '../circle';
import { allTaken, collect, createCoins, type Coin } from '../coins';
import { isVisible } from './env';
import { evadeState } from './evadeEnv';
import { QLearningAgent } from './qlearning';

// マップは元の4倍(縦横2倍)。視界制限はevadeState(evadeEnv.ts)を経由して自動的に効く
const WIDTH = 800, HEIGHT = 800, R = 20, STEP = 4;
const TOUCH_DISTANCE = R * 2;

const CATCH_REWARD = 100;
const STEP_PENALTY = -1; // 1歩ごとの小さな罰 (早く捕まえるほど良い)

// 距離のシェーピングは「見えている間」だけ効かせる。見えていないのに近づいた/離れたを
// 評価すると壁際の偶然の距離変化まで学習してしまうため。見えているのに離されるのは
// 特に悪い手なので、近づく報酬より遠ざかる減点を大きくする(非対称)
const APPROACH_REWARD_SCALE = 1; // 視界内で1px近づくごとの報酬
const RECEDE_PENALTY_SCALE = 5; // 視界内で1px離れるごとの減点(近づく報酬の5倍)

// 鬼が1体だけだと待ち伏せが効かず「一生鉢合わせない」リスクが大きいので、見つける/見失うに
// 報酬を付ける。ただし見つけただけで満足されると追いかけなくなるので発見報酬は小さめ、
// 見失うのは大きく減点して「見えたら離すな」を学ばせる
const SPOT_REWARD = 3;
const LOSE_SIGHT_PENALTY = 15;

// その場に足踏みして動かないと待つだけになりがちなので、
// 「直前と正反対の方向を選ぶ(行ったり来たり)」「壁で完全に止まる」を検知して減点する
const STILL_PENALTY = 2;

// evaderが全コインを集めきったら「クリア」= chaserの敗北として、CATCH_REWARDと対になる終端にする
const COIN_CLEAR_PENALTY = 100;

export interface ChaseStepResult {
  state: string;
  reward: number;
  done: boolean;
  // 'caught'/'cleared'は終端の理由(doneがfalseの間はnull)。ログで捕獲率とクリア率(evaderの
  // 勝利)を分けて集計するために必要(doneだけだと両方が「決着」として混ざってしまう)
  outcome: 'caught' | 'cleared' | null;
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
  coins: Coin[],
): string => `${evadeState(chaserX, chaserY, evaderX, evaderY, coins)},${speedBucket(evaderSpeedRatio)}`;

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
  private nearWallProbability = 0; // この確率でchaserの各軸を壁際からスタートさせる (苦手パターンの重点学習用)
  private wasVisible = false; // 直前ステップでevaderが見えていたか(発見/見失い検知用)
  private prevAction: Direction | null = null; // 足踏み検知用
  private stationary = false; // カリキュラム第1段階用: trueならevaderは一切動かない
  private coins: Coin[] = [];

  constructor() {
    this.placeRandom();
  }

  // この範囲でevaderの速さをエピソードごとにランダム化する。
  // 速いevader/遅いevaderのどちらが来ても対応できるように鍛えるための設定
  setEvaderSpeedRange = (min: number, max: number): void => {
    this.speedMin = min;
    this.speedMax = max;
  };

  // カリキュラム学習の第1段階用: evaderをランダムな位置に置いたまま動かさない。
  // 「探して捕まえる」だけをまず学ばせ、相手の回避行動という難易度は後回しにする
  setEvaderStationary = (stationary: boolean): void => {
    this.stationary = stationary;
  };

  // x軸・y軸それぞれ独立にこの確率で壁際スタートになる。両軸とも壁際になれば角スタート。
  // 全体を万遍なく学習させたいのでデフォルトは0(完全ランダム)のまま
  setChaserNearWallProbability = (probability: number): void => {
    this.nearWallProbability = probability;
  };

  private randomAxis = (size: number): number => R + Math.random() * (size - R * 2);

  private nearWallAxis = (size: number): number => {
    const side = Math.random() < 0.5 ? R : size - R; // どちらの壁に寄せるか
    const jitter = (Math.random() - 0.5) * 80; // 壁から±40pxくらいの範囲でばらける
    return Math.min(size - R, Math.max(R, side + jitter));
  };

  private chaserAxis = (size: number): number =>
    Math.random() < this.nearWallProbability ? this.nearWallAxis(size) : this.randomAxis(size);

  private placeRandom = (): void => {
    this.chaser.x = this.chaserAxis(WIDTH);
    this.chaser.y = this.chaserAxis(HEIGHT);
    this.evader.x = this.randomAxis(WIDTH);
    this.evader.y = this.randomAxis(HEIGHT);
    this.prevDistance = this.distance();
    this.moveBudget = 0;
    this.evaderSpeedRatio = this.stationary ? 0 : this.speedMin + Math.random() * (this.speedMax - this.speedMin);
    this.wasVisible = isVisible(this.evader.x - this.chaser.x, this.evader.y - this.chaser.y);
    this.prevAction = null;
    this.coins = createCoins(WIDTH, HEIGHT, R);
  };

  private distance = (): number =>
    Math.hypot(this.chaser.x - this.evader.x, this.chaser.y - this.evader.y);

  // 状態 = 「evaderとの相対位置」+「自分(chaser)の壁までの距離」+「今のevaderの速さ」+「コインの状況」
  private state = (): string =>
    chaseState(this.chaser.x, this.chaser.y, this.evader.x, this.evader.y, this.evaderSpeedRatio, this.coins);

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
    const beforeX = this.chaser.x;
    const beforeY = this.chaser.y;
    this.chaser.move(action);

    if (!this.stationary) {
      // evaderは固定方策で「今のchaserから一番遠ざかる方向」へ動く (evade.tsと同じロジック)
      const evaderState = evadeState(this.evader.x, this.evader.y, this.chaser.x, this.chaser.y, this.coins);
      this.moveEvader(evaderAgent.chooseAction(evaderState, 0));
    }

    const newDistance = this.distance();
    const visibleNow = isVisible(this.evader.x - this.chaser.x, this.evader.y - this.chaser.y);

    // 見えている間だけ、近づいたか離れたかを評価する(非対称: 離れる方を強く罰する)
    const distanceDelta = this.prevDistance - newDistance; // +: 近づいた, -: 離れた
    const shaping = visibleNow
      ? distanceDelta * (distanceDelta >= 0 ? APPROACH_REWARD_SCALE : RECEDE_PENALTY_SCALE)
      : 0;
    this.prevDistance = newDistance;

    // 発見した/見失った の切り替わりを検知して小さく加点/大きく減点する
    let visibilityShaping = 0;
    if (!this.wasVisible && visibleNow) visibilityShaping += SPOT_REWARD;
    else if (this.wasVisible && !visibleNow) visibilityShaping -= LOSE_SIGHT_PENALTY;
    this.wasVisible = visibleNow;

    // 直前と正反対の方向を選んだ(行ったり来たり)/壁で完全に止まった、を足踏みとみなす
    const reversed = this.prevAction !== null && OPPOSITE_DIRECTION[this.prevAction] === action;
    const stuck = this.chaser.x === beforeX && this.chaser.y === beforeY;
    const stillPenalty = reversed || stuck ? STILL_PENALTY : 0;
    this.prevAction = action;

    // evaderが全コインを集めきったらクリア(chaserの敗北)。同じ一歩で捕獲も成立していれば捕獲を優先する
    const cleared = collect(this.evader.x, this.evader.y, R, this.coins) && allTaken(this.coins);

    if (newDistance <= TOUCH_DISTANCE) {
      return { state: this.state(), reward: CATCH_REWARD + shaping, done: true, outcome: 'caught' };
    }
    if (cleared) {
      return { state: this.state(), reward: -COIN_CLEAR_PENALTY, done: true, outcome: 'cleared' };
    }
    return {
      state: this.state(),
      reward: STEP_PENALTY + shaping + visibilityShaping - stillPenalty,
      done: false,
      outcome: null,
    };
  };
}
