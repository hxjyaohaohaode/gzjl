import { describe, expect, it } from "vitest";

import {
  InvalidTimerTransitionError,
  transitionTimerState,
} from "./timer-state.js";

describe("transitionTimerState", () => {
  const t0 = new Date("2026-09-01T01:00:00.000Z");

  it("accumulates only running intervals", () => {
    const paused = transitionTimerState(
      { status: "running", stateChangedAt: t0, accumulatedSeconds: 0 },
      "pause",
      new Date("2026-09-01T01:10:00.000Z"),
    );
    expect(paused.accumulatedSeconds).toBe(600);

    const resumed = transitionTimerState(
      paused,
      "resume",
      new Date("2026-09-01T01:15:00.000Z"),
    );
    expect(resumed.accumulatedSeconds).toBe(600);

    const stopped = transitionTimerState(
      resumed,
      "stop",
      new Date("2026-09-01T01:20:00.000Z"),
    );
    expect(stopped.accumulatedSeconds).toBe(900);
    expect(stopped.stoppedAt).toEqual(new Date("2026-09-01T01:20:00.000Z"));
  });

  it("supports explicit breaks without counting them as work", () => {
    const onBreak = transitionTimerState(
      { status: "running", stateChangedAt: t0, accumulatedSeconds: 0 },
      "break_start",
      new Date("2026-09-01T01:05:00.000Z"),
    );
    const resumed = transitionTimerState(
      onBreak,
      "break_end",
      new Date("2026-09-01T01:12:00.000Z"),
    );
    expect(resumed.accumulatedSeconds).toBe(300);
  });

  it("rejects illegal and out-of-order transitions", () => {
    expect(() =>
      transitionTimerState(
        { status: "paused", stateChangedAt: t0, accumulatedSeconds: 10 },
        "pause",
        t0,
      ),
    ).toThrow(InvalidTimerTransitionError);
    expect(() =>
      transitionTimerState(
        { status: "running", stateChangedAt: t0, accumulatedSeconds: 0 },
        "stop",
        new Date("2026-09-01T00:59:59.000Z"),
      ),
    ).toThrow(RangeError);
  });
});
