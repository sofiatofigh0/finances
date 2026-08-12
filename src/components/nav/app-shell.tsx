"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Home,
  Receipt,
  CalendarDays,
  Target,
  Sparkles,
  Settings,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

const NAV: NavItem[] = [
  { href: "/", label: "Home", icon: Home },
  { href: "/activity", label: "Activity", icon: Receipt },
  { href: "/plan", label: "Plan", icon: CalendarDays },
  { href: "/goals", label: "Goals", icon: Target },
  { href: "/agent", label: "Agent", icon: Sparkles },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Mobile is the priority: persistent bottom navigation with touch-sized
 * targets and safe-area padding. Desktop gets a sidebar instead.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const wide = pathname === "/";

  return (
    <div className="min-h-dvh md:flex">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-3 py-6 md:flex">
        <Link href="/" className="mb-8 flex items-center gap-2.5 px-3">
          <span className="flex size-8 items-center justify-center rounded-lg bg-[var(--color-ink)] text-sm font-bold text-[var(--color-surface)]">
            S
          </span>
          <span className="text-[15px] font-semibold tracking-tight">
            Spendable
          </span>
        </Link>

        <nav className="flex flex-1 flex-col gap-1">
          {NAV.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-3 rounded-xl px-3 py-2.5 text-[14px] font-medium transition-colors",
                  active
                    ? "bg-[var(--color-surface-sunken)] text-[var(--color-ink)]"
                    : "text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-sunken)]",
                )}
              >
                <item.icon className="size-[18px]" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <Link
          href="/settings"
          className={cn(
            "flex items-center gap-3 rounded-xl px-3 py-2.5 text-[14px] font-medium transition-colors",
            isActive(pathname, "/settings")
              ? "bg-[var(--color-surface-sunken)] text-[var(--color-ink)]"
              : "text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-sunken)]",
          )}
        >
          <Settings className="size-[18px]" />
          Settings
        </Link>
      </aside>

      {/* Content. Bottom padding clears the mobile tab bar. */}
      <div className="min-w-0 flex-1">
        <main
          className={cn(
            "mx-auto w-full pb-28 md:pb-10",
            // The dashboard is a grid at desktop widths and wants the room.
            // Reading-oriented screens stay narrow, because a settings form or
            // a transaction list stretched across 1400px is worse, not better.
            wide ? "max-w-2xl lg:max-w-6xl" : "max-w-2xl",
          )}
        >
          {children}
        </main>
      </div>

      {/* Mobile bottom navigation */}
      <nav
        aria-label="Primary"
        className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-[var(--color-border-subtle)] bg-[var(--color-surface)]/95 backdrop-blur-lg md:hidden"
      >
        <ul className="mx-auto flex max-w-2xl">
          {NAV.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <li key={item.href} className="flex-1">
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex min-h-[56px] flex-col items-center justify-center gap-1 px-1 py-2 transition-colors",
                    active
                      ? "text-[var(--color-ink)]"
                      : "text-[var(--color-ink-faint)]",
                  )}
                >
                  <item.icon
                    className="size-[21px]"
                    strokeWidth={active ? 2.3 : 1.8}
                  />
                  <span className="text-[10.5px] font-medium tracking-tight">
                    {item.label}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
