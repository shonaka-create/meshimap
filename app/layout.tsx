import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/components/auth/AuthProvider";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "MeshiMap - 食の思い出を地図に残そう",
  description: "食の思い出を地図上で管理・共有できるグルメSNS",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja" className="h-full">
      <body className={`${inter.className} min-h-full bg-gray-50`}>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
