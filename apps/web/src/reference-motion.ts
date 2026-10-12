// Timings adapted from the supplied admin console's motion.ts.
export const referenceMotion = { press: .14, release: .46, hover: .34, leave: .42, pageIn: .62, pageOut: .18, overlayIn: .42, overlayOut: .2, morph: .72, follow: .32 } as const;
// The reference graph integrates a critically damped spring: c = 2 * sqrt(k).
export const referenceSpring = { type: "spring", stiffness: 70, damping: 2 * Math.sqrt(70), mass: 1 } as const;
