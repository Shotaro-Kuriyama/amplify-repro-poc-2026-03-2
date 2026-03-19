import { APP_NAME } from "@/lib/constants";
import Link from "next/link";

export default function TermsPage() {
  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <Link
        href="/"
        className="mb-8 inline-block text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        &larr; {APP_NAME} に戻る
      </Link>
      <h1 className="mb-8 text-2xl font-bold tracking-tight">利用規約</h1>
      <div className="prose prose-sm prose-slate max-w-none space-y-6 text-muted-foreground">
        <section>
          <h2 className="text-base font-semibold text-foreground">1. サービスの概要</h2>
          <p>
            {APP_NAME}（以下「本サービス」）は、建築平面図のPDFファイルをBIM
            3Dモデルに変換するWebアプリケーションです。本サービスは現在開発中のモック版であり、実際の変換処理は行われません。
          </p>
        </section>
        <section>
          <h2 className="text-base font-semibold text-foreground">2. 利用条件</h2>
          <p>
            本サービスの利用にあたり、ユーザーは以下の条件に同意するものとします。アップロードされたファイルは処理後に自動的に削除されます。
          </p>
        </section>
        <section>
          <h2 className="text-base font-semibold text-foreground">3. 免責事項</h2>
          <p>
            本サービスで生成されるモデルの精度や完全性について、いかなる保証も行いません。本サービスの利用により生じた損害について、運営者は一切の責任を負いません。
          </p>
        </section>
        <section>
          <h2 className="text-base font-semibold text-foreground">4. 知的財産</h2>
          <p>
            アップロードされた図面の著作権はユーザーに帰属します。生成されたモデルの利用権はユーザーに付与されます。
          </p>
        </section>
      </div>
    </div>
  );
}
