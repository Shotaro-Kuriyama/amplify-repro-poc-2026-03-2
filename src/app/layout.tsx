import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AmpliFy — 建築図面から3Dモデルへ",
  description:
    "PDFの建築平面図をAIでBIM 3Dモデル（IFC・RVT・DWG）に変換するWebアプリケーション",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja" className="h-full antialiased">
      <body className="min-h-full flex flex-col font-sans">{children}</body>
    </html>
  );
}
