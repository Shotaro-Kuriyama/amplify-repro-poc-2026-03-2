# API Contract

AmpliFy の API 契約定義。

## 前提（現在の実装）

このドキュメントは、**現時点の実装**に合わせた API 契約を整理したものです。

- デフォルトは `real` モード（`NEXT_PUBLIC_API_MODE` 未指定時）
- `real` モードでは `src/lib/api/real.ts` が Next.js Route Handlers (`/api/*`) を呼ぶ
- Route Handlers 側は in-memory store（`src/lib/server/store.ts`）を使う擬似 backend
- `POST /api/jobs` 後、`pipeline-runner` がバックグラウンドで Python パイプラインを実行
- 成功時は `structured_json` と最小 `ifc` artifact が生成される
- `mock` モードは補助的な切替モード（`src/lib/api/mock.ts` 直呼び）

## 処理フロー（real モード）

1. `POST /api/plans/upload` で PDF をアップロード
2. `POST /api/jobs` で job 作成（レスポンスは `status: "queued"`）
3. サーバー側で `executePipelineForJob(jobId)` を fire-and-forget 実行
4. `GET /api/jobs/:jobId` を polling
5. `completed` 時に `pipelineResult` と `artifacts` を取得
6. 必要に応じて `GET /api/jobs/:jobId/artifacts/:format` / `.../quantities` を取得

## API 一覧

フロントエンドは `src/lib/api/client.ts` 経由で次の 6 関数を呼びます。

### 1. `uploadPlans`

ファイルをアップロードし、サーバー割り当ての file metadata を返す。

**Request:**
```ts
{ files: File[] }
```

**Response:**
```ts
{
  files: Array<{
    fileId: string;
    originalName: string;
    size: number;
    mimeType: string;
    uploadedAt: string; // ISO 8601
  }>;
}
```

### 2. `createAmplifyJob`

ファイル ID と設定をもとに変換ジョブを作成し、バックグラウンド実行を開始する。

**Request:**
```ts
{
  fileIds: string[];
  files?: Array<{
    fileId: string;
    floorLabel: string; // 例: "1F", "B1"
  }>;
  settings: {
    scale: number;       // e.g. 100
    floorHeight: number; // meters
  };
}
```

`files` は `fileId` と `floorLabel` の対応を渡すためのオプション。未指定時はサーバー側で `1F, 2F, ...` を自動採番します。

**Response:**
```ts
{
  jobId: string;
  status: ApiJobStatus; // real: "queued", mock: "processing"
  fileIds: string[];
  createdAt: string;
}
```

### 3. `getAmplifyJob`

ジョブの現在状態を取得する（polling 用）。

**Request:** `getAmplifyJob(jobId: string)`

**Response:**
```ts
{
  jobId: string;
  status: ApiJobStatus;
  progress: number;                    // 0-100
  currentStep: ApiProcessingStep | null;
  artifacts: ApiJobArtifact[] | null;  // completed 時のみ非 null
  quantitiesReady: boolean;
  error: ApiErrorPayload | null;       // failed 時のみ非 null
  createdAt: string;
  completedAt: string | null;
  pipelineResult?: Record<string, unknown> | null;
}
```

`pipelineResult` は real モードでパイプライン結果がある場合に入ります。

### 4. `downloadArtifact`

生成物ファイルをダウンロードする。

**Request:**
```ts
{ jobId: string; format: "ifc" | "rvt" | "dwg" | "structured_json" }
```

**Response:** `Blob`

### 5. `downloadQuantities`

数量表データを取得する。

**Request:**
```ts
{ jobId: string }
```

**Response:**
```ts
{
  rows: Array<{
    element: string;
    count: number;
    unit: string;
    totalArea?: number;
    totalLength?: number;
  }>;
}
```

### 6. `submitLeadForm`

ダウンロード前のリード情報を送信する。

**Request:**
```ts
{
  data: {
    name: string;
    email: string;
    country: string;
    organizationType: string;
    company: string;
  };
  jobId: string;
}
```

**Response:**
```ts
{
  submissionId: string;
  submittedAt: string;
}
```

## Job Status

### API Job Status（バックエンド概念）

| Status | 意味 |
|---|---|
| `queued` | ジョブ受付済み、実行待ち |
| `processing` | パイプライン実行中 |
| `completed` | パイプライン正常完了 |
| `failed` | パイプライン実行失敗 |

### UI Job Status（フロントエンド概念）

| Status | 意味 | 由来 |
|---|---|---|
| `idle` | 初期状態 | ローカル状態 |
| `uploading` | アップロード中 | ローカル状態 |
| `ready` | 変換可能 | ローカル状態 |
| `processing` | 変換中 | API: `queued` or `processing` |
| `completed` | 完了 | API: `completed` |
| `failed` | 失敗 | API: `failed` |

`useAmplifyJob` が API status → UI status を変換します。

## Processing Steps

`currentStep` は以下の値を返します。

| Step | 意味 |
|---|---|
| `analyzing_plans` | 入力組み立て |
| `detecting_walls_and_openings` | Python パイプライン実行 |
| `building_3d_model` | 最小 IFC 生成 |
| `preparing_artifacts` | 結果確定・返却準備 |

## Error Model

エラー時は `ApiErrorPayload` 形式を返します。

```ts
{
  code: string;
  message: string;
  details?: Record<string, unknown>;
}
```

主なエラーコード（現在実装）:

- 共通系: `VALIDATION_ERROR`, `UNSUPPORTED_FILE_TYPE`, `UPLOAD_FAILED`, `JOB_NOT_FOUND`, `DOWNLOAD_NOT_READY`
- パイプライン系: `PIPELINE_INPUT_ERROR`, `PIPELINE_EXECUTION_ERROR`, `PIPELINE_OUTPUT_PARSE_ERROR`, `PIPELINE_FAILED`, `IFC_GENERATION_ERROR`
- artifact 系: `ARTIFACT_NOT_FOUND`, `ARTIFACT_INVALID`, `ARTIFACT_READ_ERROR`

## Runtime Validation

`src/lib/api/schemas.ts` に Zod スキーマを定義し、`client.ts` でレスポンスを runtime 検証します。

## API モード

`client.ts` は `NEXT_PUBLIC_API_MODE` で実装を切り替えます。

| 値 | 挙動 | 用途 |
|---|---|---|
| `real`（デフォルト） | `fetch` で Route Handlers (`/api/*`) を呼ぶ | 通常開発・実パイプライン確認 |
| `mock` | `mock.ts` を直接呼ぶ（HTTP なし） | UI 単体確認・補助デモ |

```bash
# real モード（デフォルト）
npm run dev

# mock モード
NEXT_PUBLIC_API_MODE=mock npm run dev
```

## Real API（Route Handlers）

| ルート | メソッド | 対応 API |
|---|---|---|
| `/api/plans/upload` | POST | uploadPlans |
| `/api/jobs` | POST | createAmplifyJob |
| `/api/jobs/[jobId]` | GET | getAmplifyJob |
| `/api/jobs/[jobId]/artifacts/[format]` | GET | downloadArtifact |
| `/api/jobs/[jobId]/quantities` | GET | downloadQuantities |
| `/api/leads` | POST | submitLeadForm |

補足:

- `POST /api/internal/pipeline/run` は実験用 endpoint（6 API 契約の外）
- poll 間隔は `useAmplifyJob` で 1.5 秒

### データ保持

- job / file / lead メタ情報: in-memory（`src/lib/server/store.ts`）
- アップロード実ファイル: `data/uploads/*`
- 生成 IFC: `data/artifacts/<jobId>/model.ifc`

in-memory のため、サーバー再起動でメタ情報は消えます。

### 進捗計算（現在実装）

時間経過ベースではなく、`pipeline-runner` が更新する `pipelineStep` に応じて進捗を返します。

| 状態/ステップ | 進捗 |
|---|---|
| `queued` | 5 |
| `analyzing_plans` | 15 |
| `detecting_walls_and_openings` | 40 |
| `building_3d_model` | 65 |
| `preparing_artifacts`（processing中） | 85 |
| `completed` | 100 |
| `failed` | 0 |

### artifact / quantities の返却

- `structured_json`: `job.pipelineOutput` があれば実データを返す
- `ifc`: `job.pipelineOutput` 内の IFC ファイルを返す
- `rvt` / `dwg`: 現時点ではモック返却
- `quantities`: `pipelineOutput.stats` があれば実カウント（壁/開口部/部屋）を返す

## 失敗デモ（現在）

real モードでは、`shouldFail` のような意図的 mock 分岐は使いません。
失敗は実際のパイプライン実行結果に基づいて決まります。

代表的な再現方法:

- 存在しない `fileId` で `POST /api/jobs` を作成して `PIPELINE_INPUT_ERROR` を発生させる
- Python 実行エラーや JSON パース失敗を誘発して `PIPELINE_EXECUTION_ERROR` / `PIPELINE_OUTPUT_PARSE_ERROR` を確認する

具体的な手順は `docs/phase8a-quickstart.md` を参照してください。

## Mock の役割

`src/lib/api/mock.ts` は API 契約準拠の補助実装です。

- HTTP なしで API 応答を再現
- `setTimeout` による擬似遅延
- `shouldFail`（ファイル名に `fail`）は **mock モードのみ** で有効

`mock` は UI 作業や軽量確認向けで、デフォルト運用は `real` を前提とします。

## 将来拡張（現時点では未実装）

ここから先は将来案です。上記の「現在の実装」と混同しないでください。

1. 外部 API サーバー（FastAPI など）へ切り替える
2. `NEXT_PUBLIC_API_URL` を外部 URL に設定する
3. Route Handlers を削除またはプロキシ化する
4. store / file storage を DB + object storage 実装に差し替える
