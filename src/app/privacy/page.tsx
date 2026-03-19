import { APP_NAME } from "@/lib/constants";
import Link from "next/link";

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <Link
        href="/"
        className="mb-8 inline-block text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        &larr; {APP_NAME} に戻る
      </Link>
      <h1 className="mb-8 text-2xl font-bold tracking-tight">
        プライバシーポリシー
      </h1>
      <div className="prose prose-sm prose-slate max-w-none space-y-6 text-muted-foreground">
        <section>
          <h2 className="text-base font-semibold text-foreground">
            1. 収集する情報
          </h2>
          <p>
            本サービスでは、モデルダウンロード時に以下の情報を収集する場合があります：氏名、メールアドレス、国・地域、組織種別、会社名。
          </p>
        </section>
        <section>
          <h2 className="text-base font-semibold text-foreground">
            2. 情報の利用目的
          </h2>
          <p>
            収集した情報は、サービス改善およびユーザーサポートの目的にのみ使用されます。第三者への提供は行いません。
          </p>
        </section>
        <section>
          <h2 className="text-base font-semibold text-foreground">
            3. データの保管と削除
          </h2>
          <p>
            アップロードされたPDFファイルは、処理完了後数時間以内に自動的に削除されます。ユーザーの明示的な同意がない限り、学習データとして使用されることはありません。
          </p>
        </section>
        <section>
          <h2 className="text-base font-semibold text-foreground">
            4. ユーザーの権利
          </h2>
          <p>
            GDPRおよび各国のデータ保護法に基づき、ユーザーは自身のデータへのアクセス、訂正、削除を請求する権利を有します。
          </p>
        </section>
      </div>
    </div>
  );
}
