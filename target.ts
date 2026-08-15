export class Target {
  x: number;
  y: number;

  constructor(
    private readonly width: number,
    private readonly height: number,
    private readonly radius: number,
  ) {
    this.x = width / 2;
    this.y = height / 2;
  }

  // from(x,y) から minDistance 以上離れた場所にランダム再配置する
  randomize = (fromX: number, fromY: number, minDistance: number): void => {
    let x: number, y: number;
    do {
      x = this.radius + Math.random() * (this.width - this.radius * 2);
      y = this.radius + Math.random() * (this.height - this.radius * 2);
    } while (Math.hypot(x - fromX, y - fromY) < minDistance);
    this.x = x;
    this.y = y;
  };

  toText = (): string => `${this.x},${this.y}`;
}
