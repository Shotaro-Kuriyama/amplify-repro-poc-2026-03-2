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
- **精度は暫定**。長さ 50mm 以上かつ水平/垂直に近い線分を壁候補として扱っている
- 重複除去: 始点・終点がともに 2mm 以内の wall を同一とみなす
- マージ: 同一直線上 (3mm 以内) で端点間ギャップが 5mm 以内の壁を 1 本にまとめる
- PDF によっては drawing 情報が無く `walls` が 0 本のままの場合もある（テキスト主体の PDF など）
- 壁本数は PDF の描画方法（line / rect / 混在）によって異なる
- 壁厚 (`thickness`) は以下の優先順位で推定（暫定）:
  1. rect の短辺 (20mm 以下の場合のみ信頼)
  2. line の stroke width (1mm 以上の場合のみ参考)
  3. 同一ページの rect 由来厚みの中央値で補完
  4. fallback: 5mm (paper mm)
- 高精度な壁厚推定ではなく、あくまで暫定値。実際の壁厚は図面スケールを考慮して解釈する必要がある
- 信頼度 (`confidence`) は固定値 0.5

### openings に関する補足

- **2 つの検出ソース** を組み合わせて開口部候補を推定している（どちらも暫定ルールベース）:
  1. **gap ベース**: 壁マージ後のギャップから推定
  2. **arc ベース**: drawing の cubic bezier (curve) からドア円弧を検出
- **精度は暫定**。高精度なドア記号認識や窓枠検出は行っていない
- gap ベースの条件:
  - 対象: 水平壁・垂直壁間のギャップのみ。斜め壁は対象外
  - ギャップ幅: 8mm 〜 40mm (paper mm, 1:50 で 400mm〜2000mm 実寸)
  - gap >= 14mm → `"door"` 寄り、それ未満 → `"unknown"`
- arc ベースの条件:
  - bounding box がほぼ正方形 (aspect 0.7〜1.4) の quarter-circle 候補を検出
  - 半径 8mm〜30mm (paper mm) のアークをドア円弧とみなす
  - arc 端点が壁線の 5mm 以内にある場合のみ採用
  - 既存の gap opening の近くに arc があれば → `"door"` + confidence 0.6
  - gap がなくても壁近くに arc があれば → 新規 door 候補 (confidence 0.5)
- `height` は隣接壁の thickness 平均値を仮値として使用（実際の開口部高さではない）
- `wallId` は隣接壁の id を紐づけている
- `confidence` の差別化:
  - arc + gap の両根拠 → 0.6
  - arc のみ → 0.5
  - gap のみ → 0.4
- PDF によっては curve 情報がなく、ギャップもないため `openings` が 0 件のままの場合もある

## 現時点の制約（まだダミー・未実装の部分）

| 項目 | 状態 |
|---|---|
| `walls` | drawing 情報から暫定ルールで抽出 + 重複整理・マージ済み（精度は低い。curve/arc は未対応） |
| `openings` | gap + arc ベースで暫定推定（精度は低い。窓枠認識は未対応） |
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
