import { expect, type Page } from "@playwright/test";

/** Advance through the actual visible wizard, preserving its validation. */
export async function wizardStep(page: Page, target: number, kind: "work" | "ai" = "work") {
  const form = kind === "work" ? page.locator("#work-editor .fx-step-form") : page.locator(".ai-settings-card .fx-step-form");
  if (kind === "ai") await form.waitFor({ state: "visible" });
  if (await form.count() === 0) return;
  const content = form.locator(".fx-step-content");
  let current = Number(await content.getAttribute("data-active-stage"));
  if (current > target) {
    await form.locator(".fx-step-progress button").nth(target).click();
  } else {
    while (current < target) {
      await form.getByRole("button", { name: "下一步", exact: true }).click();
      await expect(content).toHaveAttribute("data-active-stage", String(current + 1));
      current += 1;
    }
  }
  await expect(content).toHaveAttribute("data-active-stage", String(target));
}

export async function openWorkCards(page: Page) {
  if (new URL(page.url()).pathname !== "/work") return;
  await page.locator(".work-list-card .fx-disclosure-head").first().waitFor({ state: "visible" });
  for (const header of await page.locator(".work-record-entry > .fx-disclosure-head").all()) if (await header.getAttribute("aria-expanded") === "false") await header.click();
  await expect(page.locator(".work-record-entry > .fx-disclosure-detail[aria-hidden=true]")).toHaveCount(0);
}

export async function openApprovalCards(page: Page) {
  if (new URL(page.url()).pathname !== "/approvals") return;
  await page.locator(".fx-approval-card > .fx-disclosure-head").first().waitFor({ state: "visible" });
  for (const header of await page.locator(".fx-approval-card > .fx-disclosure-head").all()) if (await header.getAttribute("aria-expanded") === "false") await header.click();
  await expect(page.locator(".fx-approval-card > .fx-disclosure-detail[aria-hidden=true]")).toHaveCount(0);
}

export async function openBackupTools(page: Page) {
  const summary = page.locator(".fx-editor-backup:not([open]) > summary");
  if (await summary.count()) await summary.click();
}
