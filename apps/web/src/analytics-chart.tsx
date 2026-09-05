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
import { Download, Maximize2, Minimize2 } from "lucide-react";
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
  const optionSignatureRef = useRef("");
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
      resizeFrame = window.requestAnimationFrame(() => chart.resize());
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
    // Realtime reconciliation frequently returns an equivalent object graph.
    // Avoid replaying chart animations when the visible option did not change,
    // and update the existing canvas instead of disposing/recreating it. This
    // preserves scroll position, hover state and data-zoom interaction.
    const signature = JSON.stringify(option);
    if (signature === optionSignatureRef.current) return;
    optionSignatureRef.current = signature;
    chart.setOption(option, {
      lazyUpdate: true,
      notMerge: false,
    });
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
