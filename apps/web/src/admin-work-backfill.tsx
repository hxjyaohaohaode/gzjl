import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { canAdminBackfill, adminWorkBackfillSchema, type AdminWorkBackfillInput } from "@workbench/shared";
import { Button, Card, CardContent } from "@workbench/ui";
import { api, type Me } from "./api.js";
import { AccessUnavailable } from "./payroll-workspace.js";
import { ErrorMessage, Field } from "./workspace-primitives.js";
import { useWorkspaceDraft } from "./workspace-draft.js";
import { toZonedInputValue, zonedInputToDate } from "./timezone.js";

interface BackfillMember { membershipId: string; displayName: string; orgUnitName: string | null }
interface BackfillDraft { membershipIds: string[]; startAt: string; endAt: string; content: string }
const emptyDraft: BackfillDraft = { membershipIds: [], startAt: "", endAt: "", content: "" };

export function AdminWorkBackfillPage({ me }: { me: Me }) {
  const allowed = canAdminBackfill(me.permissions);
  const client = useQueryClient();
  const [search, setSearch] = useState("");
  const [formError, setFormError] = useState<Error | null>(null);
  const [savedMessage, setSavedMessage] = useState("");
  const draft = useWorkspaceDraft({ identity: `${me.user.organizationId}:${me.user.membershipId}`,
    entity: "admin-work-backfill", version: 1, initial: emptyDraft });
  const form = draft.value;
  const members = useQuery({ queryKey: ["admin-backfill-members", me.user.organizationId, me.user.membershipId],
    queryFn: ({ signal }) => api<{ items: BackfillMember[] }>("/api/work-sessions/admin-backfill/members", { signal }), enabled: allowed });
  const save = useMutation({
    mutationFn: ({ input }: { input: AdminWorkBackfillInput; submitted: BackfillDraft }) =>
      api<{ sessions: Array<{ id: string; netSeconds: number }> }>("/api/work-sessions/admin-backfill", { method: "POST", body: input }),
    onSuccess: (data, { submitted }) => {
      const names = submitted.membershipIds.map((id) => members.data?.items.find((member) => member.membershipId === id)?.displayName ?? "员工");
      setSavedMessage(`已为 ${names.join("、")} 补录并确认 ${data.sessions.length} 条工时，每人 ${((data.sessions[0]?.netSeconds ?? 0) / 3600).toFixed(2)} 小时。`);
      draft.saved(submitted);
      void client.invalidateQueries({ predicate: (query) => query.queryKey[0] !== "workspace-draft" });
    },
  });
  if (!allowed) return <AccessUnavailable />;
  const visibleMembers = (members.data?.items ?? []).filter((member) =>
    `${member.displayName} ${member.orgUnitName ?? ""}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const setField = <K extends keyof BackfillDraft>(key: K, value: BackfillDraft[K]) => {
    draft.setValue((current) => ({ ...current, [key]: value }));
    setFormError(null); setSavedMessage(""); save.reset();
  };
  let durationLabel = "";
  try {
    if (form.startAt && form.endAt) {
      const hours = (zonedInputToDate(form.endAt, me.user.timezone).getTime() - zonedInputToDate(form.startAt, me.user.timezone).getTime()) / 3_600_000;
      if (hours > 0) durationLabel = `每人 ${hours.toFixed(2)} 小时 · 合计 ${(hours * form.membershipIds.length).toFixed(2)} 小时`;
    }
  } catch { /* The submit path shows invalid local-time errors. */ }
  return <Card><CardContent>
    <h2 className="text-lg font-bold">管理员补录工时</h2>
    <p className="my-3 text-sm text-[var(--text-muted)]">无需证据，保存后直接计入已批准工时。多人选择时，每人使用相同的时间和工作内容。</p>
    {savedMessage && <p role="status" className="admin-backfill-success">{savedMessage}</p>}
    <ErrorMessage error={members.error} onRetry={() => void members.refetch()} retrying={members.isFetching} />
    <form className="admin-backfill-form" onSubmit={(event) => {
      event.preventDefault();
      if (save.isPending) return;
      setFormError(null); setSavedMessage("");
      try {
        const submitted = { ...form, membershipIds: [...form.membershipIds] };
        const parsed = adminWorkBackfillSchema.safeParse({ membershipIds: submitted.membershipIds,
          startAt: zonedInputToDate(submitted.startAt, me.user.timezone).toISOString(),
          endAt: zonedInputToDate(submitted.endAt, me.user.timezone).toISOString(),
          timezone: me.user.timezone, content: submitted.content });
        if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "请检查补录内容。");
        if (new Date(parsed.data.endAt) > new Date()) throw new Error("只能补录已经结束的工作。");
        save.mutate({ input: parsed.data, submitted });
      } catch (error) { setFormError(error instanceof Error ? error : new Error("请检查补录内容。")); }
    }}>
      <fieldset disabled={save.isPending} className="admin-backfill-fields">
        <fieldset className="admin-backfill-members">
          <legend className="font-semibold">选择员工（已选 {form.membershipIds.length} 人）</legend>
          <Field label="搜索员工或部门"><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} /></Field>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" disabled={!visibleMembers.length || new Set([...form.membershipIds, ...visibleMembers.map((member) => member.membershipId)]).size > 100}
              onClick={() => setField("membershipIds", [...new Set([...form.membershipIds, ...visibleMembers.map((member) => member.membershipId)])])}>全选当前结果</Button>
            <Button type="button" variant="secondary" disabled={!form.membershipIds.length} onClick={() => setField("membershipIds", [])}>清空选择</Button>
          </div>
          {members.isPending ? <p role="status">正在读取员工…</p> : !visibleMembers.length ? <p>没有可补录的员工。</p> :
            <div className="admin-backfill-member-grid">{visibleMembers.map((member) => <label key={member.membershipId} className="admin-backfill-member">
              <input type="checkbox" checked={form.membershipIds.includes(member.membershipId)}
                disabled={!form.membershipIds.includes(member.membershipId) && form.membershipIds.length >= 100}
                onChange={(event) => setField("membershipIds", event.target.checked ? [...form.membershipIds, member.membershipId] : form.membershipIds.filter((id) => id !== member.membershipId))} />
              <span>{member.displayName}{member.orgUnitName && <small>{member.orgUnitName}</small>}</span>
            </label>)}</div>}
        </fieldset>
        <div className="admin-backfill-time-grid">
          <Field label="开始时间" hint={me.user.timezone}><input type="datetime-local" required step="60" value={form.startAt} max={toZonedInputValue(new Date(), me.user.timezone).slice(0, 16)} onChange={(event) => setField("startAt", event.target.value)} /></Field>
          <Field label="结束时间" hint={durationLabel || me.user.timezone}><input type="datetime-local" required step="60" value={form.endAt} max={toZonedInputValue(new Date(), me.user.timezone).slice(0, 16)} onChange={(event) => setField("endAt", event.target.value)} /></Field>
        </div>
        <Field label="工作内容"><textarea required rows={5} maxLength={10_000} value={form.content} onChange={(event) => setField("content", event.target.value)} /></Field>
        <ErrorMessage error={formError ?? save.error} />
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={members.isPending || members.isError || !form.membershipIds.length}>{save.isPending ? "正在补录…" : `补录并确认（${form.membershipIds.length} 人）`}</Button>
          <span className="text-sm text-[var(--text-muted)]">可补录超过十天的记录；已锁定或结算的周期需走更正流程。</span>
        </div>
      </fieldset>
    </form>
  </CardContent></Card>;
}
