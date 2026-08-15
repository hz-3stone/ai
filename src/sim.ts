// インプロセスモード: HTTPを一切介さず Circle を直接叩く最速経路。
// move.ts (サーバー) は起動しない。ML等で桁違いの回数動かしたいときに使う。
import { Circle, Direction } from './circle';

const circle = new Circle(400, 400, 20, 4);

// 例: ランダムに8方向へ100万回動かす
const DIRECTIONS: Direction[] = ['0', '1', '2', '3', '4', '5', '6', '7'];
const STEPS = 1_000_000;

const start = performance.now();
for (let i = 0; i < STEPS; i++) {
  circle.move(DIRECTIONS[(Math.random() * 8) | 0]);
}
const ms = performance.now() - start;

console.log(`${STEPS}手: ${ms.toFixed(1)}ms (${(STEPS / (ms / 1000) / 1e6).toFixed(1)}M手/秒)`);
console.log(`final: ${circle.toText()}`);
