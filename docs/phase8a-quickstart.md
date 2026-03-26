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
      "openings": [],
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
    "totalOpenings": 0,
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

### walls に関する補足

- Phase 8A 後半で、PDF の drawing 情報から壁候補を暫定ルールベースで抽出するようになった
- **精度は暫定**。長さ 50mm 以上かつ水平/垂直に近い線分を壁候補として扱っている
- PDF によっては drawing 情報が無く `walls` が 0 本のままの場合もある（テキスト主体の PDF など）
- 壁厚 (`thickness`) は線の stroke width または矩形の短辺から推定（暫定値）
- 信頼度 (`confidence`) は固定値 0.5

## 現時点の制約（まだダミー・未実装の部分）

| 項目 | 状態 |
|---|---|
| `walls` | drawing 情報から暫定ルールで抽出（精度は低い。curve/arc は未対応） |
| `openings` | 空配列（開口部推定は Phase 8A 後半以降） |
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
