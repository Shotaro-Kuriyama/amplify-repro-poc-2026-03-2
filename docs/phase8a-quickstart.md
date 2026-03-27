# Phase 8A: 最小パイプライン動作確認ガイド

## 概要

Phase 8A の最小縦切りとして、以下の流れが repo 内で動作する状態になっています。

```
PDF upload → job 作成（+ 自動パイプライン実行）→ polling → 構造化 JSON/最小 IFC 返却
```

**Phase 8A 縦切り接続の特徴:**
- `POST /api/jobs` でジョブを作成すると、バックグラウンドで Python パイプラインが自動実行される
- **成功も失敗も、実際のパイプライン実行結果に基づく**（mock 失敗は廃止）
- フロントエンドは polling で進捗を確認し、completed / failed になると結果を取得できる
- 実験用 endpoint (`POST /api/internal/pipeline/run`) も引き続き利用可能
- floorLabel がフロントエンドからサーバーに渡るようになった
- successful job では `structured_json` に加えて最小 `ifc` artifact も生成される

## セットアップ

### 1. Python 依存のインストール

```bash
pip3 install -r scripts/pipeline/requirements.txt
```

### 2. Next.js 開発サーバーの起動

```bash
npm run dev
```

## 動作確認手順（自動パイプライン）

### Step 1: PDF をアップロード

```bash
curl -X POST http://localhost:3000/api/plans/upload \
  -F "files=@scripts/pipeline/tests/fixtures/line_only_doors_scale_1_50.pdf"
```

レスポンス例:
```json
{
  "files": [
    {
      "fileId": "file-1711234567890-0",
      "originalName": "line_only_doors_scale_1_50.pdf",
      "size": 809,
      "mimeType": "application/pdf",
      "uploadedAt": "2026-03-26T..."
    }
  ]
}
```

### Step 2: ジョブを作成（パイプラインが自動実行される）

Step 1 で得た `fileId` を使います。`files` 配列で floorLabel を指定できます。

```bash
curl -X POST http://localhost:3000/api/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "fileIds": ["file-1711234567890-0"],
    "files": [{"fileId": "file-1711234567890-0", "floorLabel": "1F"}],
    "settings": {"scale": 50, "floorHeight": 2.8}
  }'
```

レスポンス例:
```json
{
  "jobId": "job-1711234567890",
  "status": "queued",
  "fileIds": ["file-1711234567890-0"],
  "createdAt": "2026-03-26T..."
}
```

ジョブ作成直後は `queued` 状態です。バックグラウンドで pipeline-runner が `queued` → `processing` → `completed` / `failed` と遷移させます。

### Step 3: ジョブ状態を確認（数秒後に completed になる）

```bash
curl -s http://localhost:3000/api/jobs/job-1711234567890 | python3 -m json.tool
```

### 成功時のレスポンス例

```json
{
  "jobId": "job-1711234567890",
  "status": "completed",
  "progress": 100,
  "currentStep": "preparing_artifacts",
  "artifacts": [
    {
      "id": "artifact-0",
      "format": "structured_json",
      "fileName": "structured.json",
      "size": 1539
    },
    {
      "id": "artifact-1",
      "format": "ifc",
      "fileName": "model.ifc",
      "size": 4821
    }
  ],
  "quantitiesReady": true,
  "error": null,
  "createdAt": "2026-03-26T...",
  "completedAt": "2026-03-26T...",
  "pipelineResult": {
    "success": true,
    "floors": [
      {
        "floorLabel": "1F",
        "walls": [...],
        "openings": [...],
        "rooms": [...],
        "source": {
          "fileId": "file-1711234567890-0",
          "pageIndex": 0,
          "pageWidth": 297,
          "pageHeight": 210
        }
      }
    ],
    "stats": {
      "durationMs": 8,
      "totalWalls": 8,
      "totalOpenings": 3,
      "totalRooms": 0
    }
  }
}
```

### Step 4: 数量表を確認

```bash
curl -s http://localhost:3000/api/jobs/job-1711234567890/quantities | python3 -m json.tool
```

パイプライン結果がある場合、実データから算出された数量が返ります:
```json
{
  "rows": [
    {"element": "壁", "count": 8, "unit": "本"},
    {"element": "開口部", "count": 3, "unit": "箇所"},
    {"element": "部屋", "count": 0, "unit": "室"}
  ]
}
```

### Step 5: 構造化 JSON をダウンロード

```bash
curl -s http://localhost:3000/api/jobs/job-1711234567890/artifacts/structured_json | python3 -m json.tool
```

### Step 6: 最小 IFC をダウンロード

```bash
curl -o model.ifc http://localhost:3000/api/jobs/job-1711234567890/artifacts/ifc
```

`model.ifc` は PoC 用の最小実装で、主に壁形状のみを含みます。

## 失敗ケースの確認方法

成功も失敗も、実際のパイプライン実行結果に基づきます。
`shouldFail` のような mock 失敗判定は廃止されています。

### 方法 1: 存在しない fileId を指定する

```bash
curl -s -X POST http://localhost:3000/api/jobs \
  -H "Content-Type: application/json" \
  -d '{"fileIds":["non-existent-file"],"settings":{"scale":50,"floorHeight":2.8}}'
```

数秒後にジョブを確認:
```bash
curl -s http://localhost:3000/api/jobs/<jobId> | python3 -m json.tool
```

失敗時のレスポンス例:
```json
{
  "jobId": "job-...",
  "status": "failed",
  "progress": 0,
  "currentStep": null,
  "artifacts": null,
  "quantitiesReady": false,
  "error": {
    "code": "PIPELINE_INPUT_ERROR",
    "message": "File not found: non-existent-file"
  },
  "createdAt": "...",
  "completedAt": "...",
  "pipelineResult": null
}
```

### 方法 2: 実験用 endpoint でファイル未登録のジョブを実行する

```bash
# まずジョブだけ作成（ファイルが存在しない fileId で）
curl -s -X POST http://localhost:3000/api/jobs \
  -H "Content-Type: application/json" \
  -d '{"fileIds":["bad-id"],"settings":{"scale":50,"floorHeight":2.8}}'
```

### エラーコード一覧

| コード | 原因 |
|---|---|
| `PIPELINE_INPUT_ERROR` | ファイルが見つからない / filePath がない |
| `PIPELINE_EXECUTION_ERROR` | Python プロセス起動失敗 / non-zero 終了 |
| `PIPELINE_OUTPUT_PARSE_ERROR` | Python の stdout が JSON として解析できない |
| `PIPELINE_FAILED` | Python が `success: false` を返した |
| `IFC_GENERATION_ERROR` | 最小 IFC の生成または保存に失敗した |

## 動作確認手順（実験用 endpoint — 従来方式）

実験用 endpoint も引き続き利用できます。

```bash
curl -X POST http://localhost:3000/api/internal/pipeline/run \
  -H "Content-Type: application/json" \
  -d '{"jobId":"job-1711234567890"}'
```

## 何が返れば成功か

- `status: "completed"` であること
- `pipelineResult.success: true` であること
- `pipelineResult.floors[0].source.pageWidth` / `pageHeight` にページサイズ（mm 単位）が入っていること
- `pipelineResult.floors[0].walls` に壁候補が入っていること（drawing 情報を含む PDF の場合）
- `pipelineResult.stats.totalWalls` が 0 以外であること（drawing 情報を含む PDF の場合）
- `pipelineResult.stats.durationMs` に処理時間が入っていること
- `quantitiesReady: true` であること
- フロント UI の viewer が pipelineResult の walls/openings を元に表示されること（real モード）

### walls に関する補足

- PDF の drawing 情報から壁候補を暫定ルールベースで抽出している
- 抽出後に **正規化 → 重複除去 → 同一直線上マージ** の整理パイプラインを通している
- **精度は暫定**。実寸 2500mm 以上（`derive_thresholds(scale)` で paper mm に換算）かつ水平/垂直に近い線分を壁候補として扱っている（scale=50 のとき 50 paper mm）
- 重複除去: 始点・終点がともに実寸 100mm 以内の wall を同一とみなす（scale=50 のとき 2 paper mm）
- マージ: 同一直線上（実寸 150mm 以内）で端点間ギャップが実寸 250mm 以内の壁を 1 本にまとめる（scale=50 のとき 3mm / 5mm）
- PDF によっては drawing 情報が無く `walls` が 0 本のままの場合もある（テキスト主体の PDF など）
- 壁本数は PDF の描画方法（line / rect / 混在）によって異なる
- 壁厚 (`thickness`) は以下の優先順位で推定（暫定）:
  1. rect の短辺（実寸 1000mm 以下の場合のみ信頼。scale=50 のとき 20 paper mm）
  2. line の stroke width (1mm 以上の場合のみ参考)
  3. 同一ページの rect 由来厚みの中央値で補完
  4. fallback: 実寸 250mm（scale=50 のとき 5 paper mm）
- 高精度な壁厚推定ではなく、あくまで暫定値。実際の壁厚は図面スケールを考慮して解釈する必要がある
- 信頼度 (`confidence`) は固定値 0.5

### openings に関する補足

- **3 つの検出ソース** を組み合わせて開口部候補を推定している（すべて暫定ルールベース）:
  1. **gap ベース**: 壁マージ後のギャップから推定（door / unknown）
  2. **arc ベース**: drawing の cubic bezier (curve) からドア円弧を検出（door）
  3. **rect ベース**: 壁近傍の細長い rect パターンから窓候補を検出（window）
- **精度は暫定**。高精度なドア記号認識や窓種別判定は行っていない
- **scale-aware**: すべてのしきい値は `settings.scale` から導出（実寸 mm ベース）
- **1対1 マッチ保証**: arc-opening の対応は greedy distance matching で 1対1 を保証
- gap ベースの条件:
  - 対象: 水平壁・垂直壁間のギャップのみ。斜め壁は対象外
  - ギャップ幅: 実寸 400mm〜2000mm 相当（scale により paper mm に換算）
  - gap >= 実寸 700mm 相当 → `"door"` 寄り、それ未満 → `"unknown"`
- arc ベースの条件:
  - bounding box がほぼ正方形 (aspect 0.7〜1.4) の quarter-circle 候補を検出
  - 半径: 実寸 400mm〜1500mm 相当（scale により paper mm に換算）
  - arc 端点が壁線の実寸 250mm 以内にある場合のみ採用
  - 既存の gap opening の近くに arc があれば → `"door"` + confidence 0.6
  - gap がなくても壁近くに arc があれば → 新規 door 候補 (confidence 0.5)
- `height` は隣接壁の thickness 平均値を仮値として使用（実際の開口部高さではない）
- `wallId` は隣接壁の id を紐づけている
- rect ベース（window）の条件:
  - 壁近傍（実寸 150mm 以内）にある細長い rect を窓マーカーとみなす
  - rect 長辺（窓幅）: 実寸 500mm〜1800mm 相当
  - rect 短辺（マーカー厚）: 実寸 200mm 以下
  - rect の長辺方向が壁と平行であること
  - 壁として既にカウントされている大きな rect は除外
  - 既存 door opening と近すぎる位置の候補は重複除去
- `confidence` の差別化:
  - arc + gap の両根拠 → 0.6
  - arc のみ → 0.5
  - gap のみ → 0.4
  - window (rect) → 0.35
- **door / window の優先順位**: arc 根拠がある opening は door を優先。同じ位置に door と window を二重追加しない（近傍重複除去）
- PDF によっては curve 情報がなく、ギャップもないため `openings` が 0 件のままの場合もある

### scale-aware しきい値について

- 各種しきい値は **実寸 mm** で定義し、`paper_mm = real_mm / scale` で換算している
- `scale=50` のとき従来の固定値と完全一致する（後方互換）
- `scale=100` のとき paper mm しきい値は `scale=50` の半分になる
- `derive_thresholds(scale)` で全しきい値を一括生成
- 座標系は変更なし（paper mm のまま）。判定しきい値のみ scale-aware

### テストの実行

```bash
# テスト用依存のインストール
pip3 install -r scripts/pipeline/requirements-dev.txt

# fixture ベースの再現テスト
python3 -m pytest scripts/pipeline/tests/ -v
```

### fixture PDF について

テスト用の fixture PDF は `scripts/pipeline/tests/fixtures/` に正式配置されている。
`data/uploads/` への依存はなく、fresh clone 後でもそのままテスト実行可能。

| fixture | 内容 | 検証対象 |
|---|---|---|
| `line_only_doors_scale_1_50.pdf` | line ベースの壁 + gap opening + door arc | 壁抽出、gap 検出、arc 検出、arc-opening マッチ、arc-only door |
| `walls_only_scale_1_50.pdf` | rect ベースの壁のみ（gap なし、curve なし） | 壁抽出、opening=0、arc=0、window=0 の確認 |
| `windows_only_scale_1_50.pdf` | line ベースの壁 + 窓マーカー rect | 壁抽出、window 検出、door=0 の確認 |

fixture の再生成が必要な場合:

```bash
python3 scripts/pipeline/tests/fixtures/generate_fixtures.py
```

## 現時点の制約（まだダミー・未実装の部分）

| 項目 | 状態 |
|---|---|
| `walls` | drawing 情報から暫定ルールで抽出 + 重複整理・マージ済み（精度は低い。curve/arc は未対応） |
| `openings` | gap + arc + rect ベースで暫定推定（door / window / unknown。精度は低い） |
| `rooms` | テキストブロックから簡易抽出（精度は低い） |
| `floorLabel` | フロントエンドから渡された値を使用。未指定時は `1F, 2F...` と自動採番 |
| `artifacts` | `structured_json`（inline）+ `ifc`（`data/artifacts/<jobId>/model.ifc`）を返却 |
| IFC 生成 | 最小実装（壁中心、PoC品質） |
| 複数ページ PDF | 最初のページのみ処理 |
| RVT / DWG ダウンロード | モックデータを返却（実データ未生成） |
| ジョブの失敗 | 実パイプライン実行結果に基づく（mock 失敗は廃止済み） |
| client-side mock | `NEXT_PUBLIC_API_MODE=mock` 時のみ旧来の mock 動作が残る（デフォルトの real モードでは不使用） |

## トラブルシューティング

### `PyMuPDF がインストールされていません` エラー

```bash
pip3 install PyMuPDF
```

### `File not found` エラー

PDF のアップロード（Step 1）とジョブ作成（Step 2）を **同じサーバーセッション内** で行ってください。
サーバーを再起動すると in-memory のメタデータが消えます（ファイル自体は `data/uploads/` に残ります）。

### `Job not found` エラー

ジョブ作成（Step 2）を先に行ってから Step 3 を実行してください。

### パイプラインが `processing` のまま完了しない

- Python 3 + PyMuPDF がインストールされているか確認してください
- ターミナルの Next.js ログに `[pipeline-runner]` のエラーメッセージが出ていないか確認してください
- fixture PDF を使って動作確認する場合は `scripts/pipeline/tests/fixtures/` 内の PDF を使用してください
