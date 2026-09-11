import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = { title: "coolmigrate", description: "One-click app and database migration between Coolify servers" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="flex items-center gap-6 px-6 h-12 border-b" style={{ borderColor: "var(--line)" }}>
          <Link href="/" className="font-semibold tracking-tight flex items-center gap-2"><img src="/logo.svg" alt="" width={22} height={22} style={{ borderRadius: 5 }} />coolmigrate</Link>
          <nav className="flex gap-4 text-sm" style={{ color: "var(--muted)" }}>
            <Link href="/">Migrate</Link>
            <Link href="/migrations">History</Link>
            <Link href="/settings">Settings</Link>
          </nav>
        </header>
        <main className="max-w-5xl mx-auto px-6 py-8">{children}</main>
      </body>
    </html>
  );
}
