import { z } from "zod";

export const intervalSchema = z
  .object({
    startAt: z.coerce.date(),
    endAt: z.coerce.date(),
  })
  .refine(({ startAt, endAt }) => endAt.getTime() > startAt.getTime(), {
    message: "endAt must be later than startAt",
    path: ["endAt"],
  });

export type TimeInterval = z.infer<typeof intervalSchema>;

export interface WorkDuration {
  grossSeconds: number;
  breakSeconds: number;
  netSeconds: number;
}

function secondsBetween(startAt: Date, endAt: Date): number {
  return Math.floor((endAt.getTime() - startAt.getTime()) / 1_000);
}

export function intervalsOverlap(a: TimeInterval, b: TimeInterval): boolean {
  return a.startAt < b.endAt && b.startAt < a.endAt;
}

export function calculateWorkDuration(
  sessionInput: TimeInterval,
  breakInputs: readonly TimeInterval[],
): WorkDuration {
  const session = intervalSchema.parse(sessionInput);
  const breaks = breakInputs
    .map((value) => intervalSchema.parse(value))
    .sort((a, b) => a.startAt.getTime() - b.startAt.getTime());

  for (const currentBreak of breaks) {
    if (
      currentBreak.startAt < session.startAt ||
      currentBreak.endAt > session.endAt
    ) {
      throw new RangeError("Break intervals must be contained by the work session");
    }
  }

  for (let index = 1; index < breaks.length; index += 1) {
    const previousBreak = breaks[index - 1];
    const currentBreak = breaks[index];
    if (previousBreak && currentBreak && intervalsOverlap(previousBreak, currentBreak)) {
      throw new RangeError("Break intervals must not overlap");
    }
  }

  const grossSeconds = secondsBetween(session.startAt, session.endAt);
  const breakSeconds = breaks.reduce(
    (total, currentBreak) =>
      total + secondsBetween(currentBreak.startAt, currentBreak.endAt),
    0,
  );

  return {
    grossSeconds,
    breakSeconds,
    netSeconds: grossSeconds - breakSeconds,
  };
}

export function findOverlappingIntervals(
  intervals: readonly (TimeInterval & { id: string })[],
): Array<[string, string]> {
  const sorted = [...intervals].sort(
    (a, b) => a.startAt.getTime() - b.startAt.getTime(),
  );
  const conflicts: Array<[string, string]> = [];

  for (let left = 0; left < sorted.length; left += 1) {
    const candidate = sorted[left];
    if (!candidate) continue;
    for (let right = left + 1; right < sorted.length; right += 1) {
      const comparison = sorted[right];
      if (!comparison || comparison.startAt >= candidate.endAt) break;
      if (intervalsOverlap(candidate, comparison)) {
        conflicts.push([candidate.id, comparison.id]);
      }
    }
  }

  return conflicts;
}
