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

  it("keeps operations and executive briefs actionable without inventing management facts", () => {
    const operations = buildAiSystemPrompt("operations_brief");
    const executive = buildAiSystemPrompt("executive_brief");
    expect(operations).toContain("建议责任角色");
    expect(operations).toContain("不得虚构真实负责人");
    expect(executive).toContain("严格区分事实、推断与建议");
    expect(executive).toContain("禁止虚构收入、成本、ROI");
    expect(executive).toContain("禁止员工排名");
  });
});
