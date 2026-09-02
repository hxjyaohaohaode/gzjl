export const timerStatuses = ["running", "paused", "on_break", "stopped"] as const;
export type TimerStatus = (typeof timerStatuses)[number];

export const timerEventTypes = [
  "pause",
  "resume",
  "break_start",
  "break_end",
  "stop",
] as const;
export type TimerEventType = (typeof timerEventTypes)[number];

export interface TimerStateSnapshot {
  status: TimerStatus;
  stateChangedAt: Date;
  accumulatedSeconds: number;
}

export interface TimerTransitionResult extends TimerStateSnapshot {
  stoppedAt: Date | null;
}

const allowedTransitions: Record<
  Exclude<TimerStatus, "stopped">,
  Partial<Record<TimerEventType, TimerStatus>>
> = {
  running: { pause: "paused", break_start: "on_break", stop: "stopped" },
  paused: { resume: "running", break_start: "on_break", stop: "stopped" },
  on_break: { break_end: "running", stop: "stopped" },
};

export class InvalidTimerTransitionError extends Error {
  constructor(status: TimerStatus, eventType: TimerEventType) {
    super(`Timer cannot transition from ${status} via ${eventType}`);
    this.name = "InvalidTimerTransitionError";
  }
}

export function transitionTimerState(
  current: TimerStateSnapshot,
  eventType: TimerEventType,
  occurredAt: Date,
): TimerTransitionResult {
  if (occurredAt < current.stateChangedAt) {
    throw new RangeError("Timer events must be monotonic");
  }
  if (current.status === "stopped") {
    throw new InvalidTimerTransitionError(current.status, eventType);
  }
  const nextStatus = allowedTransitions[current.status][eventType];
  if (!nextStatus) throw new InvalidTimerTransitionError(current.status, eventType);

  const runningDelta =
    current.status === "running"
      ? Math.floor((occurredAt.getTime() - current.stateChangedAt.getTime()) / 1_000)
      : 0;
  return {
    status: nextStatus,
    stateChangedAt: occurredAt,
    accumulatedSeconds: current.accumulatedSeconds + runningDelta,
    stoppedAt: nextStatus === "stopped" ? occurredAt : null,
  };
}
