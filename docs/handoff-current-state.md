# Phase 8A 現状引き継ぎ

## このドキュメントの目的

Phase 8A の実装状況を正確に記録し、別のエージェントや開発者が途中から作業を引き継げるようにする。

---

## リポジトリ概要

AmpliFy のフロントエンドモック。建築平面図 PDF をアップロードし、BIM 的な 3D 結果を見る Web アプリの試作。
現在は **Phase 8A（ルールベース PDF 処理の技術検証）** まで完了。

- フレームワーク: Next.js (App Router)
- PDF 処理: Python (PyMuPDF) を `execFile()` で呼び出し
- 言語: 日本語ファースト

---

## Phase 8A で完了していること

### 1. パイプライン基盤
- `scripts/pipeline/extract_pdf.py` — stdin/stdout JSON プロトコルで PDF を処理
- `src/lib/server/pipeline.ts` — Node.js から Python を `execFile()` で呼び出し
- `src/types/pipeline.ts` — TypeScript 型定義 (`PipelineInput`, `PipelineOutput`, `ExtractedWall`, `ExtractedOpening` 等)

### 2. 壁候補抽出
- PDF の drawing 情報 (line / rect) から壁候補を抽出
- 正規化 → thickness 補完 → 重複除去 → 同一直線上マージ のパイプライン
- 水平/垂直に近い線分のみ対象 (斜め壁は未対応)

### 3. 開口部推定 (3 ソース)
- **gap ベース**: 壁間のギャップから door / unknown を推定
- **arc ベース**: cubic bezier (curve) からドア円弧を検出、gap opening と 1:1 greedy matching
- **rect ベース**: 壁近傍の細長い rect から window を検出
- door / window の重複回避 (近傍距離で dedup)

### 4. scale-aware しきい値
- 全しきい値を実寸 mm で定義 (`_REAL_MM_BASES`)
- `derive_thresholds(scale)` で paper mm に一括換算
- `scale=50` で従来の固定値と完全一致

### 5. confidence の差別化
| 根拠 | type | confidence |
|---|---|---|
| arc + gap | door | 0.6 |
| arc のみ | door | 0.5 |
| gap のみ | door / unknown | 0.4 |
| rect パターン | window | 0.35 |

### 6. fixture ベースの再現テスト (28 テスト)

| fixture | 内容 |
|---|---|
| `line_only_doors_scale_1_50.pdf` | line 壁 + gap 1 + door arc 3 |
| `walls_only_scale_1_50.pdf` | rect 壁のみ (opening=0, arc=0) |
| `windows_only_scale_1_50.pdf` | line 壁 + 窓マーカー rect 2 |

テスト実行:
```bash
pip3 install -r scripts/pipeline/requirements-dev.txt
python3 -m pytest scripts/pipeline/tests/ -v
```

fixture 再生成:
```bash
python3 scripts/pipeline/tests/fixtures/generate_fixtures.py
```

### 7. 6 API エンドポイント (既存)
| エンドポイント | 用途 |
|---|---|
| `POST /api/plans/upload` | PDF アップロード |
| `POST /api/jobs` | ジョブ作成 |
| `GET /api/jobs/[jobId]` | ジョブ状態取得 |
| `GET /api/jobs/[jobId]/artifacts/[format]` | 成果物取得 |
| `GET /api/jobs/[jobId]/quantities` | 数量表取得 |
| `POST /api/internal/pipeline/run` | パイプライン実行 (実験用) |

---

## Phase 8A で未完了のこと

| 項目 | 状態 |
|---|---|
| 斜め壁・曲線壁 | 未対応。水平/垂直のみ |
| 二重線パターンの窓検出 | 未対応。rect パターンのみ |
| 窓の種別判定 (引き違い等) | 未対応 |
| 高精度なドア記号認識 | 未対応。quarter-circle 簡易判定のみ |
| IFC 生成 | 未実装。構造化 JSON のみ |
| 複数ページ PDF | 最初のページのみ処理 |
| floorLabel の正式接続 | サーバー側で自動採番 (フロントと未連携) |
| rooms の精度 | テキストブロックからの簡易抽出のみ |
| 永続化 | in-memory のみ (数十 ms で完了するため十分) |

---

## ファイル構成

```
scripts/pipeline/
  extract_pdf.py              # メイン処理 (stdin/stdout JSON プロトコル)
  requirements.txt            # 本番依存 (PyMuPDF)
  requirements-dev.txt        # テスト依存 (PyMuPDF + pytest)
  tests/
    __init__.py
    test_extract_pdf.py       # 28 テスト (6 クラス)
    fixtures/
      generate_fixtures.py    # fixture 生成スクリプト
      line_only_doors_scale_1_50.pdf
      walls_only_scale_1_50.pdf
      windows_only_scale_1_50.pdf

src/types/pipeline.ts         # TypeScript 型定義
src/lib/server/pipeline.ts    # Python 呼び出しブリッジ
src/app/api/                  # 6 API エンドポイント
```

---

## 主要関数 (extract_pdf.py)

| 関数 | 責務 |
|---|---|
| `derive_thresholds(scale)` | scale → paper mm しきい値の一括導出 |
| `extract_walls(page, th)` | drawing → 壁候補抽出 (正規化〜マージ込み) |
| `extract_openings(walls, th)` | 壁間ギャップから opening 推定 |
| `_extract_door_arcs(page, th)` | cubic bezier から door arc 抽出 |
| `_enhance_openings_with_arcs(...)` | arc-opening 1:1 マッチ + arc-only door 生成 |
| `extract_windows(page, walls, existing_openings, th)` | rect パターンから window 候補抽出 |
| `extract_floor_data(file_entry, doc, page_index, settings)` | 1 ページ分の全抽出オーケストレーション |
| `process_pipeline(pipeline_input)` | PipelineInput → PipelineOutput の変換 |

---

## 座標系・単位

- PDF 内部: ポイント (pt)。1pt = 1/72 inch = 0.3528mm
- 出力: すべて mm (paper mm)
- しきい値: 実寸 mm ベースで定義し、`paper_mm = real_mm / scale` で換算
- `scale=50` が基準 (後方互換)

---

## 壊してはいけないもの

1. **6 API 契約** — エンドポイントの URL・リクエスト・レスポンス形式
2. **Phase 8A の責務分離** — UI / hooks / API 層 / mock 実装 / Python 処理の分離
3. **fixture ベースのテスト** — 28 テストが全て合格する状態を維持
4. **stdin/stdout JSON プロトコル** — Python ↔ Node.js の通信規約
5. **TypeScript 型定義** — `ExtractedWall`, `ExtractedOpening` 等のインターフェース
6. **scale-aware しきい値** — `derive_thresholds(scale)` の設計方針
7. **Python 3.9 互換** — `from __future__ import annotations` が必要
