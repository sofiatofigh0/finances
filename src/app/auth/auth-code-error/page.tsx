import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function AuthCodeErrorPage() {
  return (
    <main className="safe-top flex min-h-dvh flex-col justify-center px-6">
      <div className="mx-auto w-full max-w-sm text-center">
        <h1 className="text-[22px] font-semibold tracking-tight">
          That link didn&apos;t work
        </h1>
        <p className="mt-2 text-[14px] leading-relaxed text-[var(--color-ink-muted)]">
          Sign-in links expire after a short while and can only be used once.
          Request a fresh one and it&apos;ll work.
        </p>
        <Button asChild className="mt-6 w-full">
          <Link href="/login">Back to sign in</Link>
        </Button>
      </div>
    </main>
  );
}
