import { AnimatePresence, motion, useIsPresent, type HTMLMotionProps } from "motion/react";
import { ArrowUpRight, ChevronLeft, Pause, Play, RotateCcw, Search } from "lucide-react";
import { forwardRef, useEffect, useId, useMemo, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { Button } from "@workbench/ui";
import { getOrganizationTimezone, zonedInputToDate } from "./timezone.js";
import { useMotionPreference } from "./motion-preference.js";
import { CollectionPager, RollingValue, WorkspaceDialog } from "./reference-primitives.js";
import { referenceMotion, referenceSpring } from "./reference-motion.js";
import { pageSlice, shiftVisualDay, swimDomain, swimRows, visualDate, visualDuration, workHeatCells, type VisualWorkRecord } from "./work-visualization-model.js";

const narrowQuery = "(max-width: 767px)";
const subscribeNarrow = (notify: () => void) => { const query = window.matchMedia(narrowQuery); query.addEventListener("change", notify); return () => query.removeEventListener("change", notify); };
const isNarrow = () => window.matchMedia(narrowQuery).matches;

function FloatingReadout({ id, anchor, children }: { id: string; anchor: { x: number; y: number }; children: ReactNode }) {
  const { reduced } = useMotionPreference();
  return createPortal(<motion.div id={id} role="tooltip" className="fx-chart-tooltip" initial={false}
    animate={{ left: Math.max(8, Math.min(window.innerWidth - 278, anchor.x - 135)), top: Math.max(8, Math.min(window.innerHeight - 176, anchor.y - 164)) }}
    transition={{ duration: reduced ? 0 : referenceMotion.follow, ease: [.22, 1, .36, 1] }}>{children}</motion.div>, document.body);
}

export function PulseTrend({ points, previous, label = "净工时", onSelect }: {
  points: Array<{ date: string; seconds: number }>; previous?: number | undefined; label?: string; onSelect?: ((date: string) => void) | undefined;
}) {
  const { reduced } = useMotionPreference();
  const [selected, setSelected] = useState<number | null>(null);
  const [cursor, setCursor] = useState<{ index: number; x: number; y: number } | null>(null);
  const uid = useId().replace(/:/g, "");
  const total = points.reduce((sum, point) => sum + point.seconds, 0);
  const peak = Math.max(1, ...points.map((point) => point.seconds));
  const max = Math.ceil(peak / 3600 + .2) * 3600;
  const pts = points.map((point, index) => ({ x: points.length === 1 ? 355 : 44 + index / (points.length - 1) * 622, y: 170 - point.seconds / max * 144 }));
  // A fixed path topology permits the same .72s morph when the range changes
  // between one, seven and thirty days. Actual hit points retain their dates.
  const sampled = pts.length ? Array.from({ length: 60 }, (_, index) => {
    const pos = index / 59 * (pts.length - 1), a = pts[Math.floor(pos)]!, b = pts[Math.ceil(pos)]!, weight = pos - Math.floor(pos);
    // Sample the reference's smooth cubic, retaining horizontal tangents at
    // each source value instead of turning its peaks into straight segments.
    const m = 1 - weight, mx = (a.x + b.x) / 2;
    return { x: m ** 3 * a.x + 3 * m ** 2 * weight * mx + 3 * m * weight ** 2 * mx + weight ** 3 * b.x,
      y: (m ** 3 + 3 * m ** 2 * weight) * a.y + (3 * m * weight ** 2 + weight ** 3) * b.y };
  }) : [];
  const line = sampled.map((position, index) => index ? `C ${(sampled[index - 1]!.x + position.x) / 2},${sampled[index - 1]!.y} ${(sampled[index - 1]!.x + position.x) / 2},${position.y} ${position.x},${position.y}` : `M ${position.x},${position.y}`).join(" ");
  const sparse = points.length > 6 && points.filter((item) => item.seconds > 0).length <= 3 && total > 0;
  const selectedIndex = Math.min(selected ?? points.length - 1, points.length - 1);
  const point = points[selectedIndex];
  const delta = previous && previous > 0 ? (total - previous) / previous * 100 : null;
  return <div className="fx-pulse-layout">
    <div className="fx-pulse-metric"><span>{label}</span><strong><RollingValue value={(total / 3600).toFixed(1)} /><small>小时</small></strong><p>{delta === null ? "前一周期暂无可比较记录" : <><b>{delta >= 0 ? "+" : ""}{delta.toFixed(1)}%</b> 较前一等长周期</>}</p><span>仅已发生的授权工作事实</span></div>
    <figure className="fx-pulse-chart" aria-label={`${label}趋势`} tabIndex={0} aria-describedby={cursor && points[cursor.index] ? `${uid}-readout` : undefined} onBlur={() => setCursor(null)} onKeyDown={(event) => {
      if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key) && points.length) {
        event.preventDefault(); const index = event.key === "Home" ? 0 : event.key === "End" ? points.length - 1 : Math.max(0, Math.min(points.length - 1, selectedIndex + (event.key === "ArrowLeft" ? -1 : 1)));
        setSelected(index); const box = event.currentTarget.querySelector("svg")!.getBoundingClientRect(); setCursor({ index, x: box.left + pts[index]!.x / 710 * box.width, y: box.top + pts[index]!.y / 206 * box.height });
      }
      if (event.key === "Escape") setCursor(null);
      if (event.key === "Enter" && point) onSelect?.(point.date);
    }}>
      <svg viewBox="0 0 710 206" role="img" aria-label={`${points.length} 个日期的净工时趋势，左右方向键逐日查看`} onPointerLeave={() => setCursor(null)} onPointerMove={(event) => {
        if (event.pointerType !== "mouse" || !pts.length) return;
        const box = event.currentTarget.getBoundingClientRect(), x = (event.clientX - box.left) / box.width * 710;
        const index = pts.reduce((best, position, next) => Math.abs(position.x - x) < Math.abs(pts[best]!.x - x) ? next : best, 0);
        setSelected(index); setCursor({ index, x: box.left + pts[index]!.x / 710 * box.width, y: box.top + pts[index]!.y / 206 * box.height });
      }}>
        <defs><linearGradient id={uid} x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="var(--accent)" stopOpacity=".22" /><stop offset="1" stopColor="var(--accent)" stopOpacity="0" /></linearGradient></defs>
        {[0, 1, 2, 3, 4].map((tick) => <g key={tick}><line x1="44" y1={170 - tick * 36} x2="666" y2={170 - tick * 36} stroke="var(--border)" strokeDasharray="2 5" /><text x="32" y={174 - tick * 36} textAnchor="end">{(max * tick / 4 / 3600).toFixed(1)}</text></g>)}
        {line && !sparse && <><motion.path initial={false} animate={{ d: `${line} L ${pts.at(-1)!.x},170 L ${pts[0]!.x},170 Z` }} transition={{ duration: reduced ? 0 : referenceMotion.morph }} fill={`url(#${uid})`} />
          <motion.path initial={{ pathLength: reduced ? 1 : 0 }} animate={{ d: line, pathLength: 1 }} transition={{ duration: reduced ? 0 : referenceMotion.morph, ease: "easeInOut" }} fill="none" stroke="var(--text)" strokeWidth="2.3" strokeLinecap="round" /></>}
        {pts.map((position, index) => <g key={points[index]!.date} onPointerEnter={() => setSelected(index)} onClick={() => onSelect?.(points[index]!.date)}>
          {sparse && points[index]!.seconds > 0 && <><motion.line x1={position.x} x2={position.x} y1="170" initial={{ y2: reduced ? position.y : 170 }} animate={{ y2: position.y }} transition={{ duration: reduced ? 0 : .6, delay: reduced ? 0 : index * .018 }} stroke="var(--accent)" strokeWidth="2" /><text x={position.x} y={position.y - 9} textAnchor="middle">{(points[index]!.seconds / 3600).toFixed(1)}h</text></>}
          <rect x={position.x - 622 / Math.max(1, pts.length) / 2} y="18" width={622 / Math.max(1, pts.length)} height="157" fill="transparent" className="fx-chart-hit" />
          {(index === selectedIndex || pts.length <= 8 || sparse) && <circle cx={position.x} cy={position.y} r={sparse && !points[index]!.seconds ? 1.6 : index === selectedIndex ? 5 : 3} fill="var(--surface)" stroke="var(--accent)" strokeWidth="2" />}
          {index === pts.length - 1 && !sparse && pts.length > 8 && <circle cx={position.x} cy={position.y} r="9" fill="var(--accent)" opacity=".12" />}
          {(index === 0 || index === pts.length - 1 || index % Math.max(1, Math.ceil(pts.length / 5)) === 0) && <text x={position.x} y="197" textAnchor="middle">{points[index]!.date.slice(5)}</text>}
        </g>)}
        {cursor && pts[cursor.index] && <g className="fx-pulse-cursor"><line x1={pts[cursor.index]!.x} x2={pts[cursor.index]!.x} y1="18" y2="170" stroke="var(--accent)" strokeDasharray="3 5" opacity=".4" /><line x1="44" x2="666" y1={pts[cursor.index]!.y} y2={pts[cursor.index]!.y} stroke="var(--accent)" strokeDasharray="3 5" opacity=".2" /></g>}
      </svg>
      <figcaption aria-live="polite">{point ? <><span>{point.date} · {visualDuration(point.seconds)}</span>{onSelect && <button type="button" onClick={() => onSelect(point.date)}>查看当日记录<ArrowUpRight size={13} /></button>}</> : "所选范围暂无工作事实"}</figcaption>
    </figure>
    {cursor && points[cursor.index] && <FloatingReadout id={`${uid}-readout`} anchor={cursor}><strong>{points[cursor.index]!.date}</strong><p><i />{label}<b>{visualDuration(points[cursor.index]!.seconds)}</b></p><small>左右方向键逐项查看 · 回车打开对应记录</small></FloatingReadout>}
  </div>;
}

export function WorkHeatmap({ records, lastDay = visualDate(new Date(), getOrganizationTimezone()), title = "工作时段热力", onSelect }: {
  records: VisualWorkRecord[]; lastDay?: string; title?: string; onSelect?: ((item: VisualWorkRecord) => void) | undefined;
}) {
  const timezone = getOrganizationTimezone();
  const cells = useMemo(() => workHeatCells(records, lastDay, timezone), [records, lastDay, timezone]);
  const [active, setActive] = useState<number | null>(null);
  const [fixed, setFixed] = useState<number | null>(null);
  const [dayDetail, setDayDetail] = useState<string | null>(null);
  const [mode, setMode] = useState<"heat" | "trend">("heat");
  const [tooltip, setTooltip] = useState<{ index: number; x: number; y: number } | null>(null);
  const selected = cells[fixed ?? active ?? cells.findIndex((cell) => cell.count === Math.max(...cells.map((item) => item.count)))];
  const dayRows = dayDetail ? [...new Map(cells.filter((cell) => cell.date === dayDetail).flatMap((cell) => cell.records).map((row) => [row.id, row])).values()] : [];
  const selectedDayRows = selected ? [...new Map(cells.filter((cell) => cell.date === selected.date).flatMap((cell) => cell.records).map((row) => [row.id, row])).values()] : [];
  const hoverCell = tooltip ? cells[tooltip.index] : undefined;
  const hoverDayRows = hoverCell ? [...new Map(cells.filter((cell) => cell.date === hoverCell.date).flatMap((cell) => cell.records).map((row) => [row.id, row])).values()] : [];
  const points = Array.from({ length: 7 }, (_, index) => {
    const date = shiftVisualDay(lastDay, index - 6);
    return { date, seconds: records.filter((record) => record.recordKind !== "plan" && record.startAt && visualDate(record.startAt, timezone) === date).reduce((sum, record) => sum + (record.netSeconds ?? 0), 0) };
  });
  return <section className="fx-chart-surface fx-heat-surface" aria-label={title}>
    <header className="fx-surface-heading"><div><h2>{title}</h2><p>近 7 天 · 记录覆盖的小时，计划不计入热力</p></div><div className="fx-segmented" aria-label="热力图视图">{(["heat", "trend"] as const).map((value) => <button type="button" aria-pressed={mode === value} key={value} onClick={() => setMode(value)}>{value === "heat" ? "热力" : "趋势"}</button>)}</div></header>
    {mode === "trend" ? <PulseTrend points={points} label="当日开始记录的净工时" onSelect={setDayDetail} /> : <div className="fx-heat-scroll"><div className="fx-heat" role="grid" aria-label="日期与小时工作热力" onPointerLeave={() => { setActive(null); setTooltip(null); }}>
      <div className="fx-heat-hours" aria-hidden="true"><span />{Array.from({ length: 24 }, (_, hour) => <span className={selected?.hour === hour ? "is-cross" : ""} key={hour}>{hour % 3 === 0 ? String(hour).padStart(2, "0") : ""}</span>)}</div>
      {Array.from({ length: 7 }, (_, row) => <div className="fx-heat-row" role="row" key={row}><button className="fx-heat-day" type="button" onClick={() => setDayDetail(cells[row * 24]!.date)} aria-label={`查看 ${cells[row * 24]!.date} 全天记录`}>{cells[row * 24]!.date.slice(5)}<small>{new Intl.DateTimeFormat("zh-CN", { weekday: "short" }).format(new Date(`${cells[row * 24]!.date}T12:00:00`))}</small></button>
        {cells.slice(row * 24, (row + 1) * 24).map((cell, column) => <button key={cell.hour} type="button" role="gridcell" className={`fx-heat-cell level-${cell.level}${selected && (selected.date === cell.date || selected.hour === cell.hour) ? " is-cross" : ""}${fixed === row * 24 + column ? " is-fixed" : ""}`}
          style={{ "--cell-delay": `${(row + column) * 24}ms` } as CSSProperties} data-cell-index={row * 24 + column} tabIndex={(active ?? fixed ?? 0) === row * 24 + column ? 0 : -1}
          aria-label={`${cell.date} ${String(cell.hour).padStart(2, "0")}:00，${cell.count} 条工作记录覆盖`} aria-selected={fixed === row * 24 + column}
          onPointerEnter={(event) => { setActive(row * 24 + column); if (event.pointerType === "mouse") { const box = event.currentTarget.getBoundingClientRect(); setTooltip({ index: row * 24 + column, x: Math.max(8, Math.min(window.innerWidth - 278, box.left - 100)), y: Math.max(8, Math.min(window.innerHeight - 180, box.bottom + 10)) }); } }} onFocus={() => setActive(row * 24 + column)} onClick={() => setFixed((value) => value === row * 24 + column ? null : row * 24 + column)}
          onKeyDown={(event) => { const moves: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -24, ArrowDown: 24 }; const delta = moves[event.key]; if (delta !== undefined) { event.preventDefault(); const next = Math.max(0, Math.min(167, row * 24 + column + delta)); event.currentTarget.closest(".fx-heat")?.querySelector<HTMLButtonElement>(`[data-cell-index="${next}"]`)?.focus(); } if (event.key === "Escape") setFixed(null); }} />)}
      </div>)}
    </div></div>}
    <div className="fx-heat-detail"><div className="fx-heat-readout" aria-live="polite"><div><strong>{selected ? `${selected.date} · ${String(selected.hour).padStart(2, "0")}:00` : "暂无工作事实"}</strong><span>{selected?.count ?? 0} 条记录覆盖此时段 · 全天覆盖 {selectedDayRows.length} 条工作 · {selectedDayRows.filter((row) => row.result?.trim()).length} 条填写结果</span><span>悬停或方向键预览 · 点击固定 · 查看全天记录</span></div><button type="button" onClick={() => setDayDetail(selected?.date ?? lastDay)}>查看全天<ArrowUpRight size={14} /></button></div>
    {selected?.records.length ? <ul className="fx-heat-records">{selected.records.slice(0, 3).map((row) => <li key={row.id}><button type="button" onClick={() => onSelect?.(row)}><span>{row.displayName ? `${row.displayName} · ` : ""}{row.content}</span><small>{row.netSeconds != null ? `整条记录 ${visualDuration(row.netSeconds)}` : "具体工时未公开"}</small></button></li>)}</ul> : <p className="fx-chart-empty">此时段没有已记录的工作。点击日期可查看当天其他时段。</p>}
    </div>
    <WorkspaceDialog open={Boolean(dayDetail)} title={`${dayDetail ?? ""} · 全天工作记录`} description="按已授权记录查看完整内容；未来计划不会计入热力。" onClose={() => setDayDetail(null)}>
      {dayRows.length ? dayRows.map((row) => <button className="fx-day-record" type="button" key={row.id} onClick={() => { setDayDetail(null); onSelect?.(row); }}><strong>{row.content}</strong><span>{row.displayName ?? "本人记录"} · {row.netSeconds != null ? `整条记录 ${visualDuration(row.netSeconds)}` : "时长未公开"}</span><ArrowUpRight size={15} /></button>) : <p className="fx-chart-empty">当天暂无已授权的工作记录。</p>}
    </WorkspaceDialog>
    {hoverCell && tooltip && mode === "heat" && !dayDetail && createPortal(<div className="fx-heat-tooltip" aria-hidden="true" style={{ left: tooltip.x, top: tooltip.y }}><strong>{hoverCell.date} · {String(hoverCell.hour).padStart(2, "0")}:00</strong><p>此时段 {hoverCell.count} 条 · 全天覆盖 {hoverDayRows.length} 条工作</p>{hoverCell.records.slice(0, 2).map((record) => <span key={record.id}>{record.content}</span>)}<small>点击格子固定读数 · 点击日期查看全天</small></div>, document.body)}
  </section>;
}

export function WorkSwimlane({ records, title = "团队工作泳道", renderDetail }: { records: VisualWorkRecord[]; title?: string; renderDetail?: ((item: VisualWorkRecord) => ReactNode) | undefined }) {
  const compact = useSyncExternalStore(subscribeNarrow, isNarrow, () => false);
  const tooltipId = useId();
  const timezone = getOrganizationTimezone();
  const dates = [...new Set(records.filter((record) => record.recordKind !== "plan").flatMap((record) => [record.startAt ?? record.activityAt, record.endAt && Number.isFinite(Date.parse(record.endAt)) ? new Date(Date.parse(record.endAt) - 1).toISOString() : null]).filter((value): value is string => Boolean(value) && Number.isFinite(Date.parse(value!))).map((value) => visualDate(value, timezone)))].sort().reverse();
  const [date, setDate] = useState("");
  const [full, setFull] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [hover, setHover] = useState<string | null>(null);
  const [detail, setDetail] = useState<VisualWorkRecord | null>(null);
  const [readout, setReadout] = useState<{ record: VisualWorkRecord; x: number; y: number } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const chosenDate = dates.includes(date) ? date : dates[0] ?? visualDate(new Date(), timezone);
  const from = zonedInputToDate(`${chosenDate}T00:00`, timezone).getTime();
  const to = zonedInputToDate(`${shiftVisualDay(chosenDate, 1)}T00:00`, timezone).getTime();
  const intervals = swimRows(records, from, to);
  const shown = intervals.map((interval) => interval.record);
  const members = [...new Set(shown.map((record) => record.membershipId ?? record.displayName ?? "本人"))];
  const dayHours = (to - from) / 3_600_000;
  const nowHour = (now - from) / 3_600_000;
  const { start, end, ticks } = swimDomain(now >= from && now < to && intervals.length ? [...intervals, { hours: nowHour, hoursEnd: nowHour }] : intervals, dayHours, full, compact);
  const showNow = nowHour >= start && nowHour < end && now >= from && now < to;
  useEffect(() => {
    if (chosenDate !== visualDate(new Date(), timezone)) return;
    const timer = window.setInterval(() => { if (!document.hidden) setNow(Date.now()); }, 60_000);
    return () => window.clearInterval(timer);
  }, [chosenDate, timezone]);
  const tickFormatter = new Intl.DateTimeFormat("zh-CN", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const detailFormatter = new Intl.DateTimeFormat("zh-CN", { timeZone: timezone, month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const lanes = showAll ? members : members.slice(0, 5);
  return <section className="fx-chart-surface fx-swim-surface" aria-label={title}><header className="fx-surface-heading"><div><h2>{title}</h2><p>公开动态与授权时段 · 点击时间块查看工作依据</p></div><div className="fx-chart-actions"><select aria-label="泳道日期" value={chosenDate} onChange={(event) => setDate(event.target.value)}>{(dates.length ? dates : [chosenDate]).map((value) => <option value={value} key={value}>{value}</option>)}</select><button aria-pressed={full} type="button" onClick={() => setFull((value) => !value)}>{full ? "全天" : "聚焦"}</button></div></header>
    <div className="fx-swim-scroll" onScroll={() => setReadout(null)} onPointerLeave={() => { setReadout(null); setHover(null); }}><div className="fx-swim"><div className="fx-swim-ruler"><span>成员</span><div>{ticks.map((hour) => <span key={hour} style={{ left: `${(hour - start) / (end - start) * 100}%` }}>{hour === dayHours ? "24:00" : tickFormatter.format(new Date(from + hour * 3_600_000))}</span>)}{showNow && <i className="fx-swim-now-label" style={{ left: `${(nowHour - start) / (end - start) * 100}%` }}>现在</i>}</div></div>
      {lanes.map((member, index) => { const items = shown.filter((record) => (record.membershipId ?? record.displayName ?? "本人") === member); const placed = swimRows(items,from,to), height = Math.max(48, 24 + (Math.max(0,...placed.map((item) => item.row)) + 1) * 28); return <div className={`fx-swim-lane${hover && hover !== member ? " is-muted" : ""}`} key={member} onPointerEnter={() => setHover(member)} onPointerLeave={() => setHover(null)}><span className="fx-swim-label"><strong>{items[0]!.displayName ?? "本人"}</strong><small>{items.length} 条</small></span><div className="fx-swim-track" style={{ height }}>
        {ticks.map((hour) => <i className="fx-swim-gridline" key={hour} style={{ left: `${(hour - start) / (end - start) * 100}%` }} />)}
        {showNow && <i className="fx-swim-now" style={{ left: `${(nowHour - start) / (end - start) * 100}%` }} aria-hidden="true" />}
        {placed.map(({record,precise,hours,hoursEnd,row}, itemIndex) => { const width = Math.min(100, Math.max(1.1, (hoursEnd - hours) / (end - start) * 100)); const enter = (element: HTMLElement) => { const box = element.getBoundingClientRect(); setHover(member); setReadout({ record, x: box.left + box.width / 2, y: box.top }); }; return <button className={`fx-swim-block${precise ? "" : " is-public-event"}`} key={record.id} type="button" aria-describedby={readout?.record.id === record.id && !detail ? tooltipId : undefined} aria-label={`${record.displayName ?? "本人"} · ${record.content} · ${precise ? detailFormatter.format(new Date(record.startAt!)) : "仅公开动态，具体时段未公开"}`} style={{ left: `${Math.min(100 - width, (hours - start) / (end - start) * 100)}%`, top: 12 + row * 28, width: `${width}%`, "--lane-index": index, "--block-delay": `${(index * 3 + itemIndex) * 18}ms` } as CSSProperties} onClick={() => { setReadout(null); setDetail(record); }} onPointerEnter={(event) => { if (event.pointerType === "mouse") enter(event.currentTarget); }} onPointerLeave={() => setReadout(null)} onFocus={(event) => enter(event.currentTarget)} onBlur={() => { setHover(null); setReadout(null); }} />; })}
      </div></div>; })}
      {!shown.length && <p className="fx-chart-empty">当天暂无已授权的动态。</p>}
    </div></div>{members.length > 5 && <button type="button" className="fx-more-link" onClick={() => setShowAll((value) => !value)}>{showAll ? "收起到 5 位成员" : `另有 ${members.length - 5} 位成员 · 展开查看`}</button>}
    <WorkspaceDialog open={Boolean(detail)} title={detail?.displayName ? `${detail.displayName} · 工作动态` : "工作动态"} onClose={() => setDetail(null)}>
      {detail && <><h3 className="fx-detail-title">{detail.content}</h3><p className="fx-detail-copy">{detail.result || "未填写结果"}</p>{detail.startAt && detail.endAt ? <p className="fx-detail-meta">{detailFormatter.format(new Date(detail.startAt))} — {detailFormatter.format(new Date(detail.endAt))}{detail.netSeconds != null && ` · 整条净工时 ${visualDuration(detail.netSeconds)}`}</p> : <p className="fx-detail-meta">当前授权只公开动态，具体工作时段未公开。</p>}{renderDetail?.(detail)}<Link className="fx-back-link" to={`/work?record=${encodeURIComponent(detail.id)}`} onClick={() => setDetail(null)}>查看完整工作依据<ArrowUpRight size={15} /></Link></>}
    </WorkspaceDialog>
    {readout && !detail && <FloatingReadout id={tooltipId} anchor={readout}><strong>{readout.record.displayName ?? "本人"} · {readout.record.content}</strong><p>{readout.record.netSeconds != null ? <b>{visualDuration(readout.record.netSeconds)}</b> : "具体工时未公开"}</p><span>{readout.record.result || "尚未填写工作结果"}</span><small>{readout.record.startAt && readout.record.endAt ? `${detailFormatter.format(new Date(readout.record.startAt))} — ${detailFormatter.format(new Date(readout.record.endAt))}` : "仅展示公开动态，具体工作时段未公开"}</small></FloatingReadout>}
  </section>;
}

export interface OrbitItem { id: string; label: string; sub?: string; onSelect?: (() => void) | undefined }
export interface OrbitGroup { id: string; label: string; count: number; ratio?: number; items: OrbitItem[] }
const OrbitButton = forwardRef<HTMLButtonElement, HTMLMotionProps<"button">>(function OrbitButton(props, ref) {
  const present = useIsPresent();
  return <motion.button {...props} ref={ref} inert={!present} aria-hidden={!present} disabled={!present || props.disabled} tabIndex={present ? 0 : -1} />;
});
export function OrbitExplorer({ title, groups, placeholder = "搜索名称、成员或业务入口", help, rootCount }: { title: string; groups: OrbitGroup[]; placeholder?: string; help?: string; rootCount?: number }) {
  const compact = useSyncExternalStore(subscribeNarrow, isNarrow, () => false);
  const pageSize = compact ? 4 : 8;
  const [groupId, setGroupId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [paused, setPaused] = useState(false);
  const [replay, setReplay] = useState(0);
  const [hover, setHover] = useState<string | null>(null);
  const { reduced } = useMotionPreference();
  const group = groups.find((item) => item.id === groupId);
  const matches = (group ? group.items : groups.flatMap((item) => item.items)).filter((item) => !query.trim() || `${item.label} ${item.sub ?? ""}`.toLowerCase().includes(query.trim().toLowerCase()));
  const details = query.trim() ? matches : group?.items ?? [];
  const currentPage = Math.max(1, Math.min(page, Math.ceil(details.length / pageSize) || 1));
  const items = group || query.trim() ? pageSlice(details, currentPage, pageSize) : groups.map((item) => ({ id: item.id, label: item.label, sub: `${item.count} 项`, onSelect: () => { setHover(null); setGroupId(item.id); setPage(1); } }));
  const centerLabel = query.trim() ? "实际匹配" : group?.label ?? title;
  const centerCount = query.trim() ? matches.length : group?.count ?? rootCount ?? groups.reduce((sum, item) => sum + item.count, 0);
  const positions = items.map((item, index) => { const angle = -Math.PI / 2 + index * Math.PI * 2 / Math.max(1, items.length); return { ...item, x: 350 + Math.cos(angle) * 250, y: 235 + Math.sin(angle) * 145 }; });
  return <section className="fx-orbit-surface fx-chart-surface" data-paused={paused || reduced} aria-label={title}>
    <header className="fx-surface-heading"><div><h2>{title}</h2><p>{help ?? "点击展开层级 · 悬停聚焦关系 · Esc 返回"}</p></div><div className="fx-chart-actions"><button type="button" onClick={() => { setPaused(false); setHover(null); setReplay((value) => value + 1); }}><RotateCcw size={13} />重播</button><button type="button" aria-pressed={paused} onClick={() => setPaused((value) => !value)}>{paused ? <Play size={13} /> : <Pause size={13} />}{paused ? "继续" : "暂停"}</button></div></header>
    <div className="fx-orbit-stage" tabIndex={0} aria-label={`${title}关系图，方向键切换节点，Esc 返回全景`} onKeyDown={(event) => {
      if (event.key === "Escape" && (group || query)) { event.preventDefault(); setHover(null); setGroupId(null); setQuery(""); setPage(1); }
      if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) {
        event.preventDefault(); const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>(".fx-orbit-node:not([inert])")];
        const current = buttons.indexOf((event.target as HTMLElement).closest<HTMLButtonElement>(".fx-orbit-node")!);
        const direction = event.key === "ArrowLeft" ? [-1,0] : event.key === "ArrowRight" ? [1,0] : event.key === "ArrowUp" ? [0,-1] : [0,1];
        const origin = positions[current] ?? { x: 350, y: 235 };
        const spatial = positions.map((position,index) => { const dx = position.x - origin.x, dy = position.y - origin.y; return { index, forward: dx * direction[0]! + dy * direction[1]!, distance: Math.hypot(dx,dy) + Math.abs(dx * direction[1]! - dy * direction[0]!) * 2 }; }).filter((position) => position.index !== current && position.forward > 1).sort((left,right) => left.distance - right.distance);
        const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : spatial[0]?.index ?? current;
        buttons[next]?.focus();
      }
    }}>
      <svg viewBox="0 0 700 470" preserveAspectRatio="none" aria-hidden="true" className="fx-orbit-links" key={replay}>
        <ellipse cx="350" cy="235" rx="265" ry="170" className="fx-orbit-guide" />
        {!compact && !group && !query.trim() && positions.map((position, index) => <g key={`fan-${position.id}`} className={`fx-orbit-fan${hover && hover !== position.id ? " is-muted" : ""}`}>
          {groups[index]?.items.slice(0, 24).map((item, leaf) => {
            const total = Math.min(groups[index]!.items.length, 24);
            const direction = Math.atan2(position.y - 235, position.x - 350);
            const angle = direction + (leaf / Math.max(1, total - 1) - .5) * Math.min(2.25, total * .16);
            const x = position.x + Math.cos(angle) * 65, y = position.y + Math.sin(angle) * 65;
            return <g key={item.id}><motion.line x1={position.x} y1={position.y} initial={{ x2: position.x, y2: position.y, opacity: 0 }} animate={{ x2: x, y2: y, opacity: .35 }} transition={{ duration: reduced ? 0 : referenceMotion.pageIn, delay: reduced ? 0 : leaf * .015 }} /><motion.circle cx={x} cy={y} r="1.8" initial={{ opacity: 0 }} animate={{ opacity: .8 }} transition={{ duration: reduced ? 0 : referenceMotion.hover, delay: reduced ? 0 : .25 + leaf * .015 }} /></g>;
          })}
        </g>)}
        <AnimatePresence>{positions.map((item, index) => <motion.g key={item.id} initial={{ opacity: reduced ? 1 : 0 }} animate={{ opacity: hover && hover !== item.id ? .25 : 1 }} exit={{ opacity: 0 }} transition={{ duration: reduced ? 0 : referenceMotion.pageIn }}>
          <motion.path initial={{ d: reduced ? `M 350 235 Q ${(350 + item.x) / 2} ${235 + (item.y - 235) * .12} ${item.x} ${item.y}` : "M 350 235 Q 350 235 350 235", pathLength: reduced ? 1 : 0 }} animate={{ d: `M 350 235 Q ${(350 + item.x) / 2} ${235 + (item.y - 235) * .12} ${item.x} ${item.y}`, pathLength: 1 }} exit={{ d: "M 350 235 Q 350 235 350 235", pathLength: 0 }} transition={{ duration: reduced ? 0 : referenceMotion.pageIn, delay: reduced ? 0 : (!group && !query.trim() ? .7 + index * .12 : index * .04) }} className="fx-orbit-thread" />
          <motion.path initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: reduced ? 0 : referenceMotion.hover, delay: reduced ? 0 : 1 + index * .12 }} d={`M 350 235 Q ${(350 + item.x) / 2} ${235 + (item.y - 235) * .12} ${item.x} ${item.y}`} className="fx-orbit-flow" />
        </motion.g>)}</AnimatePresence>
      </svg>
      <button type="button" className="fx-orbit-core" onClick={() => { setHover(null); setGroupId(null); setQuery(""); setPage(1); }} aria-label={`${centerLabel}，${centerCount} 项，返回全景`}><i key={replay} /><strong><RollingValue value={centerCount} /></strong><span>{centerLabel}</span></button>
      <AnimatePresence mode="popLayout">{positions.map((item, index) => <OrbitButton key={`${replay}-${item.id}`} className={`fx-orbit-node${hover && hover !== item.id ? " is-muted" : ""}`} type="button" style={{ left: `${item.x / 7}%`, top: `${item.y / 4.7}%` }}
        initial={{ opacity: reduced ? 1 : 0, scale: reduced ? 1 : .45, left: reduced ? `${item.x / 7}%` : "50%", top: reduced ? `${item.y / 4.7}%` : "50%" }} animate={{ opacity: 1, scale: 1, left: `${item.x / 7}%`, top: `${item.y / 4.7}%` }} exit={{ opacity: 0, scale: reduced ? 1 : .4, left: "50%", top: "50%", transition: reduced ? { duration: 0 } : { ...referenceSpring, delay: 0, opacity: { duration: .2 } } }} transition={reduced ? { duration: 0 } : { ...referenceSpring, delay: !group && !query.trim() ? .7 + index * .12 : index * .04, opacity: { duration: .5, delay: !group && !query.trim() ? .7 + index * .12 : index * .04 } }}
        onPointerEnter={() => setHover(item.id)} onPointerLeave={() => setHover(null)} onFocus={() => setHover(item.id)} onBlur={() => setHover(null)} onClick={item.onSelect} aria-label={`${item.label}${item.sub ? `，${item.sub}` : ""}`}>
        <span className="fx-orbit-dial" style={{ "--dial-ratio": group || query.trim() ? 1 : groups[index]?.ratio ?? 1 } as CSSProperties}><i /><strong><RollingValue value={group || query.trim() ? index + 1 + (currentPage - 1) * pageSize : groups[index]?.count ?? 0} /></strong></span><b>{item.label}</b><small>{item.sub}</small>
      </OrbitButton>)}</AnimatePresence>
      {!items.length && <p className="fx-orbit-no-match">没有匹配的数据，可换一个姓名、角色或关键词。</p>}
    </div>
    <div className="fx-orbit-query"><Search size={15} /><input aria-label={`${title}查询`} type="search" value={query} placeholder={placeholder} onChange={(event) => { setHover(null); setQuery(event.target.value); setPage(1); }} /><button type="button" onClick={() => { setHover(null); setQuery(""); setGroupId(null); setPage(1); }}>重置</button></div>
    {(group || query.trim()) && <><div className="fx-orbit-back"><Button variant="ghost" size="compact" onClick={() => { setHover(null); setGroupId(null); setQuery(""); setPage(1); }}><ChevronLeft size={14} />返回全景</Button><span>{details.length} 项真实数据</span></div><CollectionPager total={details.length} page={currentPage} onChange={(value) => { setHover(null); setPage(value); }} size={pageSize} label={`${title}结果分页`} /></>}
  </section>;
}
