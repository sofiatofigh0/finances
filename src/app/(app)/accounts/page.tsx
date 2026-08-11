import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Landmark, TriangleAlert } from "lucide-react";
import { getSessionUser, createServerSupabase } from "@/lib/supabase/server";
import { loadFinancialContext } from "@/lib/db/context";
import { getIntegrationStatus } from "@/lib/env";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { EntityForm, AddButton } from "@/components/finance/entity-form";
import { PlaidLinkButton } from "@/components/finance/plaid-link-button";
import { SyncButton } from "@/components/finance/sync-button";
import { DisconnectButton } from "@/components/finance/disconnect-button";
import {
  createManualAccount,
  updateAccount,
  deleteManualAccount,
  saveManualLiability,
  deleteManualLiability,
} from "@/app/actions/finance";
import { formatMoney, formatRelativeTime, isStale } from "@/lib/utils";

export const metadata: Metadata = { title: "Accounts" };
export const dynamic = "force-dynamic";

const LIABILITY_TYPES = [
  { value: "credit_card", label: "Credit card" },
  { value: "student_loan", label: "Student loan" },
  { value: "auto_loan", label: "Auto loan" },
  { value: "personal_loan", label: "Personal loan" },
  { value: "mortgage", label: "Mortgage" },
  { value: "medical", label: "Medical" },
  { value: "family", label: "Family / personal" },
  { value: "other", label: "Other" },
];

const PAYMENT_STRATEGIES = [
  { value: "statement_balance", label: "Statement balance" },
  { value: "minimum_payment", label: "Minimum payment" },
  { value: "full_balance", label: "Full current balance" },
  { value: "fixed_amount", label: "A fixed amount" },
];

export default async function AccountsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const supabase = await createServerSupabase();
  const context = await loadFinancialContext(user.id, new Date(), supabase);
  const integrations = getIntegrationStatus();

  const { data: items } = await supabase
    .from("spendable_plaid_items")
    .select("id, institution_name, status, error_message, last_successful_sync_at")
    .eq("user_id", user.id)
    .neq("status", "revoked");

  const active = context.accounts.filter((a) => a.isActive);
  const cash = active.filter((a) => a.type === "depository");
  const credit = active.filter((a) => a.type === "credit");
  const loans = active.filter((a) => a.type === "loan");

  const liabilityByAccount = new Map(
    context.liabilities.map((l) => [l.accountId, l]),
  );

  return (
    <div className="px-4 pt-3 md:px-6 md:pt-8">
      <header className="safe-top mb-4 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Link
            href="/settings"
            aria-label="Back to settings"
            className="-ml-2 flex size-9 shrink-0 items-center justify-center rounded-full text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-sunken)]"
          >
            <ArrowLeft className="size-[18px]" />
          </Link>
          <h1 className="truncate text-[19px] font-semibold tracking-tight">
            Accounts
          </h1>
        </div>
        <SyncButton label="Sync now" />
      </header>

      {/* ---------------------------- Connections -------------------------- */}
      <Card className="mb-3.5">
        <CardHeader>
          <CardTitle>Connected institutions</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {!integrations.plaid ? (
            <div className="rounded-xl bg-[var(--color-caution-soft)] p-3.5">
              <p className="text-[13px] font-medium text-[var(--color-caution)]">
                Plaid isn&apos;t configured yet
              </p>
              <p className="mt-1 text-[12.5px] leading-relaxed text-[var(--color-ink-muted)]">
                Add <code>PLAID_CLIENT_ID</code> and <code>PLAID_SECRET</code> to
                your environment to link real institutions. Until then you can
                add accounts manually below — everything else works.
              </p>
            </div>
          ) : (
            <>
              {(items ?? []).length > 0 ? (
                <ul className="mb-4">
                  {(items ?? []).map((item) => {
                    const broken = item.status === "needs_reauth" || item.status === "error";
                    return (
                      <li
                        key={item.id}
                        className="flex items-center justify-between gap-3 border-b border-[var(--color-border-subtle)] py-3 last:border-0"
                      >
                        <div className="min-w-0">
                          <p className="flex items-center gap-2 truncate text-[13.5px] font-medium">
                            {item.institution_name ?? "Institution"}
                            {broken ? (
                              <Badge tone="caution">Needs attention</Badge>
                            ) : (
                              <Badge tone="positive">Connected</Badge>
                            )}
                          </p>
                          <p className="mt-0.5 truncate text-[12px] text-[var(--color-ink-faint)]">
                            {broken
                              ? (item.error_message ??
                                "Sign in again to keep this up to date.")
                              : `Synced ${formatRelativeTime(item.last_successful_sync_at)}`}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                          {broken ? (
                            <PlaidLinkButton
                              itemId={item.id as string}
                              label="Reconnect"
                              variant="secondary"
                            />
                          ) : null}
                          <DisconnectButton
                            itemId={item.id as string}
                            institutionName={item.institution_name ?? "this institution"}
                          />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
              <PlaidLinkButton
                label={
                  (items ?? []).length > 0
                    ? "Connect another institution"
                    : "Connect with Plaid"
                }
                variant={(items ?? []).length > 0 ? "secondary" : "primary"}
              />
            </>
          )}
        </CardContent>
      </Card>

      {/* ------------------------------- Cash ------------------------------ */}
      <AccountGroup
        title="Cash"
        emptyText="No checking or savings accounts yet."
        addForm={
          <EntityForm
            trigger={<AddButton label="Add" />}
            title="Add an account"
            description="Track a balance Spendable can't see automatically."
            action={createManualAccount}
            fields={[
              { kind: "text", name: "name", label: "Account name", required: true, placeholder: "Everyday Checking" },
              { kind: "text", name: "institution_name", label: "Institution", placeholder: "My Bank" },
              {
                kind: "select",
                name: "type",
                label: "Type",
                options: [
                  { value: "depository", label: "Checking / savings" },
                  { value: "credit", label: "Credit card" },
                  { value: "loan", label: "Loan" },
                ],
                defaultValue: "depository",
              },
              { kind: "money", name: "current_balance", label: "Current balance" },
              {
                kind: "checkbox",
                name: "is_liquid",
                label: "Count this as spendable cash",
                hint: "Turn on for checking. Leave off for savings you're not planning to spend.",
                defaultChecked: true,
              },
            ]}
          />
        }
      >
        {cash.map((account) => (
          <EntityForm
            key={account.id}
            trigger={
              <AccountRow
                name={account.name}
                subtitle={`${account.institutionName ?? "Manual"}${
                  account.mask ? ` ••${account.mask}` : ""
                } · updated ${formatRelativeTime(account.balanceLastUpdatedAt)}`}
                amount={account.currentBalance ?? 0}
                badges={[
                  account.source === "manual"
                    ? { label: "Manual", tone: "neutral" as const }
                    : { label: "Plaid", tone: "accent" as const },
                  ...(account.isLiquid
                    ? [{ label: "Spendable cash", tone: "positive" as const }]
                    : []),
                  ...(isStale(account.balanceLastUpdatedAt, 24 * 7) &&
                  account.source === "manual"
                    ? [{ label: "Update me", tone: "caution" as const }]
                    : []),
                ]}
              />
            }
            title={account.name}
            description={
              account.source === "plaid"
                ? "Balance is kept up to date by your institution."
                : "Update the balance whenever it changes."
            }
            recordId={account.id}
            action={updateAccount}
            deleteAction={account.source === "manual" ? deleteManualAccount : undefined}
            fields={[
              { kind: "text", name: "name", label: "Nickname", defaultValue: account.name },
              ...(account.source === "manual"
                ? [
                    {
                      kind: "money" as const,
                      name: "current_balance",
                      label: "Current balance",
                      defaultValue: account.currentBalance ?? 0,
                    },
                  ]
                : []),
              {
                kind: "checkbox",
                name: "is_liquid",
                label: "Count this as spendable cash",
                hint: "Only accounts you'd actually spend from should count toward Safe to Spend.",
                defaultChecked: account.isLiquid,
              },
            ]}
          />
        ))}
      </AccountGroup>

      {/* ------------------------------ Credit ----------------------------- */}
      <AccountGroup
        title="Credit"
        emptyText="No credit cards yet."
      >
        {credit.map((account) => {
          const liability = liabilityByAccount.get(account.id);
          return (
            <EntityForm
              key={account.id}
              trigger={
                <AccountRow
                  name={account.name}
                  subtitle={[
                    account.creditLimit
                      ? `${formatMoney(account.creditLimit)} limit`
                      : null,
                    liability?.minimumPayment != null
                      ? `min ${formatMoney(liability.minimumPayment)}`
                      : null,
                    liability?.nextPaymentDueDate
                      ? `due ${liability.nextPaymentDueDate}`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                  amount={-(account.currentBalance ?? 0)}
                  badges={[
                    account.source === "manual"
                      ? { label: "Manual", tone: "neutral" as const }
                      : { label: "Plaid", tone: "accent" as const },
                    {
                      label:
                        PAYMENT_STRATEGIES.find(
                          (s) => s.value === account.paymentStrategy,
                        )?.label ?? "Statement balance",
                      tone: "neutral" as const,
                    },
                  ]}
                />
              }
              title={account.name}
              description="How much cash should Spendable reserve for this card each cycle?"
              recordId={account.id}
              action={updateAccount}
              deleteAction={
                account.source === "manual" ? deleteManualAccount : undefined
              }
              fields={[
                { kind: "text", name: "name", label: "Nickname", defaultValue: account.name },
                {
                  kind: "select",
                  name: "payment_strategy",
                  label: "Payment strategy",
                  hint: "Spendable reserves this amount in your cash-flow forecast. It never assumes you'll pay in full unless you say so.",
                  options: PAYMENT_STRATEGIES,
                  defaultValue: account.paymentStrategy,
                },
                {
                  kind: "money",
                  name: "payment_fixed_amount",
                  label: "Fixed amount (if chosen above)",
                  defaultValue: account.paymentFixedAmount ?? undefined,
                },
                ...(account.source === "manual"
                  ? [
                      {
                        kind: "money" as const,
                        name: "current_balance",
                        label: "Current balance owed",
                        defaultValue: account.currentBalance ?? 0,
                      },
                    ]
                  : []),
                { kind: "checkbox", name: "is_liquid", label: "Count as spendable cash", hint: "Almost never for a credit card.", defaultChecked: account.isLiquid },
              ]}
            />
          );
        })}
      </AccountGroup>

      {/* ------------------------------- Debt ------------------------------ */}
      <AccountGroup
        title="Debt"
        emptyText="No loans tracked yet."
        addForm={
          <EntityForm
            trigger={<AddButton label="Add debt" />}
            title="Add a debt"
            description="For anything Plaid can't see — a family loan, medical debt, a private lender."
            action={saveManualLiability}
            fields={manualLiabilityFields()}
          />
        }
      >
        {loans.map((account) => (
          <AccountRow
            key={account.id}
            name={account.name}
            subtitle={account.institutionName ?? "Loan"}
            amount={-(account.currentBalance ?? 0)}
            badges={[{ label: "Plaid", tone: "accent" as const }]}
          />
        ))}

        {context.manualLiabilities
          .filter((l) => l.isActive)
          .map((liability) => (
            <EntityForm
              key={liability.id}
              trigger={
                <AccountRow
                  name={liability.name}
                  subtitle={[
                    liability.institutionName,
                    liability.aprPercentage
                      ? `${liability.aprPercentage}% APR`
                      : null,
                    `pays ${formatMoney(
                      liability.plannedMonthlyPayment || liability.minimumMonthlyPayment,
                    )}/mo`,
                    `updated ${formatRelativeTime(liability.balanceLastUpdatedAt)}`,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                  amount={-liability.currentBalance}
                  badges={[{ label: "Manual", tone: "neutral" as const }]}
                />
              }
              title={liability.name}
              recordId={liability.id}
              action={saveManualLiability}
              deleteAction={deleteManualLiability}
              fields={manualLiabilityFields(liability)}
            />
          ))}
      </AccountGroup>

      {active.length === 0 && context.manualLiabilities.length === 0 ? (
        <EmptyState
          className="mt-3.5"
          icon={<Landmark className="size-5" />}
          title="Connect your finances"
          description="Link checking and credit accounts so Spendable can calculate what is actually safe to spend."
        />
      ) : null}

      <p className="mt-5 flex items-start gap-2 px-1 text-[11.5px] leading-relaxed text-[var(--color-ink-faint)]">
        <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
        Financial data is used to calculate your personal spending plan and is
        not used to initiate transactions. Spendable can never move money.
      </p>
    </div>
  );
}

function manualLiabilityFields(liability?: {
  name: string;
  liabilityType: string;
  institutionName?: string | null;
  currentBalance: number;
  aprPercentage: number | null;
  minimumMonthlyPayment: number;
  plannedMonthlyPayment: number;
  paymentDueDay: number | null;
}) {
  return [
    { kind: "text" as const, name: "name", label: "Name", required: true, placeholder: "Student loan", defaultValue: liability?.name },
    { kind: "select" as const, name: "liability_type", label: "Type", options: LIABILITY_TYPES, defaultValue: liability?.liabilityType ?? "other" },
    { kind: "text" as const, name: "institution_name", label: "Lender", defaultValue: liability?.institutionName ?? undefined },
    { kind: "money" as const, name: "current_balance", label: "Current balance", required: true, defaultValue: liability?.currentBalance },
    { kind: "money" as const, name: "apr_percentage", label: "APR %", defaultValue: liability?.aprPercentage ?? undefined },
    { kind: "money" as const, name: "minimum_monthly_payment", label: "Minimum monthly payment", defaultValue: liability?.minimumMonthlyPayment },
    { kind: "money" as const, name: "planned_monthly_payment", label: "What you actually plan to pay", defaultValue: liability?.plannedMonthlyPayment },
    { kind: "number" as const, name: "payment_due_day", label: "Due day of month (1–31)", defaultValue: liability?.paymentDueDay ?? undefined },
  ];
}

function AccountGroup({
  title,
  children,
  emptyText,
  addForm,
}: {
  title: string;
  children: React.ReactNode;
  emptyText: string;
  addForm?: React.ReactNode;
}) {
  const hasChildren = Array.isArray(children)
    ? children.flat().filter(Boolean).length > 0
    : Boolean(children);

  return (
    <Card className="mb-3.5">
      <CardHeader className="flex items-center justify-between">
        <CardTitle>{title}</CardTitle>
        {addForm}
      </CardHeader>
      <CardContent className="pt-0">
        {hasChildren ? (
          <div>{children}</div>
        ) : (
          <p className="py-1 text-[13px] text-[var(--color-ink-muted)]">
            {emptyText}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function AccountRow({
  name,
  subtitle,
  amount,
  badges,
}: {
  name: string;
  subtitle: string;
  amount: number;
  badges: { label: string; tone: "neutral" | "accent" | "positive" | "caution" }[];
}) {
  return (
    <span className="flex w-full cursor-pointer items-center justify-between gap-4 border-b border-[var(--color-border-subtle)] py-3 text-left last:border-0">
      <span className="min-w-0">
        <span className="block truncate text-[13.5px] font-medium">{name}</span>
        <span className="mt-0.5 block truncate text-[12px] text-[var(--color-ink-faint)]">
          {subtitle}
        </span>
        <span className="mt-1.5 flex flex-wrap gap-1.5">
          {badges.map((badge) => (
            <Badge key={badge.label} tone={badge.tone}>
              {badge.label}
            </Badge>
          ))}
        </span>
      </span>
      <span
        className={`tnum shrink-0 text-[15px] font-medium ${
          amount < 0 ? "text-[var(--color-negative)]" : ""
        }`}
      >
        {amount < 0 ? "−" : ""}
        {formatMoney(Math.abs(amount))}
      </span>
    </span>
  );
}
