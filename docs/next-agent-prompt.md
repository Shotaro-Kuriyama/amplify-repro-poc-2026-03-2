# 次のエージェント向けプロンプト

> このファイルは、別の AI エージェントにそのまま貼って使うことを想定しています。

---

## あなたの役割

あなたはこの repo の開発を引き継ぎます。
このリポジトリは **AmpliFy** という建築平面図 PDF → BIM 変換プロダクトのフロントエンドモックです。
現在 **Phase 8A（ルールベース PDF 処理の技術検証）** まで完了しています。

---

## まず読むべきファイル

以下の順に読んでください。

1. `CLAUDE.md` — このプロジェクト全体の方針・設計哲学
2. `docs/handoff-current-state.md` — Phase 8A の完了状況・ファイル構成・壊してはいけないもの
3. `docs/phase8a-quickstart.md` — パイプラインの動作確認手順
4. `docs/project-roadmap-phase5-8.md` — Phase 5〜8 のロードマップと進捗

実装を触る前に必ず読むファイル:
- `src/types/pipeline.ts` — TypeScript 型定義
- `scripts/pipeline/extract_pdf.py` — Python メイン処理
- `scripts/pipeline/tests/test_extract_pdf.py` — テスト (28 件)
- `scripts/pipeline/tests/fixtures/generate_fixtures.py` — fixture 生成スクリプト

---

## 現在の実装状況

### 完了済み
- PDF → 壁候補抽出 (line / rect から水平・垂直壁を検出、重複除去・マージ済み)
- 開口部推定 3 ソース: gap (door/unknown) + arc (door) + rect (window)
- arc-opening の 1:1 greedy matching
- scale-aware しきい値 (`derive_thresholds(scale)`)
- fixture ベース再現テスト (28 テスト, 3 fixture PDF)
- `type: "door" | "window" | "unknown"` の分類
- door / window の重複回避

### 未完了
- 斜め壁・曲線壁の検出
- 二重線パターンの窓検出
- 高精度なドア記号認識
- IFC 生成 (構造化 JSON のみ)
- 複数ページ PDF 対応
- rooms の高精度抽出
- floorLabel のフロントエンド連携

---

## テスト実行方法

```bash
cd amplify-mock
pip3 install -r scripts/pipeline/requirements-dev.txt
python3 -m pytest scripts/pipeline/tests/ -v
# → 28 passed
```

fixture の再生成:
```bash
python3 scripts/pipeline/tests/fixtures/generate_fixtures.py
```

---

## 絶対に壊してはいけないもの

1. **6 API エンドポイント** の契約 (URL / リクエスト / レスポンス形式)
   - `POST /api/plans/upload`
   - `POST /api/jobs`
   - `GET /api/jobs/[jobId]`
   - `GET /api/jobs/[jobId]/artifacts/[format]`
   - `GET /api/jobs/[jobId]/quantities`
   - `POST /api/internal/pipeline/run`

2. **28 テスト** が全て合格する状態

3. **stdin/stdout JSON プロトコル** — Python ↔ Node.js 間の通信規約

4. **TypeScript 型定義** (`src/types/pipeline.ts`)

5. **scale-aware しきい値の設計** — `_REAL_MM_BASES` を実寸 mm で定義し `derive_thresholds(scale)` で換算

6. **Python 3.9 互換** — `from __future__ import annotations` が必要

7. **fixture ベーステストの独立性** — `data/uploads/` に依存しない。`scripts/pipeline/tests/fixtures/` 内の PDF だけで再現可能

---

## 次に進むなら優先すべきこと

### 優先度 1: IFC 構造化 JSON の拡充
walls / openings の構造化データから IFC 変換の前段階を整理する。
現在の `PipelineOutput` は `structured_json` を inline で返しているだけ。

### 優先度 2: 二重線パターンの窓検出
現在の window 検出は rect パターンのみ。壁に沿った短い平行線対を検出すると、より多くの図面に対応可能。

### 優先度 3: rooms の精度向上
現在はテキストブロックの位置から部屋名を簡易抽出しているだけ。壁で囲まれた領域の検出は未実装。

### 優先度 4: 複数ページ PDF 対応
現在は最初のページのみ処理。`doc.page_count` を使ったループは容易だが、floorLabel の割り当てロジックが必要。

---

## 作業の進め方

- **慎重なシニアエンジニア兼メンター** として振る舞ってください (`CLAUDE.md` の方針)
- 大きな作り直しより、意図のある改善を優先する
- 変更後は必ず `python3 -m pytest scripts/pipeline/tests/ -v` で 28 テストが全て通ることを確認する
- 新機能を追加したら、fixture + テストも追加する
- 日本語ファーストの文言品質を意識する
- docs (`phase8a-quickstart.md`, `project-roadmap-phase5-8.md`) も変更に合わせて更新する

---

## 座標系・単位の注意

- PDF 内部: ポイント (pt)。`1pt = 1/72 inch = 0.3528mm`
- 出力: すべて paper mm
- しきい値: 実寸 mm → `paper_mm = real_mm / scale`
- `scale=50` が基準値 (後方互換)
- `PT_TO_MM = 0.3528` が変換定数
