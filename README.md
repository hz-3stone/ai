# move-canvas

WASD/矢印キー・スマホの仮想スティック・HTTP API のいずれからでも操作できる、丸を動かすだけのシンプルなアプリ。`move.ts` が本体（状態と全ロジック）で、`index.html` はその状態をそのまま描画するだけの薄いビューアです。

## 構成

- `src/circle.ts` — 操作対象の円。座標・固定の可動範囲(400x400)・8方向移動ロジックを持つ、I/Oを持たない純粋なクラス。
- `src/spawnPoint.ts` — 指定した座標から一定距離以上離れた場所にランダム配置するクラス。学習時のゴール地点(`src/rl/env.ts`)と、赤(enemy)の初期位置/再配置(`src/move.ts`)の両方で使う。
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

- `src/rl/env.ts` — `Circle`/`SpawnPoint`を使い、状態(ターゲットとの相対位置を20px単位で離散化)と報酬(距離が縮んだら+、ゴールで+100)を定義する環境。
- `src/rl/qlearning.ts` — ε-greedyで行動選択し、Q学習の更新式で学習するエージェント。
- `src/rl/train.ts` — 学習ループ本体。主要なハイパーパラメータ(学習率・割引率・探索率・状態のバケツ幅など)はファイル冒頭にまとまっている。
- `src/rl/play.ts` — 学習済みQテーブルを使い、実際に動いている`move.ts`サーバーの青(player)をHTTP経由で操作する。

### 鬼ごっこ (自己対戦)

赤(enemy)が青(player)を追いかけ続ける鬼ごっこを強化学習で作る実験。同じ速さの相手を追う/逃げるのは(この盤面サイズだと)ほぼ不可能に近いことが分かったため、学習は「evader(逃げる側)を大幅に速くする」ところから始め、育ったevaderを固定相手にchaser(追う側)を鍛え直す、という**交互の自己対戦**で両方のQテーブルを育てている。

- `src/rl/evadeEnv.ts` — 2体の`Circle`(runner/chaser)を使う環境。状態は「追手との相対位置」+「上下左右の壁までの距離」。壁までの距離を状態に含めないと、壁際に追い詰められた状況を区別できず簡単に捕まってしまうことが分かったため。壁1pxに近づくごとの小さな減点も加えている(角は2軸分になるのでより不利)。追手(chaser)側の動きは学習済みの`chase`方策を固定で使う
- `src/rl/trainEvade.ts` — evaderの学習ループ。`SPEED_START`/`SPEED_END`でrunner(青)の速さをchaserの何倍にするか設定できる(カリキュラム学習にも、固定速度での学習にも使える)
- `src/rl/evade.ts` — 学習済みevadeQtable.jsonで青(player)を操作し、赤から逃げさせる
- `src/rl/chaseEnv.ts` — evadeEnv.tsと対称の環境。evadeStateは「自分の壁との距離+相手との相対位置」という幾何学的に対称な計算なので、chaser視点でもそのまま使い回せる。evader側の動きは学習済みの`evade`方策を固定で使う
- `src/rl/trainChase.ts` — chaserの学習ループ。固定相手にした`evadeQtable.json`をどれだけの速さ倍率で使うか設定できる
- `src/rl/chase.ts` — 学習済みchaseQtable.jsonで赤(enemy)を操作し、青を追いかけさせる

```
npm run train         # 「静止ターゲットに近づく」基礎方策を学習し qtable.json に保存 (このファイルはgitignore対象)
npm start              # 別ターミナルでサーバーを起動しブラウザ/スマホで見る
npm run play            # 学習済みQテーブルで青(player)を自動操作する

npm run train:evade    # qtable.jsonのchaserを固定相手に、逃げるAIを学習し evadeQtable.json に保存
npm run evade           # 学習済みevadeQtable.jsonで青(player)に赤から逃げさせる
npm run train:chase    # evadeQtable.jsonのevaderを固定相手に、追いかけるAIを学習し chaseQtable.json に保存
npm run chase           # 学習済みchaseQtable.jsonで赤(enemy)に青を追いかけさせる
```

`npm run chase`と`npm run evade`を別ターミナルで同時に動かすと、実際に鬼ごっこが見られる。

## チェック

```
npm run typecheck   # TypeScript型チェック
npm run lint        # ESLint
npm run lint:html   # markuplint (index.html)
```

貢献ルールは [CONTRIBUTING.md](CONTRIBUTING.md) を参照してください。
