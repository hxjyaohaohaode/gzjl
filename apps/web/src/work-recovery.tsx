import { useMutation, useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@workbench/ui";
import { api } from "./api.js";

export function DraftArchiveButton({ id, version }: { id: string; version: number }) {
  const client = useQueryClient();
  const archive = useMutation({ mutationFn: () => api(`/api/work-sessions/${id}/archive-action`, { method: "POST", body: { action: "archive", expectedVersion: version } }), onSuccess: () => client.invalidateQueries({ queryKey: ["work-sessions"] }) });
  return <><Button variant="ghost" size="compact" disabled={archive.isPending} onClick={() => { if (window.confirm("将这条误填草稿收起到已归档草稿，保留历史并可恢复。归档后不计入本期状态统计。")) archive.mutate(); }}>{archive.isPending ? "正在归档…" : "归档误填草稿"}</Button>{archive.error ? <p role="alert">{archive.error.message}</p> : null}</>;
}

export function ArchivedDrafts() {
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const query = useInfiniteQuery({ queryKey: ["work-sessions", "archived"], initialPageParam: "", queryFn: ({ pageParam }) => api<{ items: Array<{ id: string; version: number; content: string; recordKind: string }>; nextCursor?: string | null }>(`/api/work-sessions?archived=true&limit=20${pageParam ? `&before=${encodeURIComponent(pageParam)}` : ""}`), getNextPageParam: (page) => page.nextCursor ?? undefined, enabled: open });
  const items = query.data?.pages.flatMap((page) => Array.isArray(page.items) ? page.items : []) ?? [];
  const restore = useMutation({ mutationFn: (item: { id: string; version: number }) => api(`/api/work-sessions/${item.id}/archive-action`, { method: "POST", body: { action: "restore", expectedVersion: item.version } }), onSuccess: () => client.invalidateQueries({ queryKey: ["work-sessions"] }) });
  return <details className="archived-drafts" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}><summary>误填恢复 · 已归档草稿与计划</summary>{open ? <><p>归档保留原记录和版本；恢复会重新核对重叠时段及周期锁定，不能覆盖已确认薪资依据。</p>{query.isPending ? <p role="status">正在读取…</p> : query.isError ? <p role="alert">{query.error.message}<Button variant="ghost" onClick={() => void query.refetch()}>重试读取</Button></p> : <ul>{items.map((item) => <li key={item.id}><span>{item.content} · v{item.version}</span><Button variant="secondary" size="compact" disabled={restore.isPending} onClick={() => restore.mutate(item)}>恢复为草稿</Button></li>)}</ul>}{!query.isPending && !query.error && items.length === 0 ? <p>没有已归档草稿。</p> : null}{query.hasNextPage ? <Button variant="ghost" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>读取更多已归档草稿</Button> : null}{restore.error ? <p role="alert">{restore.error.message}</p> : null}</> : null}</details>;
}
