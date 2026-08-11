# Spendable

A personal financial decision agent. It continuously answers one question:

> **How much money can I safely spend on fun right now, without jeopardising my bills, debt payments, savings goals, or cash buffer?**

Everything else in the app exists to support that number.

---

# Fastest Path to Using Spendable on My iPhone

If you only read one section, read this one. Roughly 30–40 minutes end to end.

```bash
# 1. Install and generate your two secrets
npm install
openssl rand -base64 32   # -> FINANCIAL_TOKEN_ENCRYPTION_KEY
openssl rand -hex 32      # -> SYNC_JOB_SECRET
cp .env.example .env.local   # then fill it in
```

2. **Supabase** — create a project, copy the URL + keys into `.env.local`, then apply the schema:
   ```bash
   npx supabase link --project-ref <your-project-ref>
   npx supabase db push
   ```
3. **Plaid** — create a free account, copy your Sandbox `client_id` and `secret` into `.env.local`, keep `PLAID_ENV=sandbox`.
4. **Anthropic** — create an API key, paste into `.env.local`. *(Optional — everything except the Agent tab works without it.)*
5. **Run it locally** to confirm: `npm run dev` → <http://localhost:3000> → sign in with your email → onboarding → your Safe-to-Spend number.
6. **Deploy** — push to GitHub, connect the repo in Netlify, paste the same environment variables in Netlify (with `NEXT_PUBLIC_APP_URL` set to your Netlify URL), deploy.
7. **Add Supabase redirect URL**: Supabase → Authentication → URL Configuration → add `https://YOUR-SITE.netlify.app/**` to Redirect URLs. Redeploy.
8. **On your iPhone**: open the Netlify URL in **Safari** → tap **Share** → **Add to Home Screen** → **Add**. Launch it from the Home Screen icon.

Detailed instructions for each step are below.

---

## What this is

- **Safe to Spend** is computed by a deterministic engine in `src/lib/finance`. It is never produced, adjusted, or overridden by a language model.
- **The agent** (`src/lib/agent`) is a real tool-using Anthropic agent. It receives no financial data in its prompt — it calls narrowly scoped tools that read from the same deterministic engine, and it explains results rather than calculating them.
- **Plaid** provides balances, transactions, and supported liabilities. Manual accounts and manual debts are first-class, so the app is fully usable before — or entirely without — Plaid.

### The number, precisely

```
MonthlyFunBudget       = expected income
                       − fixed commitments
                       − necessary allowance (+ any overage)
                       − planned debt payments
                       − goal contributions
                       − planned one-time expenses
                       − cash-buffer rebuild

RemainingFunBudget     = MonthlyFunBudget − fun already spent this month

AvailableLiquidity     = lowest projected checking balance over the next ~35 days
                       − your minimum cash buffer

SafeToSpend            = min(RemainingFunBudget, AvailableLiquidity)
```

The tighter of the two constraints wins, and the app always tells you which one it was. Tap the number on Home to see every line.

Two rules the engine enforces carefully, both covered by tests:

- **A credit-card purchase is spending; the later payment to that card is not.** The payment is a transfer for expense accounting, but it still consumes cash in the liquidity forecast.
- **A transfer between your own accounts is never income or spending** — but moving money from checking to savings does reduce available liquidity.

---

## 1. Run locally

```bash
npm install
cp .env.example .env.local
npm run dev            # http://localhost:3000
```

Other commands:

```bash
npm run verify         # lint + typecheck + tests + production build
npm test               # financial engine + security tests (92 tests)
npm run lint
npm run typecheck
npm run build
```

The app boots without any credentials — it will show setup-required states instead of crashing. You need Supabase configured before you can sign in.

---

## 2. Supabase

### Create or choose a project

1. Go to <https://supabase.com/dashboard> → **New project** (or open an existing one — this app namespaces every table with `spendable_` and its migrations are purely additive, so it is safe to use an existing project).
2. Choose a region near you and save the database password somewhere safe.

### Find your keys

**Project Settings → API Keys**:

| Value in the dashboard | Environment variable | Notes |
| --- | --- | --- |
| Project URL | `NEXT_PUBLIC_SUPABASE_URL` | e.g. `https://abcdefgh.supabase.co` |
| Publishable key (or legacy "anon public") | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Safe for the browser |
| Secret key (or legacy "service_role") | `SUPABASE_SECRET_KEY` | **Server only. Never prefix with `NEXT_PUBLIC_`.** |

> Supabase renamed these keys. The app accepts either naming — if your project shows "anon public" and "service_role", use those values.

### Apply the migrations

Migrations live in `supabase/migrations/`. You do **not** need to create any tables by hand.

```bash
npx supabase login
npx supabase link --project-ref <your-project-ref>   # the subdomain of your project URL
npx supabase db push
```

If you'd rather not use the CLI: open **SQL Editor** in the dashboard and run the two files in `supabase/migrations/` in filename order.

This creates 17 `spendable_*` tables with indexes, constraints, `updated_at` triggers, Row Level Security enabled on every one, owner-only policies, and a trigger that provisions a profile row on signup.

### Configure Auth

1. **Authentication → Providers → Email**: make sure Email is enabled. Magic links work with the default settings.
2. **Authentication → URL Configuration**:
   - **Site URL**: `http://localhost:3000` for now.
   - **Redirect URLs**: add `http://localhost:3000/**`.
   - After you deploy, come back and add `https://YOUR-SITE.netlify.app/**` (step 5).

That's all the dashboard work required.

---

## 3. Plaid

### Get sandbox credentials

1. Sign up at <https://dashboard.plaid.com/signup> (free; Sandbox needs no approval).
2. **Developers → Keys**: copy `client_id` and the **Sandbox** secret.
3. Set in `.env.local`:
   ```
   PLAID_CLIENT_ID=...
   PLAID_SECRET=...        # the Sandbox secret
   PLAID_ENV=sandbox
   ```

### Products

The app requests **Transactions** as a required product and **Liabilities** as an *optional* product, so institutions that don't support liabilities still link successfully. In the Plaid dashboard under **Developers → API**, no extra configuration is needed for Sandbox.

Plaid's **Recurring Transactions** product is used automatically if your account has it, but the app does not depend on it — there is a built-in recurring detector that works from plain transaction history.

### Configure the webhook

The webhook URL is derived from `NEXT_PUBLIC_APP_URL`, never hardcoded:

```
https://YOUR-SITE.netlify.app/api/plaid/webhook
```

You do not need to paste this anywhere for Sandbox — the app sends it with every Link token. If you want to set a default in the dashboard, use **Developers → Webhooks**.

Webhook deliveries are verified using Plaid's official JWT scheme (ES256 signature against the key from `/webhook_verification_key/get`, freshness check, and a SHA-256 body-hash comparison). Unverified requests are rejected with a 401.

### Test the Sandbox connection

1. `npm run dev`, sign in, go to **Settings → Accounts → Connect with Plaid**.
2. Pick any institution, then use Plaid's sandbox credentials:
   - Username: `user_good`
   - Password: `pass_good`
   - If asked for an MFA code: `1234`
3. Accounts and ~6 months of transactions import immediately.

### Connecting real institutions

Sandbox data is fake. To connect your actual bank:

1. In the Plaid dashboard, request **Production** access (**Developers → Keys → Request Production Access**). Plaid will ask about your use case; a personal-finance app for your own use is a normal request. Approval typically takes a few days.
2. Once approved, copy the **Production** secret.
3. Change two environment variables in Netlify:
   ```
   PLAID_SECRET=<your production secret>
   PLAID_ENV=production
   ```
4. Redeploy. **No code changes are required** — the environment is configuration.
5. Reconnect your institutions in the app (Sandbox Items don't carry over).

---

## 4. Anthropic

The Agent tab needs this; nothing else does. Without it, the Agent tab shows a clean setup-required state and the rest of the app works normally.

1. Create a key at <https://console.anthropic.com/settings/keys>.
2. Set:
   ```
   ANTHROPIC_API_KEY=sk-ant-...
   ANTHROPIC_MODEL=claude-opus-5
   ```

`ANTHROPIC_MODEL` is read from the environment, so you can switch models without touching code — e.g. `claude-sonnet-5` for lower cost.

---

## 5. Netlify

### Push and connect

```bash
git add -A
git commit -m "Spendable"
git push
```

Then in Netlify: **Add new site → Import an existing project** → pick your repository.

### Build settings

Netlify detects Next.js automatically and installs its Next.js Runtime (the OpenNext adapter) for you. Confirm:

| Setting | Value |
| --- | --- |
| Build command | `npm run build` |
| Publish directory | `.next` |
| Node version | 20 (set in `netlify.toml`) |

Do **not** install `@netlify/plugin-nextjs` yourself — Netlify keeps the adapter up to date automatically, and pinning it is what breaks on future Next.js releases.

### Environment variables

**Site configuration → Environment variables** → add every variable from `.env.example`:

```
NEXT_PUBLIC_APP_URL=https://YOUR-SITE.netlify.app
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=...
SUPABASE_SECRET_KEY=...
PLAID_CLIENT_ID=...
PLAID_SECRET=...
PLAID_ENV=sandbox
ANTHROPIC_API_KEY=...
ANTHROPIC_MODEL=claude-opus-5
FINANCIAL_TOKEN_ENCRYPTION_KEY=...
SYNC_JOB_SECRET=...
ALLOW_DEMO_SEED=false
```

### Deploy, then finish wiring

1. Deploy. Note your production URL.
2. Update `NEXT_PUBLIC_APP_URL` to that URL if you guessed wrong, and **redeploy** (it is baked in at build time).
3. **Supabase → Authentication → URL Configuration**: set **Site URL** to your Netlify URL and add `https://YOUR-SITE.netlify.app/**` to **Redirect URLs**. Without this, sign-in links bounce to `localhost`.

### Scheduled sync

`netlify/functions/scheduled-sync.mts` runs **hourly** and calls `/api/sync/run` with the `SYNC_JOB_SECRET` header. It only touches Plaid Items that haven't synced in the last 6 hours, so it's a reliability fallback — webhooks remain the primary path. No setup beyond the environment variable; Netlify picks up the schedule from the function's exported `config`.

You can watch it under **Logs → Functions → scheduled-sync**.

---

## 6. Install on iPhone

1. Open your production URL in **Safari** (not Chrome — only Safari can install a PWA on iOS).
2. Tap the **Share** button (square with an up arrow).
3. Scroll down and tap **Add to Home Screen**.
4. Name it **Spendable** and tap **Add**.
5. Launch it from the Home Screen icon.

It opens in standalone mode: no browser chrome, its own app icon, correct safe-area handling around the notch and home indicator, and a persistent bottom tab bar. Your session persists between launches, so you won't need a new sign-in link each time.

---

## 7. Connect your first real account

Once your Plaid Production access is approved (§3):

1. Set `PLAID_ENV=production` and the Production `PLAID_SECRET` in Netlify. Redeploy.
2. In the app: **Settings → Accounts → Connect with Plaid**.
3. Search for your bank, sign in with your real credentials **inside Plaid's own UI** — Spendable never sees them.
4. Accounts and about six months of history import, then Safe-to-Spend recalculates.
5. Repeat for each institution. Multiple institutions are supported.
6. Go to **Plan** and confirm your rent, bills, and paycheck. Detected recurring charges appear there as suggestions — nothing becomes a committed bill until you confirm it.
7. Go to **Settings** and set your **cash buffer** and **essentials allowance**.
8. On **Accounts**, set a **payment strategy** per credit card (statement balance / minimum / fixed / full). This materially changes how much cash the forecast reserves.

---

## 8. Troubleshooting

**Sign-in link opens `localhost` in production.**
`NEXT_PUBLIC_APP_URL` is wrong, or the Netlify URL isn't in Supabase's Redirect URLs. Fix both, then redeploy — `NEXT_PUBLIC_*` values are inlined at build time.

**"That link didn't work" after clicking a magic link.**
The link expired or was already used. Request a new one. Also check the redirect URL is registered in Supabase.

**Plaid Link opens then immediately closes.**
Usually a bad `PLAID_CLIENT_ID`/`PLAID_SECRET` pair, or a secret from the wrong environment (Sandbox secret with `PLAID_ENV=production`). Check the function logs in Netlify.

**"Chase needs attention" / Reconnect prompt.**
Normal — institutions periodically require re-authentication. Tap **Reconnect**; Link opens in update mode. Your transaction history is preserved throughout; nothing is deleted.

**Safe-to-Spend looks wrong.**
Tap the number. Every line in "How this was calculated" is a real term from the computation. The usual causes are a missing income source, rent not yet added, or a credit-card payment strategy that reserves more cash than you actually pay.

**Safe-to-Spend is limited by "cash flow" when I have plenty of money.**
Your savings account probably isn't marked as spendable cash (by design — savings usually backs a goal). **Accounts → tap the account → "Count this as spendable cash"**.

**Transactions look duplicated.**
They shouldn't be: Plaid transaction IDs are unique-constrained, and pending rows are dropped when their posted twin arrives. If you see a genuine duplicate, it's likely two different accounts at the same institution. Filter by account on Activity to check.

**Agent tab says setup required.**
`ANTHROPIC_API_KEY` isn't set in Netlify. Add it and redeploy.

**Scheduled sync isn't running.**
Check `SYNC_JOB_SECRET` is set in Netlify and matches nothing else. Look at **Logs → Functions → scheduled-sync**. A 401 means the secret differs between the function and the app (they read the same variable, so this means it's missing on one side).

**`npm run build` fails after I changed the schema.**
Run `npm run typecheck` for the specific error. The build runs lint and typecheck too.

---

## Project structure

```
src/
  app/
    (app)/            Home, Activity, Plan, Goals, Agent, Accounts, Settings
    (auth)/login/     Magic-link sign-in
    api/              Plaid (link/exchange/sync/webhook/disconnect), agent,
                      scenario, scheduled-sync entrypoint, demo seed
    actions/          Server actions for all CRUD
    onboarding/       Six-step setup
  components/
    ui/               shadcn-style primitives (button, card, sheet, …)
    finance/          Safe-to-Spend hero, afford check, transaction list, …
    agent/            Chat surface
    nav/              Bottom tab bar + desktop sidebar
  lib/
    finance/          THE ENGINE — pure, deterministic, fully tested
      safe-to-spend.ts    the canonical calculation
      cashflow.ts         35-day liquidity forecast + card payment strategy
      classify.ts         classification, transfer pairing, pending dedupe
      scenario.ts         purchase simulator
      goals.ts            goal pacing
      recurrence.ts       recurring detection fallback
    plaid/            client, sync, normalisation, webhook verification
    agent/            Anthropic client, tool definitions, executor, prompt
    supabase/         browser / server / admin clients + middleware
    security/         AES-256-GCM token encryption
    db/               context loading, recurring candidate refresh
    demo/             demo data seeder
supabase/migrations/  Schema + RLS
netlify/functions/    Scheduled sync
tests/                92 tests, engine + security
```

---

## Security

- **Row Level Security** is enabled and forced on all 17 user-owned tables, with owner-only policies. A user cannot read another user's rows.
- **Plaid access tokens** are encrypted with AES-256-GCM before storage. The `access_token_encrypted` column is additionally `REVOKE`d from the `authenticated` role, so it cannot be selected from the browser even by its owner. Tokens are decrypted only inside server-side code that hands them straight to the Plaid SDK.
- **Secrets never reach the client.** `PLAID_SECRET`, `SUPABASE_SECRET_KEY`, `ANTHROPIC_API_KEY`, and `FINANCIAL_TOKEN_ENCRYPTION_KEY` are read through server-only accessors that throw if imported into a client component.
- **Logging** is structured and redacts anything token-shaped. Financial payloads are never logged — only counts and identifiers.
- **The agent cannot move money.** It has read/analyse/forecast tools only. A classification change it proposes is returned as an unapplied proposal requiring explicit confirmation in the UI.
- Rotating `FINANCIAL_TOKEN_ENCRYPTION_KEY` invalidates stored tokens; reconnect institutions afterwards.

---

## Testing

```bash
npm test
```

92 tests. The financial engine suite covers the cases where a naive implementation is confidently wrong:

1. A normal month with income, bills, goals, and fun spending
2. A credit-card purchase counts as spending; the card payment does not double-count it
3. Checking → savings is neither income nor spending
4. A large purchase lowers Safe-to-Spend by its amount
5. High monthly budget but low near-term liquidity — liquidity wins
6. A paycheck landing before rent prevents a false shortfall (and same-day events net)
7. Changing a card payment strategy from statement balance to minimum
8. Pending and posted versions of the same charge don't double-count
9. A refund offsets the spending it reverses and is not treated as income
10. Goal monthly requirement rises as the target date approaches
11. Multiple checking accounts combine for available liquidity
12. Checking → savings reduces liquidity without counting as discretionary spending

Plus security tests for token encryption (round-trip, tamper detection, nonce uniqueness) and Plaid webhook verification (valid signature, algorithm downgrade, forged signature, replay, body swap).

---

## Notes and limitations

- **Plaid Production access requires approval from Plaid.** Until then, Sandbox gives you fake but fully functional data. This is a Plaid policy, not an app limitation.
- **Manual account balances are only as fresh as your last edit.** The app labels them and flags them as stale after a week.
- **Liabilities coverage varies by institution.** Where Plaid can't provide statement balances or minimum payments, add a manual debt — it's a first-class record type, not a workaround.
- **Demo data** (Settings → Demo data) uses obviously fake institutions and is removable in one tap. It never mixes with Plaid-synced records. Set `ALLOW_DEMO_SEED=false` in production to disable it.
- **Investment accounts** are stored but not modelled in Safe-to-Spend, by design — retirement balances aren't spendable cash.
- The app is single-user by design: no shared budgets, no social features.
