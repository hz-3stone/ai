import type { Direction } from '../circle';

const ACTIONS: Direction[] = ['0', '1', '2', '3', '4', '5', '6', '7'];

// Q[state] = 各行動(8方向)を取ったときの期待価値。初めて見る状態は全部0からスタート。
export class QLearningAgent {
  private q = new Map<string, number[]>();

  constructor(
    private readonly alpha: number, // 学習率: 新しい経験をどれだけ強く反映するか
    private readonly gamma: number, // 割引率: 将来の報酬をどれだけ重視するか
  ) {}

  private valuesOf = (state: string): number[] => {
    let values = this.q.get(state);
    if (!values) {
      values = new Array(ACTIONS.length).fill(0);
      this.q.set(state, values);
    }
    return values;
  };

  // ε-greedy: 確率epsilonでランダムに探索し、それ以外は今の最善手を選ぶ
  chooseAction = (state: string, epsilon: number): Direction => {
    if (Math.random() < epsilon) {
      return ACTIONS[(Math.random() * ACTIONS.length) | 0];
    }
    const values = this.valuesOf(state);
    let best = 0;
    for (let i = 1; i < values.length; i++) {
      if (values[i] > values[best]) best = i;
    }
    return ACTIONS[best];
  };

  // Q学習の更新式: Q(s,a) += alpha * (reward + gamma * max(Q(s')) - Q(s,a))
  update = (state: string, action: Direction, reward: number, nextState: string): void => {
    const values = this.valuesOf(state);
    const nextValues = this.valuesOf(nextState);
    const actionIndex = ACTIONS.indexOf(action);
    const maxNext = Math.max(...nextValues);
    values[actionIndex] += this.alpha * (reward + this.gamma * maxNext - values[actionIndex]);
  };

  get stateCount(): number {
    return this.q.size;
  }

  toJSON = (): Record<string, number[]> => Object.fromEntries(this.q);

  static fromJSON(data: Record<string, number[]>): QLearningAgent {
    const agent = new QLearningAgent(0, 0); // 推論専用なのでalpha/gammaは使わない
    for (const [state, values] of Object.entries(data)) agent.q.set(state, values);
    return agent;
  }
}
