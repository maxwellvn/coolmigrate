import type { Metadata } from "next";
import "./globals.css";
import { Sidebar } from "./sidebar";

export const metadata: Metadata = { title: "coolmigrate", description: "One-click app and database migration between Coolify servers" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="shell">
          <Sidebar />
          <main className="main">{children}</main>
        </div>
      </body>
    </html>
  );
}
