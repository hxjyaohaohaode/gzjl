import { useState } from "react";
import { Button } from "@workbench/ui";
import { zonedInputToDate, getOrganizationTimezone } from "./timezone.js";

export interface HistoricalRange { from: Date; to: Date }
export function HistoricalRangePicker({ onChange, description = "统计与数据导出使用同一范围。" }: { onChange: (range: HistoricalRange | null) => void; description?: string }) {
  const [mode, setMode] = useState("month");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [error, setError] = useState("");
  const [applied, setApplied] = useState("");
  const apply = () => {
    try {
      if (!start || (mode === "range" && !end)) throw new Error("请填写完整日期。");
      const first = mode === "month" ? `${start}-01` : start;
      const last = mode === "range" ? end : first;
      const boundary = new Date(`${last}T00:00:00Z`);
      if (mode === "month") boundary.setUTCMonth(boundary.getUTCMonth() + 1);
      else boundary.setUTCDate(boundary.getUTCDate() + 1);
      const from = zonedInputToDate(`${first}T00:00:00`);
      const to = zonedInputToDate(`${boundary.toISOString().slice(0, 10)}T00:00:00`);
      if (to <= from || to.getTime() - from.getTime() > 366 * 86_400_000) throw new Error("结束日期不能早于开始日期，每次最多查看 366 天；历史年份不限。");
      onChange({ from, to }); setError(""); setApplied(mode === "month" ? start : `${start}${mode === "range" ? ` 至 ${end}` : ""}`);
    } catch (e) { setError(e instanceof Error ? e.message : "日期无效。"); }
  };
  return <section className="history-range" aria-label="历史日期范围选择"><div className="history-range-fields">
    <label>历史查看方式<select value={mode} onChange={(e) => { setMode(e.target.value); setStart(""); setEnd(""); }}><option value="month">某个月</option><option value="day">某一天</option><option value="range">自定义日期范围</option></select></label>
    <label>{mode === "month" ? "历史月份" : mode === "day" ? "历史日期" : "开始日期"}<input required type={mode === "month" ? "month" : "date"} value={start} onChange={(e) => setStart(e.target.value)} /></label>
    {mode === "range" ? <label>结束日期（包含当天）<input required type="date" value={end} onChange={(e) => setEnd(e.target.value)} /></label> : null}
    <Button onClick={apply}>应用历史范围</Button><Button variant="ghost" onClick={() => { onChange(null); setApplied(""); setError(""); }}>恢复默认范围</Button>
  </div><p>{applied ? `已选：${applied}。` : "可查看任意历史月份、单日或范围。"}按组织时区 {getOrganizationTimezone()} 的自然日，结束日期包含当天；{description}</p>{error ? <p role="alert">{error}</p> : null}</section>;
}
