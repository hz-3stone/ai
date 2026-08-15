import http from 'http';
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { Circle, isDirection } from './circle';
import { Target } from './target';

class Broadcaster {
  private clients: http.ServerResponse[] = [];

  add = (res: http.ServerResponse): void => {
    this.clients.push(res);
    res.on('close', () => {
      this.clients = this.clients.filter((c) => c !== res);
    });
  };

  send = (text: string): void => {
    if (this.clients.length === 0) return;
    const payload = `data: ${text}\n\n`;
    for (const res of this.clients) res.write(payload);
  };
}

// 固定の可動範囲 (画面サイズに依存しない)
const WIDTH = 400, HEIGHT = 400, R = 20, STEP = 4, MIN_DISTANCE = 200;
const TOUCH_DISTANCE = R * 2; // 円同士の半径がぶつかる距離

const circle = new Circle(WIDTH, HEIGHT, R, STEP);
const target = new Target(WIDTH, HEIGHT, R);
target.randomize(circle.x, circle.y, MIN_DISTANCE); // 起動時: 現在地から一定以上離れた場所に出現

const broadcaster = new Broadcaster();

const touching = (): boolean =>
  Math.hypot(circle.x - target.x, circle.y - target.y) <= TOUCH_DISTANCE;

// "cx,cy,tx,ty" の4値だけの軽量表現
const state = (): string => `${circle.toText()},${target.toText()}`;

// raw は "3" のような単発でも "3377..." のようなバッチでもよい。
// 不正な文字は無視するだけで、1リクエストにまとめるほど通信回数が減って軽くなる。
const handleMoves = (raw: string): string => {
  for (let i = 0; i < raw.length; i++) {
    const dir = raw[i];
    if (!isDirection(dir)) continue;
    circle.move(dir);
    if (touching()) target.randomize(circle.x, circle.y, MIN_DISTANCE); // 触れたら初回生成時と同じルールで再配置
  }
  const text = state();
  broadcaster.send(text);
  return text;
};

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'));

const requestListener = (req: http.IncomingMessage, res: http.ServerResponse): void => {
  if (req.url === '/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.write(`data: ${state()}\n\n`); // 接続時点の現在位置
    broadcaster.add(res);
    return;
  }

  if (req.url === '/state' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end(state());
    return;
  }

  if (req.url === '/move' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(handleMoves(body.trim()));
    });
    return;
  }

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
};

const server = http.createServer(requestListener);
server.listen(3000, () => console.log('http://localhost:3000'));

// move.ts単体でも動作: ターミナルで 0-7 (連続入力可) + Enter
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.on('line', (input) => handleMoves(input.trim()));
