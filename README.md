# AmpliFy Mock

建築平面図（PDF）をAIでBIM 3Dモデル（IFC・RVT・DWG）に変換するWebアプリ **AmpliFy** のフロントエンドモックです。

## セットアップ

```bash
# 1. 依存パッケージをインストール
npm install

# 2. 開発サーバーを起動
npm run dev
# → http://localhost:3000

# 3. リポジトリの健全性を確認（任意）
npm run lint
npm run build
```

> **注意**: `node_modules/` や `.next/` はリポジトリ・共有zipに含めないでください。
> 受け取った側は `npm install` から始めてください。

## クリーン環境での動作確認手順

他環境で受け取った場合や、初回セットアップ時は以下の順に実行してください。

```bash
npm install       # 依存パッケージをインストール（必須）
npm run lint      # ESLint 実行 — エラーなしで通ること
npm run build     # プロダクションビルド — 型チェック含む
npm run dev       # 開発サーバー起動
```

## 技術スタック

| 項目 | 選定 |
|---|---|
| フレームワーク | Next.js 16 (App Router) |
| 言語 | TypeScript |
| スタイリング | Tailwind CSS v4 + shadcn/ui |
| 3Dビューワー | react-three-fiber + drei |
| ファイルアップロード | react-dropzone |
| ドラッグ&ドロップ | @dnd-kit |
| フォーム | react-hook-form + zod |
| i18n | 独自辞書 + React Context（日本語デフォルト、next-intl不使用） |
| アイコン | lucide-react |

## ディレクトリ構成

```
src/
├── app/                  # Next.js App Router ページ
│   ├── page.tsx          # メインアプリ
│   ├── terms/page.tsx    # 利用規約
│   └── privacy/page.tsx  # プライバシーポリシー
├── components/
│   ├── layout/           # Header, Footer, AboutModal
│   ├── upload/           # DropZone, FileList
│   ├── multi-story/      # StoryManager（階層管理）
│   ├── viewer/           # Viewer3D, BuildingModel, ViewerControls
│   ├── settings/         # SettingsPanel
│   ├── download/         # DownloadModal
│   ├── guidelines/       # GuidelinesModal
│   └── ui/               # shadcn/ui コンポーネント
├── hooks/
│   ├── useAmplifyJob.ts  # ジョブ状態管理（idle→processing→completed/failed）
│   └── useFileUpload.ts  # ファイルアップロード管理
├── lib/
│   ├── api/
│   │   ├── client.ts     # API窓口（→ mock.ts を差し替えで本番接続可能）
│   │   ├── mock.ts       # モック実装
│   │   ├── types.ts      # API 入出力型
│   │   └── endpoints.ts  # エンドポイントURL定義
│   ├── i18n/             # 辞書ベース i18n（ja/en）
│   ├── constants.ts
│   └── utils.ts
└── types/
    └── index.ts          # 共通型定義
```

## 状態遷移

```
idle → uploading → ready → processing → completed
                                      → failed
```

| 状態 | 説明 |
|---|---|
| idle | 初期状態。ファイル未アップロード |
| uploading | ファイルアップロード中 |
| ready | アップロード完了、変換可能 |
| processing | 変換処理中（4段階のステップ表示） |
| completed | 変換完了、3Dモデル表示・ダウンロード可能 |
| failed | 変換失敗（リセットして再試行可能） |

## API境界

`src/lib/api/client.ts` がアプリ全体の API 窓口です。現在は `mock.ts` にディスパッチしていますが、将来は実APIクライアントに差し替えるだけで接続できます。全レスポンスは Zod スキーマ（`schemas.ts`）で runtime 検証されます。

詳細な API 契約は **[docs/api-contract.md](docs/api-contract.md)** を参照してください。

### 定義済みAPI関数

| 関数 | 用途 |
|---|---|
| `uploadPlans(files)` | PDF図面をアップロード → ファイルメタデータを返却 |
| `createAmplifyJob(payload)` | 変換ジョブを作成 → ジョブID・初期状態を返却 |
| `getAmplifyJob(jobId)` | ジョブの状態・進捗・成果物を取得 |
| `downloadArtifact(jobId, format)` | モデルファイルをダウンロード |
| `downloadQuantities(jobId)` | 数量表データを取得 |
| `submitLeadForm(payload)` | リード情報を送信 → 送信IDを返却 |

### API層の構成

| ファイル | 役割 |
|---|---|
| `types.ts` | API request/response 型定義 |
| `schemas.ts` | Zod runtime validation スキーマ |
| `errors.ts` | エラーコード・ApiError クラス |
| `mock.ts` | 契約準拠のモック実装 |
| `client.ts` | Zod 検証付き API クライアント |
| `endpoints.ts` | REST エンドポイント URL 定義 |

## モック化箇所

| 機能 | モック内容 |
|---|---|
| PDF→BIM変換 | setTimeout ベースのフェイク進捗（変換開始時のファイル名に「fail」を含むと失敗デモ） |
| 3Dモデル表示 | 壁・窓・ドアのプロシージャルボックスモデル |
| スケール自動検出 | 固定値 (1:100) |
| ファイルダウンロード | ダミー Blob |
| 数量表 | ハードコードされたサンプルデータ |
| フォーム送信 | 遅延のみ、データ永続化なし |

## 失敗状態のデモ

ファイル名に `fail` を含むPDF（例: `fail-test.pdf`）をアップロードして変換を開始すると、ステップ2（壁検出）で意図的にエラーが発生します。failed 状態の UI 表示を確認できます。

## 階層ラベル

「開始階」の設定により、ファイルの並び順に応じた階ラベルが自動計算されます。

| 開始階 | 1ファイル目 | 2ファイル目 | 3ファイル目 |
|---|---|---|---|
| 1F（地上1階） | 1F | 2F | 3F |
| B1（地下1階） | B1 | GF | 1F |
| B2（地下2階） | B2 | B1 | GF |

## i18n 方針

`next-intl` は使用していません。`src/lib/i18n/` に独自の辞書ベース i18n を実装しています（React Context + `ja.ts` / `en.ts` 辞書ファイル）。日本語がデフォルトで、Footer の言語切り替えボタンで英語に切り替え可能です。

## 共有時の注意

zipで共有する際は、以下を**含めないでください**。

- `node_modules/` — `npm install` で復元可能
- `.next/` — `npm run build` で再生成可能
- `.DS_Store` — macOS の不要ファイル

```bash
# zip 作成例（除外指定つき）
zip -r amplify-mock.zip amplify-mock/ \
  -x "amplify-mock/node_modules/*" \
  -x "amplify-mock/.next/*" \
  -x "amplify-mock/.DS_Store"
```

## 開発コマンド

```bash
npm install      # 依存パッケージインストール
npm run dev      # 開発サーバー起動
npm run build    # プロダクションビルド（型チェック含む）
npm run lint     # ESLint 実行
npm start        # プロダクションサーバー起動
```
