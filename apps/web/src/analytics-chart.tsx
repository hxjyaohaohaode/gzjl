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
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { chartDataRows, responsiveChartOption } from "./chart-options.js";
import { useDialogFocus } from "./dialog-focus.js";

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
  return responsiveChartOption(option, width, window.matchMedia("(prefers-reduced-motion: reduce)").matches);
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
  // Replace the complete option so removed axes, desktop layout and formatter
  // closures cannot survive a filter, resize or theme change.
  chart.setOption(next, { lazyUpdate: true, notMerge: true });
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
  const slot = useRef<HTMLDivElement>(null);
  const fullscreenButton = useRef<HTMLButtonElement>(null);
  const [portalHost] = useState(() => document.createElement("div"));
  const inlineHeightRef = useRef(0);
  const focusedControlRef = useRef<HTMLElement | null>(null);
  const previouslyExpandedRef = useRef(false);
  const chartRef = useRef<echarts.EChartsType | null>(null);
  const onDataSelectRef = useRef(onDataSelect);
  const optionRef = useRef(option);
  const compactTypographyRef = useRef<boolean | null>(null);
  const scrollPositionRef = useRef({ x: 0, y: 0 });
  const ownedFullscreenRef = useRef(false);
  const fullscreenRequestRef = useRef(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [fullscreenPending, setFullscreenPending] = useState(false);
  const [feedback, setFeedback] = useState("");
  const fullscreen = isFullscreen || expanded;
  useDialogFocus(frame, fullscreen, fullscreenButton);
  const dataRows = chartDataRows(option);

  useLayoutEffect(() => {
    const anchor = slot.current;
    if (!anchor) return;
    // Keep one chart instance while escaping card clipping/stacking contexts.
    // The inline slot retains its height so opening a chart never shifts the page.
    anchor.style.height = expanded ? `${inlineHeightRef.current}px` : "";
    (expanded ? document.body : anchor).append(portalHost);
    focusedControlRef.current?.focus({ preventScroll: true });
    if (!expanded && previouslyExpandedRef.current) window.scrollTo(scrollPositionRef.current.x, scrollPositionRef.current.y);
    previouslyExpandedRef.current = expanded;
    return () => {
      const active = document.activeElement;
      focusedControlRef.current = active instanceof HTMLElement && portalHost.contains(active) ? active : null;
      portalHost.remove();
    };
  }, [expanded, portalHost]);

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
    if (!expanded) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setExpanded(false); };
    document.addEventListener("keydown", onEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onEscape);
    };
  }, [expanded]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const refresh = () => { if (chartRef.current) reconcileChart(chartRef.current, optionRef.current, container.current?.clientWidth ?? 640); };
    media.addEventListener("change", refresh);
    return () => media.removeEventListener("change", refresh);
  }, []);

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
    try {
      link.href = chart.getDataURL({
      type: "png",
      pixelRatio: 2,
      backgroundColor:
        getComputedStyle(document.documentElement).getPropertyValue("--surface").trim() || "#ffffff",
      });
      link.click();
      setFeedback("已生成 PNG 图片，可在浏览器下载记录中查看。");
    } catch {
      setFeedback("图片导出失败，可以查看下方图表数据后重试。");
    }
  };

  const toggleFullscreen = async () => {
    if (fullscreenRequestRef.current) return;
    if (expanded) { setExpanded(false); return; }
    if (document.fullscreenElement === frame.current) {
      try { await document.exitFullscreen?.(); } catch { setFeedback("无法退出全屏，请使用浏览器退出全屏操作。"); }
      return;
    }
    const target = frame.current;
    if (!target) return;
    inlineHeightRef.current = frame.current?.getBoundingClientRect().height ?? 0;
    scrollPositionRef.current = { x: window.scrollX, y: window.scrollY };
    if (typeof target.requestFullscreen !== "function" || document.fullscreenEnabled === false) { setExpanded(true); return; }
    fullscreenRequestRef.current = true;
    setFullscreenPending(true);
    ownedFullscreenRef.current = true;
    try {
      await target.requestFullscreen();
      if (!target.isConnected || frame.current !== target) return;
      // A callable API can resolve without entering fullscreen. Verify the
      // actual browser state instead of depending solely on an event arriving.
      const entered = document.fullscreenElement === target;
      ownedFullscreenRef.current = entered;
      setIsFullscreen(entered);
      if (!entered) setExpanded(true);
    } catch {
      ownedFullscreenRef.current = false;
      if (target.isConnected && frame.current === target) setExpanded(true);
    } finally {
      fullscreenRequestRef.current = false;
      setFullscreenPending(false);
    }
  };

  const chartContent = (
    <div className={`analytics-chart-frame${expanded ? " analytics-chart-expanded" : ""}`} ref={frame}
      role={fullscreen ? "dialog" : undefined} aria-modal={fullscreen ? true : undefined} aria-label={fullscreen ? ariaLabel : undefined} tabIndex={fullscreen ? -1 : undefined}>
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
          aria-label={`${fullscreen ? "退出全屏" : "全屏查看"}${ariaLabel}`}
          aria-pressed={fullscreen}
          ref={fullscreenButton}
          disabled={fullscreenPending}
          className="analytics-chart-tool"
          onClick={() => void toggleFullscreen()}
          title={fullscreen ? "退出全屏" : "全屏查看"}
          type="button"
        >
          {fullscreen ? <Minimize2 aria-hidden="true" size={14} /> : <Maximize2 aria-hidden="true" size={14} />}
        </button>
      </div>
      <div aria-label={ariaLabel} className="analytics-chart-canvas" ref={container} role="img" />
      {feedback ? <p className="chart-feedback" role="status">{feedback}</p> : null}
      <details className="chart-data-table">
        <summary>{`查看${ariaLabel}数据`}</summary>
        <p className="chart-feedback">表格保留当前筛选范围内的完整数据；图例和缩放只调整图形显示。</p>
        <div className="chart-data-scroll" tabIndex={0} role="region" aria-label={`${ariaLabel}数据表`}>
          <table><caption className="sr-only">{ariaLabel}，缺失值以破折号表示</caption>
            <thead><tr><th scope="col">系列</th><th scope="col">类别</th><th scope="col">数值（单位见图表）</th></tr></thead>
            <tbody>{dataRows.map((row, index) => <tr key={index}><td>{row.series}</td><th scope="row">{row.name}</th><td>{row.value}</td></tr>)}</tbody>
          </table>
          {!dataRows.length ? <p>当前没有可展示的数据。</p> : null}
        </div>
      </details>
    </div>
  );
  return <><div ref={slot} className="analytics-chart-slot" />{createPortal(chartContent, portalHost)}</>;
}
