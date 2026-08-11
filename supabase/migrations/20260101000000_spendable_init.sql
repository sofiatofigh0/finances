-- ============================================================================
-- Spendable — initial schema
-- ============================================================================
-- Every object created here is namespaced with the `spendable_` prefix so this
-- application can live safely inside an existing Supabase project alongside
-- unrelated tables. This migration is purely additive: it never drops or alters
-- objects it does not own.
--
-- Money convention used throughout:
--   * `amount` on transactions is SIGNED and NORMALIZED:
--       negative = money left the user's control (spending / outflow)
--       positive = money arrived (income / inflow / refund)
--     Plaid's raw convention (positive = outflow) is inverted at ingest time.
--   * Balances are stored as reported by the source. For `credit` and `loan`
--     accounts a positive `current_balance` means "amount owed".
-- ============================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Shared trigger: keep updated_at honest
-- ---------------------------------------------------------------------------
create or replace function public.spendable_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Profiles / planning assumptions
-- ---------------------------------------------------------------------------
create table if not exists public.spendable_profiles (
  user_id                    uuid primary key references auth.users (id) on delete cascade,
  display_name               text,
  currency                   text        not null default 'USD',
  timezone                   text        not null default 'America/New_York',
  -- The Safe-to-Spend engine will never let projected cash fall below this.
  cash_buffer                numeric(14,2) not null default 1000 check (cash_buffer >= 0),
  -- Monthly allowance for groceries / transport / pharmacy / household basics.
  necessary_monthly_allowance numeric(14,2) not null default 600 check (necessary_monthly_allowance >= 0),
  -- How far ahead the liquidity guard projects.
  forecast_days              integer     not null default 35 check (forecast_days between 7 and 120),
  onboarding_completed_at    timestamptz,
  demo_mode                  boolean     not null default false,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now()
);

create trigger spendable_profiles_touch
  before update on public.spendable_profiles
  for each row execute function public.spendable_touch_updated_at();

-- ---------------------------------------------------------------------------
-- Plaid Items (one per connected institution)
-- ---------------------------------------------------------------------------
create table if not exists public.spendable_plaid_items (
  id                       uuid primary key default gen_random_uuid(),
  user_id                  uuid not null references auth.users (id) on delete cascade,
  plaid_item_id            text not null,
  -- AES-256-GCM ciphertext. NEVER leaves the server; never sent to the browser.
  access_token_encrypted   text not null,
  institution_id           text,
  institution_name         text,
  available_products       text[] not null default '{}',
  billed_products          text[] not null default '{}',
  transactions_cursor      text,
  status                   text not null default 'active'
                             check (status in ('active','needs_reauth','revoked','error')),
  error_code               text,
  error_message            text,
  consent_expires_at       timestamptz,
  last_synced_at           timestamptz,
  last_successful_sync_at  timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  constraint spendable_plaid_items_unique_item unique (user_id, plaid_item_id)
);

create index if not exists spendable_plaid_items_user_idx
  on public.spendable_plaid_items (user_id);
-- Webhooks arrive keyed only by Plaid's item_id.
create index if not exists spendable_plaid_items_plaid_id_idx
  on public.spendable_plaid_items (plaid_item_id);

create trigger spendable_plaid_items_touch
  before update on public.spendable_plaid_items
  for each row execute function public.spendable_touch_updated_at();

-- ---------------------------------------------------------------------------
-- Accounts (Plaid-sourced or manual)
-- ---------------------------------------------------------------------------
create table if not exists public.spendable_accounts (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users (id) on delete cascade,
  plaid_item_id      uuid references public.spendable_plaid_items (id) on delete cascade,
  plaid_account_id   text,
  source             text not null default 'manual' check (source in ('plaid','manual')),
  name               text not null,
  official_name      text,
  institution_name   text,
  mask               text,
  type               text not null
                       check (type in ('depository','credit','loan','investment','other')),
  subtype            text,
  current_balance    numeric(14,2),
  available_balance  numeric(14,2),
  credit_limit       numeric(14,2),
  currency           text not null default 'USD',
  -- Whether this account's balance counts toward spendable liquid cash.
  is_liquid          boolean not null default false,
  -- How much cash to reserve each cycle for this card.
  payment_strategy   text not null default 'statement_balance'
                       check (payment_strategy in ('statement_balance','minimum_payment','fixed_amount','full_balance')),
  payment_fixed_amount numeric(14,2),
  is_active          boolean not null default true,
  balance_last_updated_at timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  -- Prevents Plaid from ever inserting the same account twice.
  constraint spendable_accounts_unique_plaid unique (user_id, plaid_account_id)
);

create index if not exists spendable_accounts_user_idx
  on public.spendable_accounts (user_id, is_active);
create index if not exists spendable_accounts_item_idx
  on public.spendable_accounts (plaid_item_id);

create trigger spendable_accounts_touch
  before update on public.spendable_accounts
  for each row execute function public.spendable_touch_updated_at();

-- ---------------------------------------------------------------------------
-- Transactions
-- ---------------------------------------------------------------------------
create table if not exists public.spendable_transactions (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references auth.users (id) on delete cascade,
  account_id           uuid not null references public.spendable_accounts (id) on delete cascade,
  plaid_transaction_id text,
  -- Plaid reuses this across the pending -> posted transition.
  pending_transaction_id text,
  source               text not null default 'manual' check (source in ('plaid','manual')),
  -- Signed + normalized: negative = outflow, positive = inflow.
  amount               numeric(14,2) not null,
  currency             text not null default 'USD',
  date                 date not null,
  authorized_date      date,
  name                 text not null,
  merchant_name        text,
  -- Lowercased, punctuation-stripped merchant key used for rules + recurrence.
  merchant_key         text,
  pending              boolean not null default false,
  -- Our opinionated top-level bucket.
  classification       text not null default 'necessary'
                         check (classification in ('fixed','necessary','fun','goals','transfer','income','ignore')),
  subcategory          text,
  -- Plaid's own detailed taxonomy, preserved separately and never overwritten.
  plaid_category_primary  text,
  plaid_category_detailed text,
  -- True once the user (or a merchant rule) has set the classification, which
  -- stops automatic re-classification from overwriting their choice.
  classification_locked boolean not null default false,
  is_refund            boolean not null default false,
  notes                text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  -- Idempotency: a Plaid transaction can exist exactly once per user.
  constraint spendable_transactions_unique_plaid unique (user_id, plaid_transaction_id)
);

create index if not exists spendable_transactions_user_date_idx
  on public.spendable_transactions (user_id, date desc);
create index if not exists spendable_transactions_account_idx
  on public.spendable_transactions (account_id, date desc);
create index if not exists spendable_transactions_class_idx
  on public.spendable_transactions (user_id, classification, date desc);
create index if not exists spendable_transactions_merchant_idx
  on public.spendable_transactions (user_id, merchant_key);
create index if not exists spendable_transactions_pending_link_idx
  on public.spendable_transactions (user_id, pending_transaction_id)
  where pending_transaction_id is not null;

create trigger spendable_transactions_touch
  before update on public.spendable_transactions
  for each row execute function public.spendable_touch_updated_at();

-- ---------------------------------------------------------------------------
-- Liabilities reported by Plaid (credit cards, student loans, mortgages)
-- ---------------------------------------------------------------------------
create table if not exists public.spendable_liabilities (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null references auth.users (id) on delete cascade,
  account_id             uuid not null references public.spendable_accounts (id) on delete cascade,
  liability_type         text not null check (liability_type in ('credit','student','mortgage')),
  last_statement_balance numeric(14,2),
  last_statement_issue_date date,
  minimum_payment        numeric(14,2),
  next_payment_due_date  date,
  last_payment_amount    numeric(14,2),
  last_payment_date      date,
  apr_percentage         numeric(6,3),
  apr_type               text,
  origination_principal  numeric(14,2),
  outstanding_balance    numeric(14,2),
  expected_payoff_date   date,
  term_months            integer,
  is_overdue             boolean,
  synced_at              timestamptz not null default now(),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint spendable_liabilities_unique_account unique (account_id)
);

create index if not exists spendable_liabilities_user_idx
  on public.spendable_liabilities (user_id);

create trigger spendable_liabilities_touch
  before update on public.spendable_liabilities
  for each row execute function public.spendable_touch_updated_at();

-- ---------------------------------------------------------------------------
-- Manual liabilities — first-class fallback for debt Plaid cannot see
-- ---------------------------------------------------------------------------
create table if not exists public.spendable_manual_liabilities (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null references auth.users (id) on delete cascade,
  name                   text not null,
  liability_type         text not null default 'other'
                           check (liability_type in ('credit_card','student_loan','auto_loan','personal_loan','mortgage','medical','family','other')),
  institution_name       text,
  current_balance        numeric(14,2) not null default 0,
  apr_percentage         numeric(6,3),
  minimum_monthly_payment numeric(14,2) not null default 0,
  planned_monthly_payment numeric(14,2) not null default 0,
  payment_due_day        integer check (payment_due_day between 1 and 31),
  notes                  text,
  is_active              boolean not null default true,
  balance_last_updated_at timestamptz not null default now(),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create index if not exists spendable_manual_liabilities_user_idx
  on public.spendable_manual_liabilities (user_id, is_active);

create trigger spendable_manual_liabilities_touch
  before update on public.spendable_manual_liabilities
  for each row execute function public.spendable_touch_updated_at();

-- ---------------------------------------------------------------------------
-- Recurring obligations (rent, utilities, subscriptions, loan payments)
-- ---------------------------------------------------------------------------
create table if not exists public.spendable_recurring_obligations (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users (id) on delete cascade,
  name              text not null,
  amount            numeric(14,2) not null check (amount >= 0),
  frequency         text not null default 'monthly'
                      check (frequency in ('weekly','biweekly','semimonthly','monthly','quarterly','annual')),
  next_due_date     date not null,
  category          text not null default 'fixed'
                      check (category in ('fixed','necessary','fun','goals')),
  is_essential      boolean not null default true,
  autopay           boolean not null default false,
  account_id        uuid references public.spendable_accounts (id) on delete set null,
  merchant_key      text,
  source            text not null default 'manual' check (source in ('manual','detected')),
  is_active         boolean not null default true,
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists spendable_recurring_user_idx
  on public.spendable_recurring_obligations (user_id, is_active, next_due_date);

create trigger spendable_recurring_touch
  before update on public.spendable_recurring_obligations
  for each row execute function public.spendable_touch_updated_at();

-- ---------------------------------------------------------------------------
-- Detected recurring candidates awaiting user confirmation
-- ---------------------------------------------------------------------------
create table if not exists public.spendable_recurring_candidates (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users (id) on delete cascade,
  merchant_key      text not null,
  display_name      text not null,
  average_amount    numeric(14,2) not null,
  frequency         text not null
                      check (frequency in ('weekly','biweekly','semimonthly','monthly','quarterly','annual')),
  confidence        numeric(4,3) not null check (confidence between 0 and 1),
  occurrence_count  integer not null default 0,
  first_seen_date   date,
  last_seen_date    date,
  next_predicted_date date,
  -- pending -> the card is still shown on the Plan screen.
  status            text not null default 'pending'
                      check (status in ('pending','confirmed','dismissed')),
  detected_via      text not null default 'heuristic'
                      check (detected_via in ('heuristic','plaid')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint spendable_recurring_candidates_unique unique (user_id, merchant_key, frequency)
);

create index if not exists spendable_recurring_candidates_user_idx
  on public.spendable_recurring_candidates (user_id, status);

create trigger spendable_recurring_candidates_touch
  before update on public.spendable_recurring_candidates
  for each row execute function public.spendable_touch_updated_at();

-- ---------------------------------------------------------------------------
-- Merchant classification rules — "apply to future Amazon purchases"
-- ---------------------------------------------------------------------------
create table if not exists public.spendable_merchant_rules (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users (id) on delete cascade,
  merchant_key   text not null,
  display_name   text not null,
  classification text not null
                   check (classification in ('fixed','necessary','fun','goals','transfer','income','ignore')),
  subcategory    text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint spendable_merchant_rules_unique unique (user_id, merchant_key)
);

create index if not exists spendable_merchant_rules_user_idx
  on public.spendable_merchant_rules (user_id);

create trigger spendable_merchant_rules_touch
  before update on public.spendable_merchant_rules
  for each row execute function public.spendable_touch_updated_at();

-- ---------------------------------------------------------------------------
-- Income sources
-- ---------------------------------------------------------------------------
create table if not exists public.spendable_income_sources (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users (id) on delete cascade,
  name               text not null,
  expected_net_amount numeric(14,2) not null check (expected_net_amount >= 0),
  frequency          text not null default 'biweekly'
                       check (frequency in ('weekly','biweekly','semimonthly','monthly','quarterly','annual','irregular')),
  next_expected_date date,
  account_id         uuid references public.spendable_accounts (id) on delete set null,
  merchant_key       text,
  source             text not null default 'manual' check (source in ('manual','detected')),
  is_active          boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists spendable_income_user_idx
  on public.spendable_income_sources (user_id, is_active);

create trigger spendable_income_touch
  before update on public.spendable_income_sources
  for each row execute function public.spendable_touch_updated_at();

-- ---------------------------------------------------------------------------
-- Goals
-- ---------------------------------------------------------------------------
create table if not exists public.spendable_goals (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references auth.users (id) on delete cascade,
  name                  text not null,
  goal_type             text not null default 'savings'
                          check (goal_type in ('emergency_fund','savings','debt_payoff','travel','purchase','other')),
  current_amount        numeric(14,2) not null default 0,
  target_amount         numeric(14,2) check (target_amount >= 0),
  target_date           date,
  priority              integer not null default 3 check (priority between 1 and 5),
  desired_monthly_contribution numeric(14,2) not null default 0 check (desired_monthly_contribution >= 0),
  account_id            uuid references public.spendable_accounts (id) on delete set null,
  manual_liability_id   uuid references public.spendable_manual_liabilities (id) on delete set null,
  -- Does the monthly contribution actually move cash out of checking?
  contributions_leave_checking boolean not null default true,
  is_active             boolean not null default true,
  notes                 text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists spendable_goals_user_idx
  on public.spendable_goals (user_id, is_active, priority);

create trigger spendable_goals_touch
  before update on public.spendable_goals
  for each row execute function public.spendable_touch_updated_at();

-- ---------------------------------------------------------------------------
-- Monthly plan overrides (month_start is the 1st of the month)
-- ---------------------------------------------------------------------------
create table if not exists public.spendable_monthly_plans (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null references auth.users (id) on delete cascade,
  month_start            date not null,
  expected_income_override numeric(14,2),
  necessary_allowance_override numeric(14,2),
  goal_contribution_override numeric(14,2),
  debt_payment_override  numeric(14,2),
  buffer_override        numeric(14,2),
  notes                  text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint spendable_monthly_plans_unique unique (user_id, month_start)
);

create index if not exists spendable_monthly_plans_user_idx
  on public.spendable_monthly_plans (user_id, month_start desc);

create trigger spendable_monthly_plans_touch
  before update on public.spendable_monthly_plans
  for each row execute function public.spendable_touch_updated_at();

-- ---------------------------------------------------------------------------
-- One-time planned expenses
-- ---------------------------------------------------------------------------
create table if not exists public.spendable_planned_expenses (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users (id) on delete cascade,
  name           text not null,
  amount         numeric(14,2) not null check (amount >= 0),
  expected_date  date not null,
  classification text not null default 'fun'
                   check (classification in ('fixed','necessary','fun','goals')),
  -- Reserved = cash is already set aside, so it should not reduce fun money
  -- again, but it still leaves checking on the expected date.
  is_reserved    boolean not null default false,
  account_id     uuid references public.spendable_accounts (id) on delete set null,
  notes          text,
  is_settled     boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists spendable_planned_expenses_user_idx
  on public.spendable_planned_expenses (user_id, is_settled, expected_date);

create trigger spendable_planned_expenses_touch
  before update on public.spendable_planned_expenses
  for each row execute function public.spendable_touch_updated_at();

-- ---------------------------------------------------------------------------
-- Historical snapshots of computed values (audit / trend, never a source of truth)
-- ---------------------------------------------------------------------------
create table if not exists public.spendable_financial_snapshots (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users (id) on delete cascade,
  captured_for_date date not null,
  safe_to_spend     numeric(14,2) not null,
  limiting_factor   text not null check (limiting_factor in ('monthly_plan','liquidity')),
  components        jsonb not null default '{}'::jsonb,
  data_through      timestamptz,
  created_at        timestamptz not null default now(),
  constraint spendable_snapshots_unique_day unique (user_id, captured_for_date)
);

create index if not exists spendable_snapshots_user_idx
  on public.spendable_financial_snapshots (user_id, captured_for_date desc);

-- ---------------------------------------------------------------------------
-- Agent conversation history
-- ---------------------------------------------------------------------------
create table if not exists public.spendable_agent_threads (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  title      text not null default 'New conversation',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists spendable_agent_threads_user_idx
  on public.spendable_agent_threads (user_id, updated_at desc);

create trigger spendable_agent_threads_touch
  before update on public.spendable_agent_threads
  for each row execute function public.spendable_touch_updated_at();

create table if not exists public.spendable_agent_messages (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  thread_id  uuid not null references public.spendable_agent_threads (id) on delete cascade,
  role       text not null check (role in ('user','assistant')),
  content    text not null,
  -- Deterministic result cards (scenario output, S2S breakdown) rendered in the UI.
  result_cards jsonb not null default '[]'::jsonb,
  tool_calls jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists spendable_agent_messages_thread_idx
  on public.spendable_agent_messages (thread_id, created_at);

-- ---------------------------------------------------------------------------
-- Sync run log (observability for webhooks + scheduled function)
-- ---------------------------------------------------------------------------
create table if not exists public.spendable_sync_runs (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users (id) on delete cascade,
  plaid_item_id  uuid references public.spendable_plaid_items (id) on delete cascade,
  trigger        text not null check (trigger in ('manual','webhook','scheduled','initial')),
  status         text not null check (status in ('success','partial','failed')),
  added_count    integer not null default 0,
  modified_count integer not null default 0,
  removed_count  integer not null default 0,
  -- Human-readable only. Never contains tokens or raw provider payloads.
  message        text,
  started_at     timestamptz not null default now(),
  finished_at    timestamptz
);

create index if not exists spendable_sync_runs_user_idx
  on public.spendable_sync_runs (user_id, started_at desc);
