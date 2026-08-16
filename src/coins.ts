// マップを CELL_SIZE 四方のグリッドに分割し、1マスに1枚ずつコインを配置する。
// 視界窓(VISIBILITY_HALFの2倍)と同じ大きさにしているので、マップの倍率と枚数が一致する
// (800x800なら2x2=4枚、2000x2000なら5x5=25枚)。
export const CELL_SIZE = 400;

export interface Coin {
  id: number;
  x: number;
  y: number;
  taken: boolean;
}

// セル内のランダムな位置(端からradius分マージンを空ける)に、SpawnPointと同様の乱数配置で生成する
export const createCoins = (width: number, height: number, radius: number): Coin[] => {
  const cols = Math.round(width / CELL_SIZE);
  const rows = Math.round(height / CELL_SIZE);
  const coins: Coin[] = [];
  let id = 0;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const cellX = col * CELL_SIZE;
      const cellY = row * CELL_SIZE;
      coins.push({
        id: id++,
        x: cellX + radius + Math.random() * (CELL_SIZE - radius * 2),
        y: cellY + radius + Math.random() * (CELL_SIZE - radius * 2),
        taken: false,
      });
    }
  }
  return coins;
};

// 一番近い未取得コイン。無ければnull(全部取得済み=クリア状態)
export const nearestRemainingCoin = (x: number, y: number, coins: Coin[]): Coin | null => {
  let nearest: Coin | null = null;
  let nearestDistance = Infinity;
  for (const coin of coins) {
    if (coin.taken) continue;
    const distance = Math.hypot(coin.x - x, coin.y - y);
    if (distance < nearestDistance) {
      nearest = coin;
      nearestDistance = distance;
    }
  }
  return nearest;
};

// 全コインの取得状況を"0101"のような固定長文字列にする(状態のキーにそのまま使う)
export const remainingMask = (coins: Coin[]): string => coins.map((c) => (c.taken ? '1' : '0')).join('');

// 半径radius以内の未取得コインをtakenにする。1つでも取ったらtrueを返す
export const collect = (x: number, y: number, radius: number, coins: Coin[]): boolean => {
  let collected = false;
  for (const coin of coins) {
    if (coin.taken) continue;
    if (Math.hypot(coin.x - x, coin.y - y) <= radius) {
      coin.taken = true;
      collected = true;
    }
  }
  return collected;
};

export const allTaken = (coins: Coin[]): boolean => coins.every((c) => c.taken);
