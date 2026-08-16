import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import readline from 'readline';
import { Circle, isDirection } from './circle';
import { allTaken, collect, createCoins } from './coins';
import { SpawnPoint } from './spawnPoint';

try {
  process.loadEnvFile(); // .env があれば読み込む (無くてもエラーにしない)
} catch {
  // .env が無ければ何もしない
}

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

// 固定の可動範囲 (画面サイズに依存しない)。マップは元の4倍(縦横2倍)。
// 2000x2000(25倍)は視界(400x400相当)に対して広すぎて「発見」自体が学習できなかったため、
// 一旦800x800まで狭めて再挑戦する
const WIDTH = 800, HEIGHT = 800, R = 20, STEP = 4, MIN_DISTANCE = 400;
const TOUCH_DISTANCE = R * 2; // 円同士の半径がぶつかる距離

const player = new Circle(WIDTH, HEIGHT, R, STEP); // 青: プレイヤー操作 (HTML/POST /move)
const enemy = new Circle(WIDTH, HEIGHT, R, STEP); // 赤: AI/CLI操作 (POST /move-enemy。HTMLからは操作できない)

// enemyの配置(初期位置・触れた後の再配置)にSpawnPointを使う
const enemySpawn = new SpawnPoint(WIDTH, HEIGHT, R);
const respawnEnemy = (): void => {
  enemySpawn.randomize(player.x, player.y, MIN_DISTANCE); // 現在地から一定以上離れた場所に出現
  enemy.x = enemySpawn.x;
  enemy.y = enemySpawn.y;
};
respawnEnemy();

// マス目1つに1枚、青(player)が集める。全部集めたらクリアとして次のラウンドへ続ける
let coins = createCoins(WIDTH, HEIGHT, R);

const broadcaster = new Broadcaster();

const touching = (): boolean =>
  Math.hypot(player.x - enemy.x, player.y - enemy.y) <= TOUCH_DISTANCE;

// px,py,ex,ey + コイン一覧(可変長・構造化データなのでJSON)
const state = (): string =>
  JSON.stringify({ px: player.x, py: player.y, ex: enemy.x, ey: enemy.y, coins });

const collectCoinsForPlayer = (): void => {
  if (collect(player.x, player.y, R, coins) && allTaken(coins)) {
    coins = createCoins(WIDTH, HEIGHT, R); // クリア: 新しいコインで次のラウンドへ続ける
  }
};

// raw は "3" のような単発でも "3377..." のようなバッチでもよい。
// 不正な文字は無視するだけで、1リクエストにまとめるほど通信回数が減って軽くなる。
// player/enemy どちらの移動で触れても、赤(enemy)を再配置する(赤がまた追いかけ直す)
const makeMoveHandler = (mover: Circle, onMoved?: () => void) => (raw: string): string => {
  for (let i = 0; i < raw.length; i++) {
    const dir = raw[i];
    if (!isDirection(dir)) continue;
    mover.move(dir);
    if (touching()) respawnEnemy();
    onMoved?.();
  }
  const text = state();
  broadcaster.send(text);
  return text;
};

const handlePlayerMove = makeMoveHandler(player, collectCoinsForPlayer); // コインを集めるのは青だけ
const handleEnemyMove = makeMoveHandler(enemy);

// ハンバーガーメニュー(視点切り替え)はAIの挙動を観察するデバッグ機能なので、
// 通常プレイでは隠す。.envや `DEBUG_VIEW=1 npm start` で有効化できるようにする
const DEBUG_VIEW = Boolean(process.env.DEBUG_VIEW);
const rawHtml = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const html = DEBUG_VIEW ? rawHtml.replace('data-debug-view="false"', 'data-debug-view="true"') : rawHtml;

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
      res.end(handlePlayerMove(body.trim()));
    });
    return;
  }

  // 赤(enemy)専用。HTMLからは呼ばれない。CLI/AIスクリプト経由でのみ操作する
  if (req.url === '/move-enemy' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(handleEnemyMove(body.trim()));
    });
    return;
  }

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
};

// LAN内の別端末(スマホ等)から開くためのIPを探す。.envのHOSTがあればそれを優先する
const lanIp = (): string | undefined => {
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const addr of addrs ?? []) {
      if (addr.family === 'IPv4' && !addr.internal) return addr.address;
    }
  }
  return undefined;
};

const PORT = Number(process.env.PORT) || 3000;

const server = http.createServer(requestListener);
server.listen(PORT, () => {
  console.log(`http://localhost:${PORT}`);
  const ip = process.env.HOST || lanIp();
  if (ip) console.log(`http://${ip}:${PORT}  (同じWi-Fi内のスマホなどから)`);
});

// move.ts単体でも動作: ターミナルで 0-7 (連続入力可) + Enter (青を操作する)
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.on('line', (input) => handlePlayerMove(input.trim()));
