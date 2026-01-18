/**
 * Shared date boundary utilities for billing period calculations.
 * Single source of truth for month, week, and day boundary calculations.
 */

export interface DateBoundaries {
  start: Date;
  end: Date;
}

/**
 * Get the start and end of the current billing month
 */
export function getMonthBoundaries(): DateBoundaries {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  const end = new Date(
    now.getFullYear(),
    now.getMonth() + 1,
    0,
    23,
    59,
    59,
    999,
  );
  return { start, end };
}

/**
 * Get the start and end of the current day
 */
export function getDayBoundaries(): DateBoundaries {
  const now = new Date();
  const start = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    0,
    0,
    0,
    0,
  );
  const end = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    23,
    59,
    59,
    999,
  );
  return { start, end };
}

/**
 * Get the start and end of the current week (Sunday to Saturday)
 */
export function getWeekBoundaries(): DateBoundaries {
  const now = new Date();
  const dayOfWeek = now.getDay();

  // Start: Sunday of current week
  const start = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - dayOfWeek,
    0,
    0,
    0,
    0,
  );

  // End: Saturday of current week
  const end = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + (6 - dayOfWeek),
    23,
    59,
    59,
    999,
  );

  return { start, end };
}

/**
 * Get the start of the current month (alias for compatibility)
 */
export function getMonthStart(): Date {
  return getMonthBoundaries().start;
}

/**
 * Get the end of the current month (alias for compatibility)
 */
export function getMonthEnd(): Date {
  return getMonthBoundaries().end;
}

/**
 * Get number of days remaining in the current month
 */
export function getDaysRemainingInMonth(): number {
  const now = new Date();
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return lastDay.getDate() - now.getDate();
}

/**
 * Get total days in the current month
 */
export function getDaysInMonth(): number {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
}
