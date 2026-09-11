"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/", label: "Migrate", icon: <path d="M3 8h10M9 4l4 4-4 4" /> },
  { href: "/migrations", label: "History", icon: <path d="M8 4v4l3 2M14 8A6 6 0 1 1 8 2" /> },
  { href: "/settings", label: "Settings", icon: <path d="M8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5ZM2 8h1.5M12.5 8H14M8 2v1.5M8 12.5V14M3.8 3.8l1 1M11.2 11.2l1 1M3.8 12.2l1-1M11.2 4.8l1-1" /> },
];

export function Sidebar() {
  const p = usePathname();
  return (
    <aside className="side">
      <Link href="/" className="brand"><img src="/logo.svg" alt="" />coolmigrate</Link>
      {items.map((i) => (
        <Link key={i.href} href={i.href} className={`nav-item ${(i.href === "/" ? p === "/" : p.startsWith(i.href)) ? "active" : ""}`}>
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">{i.icon}</svg>{i.label}
        </Link>
      ))}
      <div className="foot">v0.1 · localhost only</div>
    </aside>
  );
}
