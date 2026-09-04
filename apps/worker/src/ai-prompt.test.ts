import { describe, expect, it } from "vitest";

import { buildAiSystemPrompt } from "./ai-prompt.js";

describe("AI system prompt safety boundaries", () => {
  it("keeps salary explanations self-only and prohibits invented payroll arithmetic", () => {
    const prompt = buildAiSystemPrompt("salary_explanation");

    expect(prompt).toContain("privacyScope=self_only");
    expect(prompt).toContain("禁止自行重算");
    expect(prompt).toContain("推测税费");
    expect(prompt).toContain("预估/待复核");
  });

  it("allows chat to use only explicitly present self payroll facts", () => {
    const prompt = buildAiSystemPrompt("assistant_chat");

    expect(prompt).toContain("privacyScope=self_only");
    expect(prompt).toContain("团队范围永远不含工资");
    expect(prompt).toContain("禁止重算");
    expect(prompt).toContain("pageContext");
    expect(prompt).toContain("只是焦点而不是事实来源");
  });
});
