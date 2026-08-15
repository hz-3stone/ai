# move-canvas

WASD/矢印キー・スマホの仮想スティック・HTTP API のいずれからでも操作できる、丸を動かすだけのシンプルなアプリ。`move.ts` が本体（状態と全ロジック）で、`index.html` はその状態をそのまま描画するだけの薄いビューアです。

## 構成

- `src/circle.ts` — 操作対象の円。座標・固定の可動範囲(400x400)・8方向移動ロジックを持つ、I/Oを持たない純粋なクラス。
- `src/target.ts` — ランダムに出現する目的地。現在地から一定距離以上離れた場所に配置するルールを持つ。
- `src/move.ts` — 本体。`circle.ts`/`target.ts`を使い、HTTPサーバー(SSE配信 + `/move` + `/state`)とCLI標準入力の両方を提供する。
- `public/index.html` — ビューア。SSEで受け取った状態をcanvasに描画し、キーボード/スティック入力を数字(0〜7)に変換して`/move`に送るだけ。
- `src/sim.ts` — インプロセスモードの例。HTTPを一切介さず`Circle`を直接ループで叩く、高頻度シミュレーション用のエントリポイント。

## 操作プロトコル

方向は `0`〜`7` の1文字で表す。

```
0:上 1:下 2:左 3:右 4:左上 5:右上 6:左下 7:右下
```

`POST /move` のbodyには複数文字をまとめて送れる（例: `"3377"`）。不正な文字は無視される。レスポンスは `"x,y"` のプレーンテキスト。

## セットアップ

```
npm install
npm start        # http://localhost:3000 でサーバー起動 (ブラウザ操作 + HTTP API + CLI標準入力)
npm run sim       # インプロセス高速シミュレーションの例
```

## AI/プログラムからの操作例

```
curl -X POST -d "3377" http://localhost:3000/move
# -> "220,208"
curl http://localhost:3000/state
# -> "220,208,102,49"  (cx,cy,tx,ty)
```

## チェック

```
npm run typecheck   # TypeScript型チェック
npm run lint        # ESLint
npm run lint:html   # markuplint (index.html)
```

貢献ルールは [CONTRIBUTING.md](CONTRIBUTING.md) を参照してください。
