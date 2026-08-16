import fs from 'fs';
import path from 'path';
import { Circle, OPPOSITE_DIRECTION, type Direction } from '../circle';
import { allTaken, collect, createCoins, nearestRemainingCoin, remainingMask, type Coin } from '../coins';
import { isVisible, relativeState, visibleRelativeState } from './env';
import { QLearningAgent } from './qlearning';

// マップは元の4倍(縦横2倍)。2000x2000(25倍)は視界(VISIBILITY_HALF=200相当の窓)に対して
// 広すぎて「発見」自体が学習できなかったため、一旦800x800まで狭めて再挑戦する
const WIDTH = 800, HEIGHT = 800, R = 20, STEP = 4;
const TOUCH_DISTANCE = R * 2;

const REL_BUCKET = 40; // 追手との相対位置のバケツ幅。壁の次元が増える分、chase(20)より粗くして状態数を抑える
const WALL_BUCKET = 40; // 壁までの距離をこの幅で離散化する
const WALL_BUCKET_MAX = 4; // これ以上遠ければ「壁は関係ない」として一つにまとめる
const COIN_BUCKET = 40; // 一番近い未取得コインへの相対位置のバケツ幅

const CAUGHT_PENALTY = -100;
const SURVIVE_REWARD = 1; // 1歩生き延びるごとの小さな報酬
const SHAPING_SCALE = 1; // 追手との距離が1px伸びる/縮むごとの報酬 (追いかける側と符号が逆)

const WALL_SAFE_DISTANCE = 80; // この距離より壁に近いとペナルティが発生する
const WALL_PENALTY_SCALE = 0.01; // 壁に1px近づくごとのペナルティの強さ。x/yそれぞれに掛かるので、角(両方近い)は自然と2倍になる

// 見つかる/逃げ切るの駆け引きを強めるための報酬。「見つかること自体が弱い」ので
// 見つかった時の減点を大きく、逃げ切った(視界から逸れた)時の報酬は小さめにする
const FOUND_PENALTY = 15;
const ESCAPE_REWARD = 3;

// その場に足踏みして動かないと発見されやすいだけの下手な手なので、
// 「直前と正反対の方向を選ぶ(行ったり来たり)」「壁で完全に止まる」を検知して減点する
const STILL_PENALTY = 2;

// コインを集める積極的な理由を与える。全部集めたら「クリア」として捕獲と対になる勝利終端にする
const COIN_REWARD = 10;
const COIN_CLEAR_REWARD = 100;

export interface EvadeStepResult {
  state: string;
  reward: number;
  done: boolean;
  // 'caught'/'cleared'は終端の理由(doneがfalseの間はnull)。ログで捕獲率とクリア率を
  // 分けて集計するために必要(doneだけだと両方が「成功」として混ざってしまう)
  outcome: 'caught' | 'cleared' | null;
}

// 追手(chaser)の動きは、既存の学習済み「近づく」方策をそのまま使う (固定・学習しない)
const chaserQtablePath = path.join(__dirname, 'qtable.json');
const chaserAgent = QLearningAgent.fromJSON(JSON.parse(fs.readFileSync(chaserQtablePath, 'utf8')));

const wallBucket = (distance: number): number => Math.min(Math.floor(distance / WALL_BUCKET), WALL_BUCKET_MAX);

const distToWalls = (x: number, y: number): { x: number; y: number } => ({
  x: Math.min(x - R, WIDTH - R - x),
  y: Math.min(y - R, HEIGHT - R - y),
});

// 学習(EvadeEnv)と推論(evade.ts)で同じ状態表現を使うための共通関数。
// 相手が視界(VISIBILITY_HALF)の外にいれば "none" になり、遠くの正確な位置は分からない。
// コイン情報(一番近い未取得コインへの相対位置+全体の取得状況)は視界制限の対象外にする。
// ゲームのルールとして「残り/取得済み」は常に分かる、という前提のため
export const evadeState = (
  runnerX: number,
  runnerY: number,
  chaserX: number,
  chaserY: number,
  coins: Coin[],
): string => {
  const rel = visibleRelativeState(chaserX - runnerX, chaserY - runnerY, REL_BUCKET);
  const wall = distToWalls(runnerX, runnerY);
  const nearestCoin = nearestRemainingCoin(runnerX, runnerY, coins);
  const coinRel = nearestCoin ? relativeState(nearestCoin.x - runnerX, nearestCoin.y - runnerY, COIN_BUCKET) : 'none';
  return `${rel},${wallBucket(wall.x)},${wallBucket(wall.y)},${coinRel},${remainingMask(coins)}`;
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
  private wasVisible = false; // 直前ステップでchaserから見えていたか(発見/逃げ切り検知用)
  private prevAction: Direction | null = null; // 足踏み検知用
  private coins: Coin[] = [];

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
    this.wasVisible = isVisible(this.chaser.x - this.runner.x, this.chaser.y - this.runner.y);
    this.prevAction = null;
    this.coins = createCoins(WIDTH, HEIGHT, R);
  };

  private distance = (): number =>
    Math.hypot(this.runner.x - this.chaser.x, this.runner.y - this.chaser.y);

  // 状態 = 「追手との相対位置」+「上下左右の壁までの距離」+「コインの状況」
  private state = (): string =>
    evadeState(this.runner.x, this.runner.y, this.chaser.x, this.chaser.y, this.coins);

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
    const beforeX = this.runner.x;
    const beforeY = this.runner.y;
    this.moveRunner(action);

    // 追手も同じ視界制限を受ける固定方策で「今のrunnerに一番近づく方向」へ動く。
    // runnerが視界外なら"none"になり、qtable.jsonにとって未知の状態なので反応が鈍くなる
    // (これも視界制限を「検証」する一部。追いかける側の「見失う」挙動は今後のフェーズで改善する)
    const chaserState = visibleRelativeState(this.runner.x - this.chaser.x, this.runner.y - this.chaser.y);
    this.chaser.move(chaserAgent.chooseAction(chaserState, 0));

    const newDistance = this.distance();
    const shaping = (newDistance - this.prevDistance) * SHAPING_SCALE; // 離れたら+, 近づかれたら-
    this.prevDistance = newDistance;
    const penalty = wallPenalty(this.runner.x, this.runner.y);

    // 発見された/視界から逃げ切った の切り替わりを検知して大きく減点/小さく加点する
    const visibleNow = isVisible(this.chaser.x - this.runner.x, this.chaser.y - this.runner.y);
    let visibilityShaping = 0;
    if (!this.wasVisible && visibleNow) visibilityShaping -= FOUND_PENALTY;
    else if (this.wasVisible && !visibleNow) visibilityShaping += ESCAPE_REWARD;
    this.wasVisible = visibleNow;

    // 直前と正反対の方向を選んだ(行ったり来たり)/壁で完全に止まった、を足踏みとみなす
    const reversed = this.prevAction !== null && OPPOSITE_DIRECTION[this.prevAction] === action;
    const stuck = this.runner.x === beforeX && this.runner.y === beforeY;
    const stillPenalty = reversed || stuck ? STILL_PENALTY : 0;
    this.prevAction = action;

    // コインを取りに行く積極的な理由を与える。全部集めたら捕獲と対になる「勝利」終端にする
    const collected = collect(this.runner.x, this.runner.y, R, this.coins);
    const cleared = collected && allTaken(this.coins);
    const coinReward = (collected ? COIN_REWARD : 0) + (cleared ? COIN_CLEAR_REWARD : 0);

    // 同じ一歩で捕獲とクリアが両方成立した場合は捕獲を優先する
    if (newDistance <= TOUCH_DISTANCE) {
      return { state: this.state(), reward: CAUGHT_PENALTY - penalty, done: true, outcome: 'caught' };
    }
    if (cleared) {
      return { state: this.state(), reward: coinReward, done: true, outcome: 'cleared' };
    }
    return {
      state: this.state(),
      reward: SURVIVE_REWARD + shaping - penalty + visibilityShaping - stillPenalty + coinReward,
      done: false,
      outcome: null,
    };
  };
}
