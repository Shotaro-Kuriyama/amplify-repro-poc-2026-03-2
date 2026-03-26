# Phase 8A: 最小パイプライン動作確認ガイド

## 概要

Phase 8A の最小縦切りとして、以下の流れが repo 内で動作する状態になっています。

```
PDF upload → job 作成 → 実験用 endpoint → Python で PDF 読み取り → 構造化 JSON 返却
```

## セットアップ

### 1. Python 依存のインストール

```bash
pip3 install -r scripts/pipeline/requirements.txt
```

### 2. Next.js 開発サーバーの起動

```bash
npm run dev
```

## 動作確認手順

### Step 1: PDF をアップロード

```bash
curl -X POST http://localhost:3000/api/plans/upload \
  -F "files=@/path/to/your/plan.pdf"
```

レスポンス例:
```json
{
  "files": [
    {
      "fileId": "file-1711234567890-0",
      "originalName": "plan.pdf",
      "size": 12345,
      "mimeType": "application/pdf",
      "uploadedAt": "2026-03-26T..."
    }
  ]
}
```

### Step 2: ジョブを作成

Step 1 で得た `fileId` を使います。

```bash
curl -X POST http://localhost:3000/api/jobs \
  -H "Content-Type: application/json" \
  -d '{"fileIds":["file-1711234567890-0"],"settings":{"scale":100,"floorHeight":2.8}}'
```

レスポンス例:
```json
{
  "jobId": "job-1711234567890",
  "status": "processing",
  "fileIds": ["file-1711234567890-0"],
  "createdAt": "2026-03-26T..."
}
```

### Step 3: パイプラインを実行（実験用 endpoint）

Step 2 で得た `jobId` を使います。

```bash
curl -X POST http://localhost:3000/api/internal/pipeline/run \
  -H "Content-Type: application/json" \
  -d '{"jobId":"job-1711234567890"}'
```

### 成功時のレスポンス例

```json
{
  "jobId": "job-1711234567890",
  "success": true,
  "floors": [
    {
      "floorLabel": "1F",
      "walls": [
        {
          "id": "wall-0",
          "startX": 18.0,
          "startY": 192.0,
          "endX": 258.0,
          "endY": 192.0,
          "thickness": 5.0,
          "confidence": 0.5
        }
      ],
      "openings": [
        {
          "id": "opening-0",
          "type": "door",
          "centerX": 173.0,
          "centerY": 37.0,
          "width": 34.0,
          "height": 5.0,
          "wallId": "wall-1",
          "confidence": 0.4
        },
        {
          "id": "opening-1",
          "type": "door",
          "centerX": 53.0,
          "centerY": 180.5,
          "width": 18.0,
          "height": 5.0,
          "wallId": "wall-7",
          "confidence": 0.5
        }
      ],
      "rooms": [...],
      "source": {
        "fileId": "file-1711234567890-0",
        "pageIndex": 0,
        "pageWidth": 297.0,
        "pageHeight": 210.0
      }
    }
  ],
  "artifacts": [
    {
      "format": "structured_json",
      "filePath": "(inline)",
      "size": 4228
    }
  ],
  "stats": {
    "durationMs": 15,
    "totalWalls": 20,
    "totalOpenings": 9,
    "totalRooms": 10
  }
}
```

## 何が返れば成功か

- `success: true` であること
- `floors[0].source.pageWidth` / `pageHeight` にページサイズ（mm 単位）が入っていること
- `floors[0].rooms` にテキストブロックから抽出した部屋名候補が入っていること（PDF にテキストがあれば）
- `floors[0].walls` に壁候補が入っていること（drawing 情報を含む PDF の場合）
- `stats.totalWalls` が 0 以外であること（drawing 情報を含む PDF の場合）
- `stats.durationMs` に処理時間が入っていること
- `floors[0].openings` に開口部候補が入っていること（壁間にギャップがある PDF の場合）
- `stats.totalOpenings` に開口部候補数が入っていること（ギャップがない PDF では 0 のまま）

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
| `floorLabel` | サーバー側で `1F, 2F...` と自動採番（暫定。フロントの設定とは未連携） |
| `artifacts` | `structured_json` のみ、インラインで返却（ファイル書き出しなし） |
| IFC 生成 | 未実装 |
| 複数ページ PDF | 最初のページのみ処理 |
| 既存デモフロー連携 | 実験用 endpoint は既存の upload → poll → download フローとは独立 |

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
