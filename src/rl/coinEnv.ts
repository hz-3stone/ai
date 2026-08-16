import { Circle, OPPOSITE_DIRECTION, type Direction } from '../circle';
import { allTaken, collect, createCoins, nearestRemainingCoin, remainingMask, type Coin } from '../coins';
import { relativeState } from './env';

// 鬼(chaser)を一切登場させず、青がコインを集める動作だけに絞って学習する環境。
// カリキュラム学習用: コイン枚数(1〜4)と「順番を指定するか」を段階的に変えて使う。
const WIDTH = 800, HEIGHT = 800, R = 20, STEP = 4;
const BUCKET = 20; // env.ts(qtable.json)と同じバケツ幅。1枚モードは状態のキーがそのまま一致し、
                    // 既存のqtable.json(固定ターゲットに近づく学習済みQテーブル)をそのまま流用できる

const STEP_PENALTY = -1; // 1歩ごとの小さな罰(早く集めるほど良い)
const SHAPING_SCALE = 1; // 今の目標コインとの距離が1px縮む/伸びるごとの報酬
const COIN_REWARD = 20; // コイン1枚取得
const CLEAR_REWARD = 100; // このステージの全コインを取得(捕獲/クリアと同格の大きな報酬)

export interface CoinStepResult {
  state: string;
  reward: number;
  done: boolean;
}

// 「詰み」対策の実験用オプション群(すべてデフォルトOFF)。既存の呼び出し元は変更不要
export interface CoinEnvOptions {
  antiReversePenalty?: number; // 直前と正反対の方向を選んだ時の罰(壁際やこの前見つかった往復ループの対策)
  timePenaltyScale?: number; // 経過ステップ数に比例して増える罰の傾き(長引くほど強く急かす)
  randomOrder?: boolean; // ordered=trueのとき、コインを狙う順番をエピソードごとにシャッフルする
  nearestOrder?: boolean; // ordered=trueのとき、開始時に貪欲最近傍法で順番を決めて固定する
                           // (「一番近い」を毎ステップ選び直す自由選択モードと違い、走行中に切り替わらない)
  stuckRescue?: boolean; // 実座標+マスクの完全再訪(=詰み確定)を検知したら、残りコインからランダムに
                          // 1つだけを残し、それ以外は「取得済み」であるかのように見せて単純な部分問題に落とし込む
}

// 順番指定モードの状態は「今の目標コインへの相対位置」だけ(qtable.jsonと同じ形)。
// 自由選択モードは「一番近い未取得コインへの相対位置」+「全体の取得状況マスク」を使う
const orderedState = (runnerX: number, runnerY: number, target: Coin): string =>
  relativeState(target.x - runnerX, target.y - runnerY, BUCKET);

// 推論(coin.ts)でも同じ状態表現を使うためexportする
export const freeState = (runnerX: number, runnerY: number, coins: Coin[]): string => {
  const nearest = nearestRemainingCoin(runnerX, runnerY, coins);
  const rel = nearest ? relativeState(nearest.x - runnerX, nearest.y - runnerY, BUCKET) : 'none';
  return `${rel},${remainingMask(coins)}`;
};

// stuckRescue用: focusId以外は(実際は残っていても)全部「取得済み」であるかのようなマスクにする
const fakeMaskFocusOn = (coins: Coin[], focusId: number): string =>
  coins.map((c) => (c.id === focusId ? '0' : '1')).join('');

// 壁際や特定の相対位置バケツでQテーブルの判断が誤っていると、詰みループが起きる。
// 移動そのものを強制すると、将来鬼から逃げる場面でも同じ仕組みが働いてしまい、
// 「詰み防止のせいでターゲット方向(=鬼がいるかもしれない方向)へ強制的に進まされる」
// という致命的な副作用になりかねない。そのため移動の決定は常にQテーブル(エージェント
// 自身の判断)に委ね、代わりに「本当のターゲットのすぐ手前(半径+1歩ぶん)にある、
// 実在しない仮の目印」を一時的に見せる。本物のターゲットと同じ方向にあるごく近い点なので、
// (a) 進むべき大まかな向きは変わらず、(b) 学習中どのエピソードも終盤に必ず通る
// 「あと少しで着く」バケツ(=最も高密度に学習されている領域)に迷い込ませることになり、
// エージェント自身の判断で自然に抜け出しやすくなる。仮目印に十分近づいたら本物の
// ターゲットへ戻す
const FAKE_WAYPOINT_MAX_STEPS = 40; // これだけ経っても効かなければ諦めて本物のターゲットへ戻す
// 近すぎる仮目印(半径ぎりぎり)だと1〜2歩ですぐ「到達」扱いになって本物のターゲットへ
// 戻ってしまい、詰まっていた極小範囲(数px四方)に逆戻りするだけで終わってしまうと判明した。
// バケツ数個ぶんは離しておくことで、その極小範囲を確実に抜け出すだけの猶予を持たせる
const FAKE_WAYPOINT_DISTANCE = BUCKET * 4;
const makeFakeWaypoint = (fromX: number, fromY: number, targetX: number, targetY: number): { x: number; y: number } => {
  const dx = targetX - fromX;
  const dy = targetY - fromY;
  const distance = Math.hypot(dx, dy) || 1;
  const clamped = Math.min(FAKE_WAYPOINT_DISTANCE, distance); // 本物のターゲットより先には置かない
  return { x: fromX + (dx / distance) * clamped, y: fromY + (dy / distance) * clamped };
};

// 貪欲最近傍法: fromX,fromYから一番近いコイン→そこから一番近い次のコイン…の順に並べる。
// CoinEnv(学習用)とOrderedCoinTracker(実プレイ用)の両方で同じ順番決定ロジックを使う
const greedyNearestOrder = (fromX: number, fromY: number, coins: Coin[]): Coin[] => {
  const remaining = [...coins];
  const order: Coin[] = [];
  let x = fromX;
  let y = fromY;
  while (remaining.length > 0) {
    let bestIndex = 0;
    let bestDistance = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const distance = Math.hypot(remaining[i].x - x, remaining[i].y - y);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = i;
      }
    }
    const [chosen] = remaining.splice(bestIndex, 1);
    order.push(chosen);
    x = chosen.x;
    y = chosen.y;
  }
  return order;
};

// 実際のプレイ(coin.ts)用。CoinEnvは自前でrunner.move()を呼んでシミュレートするが、
// 実プレイでは移動はサーバー側で行われるため、代わりに毎回の実測位置(px,py,coins)を
// 渡してもらい、CoinEnvと同じ「最近傍固定順+詰み対策(順番入れ替え/仮目印)」の
// 状態遷移だけを行う。移動そのものは一切決めない(常にQテーブル任せ)
export class OrderedCoinTracker {
  private order: Coin[] | null = null; // 貪欲最近傍法で計算した順番。同じ周回の間は固定
  private orderIndex = 0;
  private visitedPositions = new Set<string>();
  private fakeWaypoint: { x: number; y: number } | null = null;
  private fakeWaypointSteps = 0;
  private noProgressCount = 0;
  private lastX: number | null = null;
  private lastY: number | null = null;

  private reset = (): void => {
    this.order = null;
    this.orderIndex = 0;
    this.visitedPositions.clear();
    this.fakeWaypoint = null;
    this.fakeWaypointSteps = 0;
    this.noProgressCount = 0;
    this.lastX = null;
    this.lastY = null;
  };

  // 全コイン取得(クリア)でサーバー側が新しい周回のコインを生成すると、コインのidが
  // 総入れ替えになる。今回のコインの中に、前回覚えていた順番に無かったidが混じっていたら
  // 新しい周回とみなし、順番を最初から決め直す
  private ensureOrder = (px: number, py: number, coins: Coin[]): Coin[] => {
    if (this.order && coins.some((c) => !this.order!.some((o) => o.id === c.id))) {
      this.reset();
    }
    if (!this.order) this.order = greedyNearestOrder(px, py, coins);
    return this.order;
  };

  // 現在の実座標+コイン一覧から、agent.chooseActionに渡すべき状態文字列を返す
  next = (px: number, py: number, coins: Coin[]): string => {
    const order = this.ensureOrder(px, py, coins);
    const findLive = (id: number): Coin | undefined => coins.find((c) => c.id === id);

    while (this.orderIndex < order.length && findLive(order[this.orderIndex].id)?.taken) {
      this.orderIndex++;
    }
    if (this.orderIndex >= order.length) return 'cleared';

    const positionUnchanged = this.lastX === px && this.lastY === py;
    this.noProgressCount = positionUnchanged ? this.noProgressCount + 1 : 0;
    this.lastX = px;
    this.lastY = py;

    if (this.fakeWaypoint) {
      this.fakeWaypointSteps++;
      const distanceToWaypoint = Math.hypot(this.fakeWaypoint.x - px, this.fakeWaypoint.y - py);
      if (distanceToWaypoint <= R || this.fakeWaypointSteps >= FAKE_WAYPOINT_MAX_STEPS) {
        this.fakeWaypoint = null;
        this.fakeWaypointSteps = 0;
        this.visitedPositions.clear();
      } else {
        return relativeState(this.fakeWaypoint.x - px, this.fakeWaypoint.y - py, BUCKET);
      }
    }

    if (this.noProgressCount >= 3) {
      const target = findLive(order[this.orderIndex].id)!;
      this.fakeWaypoint = makeFakeWaypoint(px, py, target.x, target.y);
      this.fakeWaypointSteps = 0;
      this.noProgressCount = 0;
      return relativeState(this.fakeWaypoint.x - px, this.fakeWaypoint.y - py, BUCKET);
    }

    const key = `${px},${py},${remainingMask(coins)}`;
    if (this.visitedPositions.has(key)) {
      const otherIndices: number[] = [];
      for (let i = this.orderIndex + 1; i < order.length; i++) {
        const c = findLive(order[i].id);
        if (c && !c.taken) otherIndices.push(i);
      }
      if (otherIndices.length > 0) {
        const swapWith = otherIndices[(Math.random() * otherIndices.length) | 0];
        [order[this.orderIndex], order[swapWith]] = [order[swapWith], order[this.orderIndex]];
      } else {
        const target = findLive(order[this.orderIndex].id)!;
        this.fakeWaypoint = makeFakeWaypoint(px, py, target.x, target.y);
        this.fakeWaypointSteps = 0;
      }
      this.visitedPositions.clear();
    } else {
      this.visitedPositions.add(key);
    }

    if (this.fakeWaypoint) {
      return relativeState(this.fakeWaypoint.x - px, this.fakeWaypoint.y - py, BUCKET);
    }
    return orderedState(px, py, findLive(order[this.orderIndex].id)!);
  };
}

export class CoinEnv {
  private runner = new Circle(WIDTH, HEIGHT, R, STEP);
  private coins: Coin[] = [];
  private orderIndex = 0; // 順番指定モードで、次に狙うコインのインデックス
  private prevDistance = 0;
  private prevAction: Direction | null = null; // antiReversePenalty用
  private stepIndex = 0; // timePenaltyScale用(このエピソードの経過ステップ数)
  private visitedPositions = new Set<string>(); // stuckRescue用: 実座標+マスクの訪問履歴
  private rescueTargetId: number | null = null; // stuckRescue発動中に固定するターゲットのコインid
  private noProgressCount = 0; // 移動が完全に無効(壁でクランプ)だった連続回数
  private fakeWaypoint: { x: number; y: number } | null = null; // 順番指定モードで詰み検知時に見せる仮の目印(移動は強制しない)
  private fakeWaypointSteps = 0; // 仮の目印を出してからの経過ステップ数

  constructor(
    private coinCount: number, // このエピソードで登場させるコイン枚数(1〜4)
    private ordered: boolean, // true: 決まった順番で1枚ずつ狙わせる / false: 自分で近いものを選ばせる
    private options: CoinEnvOptions = {},
  ) {
    this.placeRandom();
  }

  setCoinCount = (count: number): void => {
    this.coinCount = count;
  };

  setOrdered = (ordered: boolean): void => {
    this.ordered = ordered;
  };

  private currentTarget = (): Coin | null => {
    if (this.ordered) return this.coins[this.orderIndex] ?? null;
    if (this.options.stuckRescue && this.rescueTargetId !== null) {
      return this.coins.find((c) => c.id === this.rescueTargetId) ?? null;
    }
    return nearestRemainingCoin(this.runner.x, this.runner.y, this.coins);
  };

  private distanceToTarget = (): number => {
    const target = this.currentTarget();
    return target ? Math.hypot(target.x - this.runner.x, target.y - this.runner.y) : 0;
  };

  private positionKey = (): string => `${this.runner.x},${this.runner.y},${remainingMask(this.coins)}`;

  private placeRandom = (): void => {
    this.runner.x = R + Math.random() * (WIDTH - R * 2);
    this.runner.y = R + Math.random() * (HEIGHT - R * 2);
    this.coins = createCoins(WIDTH, HEIGHT, R).slice(0, this.coinCount);
    if (this.ordered && this.options.randomOrder) {
      // Fisher-Yates: 狙う順番をエピソードごとにシャッフルする(「一番近い」ではなくランダムに1つずつ)
      for (let i = this.coins.length - 1; i > 0; i--) {
        const j = (Math.random() * (i + 1)) | 0;
        [this.coins[i], this.coins[j]] = [this.coins[j], this.coins[i]];
      }
    } else if (this.ordered && this.options.nearestOrder) {
      // 貪欲最近傍法: 開始位置から一番近いコイン→そこから一番近い次のコイン…の順に固定する。
      // 自由選択モードと違い走行中に「一番近い」を選び直さないので、往復ループが起きない
      this.coins = greedyNearestOrder(this.runner.x, this.runner.y, this.coins);
    }
    this.orderIndex = 0;
    this.prevDistance = this.distanceToTarget();
    this.prevAction = null;
    this.stepIndex = 0;
    this.visitedPositions.clear();
    this.rescueTargetId = null;
    this.noProgressCount = 0;
    this.fakeWaypoint = null;
    this.fakeWaypointSteps = 0;
  };

  // 全部取り終わった後(順番指定モードの最終手)はターゲットが無いので、専用の終端状態にする
  private state = (): string => {
    if (this.ordered) {
      if (this.fakeWaypoint) {
        return relativeState(this.fakeWaypoint.x - this.runner.x, this.fakeWaypoint.y - this.runner.y, BUCKET);
      }
      const target = this.coins[this.orderIndex];
      return target ? orderedState(this.runner.x, this.runner.y, target) : 'cleared';
    }
    if (this.options.stuckRescue && this.rescueTargetId !== null) {
      const target = this.coins.find((c) => c.id === this.rescueTargetId);
      if (target) {
        const rel = relativeState(target.x - this.runner.x, target.y - this.runner.y, BUCKET);
        return `${rel},${fakeMaskFocusOn(this.coins, this.rescueTargetId)}`;
      }
    }
    return freeState(this.runner.x, this.runner.y, this.coins);
  };

  reset = (): string => {
    this.placeRandom();
    return this.state();
  };

  // 現在の局面(コイン配置+自分の位置)を複製して取り出す。
  // 「詰みパターン」の記録・保存に使う(コインはtakenを含めてそのまま複製する)
  snapshot = (): { coins: Coin[]; runnerX: number; runnerY: number } => ({
    coins: this.coins.map((c) => ({ ...c })),
    runnerX: this.runner.x,
    runnerY: this.runner.y,
  });

  // 記録しておいた局面(詰みパターン)をそのまま再現して学習/検証に使う
  loadScenario = (coins: Coin[], runnerX: number, runnerY: number): string => {
    this.coins = coins.map((c) => ({ ...c }));
    this.runner.x = runnerX;
    this.runner.y = runnerY;
    this.orderIndex = 0;
    this.prevDistance = this.distanceToTarget();
    this.prevAction = null;
    this.stepIndex = 0;
    this.visitedPositions.clear();
    this.rescueTargetId = null;
    this.noProgressCount = 0;
    this.fakeWaypoint = null;
    this.fakeWaypointSteps = 0;
    return this.state();
  };

  // stuckRescue: 実座標+マスクの完全再訪(=決定的な環境である以上、確実に詰む)を検知したら、
  // 対処する。順番指定モードでは「今のターゲットを一旦後回しにし、別の未取得コインを先に
  // 狙わせる(順番を入れ替える)」。入れ替え先が無い(最後の1枚)場合は本物のターゲット直前に
  // 仮の目印を出す(makeFakeWaypoint参照。移動そのものは常にエージェントの判断のまま)。
  // 自由選択モードでは「残りコインからランダムに1つだけ選び、それ以外は取得済みであるかの
  // ように見せて単純化する」
  private updateStuckRescue = (): void => {
    if (!this.options.stuckRescue) return;
    if (this.ordered) {
      if (this.fakeWaypoint) {
        // 仮目印に十分近づいたか、猶予ステップを使い切ったら本物のターゲット表示に戻す
        this.fakeWaypointSteps++;
        const distanceToWaypoint = Math.hypot(this.fakeWaypoint.x - this.runner.x, this.fakeWaypoint.y - this.runner.y);
        if (distanceToWaypoint <= R || this.fakeWaypointSteps >= FAKE_WAYPOINT_MAX_STEPS) {
          this.fakeWaypoint = null;
          this.fakeWaypointSteps = 0;
          this.visitedPositions.clear();
        }
        return; // 仮目印表示中は詰み判定を休止する(同じ地点でまた反応するのを防ぐ)
      }
      const key = this.positionKey();
      if (this.visitedPositions.has(key)) {
        const otherIndices: number[] = [];
        for (let i = this.orderIndex + 1; i < this.coins.length; i++) {
          if (!this.coins[i].taken) otherIndices.push(i);
        }
        if (otherIndices.length > 0) {
          const swapWith = otherIndices[(Math.random() * otherIndices.length) | 0];
          [this.coins[this.orderIndex], this.coins[swapWith]] = [this.coins[swapWith], this.coins[this.orderIndex]];
          this.prevDistance = this.distanceToTarget();
        } else {
          const target = this.coins[this.orderIndex];
          this.fakeWaypoint = makeFakeWaypoint(this.runner.x, this.runner.y, target.x, target.y);
          this.fakeWaypointSteps = 0;
        }
        this.visitedPositions.clear();
      } else {
        this.visitedPositions.add(key);
      }
      return;
    }
    if (this.rescueTargetId !== null) {
      const target = this.coins.find((c) => c.id === this.rescueTargetId);
      if (!target || target.taken) {
        this.rescueTargetId = null;
        this.visitedPositions.clear();
        this.prevDistance = this.distanceToTarget();
      }
      return;
    }
    const key = this.positionKey();
    if (this.visitedPositions.has(key)) {
      const candidates = this.coins.filter((c) => !c.taken);
      if (candidates.length > 0) {
        this.rescueTargetId = candidates[(Math.random() * candidates.length) | 0].id;
        this.prevDistance = this.distanceToTarget();
      }
      this.visitedPositions.clear();
    } else {
      this.visitedPositions.add(key);
    }
  };

  step = (action: Direction): CoinStepResult => {
    // 移動は常にactionそのもの(=エージェント自身の判断)に従う。詰み対策は情報(状態表現)
    // だけを変えて誘導し、実際にどちらへ動くかは一切強制しない
    const reversePenalty =
      this.options.antiReversePenalty && this.prevAction !== null && action === OPPOSITE_DIRECTION[this.prevAction]
        ? -this.options.antiReversePenalty
        : 0;
    this.prevAction = action;

    const beforeX = this.runner.x;
    const beforeY = this.runner.y;
    this.runner.move(action);
    this.stepIndex++;
    const timePenalty = this.options.timePenaltyScale ? -this.options.timePenaltyScale * this.stepIndex : 0;

    // 壁でクランプされて移動が完全に無効だった状態が3回続いたら、仮目印を出す
    // (順番の入れ替えでは対処できない、壁際一点の判断ミスによる自己ループ対策)
    const positionUnchanged = this.runner.x === beforeX && this.runner.y === beforeY;
    this.noProgressCount = positionUnchanged ? this.noProgressCount + 1 : 0;
    if (this.options.stuckRescue && this.ordered && this.noProgressCount >= 3 && !this.fakeWaypoint) {
      const target = this.coins[this.orderIndex];
      if (target) {
        this.fakeWaypoint = makeFakeWaypoint(this.runner.x, this.runner.y, target.x, target.y);
        this.fakeWaypointSteps = 0;
      }
      this.noProgressCount = 0;
    }

    this.updateStuckRescue();

    const newDistance = this.distanceToTarget();
    const shaping = (this.prevDistance - newDistance) * SHAPING_SCALE; // 近づいたら+, 離れたら-
    this.prevDistance = newDistance;

    let collected: boolean;
    if (this.ordered) {
      const target = this.coins[this.orderIndex];
      collected = target !== undefined && Math.hypot(target.x - this.runner.x, target.y - this.runner.y) <= R;
      if (collected) {
        target.taken = true;
        this.orderIndex++;
        this.prevDistance = this.distanceToTarget();
      }
    } else {
      collected = collect(this.runner.x, this.runner.y, R, this.coins);
    }
    const cleared = collected && (this.ordered ? this.orderIndex >= this.coins.length : allTaken(this.coins));

    if (cleared) {
      return { state: this.state(), reward: COIN_REWARD + CLEAR_REWARD + reversePenalty + timePenalty, done: true };
    }
    return {
      state: this.state(),
      reward: STEP_PENALTY + shaping + (collected ? COIN_REWARD : 0) + reversePenalty + timePenalty,
      done: false,
    };
  };
}
