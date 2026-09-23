import type { EChartsCoreOption } from "echarts/core";

export function escapeChartText(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}

export function responsiveChartOption(option: EChartsCoreOption, width: number, reducedMotion: boolean): EChartsCoreOption {
  const compact = width < 520;
  const adapt = (value: unknown, defaults: Record<string, unknown>) => {
    const apply = (item: Record<string, unknown>) => ({ ...item, ...defaults });
    return Array.isArray(value) ? value.map(apply) : apply(value as Record<string, unknown>);
  };
  return {
    animationDuration: 350,
    animationDurationUpdate: 200,
    ...option,
    animation: !reducedMotion && option.animation !== false,
    textStyle: { ...option.textStyle, fontFamily: '"PingFang SC", "Microsoft YaHei", system-ui, sans-serif', fontSize: compact ? 12 : 13 },
    ...(option.tooltip ? { tooltip: adapt(option.tooltip, { confine: true, triggerOn: "mousemove|click", extraCssText: `max-width:${Math.max(160, width - 32)}px;white-space:normal;overflow-wrap:anywhere;` }) } : {}),
    ...(compact && option.legend ? { legend: adapt(option.legend, { type: "scroll", left: 8, right: 8, itemWidth: 12, itemHeight: 8, itemGap: 10 }) } : {}),
    ...(compact && option.grid ? { grid: adapt(option.grid, { left: 12, right: 28, containLabel: true }) } : {}),
  };
}

interface ChartDatum { name?: string; label?: string; value?: unknown; actual?: number; children?: ChartDatum[] }
interface ChartSeries {
  type?: string; name?: string; silent?: boolean; data?: unknown[];
  xAxisIndex?: number; yAxisIndex?: number;
  tooltip?: { show?: boolean; valueFormatter?: (value: unknown) => string };
  links?: Array<{ source: string; target: string; sourceLabel?: string; targetLabel?: string; value?: number }>;
}
export interface ChartDataRow { series: string; name: string; value: string }
export function chartDataRows(option: EChartsCoreOption): ChartDataRow[] {
  const series = (Array.isArray(option.series) ? option.series : option.series ? [option.series] : []) as ChartSeries[];
  const axes = (value: unknown) => (Array.isArray(value) ? value : value ? [value] : []) as Array<{ type?: string; data?: unknown[] }>;
  const xAxes = axes(option.xAxis);
  const yAxes = axes(option.yAxis);
  const tooltip = option.tooltip as ChartSeries["tooltip"];
  return series.flatMap((item) => {
    if (item.silent || item.tooltip?.show === false) return [];
    const label = item.name ?? (item.type === "sankey" ? "工时流向" : "数值");
    const formatter = item.tooltip?.valueFormatter ?? tooltip?.valueFormatter;
    const display = (value: unknown) => {
      if (value === null || value === undefined || value === "-") return "—";
      if (formatter) return String(formatter(value));
      return Array.isArray(value) ? value.map(String).join(" · ") : String(value);
    };
    if (item.type === "sankey") return (item.links ?? []).map((link) => ({ series: label, name: `${link.sourceLabel ?? link.source} → ${link.targetLabel ?? link.target}`, value: `${link.value ?? 0} 秒` }));
    const xAxis = xAxes[item.xAxisIndex ?? 0];
    const yAxis = yAxes[item.yAxisIndex ?? 0];
    const categories = xAxis?.type === "category" ? xAxis.data : yAxis?.type === "category" ? yAxis.data : undefined;
    const rows: ChartDataRow[] = [];
    const visit = (data: unknown[], parent = "") => data.forEach((raw, index) => {
      const datum: ChartDatum = raw !== null && typeof raw === "object" && !Array.isArray(raw) ? raw as ChartDatum : { value: raw };
      const tuple = Array.isArray(datum.value) ? datum.value : null;
      const name = datum.name ?? (tuple && typeof tuple[0] === "string" ? tuple[0] : String(categories?.[index] ?? index + 1));
      const path = parent ? `${parent} / ${name}` : name;
      const value = datum.actual ?? (tuple && typeof tuple[0] === "string" ? tuple[1] : datum.value);
      rows.push({ series: label, name: path, value: display(value) });
      if (datum.children) visit(datum.children, path);
    });
    visit(item.data ?? []);
    return rows;
  });
}
