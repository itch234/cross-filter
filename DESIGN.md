# クロスフィルター加工ツール 設計書 v1

作成: 2026-09-18 (Fable 5.1) / 実装: 同日 Fable 5.1(当初 Opus 5 の予定をユーザー指示で変更)
対になる文書: 引き継ぎブリーフ(ユーザー作成、`legacy/BRIEF.md` に写しあり)。ブリーフと本書が食い違う場合は**本書を優先**する。
本書で「決め」と書いた項目は設計時の決定事項なので、実装側で変えない。変えたくなったら MEMORY.md に理由を書いて止まる。
「TUNE」と書いた数値は調整前提の初期値。変えてよいが、変えたら MEMORY.md に旧値・新値・根拠を残す。

---

## 0. ゴール

試作版(`legacy/cross-filter-v0.html`、以下 v0)を引き継ぎ、

1. 「強さ」や「光を拾う明るさ」を上げても光条が本物のクロスフィルター(Kenko STAR4 相当)らしく見える
2. スマホのブラウザから、写真を選ぶ → 調整 → 保存(写真アプリに入る)まで完結する
3. GitHub Pages の静的 HTML 1 枚で動く

状態にする。

### 設計時の決定(決め)

| 項目 | 決定 | 理由 |
|---|---|---|
| 成果物 | `cross-filter/index.html` 単一 HTML。ビルド無し、外部ライブラリ無し | ブリーフどおり。Google Fonts の link だけは v0 から継続(無くても動く) |
| 公開 | `cross-filter/` を**独立した public リポジトリ**にして GitHub Pages(main / root)で公開 | 親リポジトリの一部では Pages が使えない。秘密情報を含まないので public で問題ない。親の `.gitignore` に `cross-filter/` を追加する(agave-watering と同じ扱い) |
| git 操作 | 実装時に変更: PowerShell 側から git / gh が使えたので、リポジトリ作成・push・Pages 有効化まで実装側(Fable)が行った | 設計時は「サンドボックスから git が使えない」前提だったが、PowerShell ツールでは使えた |
| 違和感の主因 | (1) 光条の断面が平らで、強さを上げると根元が一定幅の白帯になる (2) 減衰が単一指数で、白帯の先で急に消える (3) 弱い光も強い光も同じ調子で光る | §2 の数値モデルで確認済み。v0 の実機スクリーンショットは実装の最初に撮って裏取りする(§7 手順0) |
| 対策の採否 | ブリーフの A・B・D を採用し必須とする。C(光源強度の推定)は実装するが **既定では無効(TUNE.haloGain=0)**。比較画像を出してユーザーが判断してから有効化する | A・B・D は数値モデルで効果を確認した。C は実写でしか良否が判断できない |
| スライダー | 主要 3 本(長さ・強さ・光を拾う明るさ)の**意味は変えない**。「強さ」の内部マッピングだけ変える。こまかい調整に「裾の伸び」を 1 本追加 | 利用者は「おおむねかなりいい」と言っているので操作体系は保つ |
| localStorage | キーを `crossfilter.params.v4` に上げる。v3 の値は読まない | 「強さ」のマッピングと既定値が変わるため(ブリーフの制約) |
| 保存 | 結果ダイアログに「共有する」(Web Share API、ファイル共有可能なときだけ表示)と「ファイルとして保存」(a[download])を並べる。`window.claude` 経由の保存は残す | iOS Safari で写真アプリに入れる確実な経路は共有シート。a[download] は iOS で挙動が不安定 |
| 書き出しサイズ | v0 のまま(最大約 1600 万画素、光条は長辺 2048 で計算、失敗時に半分で 1 回再試行) | iOS の上限に合わせてある。変えない |
| テスト | Node + `playwright-core` + 手元の Edge(`msedge.exe`)。Chromium 別途ダウンロードは不要。`BROWSER_PATH` で差し替え可 | weight-finder と同じ方式。Edge は `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe` に存在することを確認済み |
| 試作版の扱い | `legacy/cross-filter-v0.html` として残す。テストフック `window.__cf`(§6)を足す以外は変更しない | 変更前後の比較(検証条件 2・3)に必要 |

---

## 1. 全体構成(v1 パイプライン)

すべて WebGL2。RGBA16F(非対応時 RGBA8)のレンダーターゲット。v0 から**変わるところを太字**にした。

```
src (RGBA8, mips)  ← 元画像そのまま(sRGB)。add≒0 の画素はこれをそのまま出力する
  │
  ├─ bright ─────→ bright (RGBA16F, mips)  rgb=線形色×w, a=w   ※ w の急峻化は weigh 側で行う
  │
  ├─ **lum** ────→ lum (R16F, mips)  線形輝度。C(光源強度推定)の DoG 用。float 非対応なら R8
  │
  └─ **weigh** (旧 isolate) ─→ c (RGBA16F, mips)
        入力: bright, lum
        広い明部の除外(v0 どおり) × 強度重み I(§3.2)
        │
        ├─ streak-core: c を lod=TUNE.coreLod で読み、v0 と同じ 8 タップ×最大 4 パスの連鎖
        │     → accum (full, RGBA16F)   方向ごとに加算
        │
        └─ **streak-tail**: c を lod=TUNE.tailLod で読み、τ×TUNE.tailK の連鎖を**半解像度**で
              → tail (w/2×h/2, RGBA16F) 方向ごとに加算
  │
composite
  star = max(accum − N·c(coreLod), 0) + β·max(tail − N·c(tailLod), 0)
  add  = star·gain + glow·glowAmt     (v0 と同じく線形空間)
  a    = 1 − exp(−add) → 元画像にスクリーン合成。ディザ。add≒0 なら src をそのまま
```

方向数 4/6/8、角度、にじみ(glow)、光条の色、虹色(τ の RGB 分散)は v0 のまま。

---

## 2. 症状の診断(数値モデル)

`tools/sim_streak.py` は v0 の streak → composite を 1 方向・グレースケール・黒地で再現したもの(numpy のみ)。
光源は白飛びした半径 3px の円、長さスライダー 40(τ≈19.5px @1440)、黒地なので出力値 = 1−exp(−add)。

**v0(現行)**、光源の線形強度 I0=3(街灯相当)、強さ 90:

| r (px) | 0 | 5 | 10 | 20 | 30 | 40 | 60 | 80 | 120 | 160 |
|---|---|---|---|---|---|---|---|---|---|---|
| 軸上の表示値 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 0.99 | 0.84 | 0.48 | 0.08 | 0.01 |
| 飽和(>0.97)幅 px | 7 | 7 | 7 | 7 | 7 | 5 | 0 | 0 | 0 | 0 |

根元から r≈40 まで幅 7px の白帯が一定幅で続き(光源の直径そのまま)、その先 r≈80 で急に消える。可視長 149px に対し白帯 45px(30%)。これが「白い帯」。強さ 30→90 で可視長は 95→149px と 1.6 倍に伸びるので、利用者には「明るくなった」より「太く長い棒が出た」と映る。

**v1(提案)**、同条件(gain 上限 1.0、β=0.3、tailK=3.5、core σ≈1.2px、tail σ≈4px):

| r (px) | 0 | 5 | 10 | 20 | 30 | 40 | 60 | 80 | 120 | 160 |
|---|---|---|---|---|---|---|---|---|---|---|
| 軸上の表示値 | 1.00 | 1.00 | 1.00 | 1.00 | 0.99 | 0.95 | 0.78 | 0.59 | 0.33 | 0.19 |
| 飽和(>0.97)幅 px | 5 | 7 | 7 | 7 | 3 | 0 | 0 | 0 | 0 | 0 |

白帯は r≈32 で終わり(可視長 319px の 11%)、その先は 0.95→0.78→0.59→0.33→0.19 と段階的に薄くなる。飽和幅も 7→3→0 と先細る。

**実機での裏取り(設計時、内蔵ブラウザ・サンプル夜景)**: 強さ 90(他は既定)では、街灯も窓もすべての光条が太さ一定の白い棒になり、交差して格子状に見える。光源ごとの明るさの差も消える。強さ 45・光を拾う明るさ 60 では、窓明かりが街灯とほぼ同じ長さ・明るさで一斉に光る。どちらも上の数値モデルの説明と一致する。実装側は手順 0 で 6 枚の行列画像として正式に記録し直すこと。

**判定指標(決め)**: 白点テストでの `白帯長 / 可視長`。v0 は 0.30、v1 の目標は **0.20 以下**(強さ 90、I0=1 と 3 の両方)。§7 の検証条件 3 の自動判定に使う。

弱い光(I0=1、しきい値を下げたときの窓明かり相当)については、v0 では可視長が I0=3 の 85%(127 vs 149px)しかない。可視長は τ·ln(gain·I0/ε) なので、**光源ごとの I0 の差を大きくすれば長さの差は自動的に出る**(ブリーフ D の「弱い光源ほど τ を短く」は個別に実装しない。§3.2 の重みで実現する)。

---

## 3. シェーダー仕様(変更点)

### 3.1 bright(変更なし)

v0 のまま。`o = vec4(c*w, w)`。w の急峻化は weigh で `pow(a, TUNE.wPow)` として掛ける(bright の α は他でも使うので生のまま残す)。

### 3.2 lum と weigh(新設・改修)

lum: `o = vec4(dot(toLin(s), vec3(0.2126,0.7152,0.0722)), 0,0,1)` を R16F へ。mips 生成。
sRGB の src の mips を toLin しても線形平均にならない(小さい光源が 50 倍以上過小になる)ので、線形輝度のテクスチャを別に持つ。

weigh:

```glsl
uniform sampler2D uBright, uLum, uSrc;
uniform float uLod, uIso;              // v0 の isolate と同じ
uniform float uWPow, uLvPow;           // TUNE.wPow=2, TUNE.lvPow=3
uniform float uHaloLod, uHaloGain, uHaloMax;   // C 用。TUNE.haloGain=0 で無効
void main(){
  vec4 b = texture(uBright, vUv);
  // 広い明部の除外(v0 どおり)
  float f = max(textureLod(uBright, vUv, uLod).a*0.5, textureLod(uBright, vUv, uLod+1.5).a);
  float hi = 2.5*pow(0.048, uIso), lo = hi*0.4;
  float p = 1.0 - smoothstep(lo, hi, f);
  // D: 抽出量を輝度に対して急峻に
  float lv = max3(toLin(texture(uSrc, vUv).rgb));
  float I = pow(b.a, uWPow - 1.0) * pow(lv, uLvPow - 1.0);   // b.rgb に既に w¹·lv¹ 相当が入っている
  // C: 白飛びで失われた光源強度を、周囲のにじみ量/抽出面積 で補う(radiance の代理)
  if(uHaloGain > 0.0){
    float lh = textureLod(uLum, vUv, uHaloLod).r;         // 長辺/96 の窓の線形平均輝度
    float lb = textureLod(uLum, vUv, uHaloLod + 2.0).r;   // その 4 倍の窓 = 局所背景
    float aw = textureLod(uBright, vUv, uHaloLod).a;      // 同じ窓での抽出面積率
    float rad = clamp((lh - lb) / max(aw, 0.02), 0.0, uHaloMax);
    I *= 1.0 + uHaloGain * rad;
  }
  o = vec4(b.rgb * p * I, b.a * p);
}
```

`rad` の意味: 窓内の「背景を超える線形輝度」を「抽出された面積」で割ったもの。小さく強い街灯(にじみが大きい)は大きく、面積の大きい窓明かりや看板は小さくなる。`aw` で割るのは、面積ではなく輝度(radiance)に比例させたいから。看板のような広い明部は lh≈lb で rad≈0 になり、かつ p で消える。

TUNE 初期値: wPow=2, lvPow=3, haloLod=log2(long/96), haloGain=0(比較後に 3 を候補), haloMax=4。

### 3.3 streak(2 成分)

FS_STREAK に `uniform float uSrcLod;` を足し、連鎖の**初段だけ** `textureLod(uTex, uv, uSrcLod)`、2 段目以降は lod 0(ピンポン用テクスチャは mips なし)。

| 成分 | 入力 lod | τ | 解像度 | 出力 |
|---|---|---|---|---|
| core | TUNE.coreLod = 0.8 | τ(§4) | w×h | accum |
| tail | TUNE.tailLod = 2.5 | τ × TUNE.tailK(=3.5) | ⌈w/2⌉×⌈h/2⌉ | tail |

tail の τ・step は半解像度の画素単位で扱う(τ_half = τ·tailK/2、uStep = dx·b/(w/2))。パス数は v0 と同じ式 `min(4, ceil(log(τ·ln400)/log 8))` を各成分の τ(画素単位)で計算。
テクスチャ追加: `ta`,`tb`(ピンポン、半解像度)、`tail`(半解像度)。3 枚とも RGBA16F、mips なし。
描画コスト: v0 の 8 方向×4 パス=32 回(full)に、半解像度 32 回(=full 8 回相当)が加わる。+25%。

なぜ初段 lod を上げるか: 白飛びの縁は knee=0.06 の smoothstep で切られ、断面がほぼ矩形になる。矩形断面は強さを上げると幅一定の白帯になる(§2)。lod 0.8 は 2×2 ボックス平均を補間した程度のごく弱いぼかしで、断面をガウス寄りにして白帯を先細らせる。tail は lod 2.5 でさらに広く淡い断面にし、本物の「長く淡い裾」を作る。

### 3.4 composite

```glsl
uniform sampler2D uSrc, uAccum, uTail, uC;
uniform float uN, uGain, uBeta, uCoreLod, uTailLod, uGlow, uGlowLod; ...
vec3 core = max(texture(uAccum, vUv).rgb - uN*textureLod(uC, vUv, uCoreLod).rgb, 0.0);
vec3 tail = max(texture(uTail,  vUv).rgb - uN*textureLod(uC, vUv, uTailLod).rgb, 0.0);  // 半解像度→バイリニア拡大
vec3 star = core + uBeta*tail;
vec3 add  = star*uGain + glow*uGlow;
```

以降(a=1−exp(−add)、スクリーン、ディザ、mode 1/2)は v0 のまま。素通しの条件だけ実装時に変更: v0 の「add<1e-5」では、裾の極めて弱い光が届く画素で pow の往復誤差とディザにより ±1 の揺れが出た。v1 は「合成結果の sRGB 値が元画素から 0.5/255 未満しか変わらない画素は元の値をそのまま出す」。mode 2(拾っている光の表示)は c を表示する(重み I が掛かった後の値。C の効きを目で確認できる)。

---

## 4. パラメータ対応表

| スライダー | 範囲 | 既定 | 内部値 | v0 からの変更 |
|---|---|---|---|---|
| 角度 | 0–359 | 20 | rad | なし |
| 光条の数 | 4/6/8 | 4 | N | なし |
| 長さ L | 0–100 | 40 | τ = (0.002 + 0.05·(L/100)^1.6)·long·**TUNE.tauScale** | tauScale 新設。初期値 0.75。§7 手順 2 で「既定値での可視長が v0 の ±10%」になるよう調整する |
| 強さ G | 0–100 | **60** | gain = **0.02·50^(G/100)** (0.02–1.0) | v0 は 0.03·100^(G/100) (0.03–3.0)。上限を 1/3 に下げ、既定 45→60 で v0 の既定 0.238 と同等(0.21)にする |
| **シャープさ** s(v1.1 で追加、主要スライダー) | 0–100 | **50** | coreLod = 1.6·(1−s)、tailLod = 3.5 − 2.0·s、裾の量 ×(1 − 0.5·max(0, 2s−1)) | ユーザー所見「実写では実際のフィルターより柔らかい」への対応。50 で v1 当初(0.8 / 2.5、裾そのまま)、100 で芯は無ぼかし・裾は半分 |
| 光を拾う明るさ | 40–100 | 80 | thr, knee 0.06 | なし(急峻化は weigh 側) |
| 点光源だけにする | 0–100 | 70 | iso | なし |
| 光条の色 | 0–100 | 60 | color | なし |
| 虹色 | 0–100 | 35 | disp | なし |
| にじみ | 0–100 | 20 | glow | なし |
| **裾の伸び** B(新設、こまかい調整) | 0–100 | **50** | β = 0.6·(B/100) | 0 で v0 相当(tail なし)。小見出し「先端に向かう淡い光の量」 |

TUNE(index.html 冒頭の `const TUNE = {...}` に集約。テストから `__cf.tune` で書き換え可):

| 名前 | 初期値 | 意味 |
|---|---|---|
| tauScale | **0.55**(設計時 0.75 → 較正で決定) | τ の全体倍率(tail 追加で可視長が伸びる分の補正)。`tests/calib.cjs`: 既定値の白点可視長 v0=98px に対し 0.55 で 103px |
| coreLod | 0.8 | core 初段の読み出し lod |
| tailLod | 2.5 | tail 初段の読み出し lod |
| tailK | 3.5 | tail の τ 倍率 |
| wPow | 2 | しきい値重み w の指数 |
| lvPow | 3 | 線形輝度の指数 |
| haloGain | 0 | C の強さ。0 で無効。候補 3 |
| haloMax | 4 | rad の上限 |
| haloDiv | 96 | haloLod = log2(long/haloDiv) |

---

## 5. UI・保存・公開

### 5.1 UI(v0 から)

- ヘッダー: 幅 390px で 1 行(検証条件 6)。v0 は 520px 以下で説明文を隠し h1 を 17px にしている。足りなければ「写真を選ぶ」を「選ぶ」にせず、ボタンの padding を 12px に詰める方を先に試す
- 「裾の伸び」を「こまかい調整」の「虹色」の下に追加
- 「初期値に戻す」は新既定値へ
- 処理中(書き出し中)はプレビューを触っても壊れないよう v0 の busy を維持
- そのほかの見た目・無彩色の面・ライト/ダークは変えない

### 5.2 保存(結果ダイアログ)

```
[プレビュー画像]
画像を長押しして「写真に追加」もできます。
[共有する]  [ファイルとして保存]  [閉じる]
```

- 「共有する」: `navigator.canShare && navigator.canShare({files:[file]})` のときだけ表示。クリックで `navigator.share({files:[file], title})`。**書き出し後の非同期処理の中から share を呼ばない**(ユーザー操作の有効期限切れで拒否される)。ダイアログのボタン click ハンドラ内で同期的に呼ぶ
- 「ファイルとして保存」: v0 の a[download]
- `window.claude.use('downloads')` があれば v0 どおりそれを優先(Claude 内で開いた場合)
- ファイル名 `<元名>_cross<N>.jpg`(v0 どおり)

### 5.3 公開

- `index.html` を GitHub Pages(main ブランチ / root)で配信。相対パス・外部依存なし(フォントのみ)
- `legacy/`、`tests/`、`tools/` も同じリポジトリに置く(配信されても害はない)
- `.gitignore`: `node_modules/`, `test-results/`, `tests/fixtures/`

---

## 6. テストフック `window.__cf`(決め)

index.html と legacy/cross-filter-v0.html の両方に付ける(v0 側はこれだけが唯一の変更)。UI と独立に、Playwright から確定的に操作するための口。

```js
window.__cf = {
  version: 'v1',                 // v0 側は 'v0'
  ready:   Promise,              // 初期描画完了で resolve
  params:  () => ({...params}),
  set:     (patch) => void,      // params を書き換え、UI を同期し、同期的に render する
  render:  () => void,           // 同期 render(rAF 待ち不要)
  loadCanvas: (canvas) => Promise,  // 任意の 2D キャンバスを元画像として読み込む
  loadFile:   (file)   => Promise,
  sample:  (W,H) => canvas,      // drawSample を公開
  snapshot: () => dataURL(PNG),  // プレビューキャンバス
  readPixels: (x,y,w,h) => Uint8ClampedArray,   // プレビュー、左上原点、RGBA
  export:  ({format:'png'|'jpeg', quality}) => Promise<{width,height,dataURL}>,  // 保存 UI を出さずに書き出す
  tune:    TUNE                  // v1 のみ。書き換え後 render() で反映
};
```

`export` は `exportImage()` の中身を「blob を作るまで」と「保存 UI」に分けて前者を呼ぶ。PNG 指定は検証条件 5(素通し画素の一致)のためで、UI からは JPEG 0.95 のみ。

---

## 7. 検証(ブリーフの条件 1〜6 に対応)

### 環境

```
cross-filter/
├ package.json      { "scripts": { "test": "node tests/run.cjs" }, "devDependencies": { "playwright-core": "^1" } }
└ tests/
   ├ harness.cjs    静的サーバー(weight-finder/tests/browser.cjs と同型)、ブラウザ起動、共通ヘルパー
   ├ run.cjs        下の 4 本を順に実行し、test-results/ に画像と CSV を出す
   ├ smoke.cjs      条件 1・6
   ├ profile.cjs    条件 2・3(数値)
   ├ matrix.cjs     条件 3(画像)
   └ parity.cjs     条件 4・5
```

ブラウザ起動(SwiftShader で WebGL2 を有効にする):

```js
chromium.launch({
  headless: true,
  executablePath: process.env.BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
});
```

Edge で WebGL2 が取れない場合だけ `npx playwright install chromium` に切り替え、MEMORY.md に記録する。
合成画像は Node 側で作らず、`page.evaluate` 内でキャンバスに描いて `__cf.loadCanvas` に渡す(Node に画像ライブラリを入れない)。

### 手順 0: 症状の裏取り(実装前)

v0 に `__cf` を付けたら、最初に `matrix.cjs` を v0 で走らせて 6 枚(強さ 30/60/90 × 光を拾う明るさ 60/80、サンプル夜景)を出し、§2 の診断が実機の絵と合うか確認する。合わなければ止まって MEMORY.md に書き、設計を見直す。

### 条件ごとの手順と合格基準

| 条件 | スクリプト | 手順 | 合格 |
|---|---|---|---|
| 1 | smoke | 390×844 で index.html を開く → `__cf.ready` → 合成 6000×4000 JPEG(`sample(6000,4000)` を toBlob → File)を `loadFile` → `export({format:'jpeg'})` | pageerror・console.error が 0 件。書き出し寸法 4899×3266 |
| 2 | profile | 1440×960 の黒地に中心へ半径 3px の白点(縁 1px の線形勾配)。角度 0、光条 4、他は既定。強さ 30/60/90 で `readPixels` から (a) 軸上 r=0..400 の RGB (b) r ごとの飽和(≥248)幅 を CSV に出す。v0 と v1 の両方 | CSV と要約表(r=0,5,10,20,30,40,60,80,120,160 の値)を報告に載せる |
| 3 数値 | profile | 上の CSV から `白帯長 / 可視長`(白帯長 = 飽和幅>0 の最大 r、可視長 = 軸上値が **40/255**(線形で約 0.02)を下回る最初の r。5/255 は線形 0.0002 で目に見えず、v0 も合格してしまうため実装時に変更) | 強さ 90 で **0.20 以下**。加えて白点の線形強度を 3 にした(白点を `rgb(255)` のまま `__cf.tune.lvPow` でなく `set({gain})` で代替せず、weigh の I が 3 になるよう合成画像の周囲に半径 15px・ピーク 0.3 のにじみを描いた)ケースでも 0.20 以下 |
| 3 画像 | matrix | サンプル夜景で 6 枚を 2×3 に並べ、各コマに「強さ/明るさ」のラベルをキャンバス上に描いて PNG 化。v0・v1 の 2 枚 | 画像を提示し、ユーザーの判断を待つ(自動判定しない) |
| 4 | parity | `sample(6000,4000)` を読み込み、プレビュー snapshot(1440)と `export({format:'png'})` を 1440 に縮小したものを同じ街灯の周囲 200×200 で切り出し、横に並べた PNG を出す。加えて右端の街灯の光条について「足された光」(出力 − 元画像)の軸上プロファイルを両方で取る | 実装時に確定: r=10,20,40,80 の値の差 ≤ 8/255、長さ(100/255 を下回る r)の差 ±10%。当初の「可視長 ±5%・最大値 3/255」は、夜景では最大値が飽和し、裾の 40/255 交点は 2/255 の差で数十 px 動くため指標として不安定だった |
| 5 | parity | 6000×4000 の書き出し(PNG)と、同じサイズに rasterize した元画像を、光条が通らない 3 か所(左下の路面、右下の路面、上端中央の空)の 64×64 で比較 | 最大絶対差 0。JPEG 0.95 については同じ領域の平均絶対差 ≤ 1.5 を参考値として併記。※角度 0 では街灯の真上に縦の光条の裾が届くので「左上の空」は不可(実装時に変更) |
| 6 | smoke | 390×844 で `document.documentElement.scrollWidth`、`.brand h1` と `.bar-actions` の getBoundingClientRect | scrollWidth ≤ 390。h1 の高さ < 1.6×font-size(折り返し無し)、h1 と bar-actions の top 差 < 8px。スクリーンショットを添付 |

### 実装順序

1. `legacy/` に v0 を置き `__cf` を付ける。harness と matrix を書き、手順 0 を実行(v0 の 6 枚)
2. index.html を v0 からコピーし、§3.3 の 2 成分 streak と §3.4 の composite、§4 の gain マッピング、「裾の伸び」スライダー、キー v4。profile で白点の変更前後を出し、tauScale を「既定値での可視長が v0 の ±10%」になるよう決める
3. §3.2 の weigh(wPow・lvPow)。matrix を v1 で出し、v0 と並べてユーザーに提示 → 判断待ち(ここで一度止まる)
4. lum と C(haloGain=3)を実装し、有効/無効の 2 枚をユーザーに提示 → 採否はユーザー
5. 保存ダイアログ(共有する)、ヘッダー幅、smoke・parity
6. 完了報告(条件 1〜6 の番号ごとに、コマンド・出力・画像)と、ユーザーに渡す git 作業の一覧(リポジトリ作成、Pages 有効化、親 `.gitignore` への追加)

各段階の終わりに MEMORY.md を更新する。

---

## 8. リスクと未解決

| 項目 | 内容 | 扱い |
|---|---|---|
| iOS のメモリ | 書き出し時に src(16MP RGBA8 + mips)と work(2048 長辺 RGBA16F)を複数持つ。tail 用に +3 枚(四半分)増える | 半解像度なので +10MB 程度。失敗時の半分再試行は維持。実機で落ちたら core/tail のピンポンを共有する |
| RGBA8 フォールバック | float 非対応環境では tail の淡い裾が 8bit で量子化される | 許容。lum は R8 にする |
| SwiftShader と実機の差 | SwiftShader の RGBA16F・mips は実機 GPU と一致するはずだが、線形補間の精度が違う可能性 | 数値比較は同一環境(SwiftShader)内で行う。実機は目視 |
| C の副作用 | 薄い雲のかかった月や、遠景の街の面光源で rad が高く出る可能性 | 既定無効。有効化はユーザー判断 |
| HEIC | iOS の写真アプリから選ぶと Safari が JPEG に変換して渡すはずだが未確認 | 実機で確認し MEMORY.md に記録。ダメなら「JPEG/PNG で」の案内文のみ |
| Web Share | Android Chrome は https 必須。GitHub Pages なら満たす。file:// で開いた場合は非表示になる | 仕様どおり |
| 6・8 本のときの N·c 引き算 | v0 どおり N 倍を引く。core と tail で lod が違うので別々に引く(§3.4) | 設計済み |
