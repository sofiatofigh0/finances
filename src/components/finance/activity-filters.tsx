"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Search, X } from "lucide-react";
import { CLASSIFICATION_LABELS } from "@/lib/utils";

const TYPES = ["fun", "necessary", "fixed", "goals", "transfer", "income"];

export function ActivityFilters({
  accounts,
  current,
}: {
  accounts: { id: string; name: string }[];
  current: { q: string; account: string; type: string; month: string };
}) {
  const router = useRouter();
  const [search, setSearch] = useState(current.q);

  function navigate(overrides: Record<string, string>) {
    const params = new URLSearchParams();
    const merged = { ...current, ...overrides };
    for (const [key, value] of Object.entries(merged)) {
      if (value) params.set(key, value);
    }
    router.push(`/activity?${params.toString()}`);
  }

  return (
    <div className="flex flex-col gap-2.5">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          navigate({ q: search });
        }}
        className="relative"
      >
        <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-[var(--color-ink-faint)]" />
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search merchants"
          aria-label="Search transactions"
          className="h-11 w-full rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] pl-10 pr-10 outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
        />
        {search ? (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => {
              setSearch("");
              navigate({ q: "" });
            }}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-full p-1.5 text-[var(--color-ink-faint)]"
          >
            <X className="size-4" />
          </button>
        ) : null}
      </form>

      <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4">
        <Chip
          active={!current.type}
          onClick={() => navigate({ type: "" })}
          label="All"
        />
        {TYPES.map((type) => (
          <Chip
            key={type}
            active={current.type === type}
            onClick={() => navigate({ type })}
            label={CLASSIFICATION_LABELS[type]}
          />
        ))}
      </div>

      {accounts.length > 1 ? (
        <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4">
          <Chip
            active={!current.account}
            onClick={() => navigate({ account: "" })}
            label="All accounts"
          />
          {accounts.map((account) => (
            <Chip
              key={account.id}
              active={current.account === account.id}
              onClick={() => navigate({ account: account.id })}
              label={account.name}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Chip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`shrink-0 whitespace-nowrap rounded-full px-3.5 py-2 text-[12.5px] font-medium transition-colors ${
        active
          ? "bg-[var(--color-ink)] text-[var(--color-surface)]"
          : "border border-[var(--color-border-subtle)] text-[var(--color-ink-muted)]"
      }`}
    >
      {label}
    </button>
  );
}
