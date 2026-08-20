/**
 * Marks a guest session so nobody mistakes the sample figures for their own.
 *
 * Every number below this line comes from seeded fake accounts, but they run
 * through exactly the same calculation engine as real data would.
 */
export function DemoBanner() {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-1.5 gap-y-1 border-b border-[var(--color-border-subtle)] bg-[var(--color-surface-sunken)] px-4 py-2.5 text-[12.5px] leading-relaxed text-[var(--color-ink-muted)] md:px-6">
      <span className="font-semibold text-[var(--color-ink)]">Demo</span>
      <span>— sample accounts, real calculations. Change anything you like.</span>
      <form action="/auth/signout" method="post">
        <button
          type="submit"
          className="underline underline-offset-2 hover:text-[var(--color-ink)]"
        >
          Exit
        </button>
      </form>
    </div>
  );
}
