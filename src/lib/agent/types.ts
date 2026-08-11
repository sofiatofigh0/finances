/**
 * Types shared between the server-side agent and the client chat surface.
 *
 * Deliberately kept out of `tools.ts`, which is marked `server-only` — a client
 * component importing from that module works today only because the import is
 * type-only and gets erased. Putting the shared shape here removes that trap.
 */

/** A deterministic result card the UI renders alongside the agent's prose. */
export interface ResultCard {
  type: "scenario" | "safe_to_spend" | "goals" | "proposal";
  payload: unknown;
}
