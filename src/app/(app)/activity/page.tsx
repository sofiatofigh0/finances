import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { endOfMonth, startOfMonth, subMonths, addMonths } from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { getSessionUser, createServerSupabase } from "@/lib/supabase/server";
import { mapTransaction } from "@/lib/db/context";
import { dedupePendingPosted } from "@/lib/finance/classify";
import { spentInBucket } from "@/lib/finance/safe-to-spend";
import { toISODate } from "@/lib/finance/dates";
import {
  TransactionList,
  type TransactionRow,
} from "@/components/finance/transaction-list";
import { ActivityFilters } from "@/components/finance/activity-filters";
import { Card, CardContent } from "@/components/ui/card";
import { formatMoney, formatMonthYear } from "@/lib/utils";

export const metadata: Metadata = { title: "Activity" };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 60;

interface SearchParams {
  month?: string;
  q?: string;
  account?: string;
  type?: string;
  page?: string;
}

export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const params = await searchParams;
  const supabase = await createServerSupabase();

  const monthAnchor = params.month
    ? new Date(`${params.month}-01T12:00:00`)
    : new Date();
  const monthStart = toISODate(startOfMonth(monthAnchor));
  const monthEnd = toISODate(endOfMonth(monthAnchor));
  const page = Math.max(0, Number(params.page ?? 0) || 0);

  // Aggregate totals are computed from the full month; the visible list is
  // paginated so a heavy month never ships thousands of rows to the phone.
  let query = supabase
    .from("spendable_transactions")
    .select("*")
    .eq("user_id", user.id)
    .gte("date", monthStart)
    .lte("date", monthEnd)
    .order("date", { ascending: false })
    .limit(1500);

  if (params.account) query = query.eq("account_id", params.account);
  if (params.type) query = query.eq("classification", params.type);
  if (params.q) {
    const term = params.q.replace(/[%,]/g, "");
    query = query.or(`name.ilike.%${term}%,merchant_name.ilike.%${term}%`);
  }

  const [{ data: txnRows }, { data: accountRows }] = await Promise.all([
    query,
    supabase
      .from("spendable_accounts")
      .select("id, name")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .order("name"),
  ]);

  const accountNames = new Map(
    (accountRows ?? []).map((a) => [a.id as string, a.name as string]),
  );

  const transactions = dedupePendingPosted((txnRows ?? []).map(mapTransaction));

  const summary = {
    fun: spentInBucket(transactions, "fun"),
    necessary: spentInBucket(transactions, "necessary"),
    fixed: spentInBucket(transactions, "fixed"),
  };

  const visible: TransactionRow[] = transactions
    .slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
    .map((t) => ({
      id: t.id,
      date: t.date,
      name: t.name,
      merchantName: t.merchantName ?? null,
      amount: t.amount,
      accountName: accountNames.get(t.accountId) ?? "Account",
      classification: t.classification,
      subcategory: t.subcategory ?? null,
      pending: t.pending,
      isRefund: t.isRefund,
    }));

  const hasMore = transactions.length > (page + 1) * PAGE_SIZE;
  const monthKey = monthStart.slice(0, 7);
  const prevMonth = toISODate(subMonths(monthAnchor, 1)).slice(0, 7);
  const nextMonth = toISODate(addMonths(monthAnchor, 1)).slice(0, 7);
  const isCurrentMonth = monthKey === toISODate(new Date()).slice(0, 7);

  const queryString = (overrides: Record<string, string | undefined>) => {
    const next = new URLSearchParams();
    const merged = { ...params, ...overrides };
    for (const [key, value] of Object.entries(merged)) {
      if (value) next.set(key, value);
    }
    return next.toString();
  };

  return (
    <div className="px-4 pt-3 md:px-6 md:pt-8">
      <header className="safe-top mb-4 flex items-center justify-between gap-2">
        <h1 className="text-[19px] font-semibold tracking-tight">Activity</h1>
        <div className="flex items-center gap-1">
          <Link
            aria-label="Previous month"
            href={`/activity?${queryString({ month: prevMonth, page: undefined })}`}
            className="flex size-9 items-center justify-center rounded-full text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-sunken)]"
          >
            <ChevronLeft className="size-[18px]" />
          </Link>
          <span className="min-w-[8.5rem] text-center text-[13px] font-medium">
            {formatMonthYear(monthStart)}
          </span>
          <Link
            aria-label="Next month"
            href={
              isCurrentMonth
                ? `/activity?${queryString({ page: undefined })}`
                : `/activity?${queryString({ month: nextMonth, page: undefined })}`
            }
            aria-disabled={isCurrentMonth}
            className={`flex size-9 items-center justify-center rounded-full ${
              isCurrentMonth
                ? "pointer-events-none text-[var(--color-ink-faint)] opacity-40"
                : "text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-sunken)]"
            }`}
          >
            <ChevronRight className="size-[18px]" />
          </Link>
        </div>
      </header>

      <Card className="mb-3.5">
        <CardContent className="grid grid-cols-3 gap-2 pt-5">
          {[
            { label: "Fun spent", value: summary.fun },
            { label: "Necessary", value: summary.necessary },
            { label: "Fixed", value: summary.fixed },
          ].map((item) => (
            <div key={item.label}>
              <p className="text-[11.5px] text-[var(--color-ink-faint)]">
                {item.label}
              </p>
              <p className="tnum mt-0.5 text-[17px] font-semibold tracking-tight">
                {formatMoney(item.value)}
              </p>
            </div>
          ))}
        </CardContent>
      </Card>

      <ActivityFilters
        accounts={(accountRows ?? []).map((a) => ({
          id: a.id as string,
          name: a.name as string,
        }))}
        current={{
          q: params.q ?? "",
          account: params.account ?? "",
          type: params.type ?? "",
          month: params.month ?? "",
        }}
      />

      <div className="mt-3.5">
        <TransactionList transactions={visible} />
      </div>

      {hasMore || page > 0 ? (
        <div className="mt-4 flex items-center justify-between">
          {page > 0 ? (
            <Link
              href={`/activity?${queryString({ page: String(page - 1) })}`}
              className="rounded-xl border border-[var(--color-border-subtle)] px-4 py-2.5 text-[13px] font-medium"
            >
              Newer
            </Link>
          ) : (
            <span />
          )}
          {hasMore ? (
            <Link
              href={`/activity?${queryString({ page: String(page + 1) })}`}
              className="rounded-xl border border-[var(--color-border-subtle)] px-4 py-2.5 text-[13px] font-medium"
            >
              Older
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
