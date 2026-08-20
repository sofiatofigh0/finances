/**
 * Centralised environment access.
 *
 * Anything exported from here that is NOT prefixed `NEXT_PUBLIC_` must only be
 * imported from server-side code (route handlers, server components, server
 * actions). The `serverEnv` getters deliberately throw when called in the
 * browser so a mistaken import fails loudly in development rather than leaking
 * a secret into the client bundle.
 */

function assertServer(name: string): void {
  if (typeof window !== "undefined") {
    throw new Error(
      `${name} is a server-only environment variable and was read in the browser.`,
    );
  }
}

function optional(name: string): string | undefined {
  const value = process.env[name];
  return value && value.length > 0 ? value : undefined;
}

/** Values safe to reference from client components. */
export const publicEnv = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  supabasePublishableKey:
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    "",
  appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
  // Opt-in, so a personal deployment never offers strangers a way in. Set this
  // only on a deployment meant to be shown publicly.
  guestDemoEnabled: process.env.NEXT_PUBLIC_ENABLE_GUEST_DEMO === "true",
};

export const serverEnv = {
  get supabaseSecretKey(): string | undefined {
    assertServer("SUPABASE_SECRET_KEY");
    return optional("SUPABASE_SECRET_KEY") ?? optional("SUPABASE_SERVICE_ROLE_KEY");
  },
  get plaidClientId(): string | undefined {
    assertServer("PLAID_CLIENT_ID");
    return optional("PLAID_CLIENT_ID");
  },
  get plaidSecret(): string | undefined {
    assertServer("PLAID_SECRET");
    return optional("PLAID_SECRET");
  },
  get plaidEnv(): string {
    assertServer("PLAID_ENV");
    return optional("PLAID_ENV") ?? "sandbox";
  },
  get plaidRedirectUri(): string | undefined {
    assertServer("PLAID_REDIRECT_URI");
    return optional("PLAID_REDIRECT_URI");
  },
  get anthropicApiKey(): string | undefined {
    assertServer("ANTHROPIC_API_KEY");
    return optional("ANTHROPIC_API_KEY");
  },
  get anthropicModel(): string {
    assertServer("ANTHROPIC_MODEL");
    return optional("ANTHROPIC_MODEL") ?? "claude-opus-5";
  },
  get tokenEncryptionKey(): string | undefined {
    assertServer("FINANCIAL_TOKEN_ENCRYPTION_KEY");
    return optional("FINANCIAL_TOKEN_ENCRYPTION_KEY");
  },
  get syncSecret(): string | undefined {
    assertServer("SYNC_JOB_SECRET");
    return optional("SYNC_JOB_SECRET");
  },
  get allowDemoSeed(): boolean {
    assertServer("ALLOW_DEMO_SEED");
    return (optional("ALLOW_DEMO_SEED") ?? "true") !== "false";
  },
};

/**
 * Which integrations are configured. Drives the "setup required" states in the
 * UI so the app degrades gracefully instead of crashing when a credential is
 * missing.
 */
export type IntegrationStatus = {
  supabase: boolean;
  supabaseAdmin: boolean;
  plaid: boolean;
  anthropic: boolean;
  encryption: boolean;
};

export function getIntegrationStatus(): IntegrationStatus {
  return {
    supabase: Boolean(publicEnv.supabaseUrl && publicEnv.supabasePublishableKey),
    supabaseAdmin: Boolean(serverEnv.supabaseSecretKey),
    plaid: Boolean(serverEnv.plaidClientId && serverEnv.plaidSecret),
    anthropic: Boolean(serverEnv.anthropicApiKey),
    encryption: Boolean(serverEnv.tokenEncryptionKey),
  };
}
