import { and, asc, eq, gt, inArray, isNull, lt, or } from "drizzle-orm";
import type { Database } from "@workbench/db";
import { compensationPlanVersions, rateRules } from "@workbench/db/schema";

// Keep the pieces outside a replacement range, including scheduled future
// prices. Fully replaced versions remain available to immutable audit snapshots.
export async function replacePlanRange(db: Database, planId: string, startsAt: Date, endsAt: Date | undefined, createdBy: string) {
  const versions = await db.select().from(compensationPlanVersions)
    .where(eq(compensationPlanVersions.compensationPlanId, planId))
    .orderBy(asc(compensationPlanVersions.version)).for("update");
  let nextVersion = Math.max(0, ...versions.map((version) => version.version)) + 1;
  const replaced = versions.filter((version) =>
    (!version.effectiveTo || version.effectiveTo > version.effectiveFrom)
    && (!endsAt || version.effectiveFrom < endsAt)
    && (!version.effectiveTo || version.effectiveTo > startsAt));
  const rules = replaced.length ? await db.select().from(rateRules)
    .where(inArray(rateRules.compensationPlanVersionId, replaced.map((version) => version.id))) : [];
  for (const version of replaced) {
    const keepBefore = version.effectiveFrom < startsAt;
    const keepAfter = endsAt && (!version.effectiveTo || version.effectiveTo > endsAt);
    if (keepBefore && keepAfter) {
      const { id: _id, createdAt: _createdAt, ...copy } = version;
      void _id; void _createdAt;
      const [continuation] = await db.insert(compensationPlanVersions).values({ ...copy,
        version: nextVersion++, effectiveFrom: endsAt, createdBy }).returning();
      const copiedRules = rules.filter((rule) => rule.compensationPlanVersionId === version.id);
      if (copiedRules.length) await db.insert(rateRules).values(copiedRules.map(({ id: _ruleId, createdAt: _ruleCreatedAt, ...rule }) => {
        void _ruleId; void _ruleCreatedAt;
        return { ...rule, compensationPlanVersionId: continuation!.id };
      }));
    }
    await db.update(compensationPlanVersions).set(keepBefore
      ? { effectiveTo: startsAt }
      : keepAfter ? { effectiveFrom: endsAt }
        : { effectiveTo: version.effectiveFrom })
      .where(eq(compensationPlanVersions.id, version.id));
  }
  return { nextVersion, replaced };
}

export function effectivePlanRange(startsAt: Date, endsAt: Date) {
  return and(
    lt(compensationPlanVersions.effectiveFrom, endsAt),
    or(isNull(compensationPlanVersions.effectiveTo), gt(compensationPlanVersions.effectiveTo, startsAt)),
    nonEmptyPlanVersion(),
  );
}

export function nonEmptyPlanVersion() {
  return or(isNull(compensationPlanVersions.effectiveTo), gt(compensationPlanVersions.effectiveTo, compensationPlanVersions.effectiveFrom));
}
