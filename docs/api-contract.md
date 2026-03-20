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

> **Phase 7 決定事項メモ**: 現在の mock は `Blob` を直接返却しているが、実バックエンド接続時には以下の 2 択を検討すること。
> 1. **Blob 直返し** — `fetch` で `response.blob()` を取得し、そのまま返す（現行と同じ interface）
> 2. **downloadUrl 返却** — レスポンスを `{ downloadUrl: string; expiresAt: string }` にし、クライアント側で URL を開く
>
> 選択基準: ファイルサイズが大きい場合や署名付き URL（S3 presigned URL 等）を使う場合は downloadUrl 方式が適切。Phase 7 の最初にバックエンドのストレージ設計と合わせて決定する。

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

## Mock の役割

`src/lib/api/mock.ts` は API 契約に準拠したリファレンス実装です。

- `setTimeout` で非同期遅延をシミュレーション
- ファイル名に `fail` を含むと `PROCESSING_FAILED` を再現
- Per-job 状態管理（グローバル状態漏れなし）

## Phase 7 以降での差し替え手順

1. 実バックエンドの API を実装する（同じレスポンス shape に準拠）
2. `src/lib/api/` に `real.ts` 等を作成し、`endpoints.ts` の URL に `fetch` する
3. `client.ts` の `mockApi` を `realApi` に差し替える
4. Zod validation が自動的にレスポンスを検証する
5. `useAmplifyJob` の adapter 層が API → UI の変換を引き続き担当する
