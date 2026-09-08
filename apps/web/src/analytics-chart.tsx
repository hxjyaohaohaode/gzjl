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
import { Download, Maximize2, Minimize2, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";

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

function responsiveOption(option: EChartsCoreOption, width: number): EChartsCoreOption {
  const compact = width < 520;
  const adapt = (value: unknown, defaults: Record<string, unknown>) => {
    if (!value) return value;
    const apply = (item: Record<string, unknown>) => ({ ...item, ...defaults });
    return Array.isArray(value) ? value.map(apply) : apply(value as Record<string, unknown>);
  };
  return {
    animationDuration: 350,
    animationDurationUpdate: 200,
    ...option,
    animation: !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    textStyle: { ...option.textStyle, fontFamily: '"PingFang SC", "Microsoft YaHei", system-ui, sans-serif', fontSize: compact ? 12 : 13 },
    tooltip: adapt(option.tooltip, { confine: true, triggerOn: "mousemove|click", extraCssText: `max-width:${Math.max(160, width - 32)}px;white-space:normal;overflow-wrap:anywhere;` }),
    ...(compact && option.legend ? { legend: adapt(option.legend, { type: "scroll", left: 8, right: 8, itemWidth: 12, itemHeight: 8, itemGap: 10 }) } : {}),
    ...(compact && option.grid ? { grid: adapt(option.grid, { left: 12, right: 28, containLabel: true }) } : {}),
  };
}

function reconcileChart(chart: echarts.EChartsType, option: EChartsCoreOption, width: number) {
  const next = responsiveOption(option, width);
  const previous = (chart.getOption() ?? {}) as { dataZoom?: Array<{ start?: number; end?: number }>; legend?: Array<{ selected?: Record<string, boolean> }> };
  const mergeControls = (configured: unknown, states: unknown[], field: "zoom" | "legend") => {
    const items = Array.isArray(configured) ? configured : [configured];
    return items.map((item, index) => {
      const state = states[index] as { start?: number; end?: number; selected?: Record<string, boolean> } | undefined;
      return { ...item,
        ...(field === "zoom" && state ? { start: state.start, end: state.end } : {}),
        ...(field === "legend" && state?.selected ? { selected: state.selected } : {}),
      };
    });
  };
  if (next.dataZoom) next.dataZoom = mergeControls(next.dataZoom, previous.dataZoom ?? [], "zoom");
  if (next.legend) next.legend = mergeControls(next.legend, previous.legend ?? [], "legend");
  chart.setOption(next, { lazyUpdate: true, notMerge: false, replaceMerge: ["series"] });
}

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
  const onDataSelectRef = useRef(onDataSelect);
  const optionRef = useRef(option);
  const compactTypographyRef = useRef<boolean | null>(null);
  const scrollPositionRef = useRef({ x: 0, y: 0 });
  const ownedFullscreenRef = useRef(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    onDataSelectRef.current = onDataSelect;
  }, [onDataSelect]);

  useEffect(() => {
    const element = container.current;
    if (!element) return undefined;
    const chart = echarts.init(element, undefined, { renderer: "canvas" });
    chartRef.current = chart;
    compactTypographyRef.current = null;
    const handleClick = (params: { data?: unknown; name?: string; value?: unknown }) => {
      if (!onDataSelectRef.current) return;
      onDataSelectRef.current({
        data: params.data,
        name: params.name ?? "",
        value: params.value,
      });
    };
    chart.on("click", handleClick);
    let resizeFrame = 0;
    const observer = new ResizeObserver(() => {
      window.cancelAnimationFrame(resizeFrame);
      resizeFrame = window.requestAnimationFrame(() => {
        chart.resize();
        const compact = element.clientWidth < 520;
        if (compactTypographyRef.current !== compact) {
          compactTypographyRef.current = compact;
          reconcileChart(chart, optionRef.current, element.clientWidth);
        }
      });
    });
    observer.observe(element);
    return () => {
      window.cancelAnimationFrame(resizeFrame);
      observer.disconnect();
      chart.off("click", handleClick);
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    // Replace obsolete series while retaining user zoom and legend choices.
    // Always refresh formatter closures, including when only their context changes.
    optionRef.current = option;
    const compact = (container.current?.clientWidth ?? 0) < 520;
    compactTypographyRef.current = compact;
    reconcileChart(chart, option, container.current?.clientWidth ?? 640);
  }, [option]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      const active = document.fullscreenElement === frame.current;
      setIsFullscreen(active);
      window.requestAnimationFrame(() => chartRef.current?.resize());
      if (!document.fullscreenElement && ownedFullscreenRef.current) {
        ownedFullscreenRef.current = false;
        const { x, y } = scrollPositionRef.current;
        window.requestAnimationFrame(() => window.scrollTo({ left: x, top: y }));
      }
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

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

  const toggleFullscreen = async () => {
    if (document.fullscreenElement === frame.current) {
      await document.exitFullscreen?.();
      return;
    }
    if (!frame.current?.requestFullscreen) return;
    scrollPositionRef.current = { x: window.scrollX, y: window.scrollY };
    ownedFullscreenRef.current = true;
    try {
      await frame.current.requestFullscreen();
    } catch {
      ownedFullscreenRef.current = false;
    }
  };

  return (
    <div className="analytics-chart-frame" ref={frame}>
      <div className="analytics-chart-tools">
        <button className="analytics-chart-tool" type="button" aria-label={`重置${ariaLabel}视图`} title="重置缩放与图例"
          onClick={() => chartRef.current?.setOption(responsiveOption(optionRef.current, container.current?.clientWidth ?? 640), { notMerge: true })}>
          <RotateCcw aria-hidden="true" size={14} />
        </button>
        <button
          aria-label={`下载${ariaLabel}图片`}
          className="analytics-chart-tool"
          onClick={downloadImage}
          title="下载 PNG"
          type="button"
        >
          <Download aria-hidden="true" size={14} />
          <span className="sr-only">PNG</span>
        </button>
        <button
          aria-label={`${isFullscreen ? "退出全屏" : "全屏查看"}${ariaLabel}`}
          aria-pressed={isFullscreen}
          className="analytics-chart-tool"
          onClick={() => void toggleFullscreen()}
          title={isFullscreen ? "退出全屏" : "全屏查看"}
          type="button"
        >
          {isFullscreen ? <Minimize2 aria-hidden="true" size={14} /> : <Maximize2 aria-hidden="true" size={14} />}
        </button>
      </div>
      <div aria-label={ariaLabel} className="analytics-chart-canvas" ref={container} role="img" />
    </div>
  );
}
