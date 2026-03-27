# AGENTS.md

## プロジェクト概要
このリポジトリは `amplify-mock` です。  
AmpliFy を参考にした、**顧客デモ品質のフロントエンド + 擬似 backend + 最小パイプライン縦切り**を扱う PoC リポジトリです。

主な目的:
- 日本語を第一言語とした、完成度の高いフロントエンドデモを作る
- `real` モード（既定）で upload -> job -> polling -> artifact 取得までを壊さない
- upload -> ready -> processing -> completed / failed の体験を丁寧に作る
- 将来、実バックエンドに接続しやすい構造を保つ

現状は **製品完成版ではないが、静的 UI モックでもない** 段階です。  
Next.js Route Handlers（擬似 backend）+ in-memory store + Python パイプライン実行 + 最小 IFC 生成まで接続済みです。  
一方で、`rvt` / `dwg` 返却や一部数量などは引き続き mock 相当の実装が残っています。

---

## 基本方針
このリポジトリで作業する際は、以下を守ってください。

1. **見た目の改善よりも、まずリポジトリの健全性を優先する**
   - build / lint / typecheck を壊さない
   - 見た目が良くても不安定な状態は失敗とみなす

2. **大規模な作り直しは避ける**
   - できるだけ小さく安全な修正を優先する
   - 強い理由がない限り、現行のコンポーネント構成を活かす

3. **API 境界を維持する**
   - UI / components / hooks に将来のバックエンド実装を直接埋め込まない
   - `src/lib/api/` 配下の API 層を使う
   - mock と本実装の差し替えがしやすい構造を保つ

4. **プロダクトデモとしての説得力を保つ**
   - empty / ready / processing / completed / failed の状態差を丁寧に作る
   - Viewer の操作体験は、顧客デモとして十分な自然さを持たせる

5. **日本語ファーストの UX**
   - 既定言語は日本語
   - 英語は補助的
   - 日本語文言は、SaaS / 建築 / 業務ツールとして自然で簡潔にする

---

## 現在の想定アーキテクチャ

### フロントエンド構成
- Next.js（App Router）
- TypeScript
- Tailwind CSS
- shadcn/ui ベースのコンポーネント
- react-three-fiber / drei
- react-dropzone
- dnd-kit
- react-hook-form + zod

### i18n
このリポジトリでは現在、**独自辞書 + React Context** を使っています。  
`next-intl` は現在の正式な実装方針ではありません。

i18n を触る場合は:
- 明示的な移行指示がない限り、現行方式を維持する
- 中途半端な多言語移行状態を残さない
- 日本語を既定言語のままにする

### API 層
以下の責務を分離してください。

- `src/lib/api/types.ts`
- `src/lib/api/endpoints.ts`
- `src/lib/api/real.ts`
- `src/lib/api/mock.ts`
- `src/lib/api/client.ts`

想定する API 面:
- `uploadPlans(files)`
- `createAmplifyJob(payload)`
- `getAmplifyJob(jobId)`
- `downloadArtifact(jobId, format)`
- `downloadQuantities(jobId)`
- `submitLeadForm(payload)`

強い理由がない限り、この API 層を迂回しないでください。

### いま信頼すべき事実（実装基準）
- `NEXT_PUBLIC_API_MODE` 未指定時は `real` モード
- `POST /api/jobs` は `queued` を返し、バックグラウンドで Python パイプラインを実行する
- job 成功/失敗は実パイプライン結果ベース（`real` 側に `shouldFail` 分岐はない）
- `structured_json` と `ifc` は実成果物を返せる。`rvt` / `dwg` は現時点ではモック返却
- job / file / lead メタデータは in-memory のため、サーバー再起動で消える

### 壊してはいけない境界
- UI からは `src/lib/api/client.ts` を唯一の API 入口として使う
- `upload -> create job -> polling -> artifact/quantities` の流れを維持する
- Route Handlers と pipeline-runner の責務を混在させない
- 「現在の実装」と「将来構想」をドキュメント・実装の両方で混同しない

---

## このリポジトリ固有の重要ルール

### 1. `node_modules` や `.next` をコミット・共有前提にしない
共有物を作るときは:
- `node_modules` を含めない
- `.next` を含めない
- zip 共有時に実行権限が壊れる前提を意識する

### 2. 意味のある変更後は必ずリポジトリ健全性を確認する
必要に応じて以下を実行してください。
- `npm install`
- `npm run lint`
- `npm run build`

確認できていない場合は、その旨を明記してください。

### 3. ファイル ID の二重管理を避ける
`files` の中にすでに ID があるなら、別の state で矛盾する ID 一覧を持たないでください。  
できるだけ derived state を使い、二重管理を避けてください。

### 4. Reset View は本当に reset すること
「表示をリセット」「Reset View」系の UI は、  
単に camera mode を変えるだけではなく、**Viewer の実際の reset 動作** に接続してください。

### 5. `startFloor` は実際の階ラベル計算に反映すること
表示だけの UI にしないでください。  
並べ替え後のラベル再計算も、開始階設定と整合している必要があります。

### 6. failed 状態は再現可能にしておくこと
`real` モードで実エラーフローを再現できる状態を維持してください。  
`shouldFail` のような擬似分岐を `real` 側に戻さず、存在しない `fileId` など実入力エラーで failed を確認できるようにしてください。

### 7. 設定パネルの値は Viewer に意味のある形で反映すること
少なくとも以下は、見た目に反映されるべきです。
- floor height
- opacity
- camera mode
- reset view

---

## 優先順位
複数の問題がある場合は、以下の順で修正してください。

1. build / lint / 型の安定性
2. Viewer 制御の正しさ
3. API 境界の正しさ
4. 状態遷移の正しさ
5. Settings が Viewer / UI に反映されること
6. Download フローの完成度
7. Multi-storey UX の改善
8. 文言・見た目の微調整

---

## UX の期待値
このリポジトリは、ワイヤーフレームではなく**製品デモ**として見えるべきです。

重視すること:
- 整った余白
- 強い視覚的階層
- 控えめなアニメーション
- 一貫したボタン、カード、ラベル、empty state
- 説得力のある processing 表示
- 自然な日本語文言

避けること:
- うるさいアニメーション
- 最終 UI に残った雑なプレースホルダー文言
- 押せるのに何も起きない要素を説明なく残すこと

---

## 変更時の推奨手順
以下の流れを優先してください。

1. 現在の実装を理解する
2. 最小で安全な修正方針を決める
3. 変更を入れる
4. 動作とリポジトリ健全性を確認する
5. 以下を整理して報告する
   - 何を変えたか
   - なぜ変えたか
   - どんなリスクが残るか

---

## 報告時の期待
作業完了時には、以下を明確にしてください。

- 何を変更したか
- どのコマンドを実行したか
- lint / build が通ったか
- 未解決の課題は何か
- この状態から次へ進めてよいか

不確実な点は曖昧にせず、分からないときは分からないと明記してください。

---

## このリポジトリの到達目標
最終的に目指すものは以下です。

> 日本語ファーストで、API 境界が明確で、内部構造が安定し、Viewer 体験に説得力があり、最小縦切り（front + 擬似 backend + pipeline）を維持しながら将来バックエンド接続へ自然に進める PoC。
