import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, ArrowUpRight, Clock3, CornerDownLeft, Plus, Search, Settings2, X, type LucideIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@workbench/ui";
import { api } from "./api.js";
import { useDialogFocus } from "./dialog-focus.js";
import { readRecentPaths } from "./browser-preferences.js";

interface PageItem { label: string; shortLabel: string; to: string; icon: LucideIcon; section: "workspace" | "management" | "personal" }
interface SearchResult { id: string; kind: "work_session" | "project" | "project_node" | "member" | "attachment" | "ai_report"; title: string; subtitle: string | null; href: string }
interface Command { id: string; label: string; detail: string; icon: LucideIcon; run: () => void }
const sectionNames = { workspace: "工作空间", management: "管理工作", personal: "个人事务" };
const kindNames = { work_session: "工作", project: "项目", project_node: "节点", member: "成员", attachment: "附件", ai_report: "AI 报告" };

/** A permission-filtered command surface shared by desktop and mobile. */
export function CommandPalette({ items, membershipId, currentPath, onAppearance, onClose }: {
  items: PageItem[]; membershipId: string; currentPath: string; onAppearance: () => void; onClose: () => void;
}) {
  const [recentPaths] = useState(() => readRecentPaths(membershipId).filter((path) => path !== currentPath));
  const [query, setQuery] = useState("");
  const [settledQuery, setSettledQuery] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogFocus(dialogRef, true);
  const navigate = useNavigate();
  const normalizedQuery = query.trim();
  const term = normalizedQuery.toLowerCase();
  const match = (value: string) => value.toLowerCase().includes(term);
  useEffect(() => {
    const timer = window.setTimeout(() => setSettledQuery(normalizedQuery), 220);
    return () => window.clearTimeout(timer);
  }, [normalizedQuery]);
  const search = useQuery({
    queryKey: ["global-search", settledQuery],
    queryFn: ({ signal }) => api<{ items: SearchResult[] }>(`/api/search?q=${encodeURIComponent(settledQuery)}&limit=5`, { signal }),
    enabled: settledQuery.length >= 2,
    staleTime: 15_000,
  });
  const open = (href: string) => { onClose(); navigate(href); };
  const pageCommand = (item: PageItem, recent = false): Command => ({
    id: `${recent ? "recent" : "page"}:${item.to}`, label: item.label,
    detail: recent ? "最近访问" : sectionNames[item.section], icon: recent ? Clock3 : item.icon, run: () => open(item.to),
  });
  const recent = term ? [] : recentPaths.flatMap((path) => {
    const item = items.find((candidate) => candidate.to === path);
    return item ? [pageCommand(item, true)] : [];
  });
  const actions: Command[] = [
    { id: "action:work", label: "记录工作", detail: "打开工作记录", icon: Plus, run: () => open("/work") },
    { id: "action:appearance", label: "外观与密度设置", detail: "主题、密度、强调色与动效", icon: Settings2, run: () => { onClose(); onAppearance(); } },
  ];
  const businessReady = settledQuery === normalizedQuery && !search.isPending;
  const groups = [
    { label: "最近访问", entries: recent },
    { label: "快速前往", entries: items.filter((item) => match(`${item.label} ${item.shortLabel} ${item.to}`) && !recent.some((entry) => entry.id === `recent:${item.to}`)).map((item) => pageCommand(item)) },
    { label: "快捷操作", entries: actions.filter((action) => match(`${action.label} ${action.detail}`)) },
    { label: "业务结果", entries: normalizedQuery.length >= 2 && businessReady && !search.isError ? (search.data?.items ?? []).map((item): Command => ({ id: `${item.kind}:${item.id}`, label: item.title, detail: `${kindNames[item.kind]}${item.subtitle ? ` · ${item.subtitle}` : ""}`, icon: Search, run: () => open(item.href) })) : [] },
  ];
  const entries = groups.flatMap((group) => group.entries);
  const selected = entries.find((entry) => entry.id === activeId) ?? entries[0];
  const selectedId = selected?.id;
  useEffect(() => {
    if (!selectedId) return;
    dialogRef.current?.querySelector(`[data-command-id="${CSS.escape(selectedId)}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selectedId]);
  return (
    <div aria-label="全局导航" aria-modal="true" className="app-command-backdrop" role="dialog" ref={dialogRef} tabIndex={-1} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="app-command-palette">
        <div className="app-command-search">
          <Search size={20} aria-hidden="true" />
          <input aria-label="搜索工作台" aria-controls="workbench-command-results" aria-expanded="true" aria-autocomplete="list" aria-activedescendant={selected ? `command-${encodeURIComponent(selected.id)}` : undefined} role="combobox" className="app-command-input" placeholder="搜索页面、工作、项目、成员…" value={query}
            onChange={(event) => { setQuery(event.target.value); setActiveId(null); }}
            onKeyDown={(event) => {
              if ((event.key === "ArrowDown" || event.key === "ArrowUp") && entries.length) {
                event.preventDefault();
                const index = entries.findIndex((entry) => entry.id === selected?.id);
                setActiveId(entries[(index + (event.key === "ArrowDown" ? 1 : -1) + entries.length) % entries.length]!.id);
              } else if (event.key === "Enter" && selected && !event.nativeEvent.isComposing) { event.preventDefault(); selected.run(); }
            }} />
          <Button aria-label="关闭搜索" onClick={onClose} size="icon" variant="ghost"><X size={18} /></Button>
        </div>
        <div className="app-command-results" id="workbench-command-results" role="listbox" aria-label="导航与搜索结果">
          {groups.filter((group) => group.entries.length).map((group) => (
            <div key={group.label} role="group" aria-label={group.label}>
              <p className="app-command-group" aria-hidden="true">{group.label}</p>
              {group.entries.map((entry) => {
                const Icon = entry.icon;
                return <button key={entry.id} id={`command-${encodeURIComponent(entry.id)}`} data-command-id={entry.id} type="button" role="option" aria-selected={entry.id === selected?.id} tabIndex={-1} className="app-command-option" onPointerMove={() => setActiveId(entry.id)} onClick={entry.run}>
                  <span className="app-command-icon"><Icon size={17} /></span>
                  <span className="min-w-0 flex-1"><strong className="block truncate text-sm">{entry.label}</strong><span className="mt-0.5 block truncate text-xs text-[var(--text-muted)]">{entry.detail}</span></span>
                  <ArrowUpRight size={15} className="text-[var(--text-subtle)]" />
                </button>;
              })}
            </div>
          ))}
          {normalizedQuery.length >= 2 && !businessReady ? <p className="app-command-message" role="status">搜索中…</p> : null}
          {normalizedQuery.length >= 2 && businessReady && search.isError ? <div className="app-command-message" role="alert">搜索暂时不可用。<Button className="ml-2" disabled={search.isFetching} onClick={() => void search.refetch()} variant="secondary" size="compact">重新搜索</Button></div> : null}
          {!entries.length && (normalizedQuery.length < 2 || businessReady && !search.isError) ? <p className="app-command-message">没有可见的匹配结果，请尝试其他关键词。</p> : null}
        </div>
        <div className="app-command-footer"><span><ArrowUp size={12} /><ArrowDown size={12} /> 选择</span><span><CornerDownLeft size={13} /> 打开</span><span><kbd>Esc</kbd> 关闭</span><span className="ml-auto">只搜索已授权内容</span></div>
      </div>
    </div>
  );
}
