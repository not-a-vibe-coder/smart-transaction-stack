import type { Metadata } from "next";
import { Inter } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: "Solana Pay Dispatcher",
  description: "Guaranteed stablecoin delivery — Jito bundles + AI recovery",
};

function ConnectionDot() {
  return (
    <span className="relative flex h-2.5 w-2.5">
      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
      <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500" />
    </span>
  );
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="min-h-screen bg-[#0a0a0a] text-gray-100">
        <header className="border-b border-gray-800 bg-[#0d0d0d]">
          <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <ConnectionDot />
              <span className="font-semibold text-white tracking-tight">
                Solana Pay Dispatcher
              </span>
              <span className="text-xs text-gray-500 hidden sm:inline">
                Jito bundles · Geyser streaming · AI recovery
              </span>
            </div>
            <nav className="flex gap-5 text-sm text-gray-400">
              <Link href="/dashboard" className="hover:text-white transition-colors">
                Dashboard
              </Link>
              <Link href="/payments" className="hover:text-white transition-colors">
                Payments
              </Link>
              <Link href="/logs" className="hover:text-white transition-colors">
                Logs
              </Link>
            </nav>
          </div>
        </header>
        <main className="max-w-7xl mx-auto px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
