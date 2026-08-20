import { Suspense } from "react";
import { FinishSignIn } from "@/components/auth/finish-sign-in";

export default function FinishSignInPage() {
  return (
    <main className="safe-top flex min-h-dvh flex-col items-center justify-center px-6">
      <Suspense fallback={null}>
        <FinishSignIn />
      </Suspense>
    </main>
  );
}
