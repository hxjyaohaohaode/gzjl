import { describe, expect, it } from "vitest";
import { chartDataRows, escapeChartText, responsiveChartOption } from "./chart-options.js";

describe("chart display and readable data", () => {
  it("escapes user text in custom HTML tooltips", () => {
    expect(escapeChartText('<img src=x onerror="alert(1)"> & 项目')).toBe("&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; 项目");
    expect(escapeChartText(null)).toBe("");
  });
  it("respects reduced motion and a chart's explicit animation setting", () => {
    expect(responsiveChartOption({}, 390, true).animation).toBe(false);
    expect(responsiveChartOption({ animation: false }, 1440, false).animation).toBe(false);
  });
  it("does not persist narrow-layout options into the desktop configuration", () => {
    const original = { legend: { left: 100 }, grid: { left: 60 } };
    expect(responsiveChartOption(original, 390, false).legend).toMatchObject({ type: "scroll", left: 8 });
    expect(responsiveChartOption(original, 1440, false).legend).toEqual({ left: 100 });
    expect(original.grid).toEqual({ left: 60 });
  });
  it("distinguishes missing data and actual zero and uses chart units", () => {
    expect(chartDataRows({ xAxis: { type: "category", data: ["一", "二", "三"] }, tooltip: { valueFormatter: (value: number) => `${value} 秒` }, series: [{ type: "line", name: "净工时", data: [0, null, 60] }] }))
      .toEqual([{ series: "净工时", name: "一", value: "0 秒" }, { series: "净工时", name: "二", value: "—" }, { series: "净工时", name: "三", value: "60 秒" }]);
  });
  it("uses horizontal categories and original waterfall amounts, excluding helper stacks", () => {
    expect(chartDataRows({ yAxis: { type: "category", data: ["项目甲"] }, series: [{ silent: true, data: [99] }, { name: "调整", data: [{ value: 10, actual: -10 }] }] }))
      .toEqual([{ series: "调整", name: "项目甲", value: "-10" }]);
  });
  it("keeps units separate for mixed-axis charts", () => {
    expect(chartDataRows({ xAxis: { type: "category", data: ["项目"] }, series: [
      { name: "工时", data: [3600], tooltip: { valueFormatter: (value: number) => `${value / 3600} 小时` } },
      { name: "进度", data: [0], tooltip: { valueFormatter: (value: number) => `${value}%` } },
    ] }).map((row) => row.value)).toEqual(["1 小时", "0%"]);
  });
  it("exposes heatmap dates, sunburst hierarchy and Sankey links in text", () => {
    expect(chartDataRows({ series: [{ type: "heatmap", data: [["2026-09-20", 12]] }] })[0]).toMatchObject({ name: "2026-09-20", value: "12" });
    expect(chartDataRows({ series: [{ type: "sunburst", data: [{ name: "项目", value: 60, children: [{ name: "研发", value: 60 }] }] }] })[1]).toMatchObject({ name: "项目 / 研发", value: "60" });
    expect(chartDataRows({ series: [{ type: "sankey", links: [{ source: "p:1", target: "t:1", sourceLabel: "项目", targetLabel: "研发", value: 60 }] }] })[0]).toMatchObject({ name: "项目 → 研发", value: "60 秒" });
  });
});
