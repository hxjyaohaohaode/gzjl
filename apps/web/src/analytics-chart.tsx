import {
  BarChart,
  FunnelChart,
  HeatmapChart,
  LineChart,
  PieChart,
  SankeyChart,
  SunburstChart,
} from "echarts/charts";
import { CalendarComponent, DataZoomComponent, GridComponent, LegendComponent, ToolboxComponent, TooltipComponent, VisualMapComponent } from "echarts/components";
import * as echarts from "echarts/core";
import type { EChartsCoreOption } from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import { useEffect, useRef } from "react";

echarts.use([
  BarChart,
  CanvasRenderer,
  DataZoomComponent,
  CalendarComponent,
  FunnelChart,
  GridComponent,
  LegendComponent,
  LineChart,
  HeatmapChart,
  PieChart,
  SankeyChart,
  SunburstChart,
  ToolboxComponent,
  TooltipComponent,
  VisualMapComponent,
]);

export default function AnalyticsChart({
  ariaLabel,
  onDataSelect,
  option,
}: {
  ariaLabel: string;
  onDataSelect?: ((selection: { data: unknown; name: string; value: unknown }) => void) | undefined;
  option: EChartsCoreOption;
}) {
  const container = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.EChartsType | null>(null);

  useEffect(() => {
    const element = container.current;
    if (!element) return undefined;
    const chart = echarts.init(element, undefined, { renderer: "canvas" });
    chartRef.current = chart;
    chart.setOption(option, { notMerge: true });
    const handleClick = (params: { data?: unknown; name?: string; value?: unknown }) => {
      if (!onDataSelect) return;
      onDataSelect({
        data: params.data,
        name: params.name ?? "",
        value: params.value,
      });
    };
    chart.on("click", handleClick);
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(element);
    return () => {
      observer.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, [onDataSelect, option]);

  const downloadImage = () => {
    const chart = chartRef.current;
    if (!chart) return;
    const link = document.createElement("a");
    const safeName = ariaLabel.replace(/[\\/:*?"<>|\s]+/g, "-").replace(/^-|-$/g, "");
    link.download = `${safeName || "analytics"}.png`;
    link.href = chart.getDataURL({
      type: "png",
      pixelRatio: 2,
      backgroundColor:
        getComputedStyle(document.documentElement).getPropertyValue("--surface").trim() || "#ffffff",
    });
    link.click();
  };

  return (
    <div className="relative bg-[var(--surface)] fullscreen:h-screen fullscreen:p-6" ref={frame}>
      <div className="absolute right-1 top-0 z-10 flex gap-1">
        <button
          aria-label={`下载${ariaLabel}图片`}
          className="rounded-lg bg-[var(--surface-subtle)] px-2.5 py-1.5 text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--text)]"
          onClick={downloadImage}
          type="button"
        >
          PNG
        </button>
        <button
          aria-label={`全屏查看${ariaLabel}`}
          className="rounded-lg bg-[var(--surface-subtle)] px-2.5 py-1.5 text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--text)]"
          onClick={() => void frame.current?.requestFullscreen?.()}
          type="button"
        >
          全屏
        </button>
      </div>
      <div aria-label={ariaLabel} className="h-72 w-full fullscreen:h-full" ref={container} role="img" />
    </div>
  );
}
