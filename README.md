# move-canvas

WASD/矢印キー・スマホの仮想スティック・HTTP API のいずれからでも操作できる、丸を動かすだけのシンプルなアプリ。`move.ts` が本体（状態と全ロジック）で、`index.html` はその状態をそのまま描画するだけの薄いビューアです。

## 構成

- `src/circle.ts` — 操作対象の円。座標・固定の可動範囲(400x400)・8方向移動ロジックを持つ、I/Oを持たない純粋なクラス。
- `src/target.ts` — ランダムに出現する目的地。現在地から一定距離以上離れた場所に配置するルールを持つ。
- `src/move.ts` — 本体。青(player)と赤(enemy)の2つの`Circle`を持つHTTPサーバー(SSE配信 + `/move` + `/move-enemy` + `/state`)とCLI標準入力を提供する。
- `public/index.html` — ビューア。SSEで受け取った状態をcanvasに描画し、キーボード/スティック入力を数字(0〜7)に変換して`/move`(青のみ)に送るだけ。赤(enemy)はHTMLからは一切操作できない。
- `src/sim.ts` — インプロセスモードの例。HTTPを一切介さず`Circle`を直接ループで叩く、高頻度シミュレーション用のエントリポイント。
- `src/rl/` — 強化学習(Qラーニング)でcircleにターゲットへの移動を学習させる実験コード。詳細は下記「強化学習」を参照。

## 操作プロトコル

方向は `0`〜`7` の1文字で表す。

```
0:上 1:下 2:左 3:右 4:左上 5:右上 6:左下 7:右下
```

`POST /move`(青) / `POST /move-enemy`(赤) のbodyには複数文字をまとめて送れる（例: `"3377"`）。不正な文字は無視される。レスポンスは `"px,py,ex,ey"` のプレーンテキスト。赤は`/move-enemy`を直接叩くCLI/AIからしか操作できない。

## セットアップ

```
npm install
npm start        # http://localhost:3000 でサーバー起動 (ブラウザ操作 + HTTP API + CLI標準入力)
npm run sim       # インプロセス高速シミュレーションの例
```

## AI/プログラムからの操作例

```
curl -X POST -d "3377" http://localhost:3000/move
# -> "220,208,102,49"  (px,py,ex,ey)
curl -X POST -d "22" http://localhost:3000/move-enemy
# -> "220,208,94,49"
curl http://localhost:3000/state
# -> "220,208,94,49"
```

## 強化学習

`src/rl/` に、circleがランダムに出現するターゲットまで自力で移動できるよう学習する、表形式Qラーニングの実験コードがある。

- `src/rl/env.ts` — `Circle`/`Target`を使い、状態(ターゲットとの相対位置を20px単位で離散化)と報酬(距離が縮んだら+、ゴールで+100)を定義する環境。
- `src/rl/qlearning.ts` — ε-greedyで行動選択し、Q学習の更新式で学習するエージェント。
- `src/rl/train.ts` — 学習ループ本体。主要なハイパーパラメータ(学習率・割引率・探索率・状態のバケツ幅など)はファイル冒頭にまとまっている。
- `src/rl/play.ts` — 学習済みQテーブルを使い、実際に動いている`move.ts`サーバーの青(player)をHTTP経由で操作する。
- `src/rl/chase.ts` — 同じ学習済みQテーブルを流用し、赤(enemy)に青(player)を追いかけさせる。このQテーブルは「静止したターゲットに近づく」ために学習したものであり、動くプレイヤーを追いかける訓練はしていない。そのままでどう動くかを見るための実験。

```
npm run train   # 学習を実行し、結果を src/rl/qtable.json に保存する (このファイルはgitignore対象)
npm start        # 別ターミナルでサーバーを起動しブラウザ/スマホで見る
npm run play      # 学習済みQテーブルで青(player)を自動操作する
npm run chase     # 学習済みQテーブルで赤(enemy)に青を追いかけさせる (キーボード/スティックで青を操作しながら試せる)
```

## チェック

```
npm run typecheck   # TypeScript型チェック
npm run lint        # ESLint
npm run lint:html   # markuplint (index.html)
```

貢献ルールは [CONTRIBUTING.md](CONTRIBUTING.md) を参照してください。
