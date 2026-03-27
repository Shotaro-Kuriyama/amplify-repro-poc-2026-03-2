# ARCHITECTURE

## 目的

このドキュメントは、`amplify-mock` の現在の実装境界（front / api / pipeline / viewer）を短く把握するためのメモです。

## 全体構成

- フロント: Next.js App Router (`src/app/page.tsx`)
- API 境界: `src/lib/api/*`（`client.ts` を唯一の入口にする）
- 擬似 backend: Next.js Route Handlers (`src/app/api/*`)
- パイプライン実行: Node.js から Python (`scripts/pipeline/extract_pdf.py`) を `execFile` で呼び出し
- 3D viewer: `react-three-fiber` + `drei`

## 処理フロー（real モード）

1. `POST /api/plans/upload`
2. `POST /api/jobs`（job 作成）
3. `pipeline-runner` が非同期で Python pipeline を実行
4. `GET /api/jobs/[jobId]` を polling
5. `completed` 時に `pipelineResult` と `artifacts`（`structured_json` + 最小 `ifc`）を取得
6. viewer が `pipelineResult.floors[].walls/openings` を描画
7. `GET /api/jobs/[jobId]/artifacts/[format]` で成果物をダウンロード

## 主な責務

- `src/hooks/useAmplifyJob.ts`
  - API 応答を UI 用状態へ変換
  - `pipelineResult`（サマリー）と `pipelineModel`（viewer 用）を保持
- `src/components/viewer/Viewer3D.tsx`
  - 状態別 UI（processing/completed/failed）
  - pipeline 座標（paper mm）を `settings.scale` で world m に変換して bounds を算出
  - モデル bounds からカメラ fit を安定化
- `src/components/viewer/BuildingModel.tsx`
  - `pipelineModel` から壁・開口部の簡易 3D を生成
  - データがない場合のみフォールバックモデルを表示
- `src/lib/server/pipeline-runner.ts`
  - Python 実行と job 状態遷移管理
  - 最小 IFC 生成（`ifc-generator.ts`）まで含めて成功判定

## データ永続化

- job / file / lead メタ情報: in-memory (`src/lib/server/store.ts`)
- アップロード実ファイル: `data/uploads/*`
- 生成 IFC: `data/artifacts/<jobId>/model.ifc`

## 制約（Phase 8A）

- 壁検出はルールベース（主に水平/垂直）
- opening は簡易推定
- IFC は最小 PoC（壁中心）
- `rvt` / `dwg` はモック返却
