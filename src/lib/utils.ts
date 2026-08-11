import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** $1,247 — whole dollars, the default for headline figures. */
export function formatMoney(value: number, options: { cents?: boolean } = {}): string {
  const showCents = options.cents ?? false;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: showCents ? 2 : 0,
    maximumFractionDigits: showCents ? 2 : 0,
  }).format(value);
}

/** Always shows the sign, for transaction rows. */
export function formatSignedMoney(value: number): string {
  const formatted = formatMoney(Math.abs(value), { cents: true });
  if (value > 0) return `+${formatted}`;
  if (value < 0) return `−${formatted}`;
  return formatted;
}

/** "18 minutes ago", "just now", "yesterday". */
export function formatRelativeTime(input: string | Date | null): string {
  if (!input) return "never";
  const date = typeof input === "string" ? new Date(input) : input;
  if (Number.isNaN(date.getTime())) return "unknown";

  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 45) return "just now";
  if (seconds < 90) return "a minute ago";

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minutes ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours === 1 ? "an hour ago" : `${hours} hours ago`;

  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;

  const months = Math.floor(days / 30);
  return months === 1 ? "a month ago" : `${months} months ago`;
}

/** Data older than this should be flagged to the user. */
export function isStale(input: string | Date | null, hours = 36): boolean {
  if (!input) return true;
  const date = typeof input === "string" ? new Date(input) : input;
  if (Number.isNaN(date.getTime())) return true;
  return Date.now() - date.getTime() > hours * 3_600_000;
}

/** "Aug 15" / "Aug 15, 2027" when the year differs from today. */
export function formatShortDate(iso: string): string {
  const date = new Date(`${iso.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(date.getTime())) return iso;
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

export function formatMonthName(date: Date = new Date()): string {
  return date.toLocaleDateString("en-US", { month: "long" });
}

export function formatMonthYear(iso: string): string {
  const [year, month] = iso.split("-");
  const date = new Date(Number(year), Number(month) - 1, 1);
  return date.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

export const CLASSIFICATION_LABELS: Record<string, string> = {
  fixed: "Fixed",
  necessary: "Necessary",
  fun: "Fun",
  goals: "Goals",
  transfer: "Transfer",
  income: "Income",
  ignore: "Ignored",
};

export const FREQUENCY_LABELS: Record<string, string> = {
  weekly: "Weekly",
  biweekly: "Every 2 weeks",
  semimonthly: "Twice a month",
  monthly: "Monthly",
  quarterly: "Quarterly",
  annual: "Yearly",
  irregular: "Irregular",
};
