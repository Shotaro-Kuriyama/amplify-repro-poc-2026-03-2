# API Contract

AmpliFy フロントエンドモックの API 契約定義。

## 概要

フロントエンドは `src/lib/api/client.ts` 経由で 6 つの API 関数を呼び出します。
現在は `mock.ts` がレスポンスを返していますが、将来は実バックエンド（FastAPI / Route Handler 等）に差し替え可能です。

差し替え時は `client.ts` の `mockApi` を実 API 実装に置き換えるだけで、Zod による runtime validation が型安全性を担保します。

## API 一覧

### 1. uploadPlans

ファイルをアップロードし、サーバー割り当ての file metadata を返す。

**Request:**
```typescript
{ files: File[] }
```

**Response:**
```typescript
{
  files: Array<{
    fileId: string;
    originalName: string;
    size: number;
    mimeType: string;
    uploadedAt: string;  // ISO 8601
  }>;
}
```

### 2. createAmplifyJob

ファイル ID と設定をもとに変換ジョブを開始する。

**Request:**
```typescript
{
  fileIds: string[];
  settings: {
    scale: number;       // e.g. 100
    floorHeight: number; // meters
  };
}
```

**Response:**
```typescript
{
  jobId: string;
  status: ApiJobStatus;  // "queued" | "processing"
  fileIds: string[];
  createdAt: string;     // ISO 8601
}
```

### 3. getAmplifyJob

ジョブの現在状態を取得する。ポーリングで使用。

**Request:** `getAmplifyJob(jobId: string)`

**Response:**
```typescript
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
}
```

### 4. downloadArtifact

生成物ファイルをダウンロードする。

**Request:**
```typescript
{ jobId: string; format: "ifc" | "rvt" | "dwg" }
```

**Response:** `Blob`

> **Phase 7 確定**: 案A（直接ファイルレスポンス）を採用。Route Handler が `Response` でバイナリを返し、client は `res.blob()` で受け取る。Phase 8 以降で S3 presigned URL 方式に移行する場合は、`real.ts` の `downloadArtifact` をリダイレクト or URL 返却に変更する。

### 5. downloadQuantities

数量表データを取得する。

**Request:**
```typescript
{ jobId: string }
```

**Response:**
```typescript
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

### 6. submitLeadForm

ダウンロード前のリード情報を送信する。

**Request:**
```typescript
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
```typescript
{
  submissionId: string;
  submittedAt: string;  // ISO 8601
}
```

## Job Status

### API Job Status（バックエンド概念）

| Status | 意味 |
|---|---|
| `queued` | ジョブ受付済み、処理待ち |
| `processing` | 変換処理中 |
| `completed` | 変換完了 |
| `failed` | 変換失敗 |

### UI Job Status（フロントエンド概念）

| Status | 意味 | 由来 |
|---|---|---|
| `idle` | 初期状態 | ローカル状態 |
| `uploading` | アップロード中 | ローカル状態 |
| `ready` | 変換可能 | ローカル状態 |
| `processing` | 変換中 | API: `queued` or `processing` |
| `completed` | 完了 | API: `completed` |
| `failed` | 失敗 | API: `failed` |

`idle`, `uploading`, `ready` はフロントエンド固有の画面状態です。
`useAmplifyJob` フックが API status → UI status の変換を行います。

## Processing Steps

API が返す `currentStep` の値:

| Step | 意味 |
|---|---|
| `analyzing_plans` | 図面解析 |
| `detecting_walls_and_openings` | 壁・開口部検出 |
| `building_3d_model` | 3Dモデル生成 |
| `preparing_artifacts` | 出力準備 |

## Error Model

エラー時は `ApiErrorPayload` 形式で返却:

```typescript
{
  code: string;    // 例: "PROCESSING_FAILED"
  message: string; // 人間向けメッセージ
  details?: Record<string, unknown>;
}
```

定義済みエラーコード: `VALIDATION_ERROR`, `UNSUPPORTED_FILE_TYPE`, `FILE_TOO_LARGE`, `UPLOAD_FAILED`, `JOB_NOT_FOUND`, `JOB_NOT_READY`, `PROCESSING_FAILED`, `DOWNLOAD_NOT_READY`, `LEAD_SUBMISSION_FAILED`, `UNKNOWN_ERROR`

## Runtime Validation

`src/lib/api/schemas.ts` に全レスポンスの Zod スキーマが定義されています。
`client.ts` がレスポンスを `schema.parse()` で検証するため、mock/実 API どちらでも型安全性が保証されます。

## API モード

`client.ts` は環境変数 `NEXT_PUBLIC_API_MODE` で API 実装を切り替えます。

| 値 | 挙動 | 用途 |
|---|---|---|
| `real`（デフォルト） | `fetch` で Route Handlers (`/api/*`) を呼ぶ | 通常開発・デモ |
| `mock` | `mock.ts` を直接呼ぶ（HTTP なし） | Phase 6 以前の動作確認・単体テスト |

切り替え方法:
```bash
# real API モード（デフォルト）
npm run dev

# mock モード
NEXT_PUBLIC_API_MODE=mock npm run dev
```

## Real API（Route Handlers）

Phase 7 で導入された `fetch` ベースの擬似 backend です。

### 構成

| ルート | メソッド | 対応 API |
|---|---|---|
| `/api/plans/upload` | POST | uploadPlans |
| `/api/jobs` | POST | createAmplifyJob |
| `/api/jobs/[jobId]` | GET | getAmplifyJob |
| `/api/jobs/[jobId]/artifacts/[format]` | GET | downloadArtifact |
| `/api/jobs/[jobId]/quantities` | GET | downloadQuantities |
| `/api/leads` | POST | submitLeadForm |

### In-memory Store / Repository

`src/lib/server/store.ts` が擬似 backend のデータ層です。

- `FileRepository`: アップロード済みファイルメタデータ（現在は InMemory 実装）
- `JobRepository`: ジョブ状態（現在は InMemory 実装、作成時刻ベースで進捗を時間計算）
- `LeadRepository`: リード送信データ（現在は InMemory 実装）

データはサーバー再起動で消えます（in-memory のため）。
将来 SQLite / PostgreSQL に差し替える場合は、Repository インターフェースの別実装を作成し、シングルトンを差し替える。

### File Storage（Phase 7.5）

`src/lib/server/file-storage.ts` がアップロードされたファイル実体の保存を担当します。

- `FileStorage` インターフェース: `save()` / `getPath()` / `read()`
- 現在は `LocalFileStorage`（`data/uploads/{fileId}/` に保存）
- 将来は S3 / GCS に差し替え可能

### Job 進捗の仕組み

ジョブ作成時に `startedAtMs`（現在時刻）を記録し、GET 時に経過時間から現在の進捗・ステップを計算します。

| 経過時間 | ステップ | 進捗 |
|---|---|---|
| 0–2秒 | analyzing_plans | 0→25% |
| 2–5秒 | detecting_walls_and_openings | 25→50% |
| 5–8.5秒 | building_3d_model | 50→80% |
| 8.5–10秒 | preparing_artifacts | 80→100% |

fail デモ: ファイル名に `fail` を含む場合、5秒経過時点で `PROCESSING_FAILED` を返却。

### Polling

`useAmplifyJob` が 1.5 秒間隔で `GET /api/jobs/:jobId` をポーリングします。
`completed` または `failed` を受信したらポーリングを停止します。

### downloadArtifact の返却方式

**案A（直接ファイルレスポンス）** を採用。Route Handler が `Response` で直接ファイルを返し、client は `res.blob()` で受け取ります。

### Request Validation

JSON body を持つエンドポイント（`/api/jobs`, `/api/leads`）は Zod で入力を検証し、不正入力には `VALIDATION_ERROR` を返します。ジョブ未存在時は `JOB_NOT_FOUND`（404）、未完了ジョブへのダウンロード要求には `DOWNLOAD_NOT_READY`（409）を返します。

## Mock の役割

`src/lib/api/mock.ts` は API 契約に準拠したリファレンス実装です。

- `setTimeout` で非同期遅延をシミュレーション
- ファイル名に `fail` を含むと `PROCESSING_FAILED` を再現
- Per-job 状態管理（グローバル状態漏れなし）
- `NEXT_PUBLIC_API_MODE=mock` で有効化

## Phase 8A で接続予定のポイント

Phase 8A（ルールベース PDF 処理）に進む際、現行 API 契約に対して以下の接続・拡張が必要になる見込み。

### 1. floorLabel のサーバー側受け渡し

`PipelineInput`（`src/types/pipeline.ts`）は各ファイルに `floorLabel`（"1F", "B1" 等）を必要とするが、現在この情報はフロントエンド（`useFileUpload.ts`）にしか存在しない。

`createAmplifyJob` の request を拡張して、`fileIds` と対応する `floorLabel` を渡す形が最もシンプルだが、API 契約変更になるため着手時に判断する。

### 2. 実際の処理結果の返却

現在の `getAmplifyJob` と `downloadArtifact` / `downloadQuantities` はモックデータを返しているが、Phase 8A 以降は Worker が生成した実データをストレージ / DB から読み出して返す形に変わる。

API レスポンスの shape 自体は変更不要（現行契約のまま使える）。

## Phase 8 以降での差し替え手順

1. FastAPI 等で同じ REST API を実装する（同じレスポンス shape に準拠）
2. `NEXT_PUBLIC_API_URL` を外部サーバーの URL に設定する（例: `http://localhost:8000/api`）
3. Route Handlers を削除するか、プロキシに変換する
4. `real.ts` の `fetch` ロジックはそのまま使える
5. Zod validation が自動的にレスポンスを検証する
6. `useAmplifyJob` の adapter 層が API → UI の変換を引き続き担当する
