import {
  addDays,
  addMonths,
  differenceInCalendarMonths,
  endOfMonth,
  format,
  parseISO,
  startOfMonth,
} from "date-fns";
import type { Frequency } from "./types";

/** Formats a Date as YYYY-MM-DD without timezone drift. */
export function toISODate(date: Date): string {
  return format(date, "yyyy-MM-dd");
}

/** Parses YYYY-MM-DD as a local-noon Date, avoiding UTC-offset day slips. */
export function fromISODate(value: string): Date {
  const parsed = parseISO(`${value.slice(0, 10)}T12:00:00`);
  return parsed;
}

/** How many times per month this frequency occurs, for monthly-equivalent math. */
export function monthlyMultiplier(frequency: Frequency): number {
  switch (frequency) {
    case "weekly":
      return 52 / 12;
    case "biweekly":
      return 26 / 12;
    case "semimonthly":
      return 2;
    case "monthly":
      return 1;
    case "quarterly":
      return 1 / 3;
    case "annual":
      return 1 / 12;
    case "irregular":
      // Unpredictable by definition — excluded from the monthly plan rather
      // than guessed at.
      return 0;
  }
}

/** Converts an amount at some cadence into its monthly-equivalent value. */
export function toMonthlyAmount(amount: number, frequency: Frequency): number {
  return amount * monthlyMultiplier(frequency);
}

/**
 * Every occurrence of a recurring event that falls within [from, to].
 *
 * Walks forward from `anchor`. If the anchor is in the past (a bill whose due
 * date was never advanced), it is rolled forward to the first occurrence on or
 * after `from` so a stale record cannot silently drop out of the forecast.
 */
export function occurrencesBetween(
  anchorISO: string,
  frequency: Frequency,
  from: Date,
  to: Date,
  maxOccurrences = 64,
): string[] {
  if (frequency === "irregular") return [];

  let cursor = fromISODate(anchorISO);
  const results: string[] = [];

  // Roll a stale anchor forward without looping unbounded.
  let guard = 0;
  while (cursor < from && guard < 600) {
    cursor = advance(cursor, frequency);
    guard += 1;
  }

  while (cursor <= to && results.length < maxOccurrences) {
    if (cursor >= from) results.push(toISODate(cursor));
    cursor = advance(cursor, frequency);
  }

  return results;
}

function advance(date: Date, frequency: Frequency): Date {
  switch (frequency) {
    case "weekly":
      return addDays(date, 7);
    case "biweekly":
      return addDays(date, 14);
    case "semimonthly":
      // 1st and 15th style cadence.
      return date.getDate() < 15
        ? new Date(date.getFullYear(), date.getMonth(), 15, 12)
        : new Date(date.getFullYear(), date.getMonth() + 1, 1, 12);
    case "monthly":
      return addMonths(date, 1);
    case "quarterly":
      return addMonths(date, 3);
    case "annual":
      return addMonths(date, 12);
    case "irregular":
      return addDays(date, 3650);
  }
}

/** Whole months between now and a target date, floored at 1. */
export function monthsUntil(targetISO: string, asOf: Date): number {
  const diff = differenceInCalendarMonths(fromISODate(targetISO), asOf);
  return Math.max(1, diff);
}

export function monthBounds(asOf: Date): { start: string; end: string } {
  return {
    start: toISODate(startOfMonth(asOf)),
    end: toISODate(endOfMonth(asOf)),
  };
}

/** Days left in the month including today. */
export function daysRemainingInMonth(asOf: Date): number {
  const end = endOfMonth(asOf);
  return Math.max(
    1,
    Math.round(
      (end.getTime() - new Date(asOf.getFullYear(), asOf.getMonth(), asOf.getDate()).getTime()) /
        86_400_000,
    ) + 1,
  );
}

/**
 * The next occurrence of a day-of-month on or after `from`, clamped to the
 * length of the target month (a "31st" due date becomes the 30th in April).
 */
export function nextDayOfMonth(day: number, from: Date): string {
  const clampTo = (year: number, month: number) => {
    const lastDay = new Date(year, month + 1, 0).getDate();
    return new Date(year, month, Math.min(day, lastDay), 12);
  };

  const thisMonth = clampTo(from.getFullYear(), from.getMonth());
  if (thisMonth >= new Date(from.getFullYear(), from.getMonth(), from.getDate(), 12)) {
    return toISODate(thisMonth);
  }
  return toISODate(clampTo(from.getFullYear(), from.getMonth() + 1));
}
