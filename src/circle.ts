// 0:上 1:下 2:左 3:右 4:左上 5:右上 6:左下 7:右下
export type Direction = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7';

export const isDirection = (v: string): v is Direction =>
  v.length === 1 && v >= '0' && v <= '7';

// 直前と正反対の方向(上下入れ替え等)を選ぶと実質その場に足踏みしてしまうため、
// 「足踏み」を検知する報酬シェーピングで使う
export const OPPOSITE_DIRECTION: Record<Direction, Direction> = {
  '0': '1', '1': '0', '2': '3', '3': '2', '4': '7', '7': '4', '5': '6', '6': '5',
};

export class Circle {
  x: number;
  y: number;

  constructor(
    private readonly width: number,
    private readonly height: number,
    private readonly radius: number,
    private readonly step: number,
  ) {
    this.x = width / 2;
    this.y = height / 2;
  }

  private clamp = (): void => {
    this.x = Math.max(this.radius, Math.min(this.width - this.radius, this.x));
    this.y = Math.max(this.radius, Math.min(this.height - this.radius, this.y));
  };

  move = (dir: Direction): void => {
    switch (dir) {
      case '0': this.y -= this.step; break; // 上
      case '1': this.y += this.step; break; // 下
      case '2': this.x -= this.step; break; // 左
      case '3': this.x += this.step; break; // 右
      case '4': this.x -= this.step; this.y -= this.step; break; // 左上
      case '5': this.x += this.step; this.y -= this.step; break; // 右上
      case '6': this.x -= this.step; this.y += this.step; break; // 左下
      case '7': this.x += this.step; this.y += this.step; break; // 右下
    }
    this.clamp();
  };

  // w,h,r は固定で変化しないため送らない。x,y だけの軽量表現。
  toText = (): string => `${this.x},${this.y}`;
}
