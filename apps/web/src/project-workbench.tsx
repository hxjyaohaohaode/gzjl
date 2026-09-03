import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  AlertCircle,
  ArrowLeft,
  ChevronRight,
  Clock3,
  FilePenLine,
  FolderKanban,
  GitBranch,
  GitMerge,
  GripVertical,
  Layers3,
  Link2,
  ListTree,
  Plus,
  RotateCcw,
  Save,
  PencilLine,
  Trash2,
  Unlink,
  UserMinus,
  UserPlus,
  UsersRound,
} from "lucide-react";
import { lazy, Suspense, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Badge, Button, Card, CardContent, cn } from "@workbench/ui";

import { api, type Me } from "./api.js";
import {
  EmptyState,
  ErrorMessage,
  fieldClass,
  Field,
  LoadingBlock,
  PageHeader,
  textAreaClass,
} from "./pages.js";

const ProjectCanvas = lazy(() => import("./project-canvas.js"));

type ProjectView = "canvas" | "timeline" | "list";
type NodeType = "phase" | "milestone" | "task" | "deliverable" | "decision";
type ProjectProgressMode =
  | "manual"
  | "weighted_children"
  | "milestone_based";

interface Project {
  id: string;
  key: string;
  name: string;
  description: string | null;
  color: string;
  status: string;
  version: number;
  startAt: string | null;
  dueAt: string | null;
}

interface ProjectNode {
  id: string;
  branchId: string;
  parentId: string | null;
  type: NodeType;
  title: string;
  description: string | null;
  status: string;
  progress: string;
  progressMode: ProjectProgressMode;
  weight: string;
  version: number;
  sortOrder: number;
  startAt: string | null;
  dueAt: string | null;
}

interface Branch {
  id: string;
  name: string;
  description: string | null;
  isDefault: boolean;
  version?: number;
  parentBranchId?: string | null;
  sourceNodeId?: string | null;
  mergedIntoBranchId?: string | null;
  mergedAt?: string | null;
  archivedAt?: string | null;
}
interface ProjectEdge {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  type: ProjectEdgeType;
  label: string | null;
}

interface ProjectNodeAssignee {
  nodeId: string;
  membershipId: string;
  isResponsible: boolean;
  assignedAt: string;
  displayName: string;
  avatarUrl: string | null;
}

interface ProjectMember {
  membershipId: string;
  role: "lead" | "member" | "observer";
  publicActivityVisible: boolean;
  joinedAt: string;
  displayName: string;
  avatarUrl: string | null;
}

interface ProjectMemberCandidate {
  membershipId: string;
  displayName: string;
  avatarUrl: string | null;
}

interface ProjectTree {
  project: Project;
  branches: Branch[];
  nodes: ProjectNode[];
  edges: ProjectEdge[];
  nodeAssignees: ProjectNodeAssignee[];
}

type ProjectEdgeType =
  | "depends_on"
  | "blocks"
  | "relates_to"
  | "replaces"
  | "merges_into";

interface ProjectNodeVersion {
  version: number;
  snapshot: Record<string, unknown>;
  changeSummary: string | null;
  createdAt: string;
  createdBy: string;
}

function snapshotAssigneeCount(snapshot: Record<string, unknown>): number | null {
  if (!Array.isArray(snapshot.assignees)) return null;
  return snapshot.assignees.filter(
    (assignment) =>
      typeof assignment === "object" &&
      assignment !== null &&
      typeof (assignment as { membershipId?: unknown }).membershipId === "string",
  ).length;
}

interface ProjectWorkSession {
  id: string;
  membershipId: string;
  displayName: string;
  startAt: string;
  endAt: string;
  netSeconds: number;
  content: string;
  source: string;
  submissionStatus: string;
  approvalStatus: string;
  isPrimary: boolean;
}

interface RecycleBinNode {
  id: string;
  entityId: string;
  snapshot: Record<string, unknown>;
  deletedAt: string;
  restoreUntil: string | null;
}

const EMPTY_NODES: ProjectNode[] = [];
const EMPTY_EDGES: ProjectEdge[] = [];
const DAY_MS = 86_400_000;
const TIMELINE_FALLBACK_START_MS = Date.UTC(2026, 0, 1);

function nodeTypeLabel(type: NodeType): string {
  return {
    phase: "阶段",
    milestone: "里程碑",
    task: "任务",
    deliverable: "交付物",
    decision: "决策",
  }[type];
}
function nodeStatusLabel(status: string): string {
  return (
    {
      not_started: "未开始",
      in_progress: "进行中",
      blocked: "受阻",
      in_review: "待确认",
      completed: "已完成",
      cancelled: "已取消",
    }[status] ?? status
  );
}
function statusTone(
  status: string,
): "positive" | "warning" | "danger" | "info" | "neutral" {
  return status === "completed"
    ? "positive"
    : status === "blocked"
      ? "danger"
      : status === "in_progress"
        ? "info"
        : status === "in_review"
          ? "warning"
          : "neutral";
}
function formatDate(value: string | null): string {
  return value
    ? new Intl.DateTimeFormat("zh-CN", {
        month: "short",
        day: "numeric",
      }).format(new Date(value))
    : "未排期";
}

function toDateTimeLocalInput(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatProjectWorkTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatProjectWorkDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  return hours > 0 ? `${hours}小时${minutes}分` : `${minutes}分`;
}

function edgeTypeLabel(type: ProjectEdgeType): string {
  return {
    depends_on: "依赖",
    blocks: "阻塞",
    relates_to: "关联",
    replaces: "替代",
    merges_into: "合并到",
  }[type];
}

function progressModeLabel(mode: ProjectProgressMode | undefined): string {
  return (
    {
      manual: "手动进度",
      weighted_children: "按子节点权重",
      milestone_based: "按里程碑",
    }[mode ?? "manual"] ?? "手动进度"
  );
}

function projectMemberRoleLabel(role: ProjectMember["role"]): string {
  return role === "lead" ? "项目负责人" : role === "observer" ? "观察者" : "项目成员";
}

function initials(displayName: string): string {
  return displayName.trim().slice(0, 2).toLocaleUpperCase() || "成员";
}

function AssigneeAvatarGroup({
  assignees,
  className,
}: {
  assignees: ProjectNodeAssignee[];
  className?: string;
}) {
  if (!assignees.length) {
    return <span className={cn("project-assignee-empty", className)}>未分配</span>;
  }
  const visible = assignees.slice(0, 3);
  return (
    <span
      aria-label={`节点协作者：${assignees.map((assignee) => assignee.displayName).join("、")}`}
      className={cn("project-assignee-avatars", className)}
      title={assignees
        .map(
          (assignee) =>
            `${assignee.displayName}${assignee.isResponsible ? "（负责人）" : ""}`,
        )
        .join("、")}
    >
      {visible.map((assignee) =>
        assignee.avatarUrl ? (
          <img
            alt=""
            className={cn(assignee.isResponsible && "is-responsible")}
            key={assignee.membershipId}
            src={assignee.avatarUrl}
          />
        ) : (
          <span
            className={cn(assignee.isResponsible && "is-responsible")}
            key={assignee.membershipId}
          >
            {initials(assignee.displayName)}
          </span>
        ),
      )}
      {assignees.length > visible.length ? (
        <span className="project-assignee-overflow">+{assignees.length - visible.length}</span>
      ) : null}
    </span>
  );
}

function Timeline({
  nodes,
  selectedNodeId,
  onSelect,
}: {
  nodes: ProjectNode[];
  selectedNodeId: string | null;
  onSelect: (nodeId: string) => void;
}) {
  const scheduled = nodes.filter((node) => node.startAt || node.dueAt);
  const startMs = scheduled.length
    ? Math.min(
        ...scheduled.map((node) =>
          new Date(node.startAt ?? node.dueAt ?? "").getTime(),
        ),
      )
    : TIMELINE_FALLBACK_START_MS;
  const endMs = scheduled.length
    ? Math.max(
        ...scheduled.map((node) =>
          new Date(node.dueAt ?? node.startAt ?? "").getTime(),
        ),
      )
    : startMs + 6 * DAY_MS;
  const start = new Date(startMs);
  const end = new Date(endMs);
  const rangeStart = new Date(
    start.getFullYear(),
    start.getMonth(),
    start.getDate(),
  );
  const rangeEnd = new Date(
    Math.max(end.getTime(), rangeStart.getTime() + 6 * DAY_MS),
  );
  const rangeDays = Math.max(
    1,
    Math.ceil((rangeEnd.getTime() - rangeStart.getTime()) / DAY_MS) + 1,
  );
  const days = Array.from(
    { length: Math.min(rangeDays, 31) },
    (_, index) => new Date(rangeStart.getTime() + index * DAY_MS),
  );
  const offset = (date: string | null) =>
    Math.max(
      0,
      Math.min(
        100,
        ((new Date(date ?? rangeStart).getTime() - rangeStart.getTime()) /
          (rangeEnd.getTime() - rangeStart.getTime() || 1)) *
          100,
      ),
    );
  const width = (node: ProjectNode) =>
    Math.max(
      3,
      offset(node.dueAt ?? node.startAt) - offset(node.startAt ?? node.dueAt),
    );
  return (
    <div className="project-timeline">
      <div className="project-timeline-head">
        <div className="project-timeline-label">节点 / 排期</div>
        <div className="project-timeline-days">
          {days.map((day) => (
            <span key={day.toISOString()}>
              {new Intl.DateTimeFormat("zh-CN", {
                month: "numeric",
                day: "numeric",
              }).format(day)}
            </span>
          ))}
        </div>
      </div>
      <div className="project-timeline-rows">
        {nodes.map((node) => (
          <button
            aria-pressed={selectedNodeId === node.id}
            className={cn(
              "project-timeline-row",
              selectedNodeId === node.id && "is-selected",
            )}
            key={node.id}
            onClick={() => onSelect(node.id)}
            type="button"
          >
            <span className="project-timeline-node-label">
              <strong>{node.title}</strong>
              <small>
                {nodeTypeLabel(node.type)} · {nodeStatusLabel(node.status)}
              </small>
            </span>
            <span className="project-timeline-bar-space">
              {node.startAt || node.dueAt ? (
                <span
                  className="project-timeline-bar"
                  style={{
                    left: `${offset(node.startAt ?? node.dueAt)}%`,
                    width: `${width(node)}%`,
                  }}
                >
                  <span>
                    {formatDate(node.startAt)} – {formatDate(node.dueAt)}
                  </span>
                </span>
              ) : (
                <span className="project-timeline-unscheduled">未排期</span>
              )}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function TreeList({
  nodes,
  selectedNodeId,
  onSelect,
  assigneesByNodeId,
}: {
  nodes: ProjectNode[];
  selectedNodeId: string | null;
  onSelect: (nodeId: string) => void;
  assigneesByNodeId: Map<string, ProjectNodeAssignee[]>;
}) {
  const ordered = useMemo(() => {
    const result: Array<{ node: ProjectNode; depth: number }> = [];
    const visit = (parentId: string | null, depth: number) =>
      nodes
        .filter((node) => node.parentId === parentId)
        .sort((left, right) => left.sortOrder - right.sortOrder)
        .forEach((node) => {
          result.push({ node, depth });
          visit(node.id, depth + 1);
        });
    visit(null, 0);
    return result;
  }, [nodes]);
  return (
    <div className="project-tree-list project-workbench-tree-list">
      {ordered.length ? (
        ordered.map(({ node, depth }) => (
          <button
            aria-pressed={selectedNodeId === node.id}
            className={cn(
              "project-workbench-tree-row",
              selectedNodeId === node.id && "is-selected",
            )}
            key={node.id}
            onClick={() => onSelect(node.id)}
            style={{ paddingLeft: `${1 + Math.min(depth, 7) * 1.25}rem` }}
            type="button"
          >
            <span className="project-tree-kind">
              <ChevronRight size={14} />
            </span>
            <span className="min-w-0 flex-1 text-left">
              <strong>{node.title}</strong>
              <small>
                {nodeTypeLabel(node.type)} · {progressModeLabel(node.progressMode)} · v{node.version} ·{" "}
                {formatDate(node.startAt)} – {formatDate(node.dueAt)}
              </small>
            </span>
            <AssigneeAvatarGroup
              assignees={assigneesByNodeId.get(node.id) ?? []}
            />
            <Badge tone={statusTone(node.status)}>
              {nodeStatusLabel(node.status)}
            </Badge>
            <span className="project-tree-progress">
              {Number(node.progress)}%
            </span>
          </button>
        ))
      ) : (
        <EmptyState
          description="当前筛选条件下没有节点。"
          icon={<ListTree />}
          title="没有匹配节点"
        />
      )}
    </div>
  );
}

function ProjectTeamPanel({
  projectId,
  onClose,
}: {
  projectId: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [membershipId, setMembershipId] = useState("");
  const [role, setRole] = useState<ProjectMember["role"]>("member");
  const [publicActivityVisible, setPublicActivityVisible] = useState(true);
  const members = useQuery({
    queryKey: ["project-members", projectId],
    queryFn: () =>
      api<{ items: ProjectMember[] }>(`/api/projects/${projectId}/members`),
  });
  const candidates = useQuery({
    queryKey: ["project-member-candidates", projectId],
    queryFn: () =>
      api<{ items: ProjectMemberCandidate[] }>(
        `/api/projects/${projectId}/member-candidates`,
      ),
  });
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["project-members", projectId] }),
      queryClient.invalidateQueries({
        queryKey: ["project-member-candidates", projectId],
      }),
      queryClient.invalidateQueries({ queryKey: ["project-tree", projectId] }),
    ]);
  const saveMember = useMutation({
    mutationFn: ({
      targetMembershipId,
      nextRole,
      nextPublicActivityVisible,
    }: {
      targetMembershipId: string;
      nextRole: ProjectMember["role"];
      nextPublicActivityVisible: boolean;
    }) =>
      api(`/api/projects/${projectId}/members/${targetMembershipId}`, {
        method: "PUT",
        body: {
          role: nextRole,
          publicActivityVisible: nextPublicActivityVisible,
        },
      }),
    onSuccess: async () => {
      setMembershipId("");
      setRole("member");
      setPublicActivityVisible(true);
      await refresh();
    },
  });
  const removeMember = useMutation({
    mutationFn: (targetMembershipId: string) =>
      api(`/api/projects/${projectId}/members/${targetMembershipId}`, {
        method: "DELETE",
      }),
    onSuccess: refresh,
  });
  const currentMemberIds = new Set(
    (members.data?.items ?? []).map((member) => member.membershipId),
  );
  const availableCandidates = (candidates.data?.items ?? []).filter(
    (candidate) => !currentMemberIds.has(candidate.membershipId),
  );
  const hasAvailableCandidates = availableCandidates.length > 0;

  return (
    <Card className="project-team-panel">
      <CardContent>
        <div className="project-create-panel-head">
          <div>
            <p className="app-section-label">项目成员</p>
            <h2>把协作权限留在项目范围内，再分配到具体节点。</h2>
          </div>
          <Button onClick={onClose} size="compact" variant="ghost">
            关闭
          </Button>
        </div>
        <p className="project-team-panel-note">
          这是项目协作角色，不等同于组织访问权限、组织岗位或专业身份。离开项目会撤销该成员的节点分配，不会删除历史事实。
        </p>
        <div className="project-team-list">
          {members.isPending ? (
            <LoadingBlock />
          ) : members.data?.items.length ? (
            members.data.items.map((member) => (
              <div key={member.membershipId}>
                {member.avatarUrl ? (
                  <img alt="" src={member.avatarUrl} />
                ) : (
                  <span className="project-member-initials">
                    {initials(member.displayName)}
                  </span>
                )}
                <span className="min-w-0">
                  <strong>{member.displayName}</strong>
                  <small>
                    {projectMemberRoleLabel(member.role)} ·{" "}
                    {member.publicActivityVisible
                      ? "公开项目活动"
                      : "项目活动仅本人"}
                  </small>
                </span>
                <select
                  aria-label={`设置 ${member.displayName} 的项目角色`}
                  className={fieldClass}
                  disabled={saveMember.isPending}
                  onChange={(event) =>
                    saveMember.mutate({
                      targetMembershipId: member.membershipId,
                      nextRole: event.target.value as ProjectMember["role"],
                      nextPublicActivityVisible: member.publicActivityVisible,
                    })
                  }
                  value={member.role}
                >
                  <option value="lead">项目负责人</option>
                  <option value="member">项目成员</option>
                  <option value="observer">观察者</option>
                </select>
                <label className="project-team-visibility">
                  <input
                    checked={member.publicActivityVisible}
                    disabled={saveMember.isPending}
                    onChange={(event) =>
                      saveMember.mutate({
                        targetMembershipId: member.membershipId,
                        nextRole: member.role,
                        nextPublicActivityVisible: event.target.checked,
                      })
                    }
                    type="checkbox"
                  />
                  <span>公开活动</span>
                </label>
                <Button
                  aria-label={`移出项目成员 ${member.displayName}`}
                  disabled={removeMember.isPending}
                  onClick={() => {
                    if (
                      window.confirm(
                        `将“${member.displayName}”移出项目吗？其当前节点分配会一并撤销，历史记录仍会保留。`,
                      )
                    ) {
                      removeMember.mutate(member.membershipId);
                    }
                  }}
                  size="compact"
                  variant="ghost"
                >
                  <UserMinus size={14} />
                  移出
                </Button>
              </div>
            ))
          ) : (
            <p className="text-xs text-[var(--text-muted)]">尚未加入项目成员。</p>
          )}
        </div>
        <form
          className="project-team-add-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (
              !membershipId ||
              !availableCandidates.some(
                (candidate) => candidate.membershipId === membershipId,
              )
            )
              return;
            saveMember.mutate({
              targetMembershipId: membershipId,
              nextRole: role,
              nextPublicActivityVisible: publicActivityVisible,
            });
          }}
        >
          <Field label="加入组织成员">
            <select
              className={fieldClass}
              disabled={candidates.isPending || !hasAvailableCandidates}
              onChange={(event) => setMembershipId(event.target.value)}
              required={hasAvailableCandidates}
              value={membershipId}
            >
              <option value="">
                {candidates.isPending
                  ? "正在读取可加入成员…"
                  : hasAvailableCandidates
                    ? "选择成员"
                    : "暂无可加入成员"}
              </option>
              {availableCandidates.map((candidate) => (
                <option key={candidate.membershipId} value={candidate.membershipId}>
                  {candidate.displayName}
                </option>
              ))}
            </select>
          </Field>
          {!candidates.isPending &&
          !candidates.isError &&
          !hasAvailableCandidates ? (
            <p className="text-xs leading-5 text-[var(--text-muted)]" role="status">
              当前组织中没有可加入该项目的成员；现有成员已经全部加入，或请先在组织页完成白名单邀请。
            </p>
          ) : null}
          <Field label="项目角色">
            <select
              className={fieldClass}
              onChange={(event) =>
                setRole(event.target.value as ProjectMember["role"])
              }
              value={role}
            >
              <option value="lead">项目负责人</option>
              <option value="member">项目成员</option>
              <option value="observer">观察者</option>
            </select>
          </Field>
          <label className="project-team-visibility">
            <input
              checked={publicActivityVisible}
              onChange={(event) => setPublicActivityVisible(event.target.checked)}
              type="checkbox"
            />
            <span>允许同项目成员看到公开工作动态</span>
          </label>
          <Button
            disabled={
              saveMember.isPending || !membershipId || !hasAvailableCandidates
            }
            size="compact"
            type="submit"
          >
            <UserPlus size={15} />
            {saveMember.isPending ? "正在加入…" : "加入项目"}
          </Button>
        </form>
        <ErrorMessage error={members.error ?? candidates.error ?? saveMember.error ?? removeMember.error} />
      </CardContent>
    </Card>
  );
}

function NodeInspectorContent({
  node,
  nodes,
  assignees,
  projectId,
  canManage,
  onClose,
  onOpenRecycle,
}: {
  node: ProjectNode;
  nodes: ProjectNode[];
  assignees: ProjectNodeAssignee[];
  projectId: string;
  canManage: boolean;
  onClose: () => void;
  onOpenRecycle?: () => void;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    title: node.title,
    description: node.description ?? "",
    status: node.status,
    progress: String(node.progress),
    progressMode: node.progressMode ?? "manual",
    weight: String(node.weight ?? "1"),
    startAt: toDateTimeLocalInput(node.startAt),
    dueAt: toDateTimeLocalInput(node.dueAt),
    changeSummary: "更新项目节点",
  });
  const [assignedMembershipIds, setAssignedMembershipIds] = useState(
    assignees.map((assignee) => assignee.membershipId),
  );
  const [responsibleMembershipId, setResponsibleMembershipId] = useState(
    assignees.find((assignee) => assignee.isResponsible)?.membershipId ?? "",
  );
  const [move, setMove] = useState({
    parentId: node.parentId ?? "",
    sortOrder: String(node.sortOrder),
  });
  const [relation, setRelation] = useState<{
    targetNodeId: string;
    type: ProjectEdgeType;
    label: string;
  }>({ targetNodeId: "", type: "relates_to", label: "" });
  const history = useQuery({
    queryKey: ["project-node-versions", projectId, node.id],
    queryFn: () =>
      api<{ items: ProjectNodeVersion[] }>(
        `/api/projects/${projectId}/nodes/${node.id}/versions`,
      ),
  });
  const linkedWork = useQuery({
    queryKey: ["project-node-work-sessions", projectId, node.id],
    queryFn: () =>
      api<{ items: ProjectWorkSession[] }>(
        `/api/projects/${projectId}/nodes/${node.id}/work-sessions`,
      ),
  });
  const projectTree = useQuery({
    queryKey: ["project-tree", projectId],
    queryFn: () =>
      api<{ edges: ProjectEdge[] }>(`/api/projects/${projectId}/tree`),
  });
  const projectMembers = useQuery({
    queryKey: ["project-members", projectId],
    queryFn: () =>
      api<{ items: ProjectMember[] }>(`/api/projects/${projectId}/members`),
    enabled: canManage,
  });
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["project-tree", projectId] });
  const refreshHistory = () =>
    queryClient.invalidateQueries({
      queryKey: ["project-node-versions", projectId, node.id],
    });
  const update = useMutation({
    mutationFn: () =>
      api(`/api/projects/${projectId}/nodes/${node.id}`, {
        method: "PATCH",
        body: {
          expectedVersion: node.version,
          title: form.title,
          description: form.description.trim() || null,
          status: form.status,
          progress:
            form.progressMode === "manual" ? Number(form.progress) : undefined,
          progressMode: form.progressMode,
          weight: Number(form.weight),
          startAt: form.startAt ? new Date(form.startAt).toISOString() : null,
          dueAt: form.dueAt ? new Date(form.dueAt).toISOString() : null,
          changeSummary: form.changeSummary,
        },
      }),
    onSuccess: refresh,
  });
  const updateAssignees = useMutation({
    mutationFn: () =>
      api(`/api/projects/${projectId}/nodes/${node.id}/assignees`, {
        method: "PUT",
        body: {
          expectedVersion: node.version,
          assignments: assignedMembershipIds.map((membershipId) => ({
            membershipId,
            isResponsible: responsibleMembershipId === membershipId,
          })),
        },
      }),
    onSuccess: refresh,
  });
  const moveNode = useMutation({
    mutationFn: () =>
      api(`/api/projects/${projectId}/nodes/${node.id}/move`, {
        method: "POST",
        body: {
          expectedVersion: node.version,
          parentId: move.parentId || null,
          sortOrder: Number(move.sortOrder),
        },
      }),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: () =>
      api(`/api/projects/${projectId}/nodes/${node.id}`, {
        method: "DELETE",
        body: { expectedVersion: node.version },
      }),
    onSuccess: async () => {
      await refresh();
      onClose();
    },
  });
  const createRelation = useMutation({
    mutationFn: () =>
      api(`/api/projects/${projectId}/edges`, {
        method: "POST",
        body: {
          sourceNodeId: node.id,
          targetNodeId: relation.targetNodeId,
          type: relation.type,
          label: relation.label.trim() || undefined,
        },
      }),
    onSuccess: async () => {
      setRelation((current) => ({ ...current, targetNodeId: "", label: "" }));
      await refresh();
    },
  });
  const deleteRelation = useMutation({
    mutationFn: (edgeId: string) =>
      api(`/api/projects/${projectId}/edges/${edgeId}`, { method: "DELETE" }),
    onSuccess: refresh,
  });
  const rollback = useMutation({
    mutationFn: (targetVersion: number) =>
      api(`/api/projects/${projectId}/nodes/${node.id}/rollback`, {
        method: "POST",
        body: { expectedVersion: node.version, targetVersion },
      }),
    onSuccess: async () => {
      await Promise.all([refresh(), refreshHistory()]);
    },
  });
  const invalidParentIds = useMemo(() => {
    const children = new Map<string, string[]>();
    nodes.forEach((item) =>
      children.set(item.parentId ?? "", [
        ...(children.get(item.parentId ?? "") ?? []),
        item.id,
      ]),
    );
    const descendants = new Set<string>([node.id]);
    const collect = (id: string) =>
      (children.get(id) ?? []).forEach((child) => {
        descendants.add(child);
        collect(child);
      });
    collect(node.id);
    return descendants;
  }, [node.id, nodes]);
  const relatedEdges = (projectTree.data?.edges ?? []).reduce<
    Array<{
      edge: ProjectEdge;
      direction: "outgoing" | "incoming";
      otherNodeId: string;
    }>
  >((rows, edge) => {
    if (edge.sourceNodeId === node.id)
      rows.push({
        edge,
        direction: "outgoing",
        otherNodeId: edge.targetNodeId,
      });
    if (edge.targetNodeId === node.id)
      rows.push({
        edge,
        direction: "incoming",
        otherNodeId: edge.sourceNodeId,
      });
    return rows;
  }, []);
  return (
    <aside
      aria-label={`${node.title} 节点详情`}
      className="project-node-inspector"
    >
      <div className="project-node-inspector-head">
        <div>
          <p className="app-section-label">节点详情</p>
          <h2>{node.title}</h2>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {canManage && onOpenRecycle ? (
            <Button
              aria-label="打开项目回收站"
              onClick={onOpenRecycle}
              size="compact"
              variant="ghost"
            >
              <Trash2 size={14} />
              回收站
            </Button>
          ) : null}
          <Button onClick={onClose} size="compact" variant="ghost">
            关闭
          </Button>
        </div>
      </div>
      <div className="project-node-inspector-scroll">
        <section>
          <div className="project-node-readout">
            <Badge tone={statusTone(node.status)}>
              {nodeStatusLabel(node.status)}
            </Badge>
            <span>
              {nodeTypeLabel(node.type)} · 版本 {node.version}
            </span>
            <span>
              排期：{formatDate(node.startAt)} – {formatDate(node.dueAt)}
            </span>
            <span>
              进度：{Number(node.progress)}% · {progressModeLabel(node.progressMode)}
            </span>
          </div>
        </section>
        <section className="project-inspector-section">
          <p className="app-section-label">协作者与负责人</p>
          <div className="project-node-assignee-readout">
            <AssigneeAvatarGroup assignees={assignees} />
            <span>
              {assignees.length
                ? assignees
                    .map(
                      (assignee) =>
                        `${assignee.displayName}${assignee.isResponsible ? "（负责人）" : ""}`,
                    )
                    .join("、")
                : "尚未分配协作者"}
            </span>
          </div>
          {canManage ? (
            <div className="project-assignment-editor">
              <p>
                仅可分配当前项目成员；一名节点最多指定一位主要负责人。调整会写入节点版本与审计。
              </p>
              {projectMembers.isPending ? (
                <p className="text-xs text-[var(--text-muted)]">
                  正在读取项目成员…
                </p>
              ) : projectMembers.data?.items.length ? (
                <div className="project-assignment-list">
                  {projectMembers.data.items.map((member) => {
                    const assigned = assignedMembershipIds.includes(
                      member.membershipId,
                    );
                    return (
                      <label key={member.membershipId}>
                        <input
                          checked={assigned}
                          onChange={(event) => {
                            if (event.target.checked) {
                              setAssignedMembershipIds((current) => [
                                ...new Set([...current, member.membershipId]),
                              ]);
                            } else {
                              setAssignedMembershipIds((current) =>
                                current.filter(
                                  (membershipId) =>
                                    membershipId !== member.membershipId,
                                ),
                              );
                              if (
                                responsibleMembershipId === member.membershipId
                              ) {
                                setResponsibleMembershipId("");
                              }
                            }
                          }}
                          type="checkbox"
                        />
                        {member.avatarUrl ? (
                          <img alt="" src={member.avatarUrl} />
                        ) : (
                          <span className="project-member-initials">
                            {initials(member.displayName)}
                          </span>
                        )}
                        <span>
                          <strong>{member.displayName}</strong>
                          <small>
                            {member.role === "lead"
                              ? "项目负责人"
                              : member.role === "observer"
                                ? "观察者"
                                : "项目成员"}
                          </small>
                        </span>
                        <input
                          aria-label={`指定 ${member.displayName} 为节点负责人`}
                          checked={
                            assigned &&
                            responsibleMembershipId === member.membershipId
                          }
                          disabled={!assigned}
                          name={`node-responsible-${node.id}`}
                          onChange={() =>
                            setResponsibleMembershipId(member.membershipId)
                          }
                          type="radio"
                        />
                      </label>
                    );
                  })}
                </div>
              ) : (
                <p className="text-xs leading-5 text-[var(--text-muted)]">
                  当前项目还没有可分配成员。先在“团队成员”中加入协作者。
                </p>
              )}
              <Button
                disabled={updateAssignees.isPending || projectMembers.isPending}
                onClick={() => updateAssignees.mutate()}
                size="compact"
                variant="secondary"
              >
                <Save size={14} />
                {updateAssignees.isPending ? "正在保存…" : "保存负责人分配"}
              </Button>
            </div>
          ) : null}
        </section>
        <section className="project-inspector-section">
          <p className="app-section-label">关联工作记录</p>
          <p className="mt-2 text-xs leading-5 text-[var(--text-muted)]">
            仅显示本人记录和标记为“项目成员可见”的事实记录；辅助关联不会重复汇总时长。
          </p>
          {linkedWork.isPending ? (
            <p className="mt-3 text-xs text-[var(--text-muted)]">
              正在读取关联工作…
            </p>
          ) : linkedWork.data?.items.length ? (
            <div className="project-version-history">
              {linkedWork.data.items.map((session) => (
                <div key={session.id}>
                  <span>
                    <strong>{session.content}</strong>
                    <small>
                      {session.displayName} ·{" "}
                      {formatProjectWorkTime(session.startAt)} ·{" "}
                      {formatProjectWorkDuration(session.netSeconds)} ·{" "}
                      {session.source === "timer" ? "计时" : "手工"}
                    </small>
                  </span>
                  <Badge tone={session.isPrimary ? "info" : "neutral"}>
                    {session.isPrimary ? "主关联" : "辅助关联"}
                  </Badge>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-3 text-xs text-[var(--text-muted)]">
              暂无你有权查看的关联工作记录。
            </p>
          )}
        </section>
        {canManage ? (
          <>
            <section className="project-inspector-section">
              <p className="app-section-label">内容与状态</p>
              <div className="mt-3 grid gap-3">
                <Field label="标题">
                  <input
                    className={fieldClass}
                    maxLength={300}
                    onChange={(event) =>
                      setForm({ ...form, title: event.target.value })
                    }
                    value={form.title}
                  />
                </Field>
                <Field label="节点说明">
                  <textarea
                    className={textAreaClass}
                    maxLength={20000}
                    onChange={(event) =>
                      setForm({ ...form, description: event.target.value })
                    }
                    value={form.description}
                  />
                </Field>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="状态">
                    <select
                      className={fieldClass}
                      onChange={(event) =>
                        setForm({ ...form, status: event.target.value })
                      }
                      value={form.status}
                    >
                      {[
                        "not_started",
                        "in_progress",
                        "blocked",
                        "in_review",
                        "completed",
                        "cancelled",
                      ].map((status) => (
                        <option key={status} value={status}>
                          {nodeStatusLabel(status)}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="进度计算">
                    <select
                      className={fieldClass}
                      onChange={(event) =>
                        setForm({
                          ...form,
                          progressMode: event.target.value as ProjectProgressMode,
                        })
                      }
                      value={form.progressMode}
                    >
                      <option value="manual">手动填写</option>
                      <option value="weighted_children">按子节点权重汇总</option>
                      <option value="milestone_based">按里程碑汇总</option>
                    </select>
                  </Field>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field
                    hint={
                      form.progressMode === "manual"
                        ? "0–100；手动模式由负责人确认。"
                        : "自动模式只读，保存后由服务端按事实重新计算。"
                    }
                    label="进度"
                  >
                    <input
                      className={fieldClass}
                      disabled={form.progressMode !== "manual"}
                      max="100"
                      min="0"
                      onChange={(event) =>
                        setForm({ ...form, progress: event.target.value })
                      }
                      type="number"
                      value={form.progress}
                    />
                  </Field>
                  <Field
                    hint="用于上级的“按子节点权重”进度汇总；设为 0 时不参与加权。"
                    label="节点权重"
                  >
                    <input
                      className={fieldClass}
                      min="0"
                      onChange={(event) =>
                        setForm({ ...form, weight: event.target.value })
                      }
                      step="0.01"
                      type="number"
                      value={form.weight}
                    />
                  </Field>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="开始时间">
                    <input
                      className={fieldClass}
                      onChange={(event) =>
                        setForm({ ...form, startAt: event.target.value })
                      }
                      type="datetime-local"
                      value={form.startAt}
                    />
                  </Field>
                  <Field label="截止时间">
                    <input
                      className={fieldClass}
                      onChange={(event) =>
                        setForm({ ...form, dueAt: event.target.value })
                      }
                      type="datetime-local"
                      value={form.dueAt}
                    />
                  </Field>
                </div>
                <Field
                  hint="每次改动会写入节点版本与活动轨迹。"
                  label="变更说明"
                >
                  <input
                    className={fieldClass}
                    maxLength={500}
                    minLength={2}
                    onChange={(event) =>
                      setForm({ ...form, changeSummary: event.target.value })
                    }
                    required
                    value={form.changeSummary}
                  />
                </Field>
                <Button
                  disabled={
                    update.isPending ||
                    !form.title.trim() ||
                    !form.changeSummary.trim()
                  }
                  onClick={() => update.mutate()}
                  variant="secondary"
                >
                  <Save size={16} />
                  保存节点版本
                </Button>
              </div>
            </section>
            <section className="project-inspector-section">
              <p className="app-section-label">节点关联</p>
              <p className="mt-2 text-xs leading-5 text-[var(--text-muted)]">
                当前节点作为关系起点；依赖和阻塞关系会阻止形成循环，关联变更同样写入项目活动轨迹。
              </p>
              <div className="mt-3 grid gap-3">
                <Field label="关系类型">
                  <select
                    className={fieldClass}
                    onChange={(event) =>
                      setRelation({
                        ...relation,
                        type: event.target.value as ProjectEdgeType,
                      })
                    }
                    value={relation.type}
                  >
                    {(
                      [
                        "depends_on",
                        "blocks",
                        "relates_to",
                        "replaces",
                        "merges_into",
                      ] as ProjectEdgeType[]
                    ).map((type) => (
                      <option key={type} value={type}>
                        {edgeTypeLabel(type)}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="关联到节点">
                  <select
                    className={fieldClass}
                    onChange={(event) =>
                      setRelation({
                        ...relation,
                        targetNodeId: event.target.value,
                      })
                    }
                    value={relation.targetNodeId}
                  >
                    <option value="">选择目标节点</option>
                    {nodes
                      .filter((candidate) => candidate.id !== node.id)
                      .map((candidate) => (
                        <option key={candidate.id} value={candidate.id}>
                          {candidate.title}
                        </option>
                      ))}
                  </select>
                </Field>
                <Field hint="可选，最多 160 字。" label="关系说明">
                  <input
                    className={fieldClass}
                    maxLength={160}
                    onChange={(event) =>
                      setRelation({ ...relation, label: event.target.value })
                    }
                    placeholder="例如：完成后才可开始"
                    value={relation.label}
                  />
                </Field>
                <Button
                  disabled={createRelation.isPending || !relation.targetNodeId}
                  onClick={() => createRelation.mutate()}
                  size="compact"
                  variant="secondary"
                >
                  <Link2 size={15} />
                  创建节点关联
                </Button>
              </div>
              {relatedEdges.length ? (
                <div className="project-relation-list">
                  {relatedEdges.map(({ edge, direction, otherNodeId }) => {
                    const otherNode = nodes.find(
                      (candidate) => candidate.id === otherNodeId,
                    );
                    return (
                      <div key={edge.id}>
                        <span>
                          {direction === "outgoing" ? "→" : "←"}{" "}
                          {edgeTypeLabel(edge.type)} ·{" "}
                          {otherNode?.title ?? "已不可用节点"}
                        </span>
                        {edge.label ? <small>{edge.label}</small> : null}
                        <Button
                          aria-label={`删除 ${edgeTypeLabel(edge.type)} 关联`}
                          disabled={deleteRelation.isPending}
                          onClick={() => deleteRelation.mutate(edge.id)}
                          size="compact"
                          variant="ghost"
                        >
                          <Unlink size={14} />
                        </Button>
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </section>
            <section className="project-inspector-section">
              <p className="app-section-label">版本历史与回滚</p>
              <p className="mt-2 text-xs leading-5 text-[var(--text-muted)]">
                回滚会生成一个新版本，不会抹除历史版本或活动记录；新版同时保存当时的协作分配，已离开项目的成员不会被重新加入。
              </p>
              {history.isPending ? (
                <p className="mt-3 text-xs text-[var(--text-muted)]">
                  正在读取版本历史…
                </p>
              ) : history.data?.items.length ? (
                <div className="project-version-history">
                  {history.data.items.map((version) => {
                    const title =
                      typeof version.snapshot.title === "string"
                        ? version.snapshot.title
                        : node.title;
                    const assigneeCount = snapshotAssigneeCount(version.snapshot);
                    return (
                      <div key={version.version}>
                        <span>
                          <strong>
                            v{version.version} · {title}
                          </strong>
                          <small>
                            {version.changeSummary || "未提供变更说明"} ·{" "}
                            {new Intl.DateTimeFormat("zh-CN", {
                              month: "numeric",
                              day: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            }).format(new Date(version.createdAt))}
                            {assigneeCount === null
                              ? ""
                              : ` · ${assigneeCount} 位协作者`}
                          </small>
                        </span>
                        {version.version === node.version ? (
                          <Badge tone="info">当前</Badge>
                        ) : (
                          <Button
                            disabled={rollback.isPending}
                            onClick={() => {
                              if (
                                window.confirm(
                                  `确定回滚“${node.title}”到 v${version.version} 吗？系统会创建一个新的版本。`,
                                )
                              )
                                rollback.mutate(version.version);
                            }}
                            size="compact"
                            variant="ghost"
                          >
                            <RotateCcw size={14} />
                            回滚
                          </Button>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="mt-3 text-xs text-[var(--text-muted)]">
                  尚未找到可展示的历史版本。
                </p>
              )}
            </section>
            <section className="project-inspector-section">
              <p className="app-section-label">层级与排序</p>
              <div className="mt-3 grid gap-3">
                <Field label="上级节点">
                  <select
                    className={fieldClass}
                    onChange={(event) =>
                      setMove({ ...move, parentId: event.target.value })
                    }
                    value={move.parentId}
                  >
                    <option value="">顶层节点</option>
                    {nodes
                      .filter(
                        (candidate) => !invalidParentIds.has(candidate.id),
                      )
                      .map((candidate) => (
                        <option key={candidate.id} value={candidate.id}>
                          {candidate.title}
                        </option>
                      ))}
                  </select>
                </Field>
                <Field label="同级排序">
                  <input
                    className={fieldClass}
                    min="0"
                    onChange={(event) =>
                      setMove({ ...move, sortOrder: event.target.value })
                    }
                    type="number"
                    value={move.sortOrder}
                  />
                </Field>
                <Button
                  disabled={moveNode.isPending}
                  onClick={() => moveNode.mutate()}
                  size="compact"
                  variant="secondary"
                >
                  <GripVertical size={15} />
                  移动节点
                </Button>
              </div>
            </section>
            <section className="project-inspector-section">
              <p className="app-section-label">安全操作</p>
              <p className="mt-2 text-xs leading-5 text-[var(--text-muted)]">
                删除进入项目回收站并保留活动轨迹；后端会阻止不安全的结构操作。
              </p>
              <Button
                className="mt-3"
                disabled={remove.isPending}
                onClick={() => {
                  if (window.confirm(`确定将“${node.title}”移入回收站吗？`))
                    remove.mutate();
                }}
                size="compact"
                variant="ghost"
              >
                <Trash2 size={15} />
                移入回收站
              </Button>
            </section>
          </>
        ) : (
          <p className="mt-5 text-sm leading-6 text-[var(--text-muted)]">
            你拥有查看权限；节点修改仍受项目范围授权控制。
          </p>
        )}
        <ErrorMessage
          error={
            update.error ??
            moveNode.error ??
            remove.error ??
            createRelation.error ??
            deleteRelation.error ??
            rollback.error ??
            updateAssignees.error ??
            history.error ??
            linkedWork.error
          }
        />
      </div>
    </aside>
  );
}

function NodeInspector({
  node,
  nodes,
  assignees,
  projectId,
  canManage,
  onClose,
  onOpenRecycle,
}: {
  node: ProjectNode;
  nodes: ProjectNode[];
  assignees: ProjectNodeAssignee[];
  projectId: string;
  canManage: boolean;
  onClose: () => void;
  onOpenRecycle?: () => void;
}) {
  return (
    <NodeInspectorContent
      canManage={canManage}
      key={`${node.id}-${node.version}`}
      node={node}
      nodes={nodes}
      assignees={assignees}
      onClose={onClose}
      {...(onOpenRecycle ? { onOpenRecycle } : {})}
      projectId={projectId}
    />
  );
}

export function ProjectDetailPage({ me }: { me: Me }) {
  const { projectId = "" } = useParams();
  const queryClient = useQueryClient();
  const [view, setView] = useState<ProjectView>("canvas");
  const [branchId, setBranchId] = useState("all");
  const [search, setSearch] = useState("");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showTeam, setShowTeam] = useState(false);
  const [showBranch, setShowBranch] = useState(false);
  const [showBranchManager, setShowBranchManager] = useState(false);
  const [showRecycle, setShowRecycle] = useState(false);
  const [nodeForm, setNodeForm] = useState({
    parentId: "",
    branchId: "",
    type: "task" as NodeType,
    title: "",
    description: "",
    progress: "0",
    progressMode: "manual" as ProjectProgressMode,
    weight: "1",
    startAt: "",
    dueAt: "",
  });
  const [branchName, setBranchName] = useState("");
  const [branchEditor, setBranchEditor] = useState<Branch | null>(null);
  const [branchEditForm, setBranchEditForm] = useState({
    name: "",
    description: "",
  });
  const [mergeSourceBranchId, setMergeSourceBranchId] = useState<string | null>(
    null,
  );
  const [mergeTargetBranchId, setMergeTargetBranchId] = useState("");
  const tree = useQuery({
    queryKey: ["project-tree", projectId],
    queryFn: () =>
      api<ProjectTree>(`/api/projects/${projectId}/tree`),
  });
  const branches = tree.data?.branches ?? [];
  const activeBranches = branches.filter((branch) => !branch.archivedAt);
  const archivedBranches = branches.filter((branch) => branch.archivedAt);
  const canManage = me.permissions.some(
    (grant) =>
      grant.permission === "project.manage" &&
      (grant.scopeKind === "organization" || grant.scopeId === projectId),
  );
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["project-tree", projectId] });
  const recycleBin = useQuery({
    queryKey: ["project-recycle-bin", projectId],
    queryFn: () =>
      api<{ items: RecycleBinNode[] }>(
        `/api/projects/${projectId}/recycle-bin`,
      ),
    enabled: canManage && showRecycle,
  });
  const restoreRecycleNode = useMutation({
    mutationFn: (nodeId: string) =>
      api(`/api/projects/${projectId}/nodes/${nodeId}/restore`, {
        method: "POST",
      }),
    onSuccess: async () => {
      await Promise.all([
        refresh(),
        queryClient.invalidateQueries({
          queryKey: ["project-recycle-bin", projectId],
        }),
      ]);
    },
  });
  const createNode = useMutation({
    mutationFn: () => {
      const defaultBranch =
        activeBranches.find((branch) => branch.isDefault) ?? activeBranches[0];
      const branch = nodeForm.branchId || defaultBranch?.id;
      if (!branch) throw new Error("该项目没有可写入的分支。");
      return api(`/api/projects/${projectId}/nodes`, {
        method: "POST",
        body: {
          branchId: branch,
          parentId: nodeForm.parentId || null,
          type: nodeForm.type,
          title: nodeForm.title,
          description: nodeForm.description.trim() || undefined,
          progress:
            nodeForm.progressMode === "manual"
              ? Number(nodeForm.progress)
              : undefined,
          progressMode: nodeForm.progressMode,
          weight: Number(nodeForm.weight),
          startAt: nodeForm.startAt
            ? new Date(nodeForm.startAt).toISOString()
            : undefined,
          dueAt: nodeForm.dueAt
            ? new Date(nodeForm.dueAt).toISOString()
            : undefined,
          sortOrder: tree.data?.nodes.length ?? 0,
        },
      });
    },
    onSuccess: async () => {
      setShowCreate(false);
      setNodeForm((current) => ({
        ...current,
        title: "",
        description: "",
        progress: "0",
        progressMode: "manual",
        weight: "1",
        startAt: "",
        dueAt: "",
      }));
      await refresh();
    },
  });
  const createBranch = useMutation({
    mutationFn: () =>
      api(`/api/projects/${projectId}/branches`, {
        method: "POST",
        body: {
          name: branchName,
          parentBranchId: activeBranches.find((branch) => branch.isDefault)?.id,
          sourceNodeId: selectedNodeId ?? undefined,
        },
      }),
    onSuccess: async () => {
      setShowBranch(false);
      setBranchName("");
      await refresh();
    },
  });
  const updateBranch = useMutation({
    mutationFn: ({
      branch,
      name,
      description,
    }: {
      branch: Branch;
      name: string;
      description: string;
    }) =>
      api(`/api/projects/${projectId}/branches/${branch.id}`, {
        method: "PATCH",
        body: {
          expectedVersion: branch.version ?? 1,
          name,
          description: description.trim() || null,
          changeSummary: "更新分支信息",
        },
      }),
    onSuccess: async () => {
      setBranchEditor(null);
      await refresh();
    },
  });
  const archiveBranch = useMutation({
    mutationFn: (branch: Branch) =>
      api(`/api/projects/${projectId}/branches/${branch.id}/archive`, {
        method: "POST",
        body: { expectedVersion: branch.version ?? 1 },
      }),
    onSuccess: async (_, branch) => {
      if (branchId === branch.id) setBranchId("all");
      if (mergeSourceBranchId === branch.id) setMergeSourceBranchId(null);
      setSelectedNodeId(null);
      await refresh();
    },
  });
  const restoreBranch = useMutation({
    mutationFn: (branch: Branch) =>
      api(`/api/projects/${projectId}/branches/${branch.id}/restore`, {
        method: "POST",
        body: { expectedVersion: branch.version ?? 1 },
      }),
    onSuccess: refresh,
  });
  const mergeBranch = useMutation({
    mutationFn: ({
      branch,
      targetBranchId,
    }: {
      branch: Branch;
      targetBranchId: string;
    }) =>
      api(`/api/projects/${projectId}/branches/${branch.id}/merge`, {
        method: "POST",
        body: {
          expectedVersion: branch.version ?? 1,
          targetBranchId,
        },
      }),
    onSuccess: async (_, { branch }) => {
      if (branchId === branch.id) setBranchId("all");
      setMergeSourceBranchId(null);
      setMergeTargetBranchId("");
      setSelectedNodeId(null);
      await refresh();
    },
  });
  const allNodes = tree.data?.nodes ?? EMPTY_NODES;
  const visibleNodes = useMemo(
    () =>
      allNodes.filter((node) => {
        const matchesBranch = branchId === "all" || node.branchId === branchId;
        const keyword = search.trim().toLocaleLowerCase();
        const matchesSearch =
          !keyword ||
          [node.title, node.type, node.status, node.description ?? ""].some(
            (value) => value.toLocaleLowerCase().includes(keyword),
          );
        return matchesBranch && matchesSearch;
      }),
    [allNodes, branchId, search],
  );
  const visibleNodeIds = new Set(visibleNodes.map((node) => node.id));
  const visibleEdges = (tree.data?.edges ?? EMPTY_EDGES).filter(
    (edge) =>
      visibleNodeIds.has(edge.sourceNodeId) &&
      visibleNodeIds.has(edge.targetNodeId),
  );
  const assigneesByNodeId = useMemo(() => {
    const assignments = new Map<string, ProjectNodeAssignee[]>();
    (tree.data?.nodeAssignees ?? []).forEach((assignee) => {
      assignments.set(assignee.nodeId, [
        ...(assignments.get(assignee.nodeId) ?? []),
        assignee,
      ]);
    });
    return assignments;
  }, [tree.data?.nodeAssignees]);
  const visibleCanvasNodes = useMemo(
    () =>
      visibleNodes.map((node) => ({
        ...node,
        assignees: assigneesByNodeId.get(node.id) ?? [],
      })),
    [assigneesByNodeId, visibleNodes],
  );
  const selected = allNodes.find((node) => node.id === selectedNodeId) ?? null;

  if (tree.isPending)
    return (
      <Card>
        <LoadingBlock />
      </Card>
    );
  if (tree.isError || !tree.data)
    return (
      <Card>
        <EmptyState
          description={tree.error?.message ?? "项目不存在或没有访问权限。"}
          icon={<AlertCircle />}
          title="无法打开项目"
        />
      </Card>
    );
  return (
    <>
      <PageHeader
        title={tree.data.project.name}
        description={`${tree.data.project.key} · ${activeBranches.length} 个活跃分支${archivedBranches.length ? ` · ${archivedBranches.length} 个已归档` : ""} · ${allNodes.length} 个有效节点。画布、列表和时间轴都指向同一套版本化项目事实。`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link to="/projects">
              <Button size="compact" variant="secondary">
                <ArrowLeft size={15} />
                项目列表
              </Button>
            </Link>
            {canManage ? (
              <>
                <Button
                  aria-expanded={showTeam}
                  onClick={() => setShowTeam((value) => !value)}
                  size="compact"
                  variant="secondary"
                >
                  <UsersRound size={15} />
                  团队成员
                </Button>
                <Button
                  aria-expanded={showRecycle}
                  onClick={() => {
                    setShowRecycle((value) => !value);
                    setSelectedNodeId(null);
                  }}
                  size="compact"
                  variant="secondary"
                >
                  <Trash2 size={15} />
                  回收站
                </Button>
                <Button
                  onClick={() => {
                    setNodeForm((current) => ({
                      ...current,
                      parentId: selectedNodeId ?? "",
                      branchId:
                        branchId === "all"
                          ? (activeBranches.find((branch) => branch.isDefault)
                              ?.id ?? "")
                          : branchId,
                    }));
                    setShowCreate((value) => !value);
                  }}
                  size="compact"
                >
                  <Plus size={16} />
                  新建节点
                </Button>
              </>
            ) : null}
          </div>
        }
      />
      <div className={cn("project-workbench", selected && "has-inspector")}>
        <main className="project-workbench-main">
          <div className="project-workbench-toolbar">
            <div className="project-view-tabs">
              {(
                [
                  ["canvas", "结构画布", Layers3],
                  ["timeline", "时间轴", Clock3],
                  ["list", "列表", ListTree],
                ] as const
              ).map(([value, label, Icon]) => (
                <Button
                  aria-pressed={view === value}
                  key={value}
                  onClick={() => setView(value)}
                  size="compact"
                  variant={view === value ? "primary" : "secondary"}
                >
                  <Icon size={14} />
                  {label}
                </Button>
              ))}
            </div>
            <div className="project-toolbar-controls">
              <select
                aria-label="项目分支"
                className={fieldClass}
                onChange={(event) => setBranchId(event.target.value)}
                value={branchId}
              >
                <option value="all">全部分支</option>
                {activeBranches.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.isDefault ? "主线 · " : "分支 · "}
                    {branch.name}
                  </option>
                ))}
              </select>
              <input
                aria-label="搜索项目节点"
                className={fieldClass}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="搜索节点、类型或状态"
                value={search}
              />
              {canManage ? (
                <>
                  <Button
                    aria-expanded={showBranchManager}
                    aria-label="管理项目分支"
                    onClick={() => setShowBranchManager((value) => !value)}
                    size="compact"
                    variant="secondary"
                  >
                    <GitMerge size={15} />
                    管理分支
                  </Button>
                  <Button
                    aria-label="从当前节点创建分支"
                    onClick={() => setShowBranch((value) => !value)}
                    size="compact"
                    variant="secondary"
                  >
                    <GitBranch size={15} />
                    新分支
                  </Button>
                </>
              ) : null}
            </div>
          </div>
          {showCreate && canManage ? (
            <Card className="project-create-panel">
              <CardContent>
                <div className="project-create-panel-head">
                  <div>
                    <p className="app-section-label">新增节点</p>
                    <h2>将新的项目事实放进正确的分支、层级与时间范围。</h2>
                  </div>
                  <Button
                    onClick={() => setShowCreate(false)}
                    size="compact"
                    variant="ghost"
                  >
                    关闭
                  </Button>
                </div>
                <form
                  className="project-create-grid"
                  onSubmit={(event) => {
                    event.preventDefault();
                    createNode.mutate();
                  }}
                >
                  <Field label="节点标题">
                    <input
                      className={fieldClass}
                      maxLength={300}
                      onChange={(event) =>
                        setNodeForm({ ...nodeForm, title: event.target.value })
                      }
                      required
                      value={nodeForm.title}
                    />
                  </Field>
                  <Field label="节点类型">
                    <select
                      className={fieldClass}
                      onChange={(event) =>
                        setNodeForm({
                          ...nodeForm,
                          type: event.target.value as NodeType,
                        })
                      }
                      value={nodeForm.type}
                    >
                      {(
                        [
                          "phase",
                          "milestone",
                          "task",
                          "deliverable",
                          "decision",
                        ] as NodeType[]
                      ).map((type) => (
                        <option key={type} value={type}>
                          {nodeTypeLabel(type)}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="进度计算">
                    <select
                      className={fieldClass}
                      onChange={(event) =>
                        setNodeForm({
                          ...nodeForm,
                          progressMode: event.target
                            .value as ProjectProgressMode,
                        })
                      }
                      value={nodeForm.progressMode}
                    >
                      <option value="manual">手动填写</option>
                      <option value="weighted_children">按子节点权重汇总</option>
                      <option value="milestone_based">按里程碑汇总</option>
                    </select>
                  </Field>
                  <Field
                    hint={
                      nodeForm.progressMode === "manual"
                        ? "0–100"
                        : "自动模式由服务端按项目事实计算"
                    }
                    label="初始进度"
                  >
                    <input
                      className={fieldClass}
                      disabled={nodeForm.progressMode !== "manual"}
                      max="100"
                      min="0"
                      onChange={(event) =>
                        setNodeForm({
                          ...nodeForm,
                          progress: event.target.value,
                        })
                      }
                      type="number"
                      value={nodeForm.progress}
                    />
                  </Field>
                  <Field
                    hint="用于上级的加权汇总；0 表示不参与。"
                    label="节点权重"
                  >
                    <input
                      className={fieldClass}
                      min="0"
                      onChange={(event) =>
                        setNodeForm({ ...nodeForm, weight: event.target.value })
                      }
                      step="0.01"
                      type="number"
                      value={nodeForm.weight}
                    />
                  </Field>
                  <Field label="所属分支">
                    <select
                      className={fieldClass}
                      onChange={(event) =>
                        setNodeForm({
                          ...nodeForm,
                          branchId: event.target.value,
                        })
                      }
                      value={
                        nodeForm.branchId ||
                        activeBranches.find((branch) => branch.isDefault)?.id ||
                        ""
                      }
                    >
                      {activeBranches.map((branch) => (
                        <option key={branch.id} value={branch.id}>
                          {branch.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="上级节点">
                    <select
                      className={fieldClass}
                      onChange={(event) =>
                        setNodeForm({
                          ...nodeForm,
                          parentId: event.target.value,
                        })
                      }
                      value={nodeForm.parentId}
                    >
                      <option value="">顶层节点</option>
                      {allNodes
                        .filter(
                          (node) =>
                            node.branchId ===
                            (nodeForm.branchId ||
                              activeBranches.find((branch) => branch.isDefault)
                                ?.id),
                        )
                        .map((node) => (
                          <option key={node.id} value={node.id}>
                            {node.title}
                          </option>
                        ))}
                    </select>
                  </Field>
                  <Field label="开始时间（可选）">
                    <input
                      className={fieldClass}
                      onChange={(event) =>
                        setNodeForm({
                          ...nodeForm,
                          startAt: event.target.value,
                        })
                      }
                      type="datetime-local"
                      value={nodeForm.startAt}
                    />
                  </Field>
                  <Field label="截止时间（可选）">
                    <input
                      className={fieldClass}
                      onChange={(event) =>
                        setNodeForm({ ...nodeForm, dueAt: event.target.value })
                      }
                      type="datetime-local"
                      value={nodeForm.dueAt}
                    />
                  </Field>
                  <div className="project-create-description">
                    <Field label="说明（可选）">
                      <textarea
                        className={textAreaClass}
                        maxLength={20000}
                        onChange={(event) =>
                          setNodeForm({
                            ...nodeForm,
                            description: event.target.value,
                          })
                        }
                        value={nodeForm.description}
                      />
                    </Field>
                  </div>
                  <div className="flex items-end justify-end">
                    <Button
                      disabled={createNode.isPending || !nodeForm.title.trim()}
                      type="submit"
                    >
                      {createNode.isPending ? "正在创建…" : "创建版本化节点"}
                    </Button>
                  </div>
                </form>
                <ErrorMessage error={createNode.error} />
              </CardContent>
            </Card>
          ) : null}
          {showTeam && canManage ? (
            <ProjectTeamPanel
              onClose={() => setShowTeam(false)}
              projectId={projectId}
            />
          ) : null}
          {showBranch && canManage ? (
            <div className="project-branch-form">
              <GitBranch size={16} />
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  createBranch.mutate();
                }}
              >
                <input
                  className={fieldClass}
                  onChange={(event) => setBranchName(event.target.value)}
                  placeholder={
                    selected
                      ? `从“${selected.title}”创建分支`
                      : "从主线创建分支"
                  }
                  required
                  value={branchName}
                />
                <Button
                  disabled={createBranch.isPending}
                  size="compact"
                  type="submit"
                >
                  创建分支
                </Button>
              </form>
              <Button
                onClick={() => setShowBranch(false)}
                size="compact"
                variant="ghost"
              >
                关闭
              </Button>
            </div>
          ) : null}
          {showBranchManager && canManage ? (
            <Card className="project-branch-manager">
              <CardContent>
                <div className="project-create-panel-head">
                  <div>
                    <p className="app-section-label">分支生命周期</p>
                    <h2>
                      分支可独立演进；合并会复制它的有效节点和内部关联，再将来源分支安全归档。
                    </h2>
                  </div>
                  <Button
                    onClick={() => {
                      setShowBranchManager(false);
                      setBranchEditor(null);
                      setMergeSourceBranchId(null);
                    }}
                    size="compact"
                    variant="ghost"
                  >
                    关闭
                  </Button>
                </div>
                <div className="project-branch-list">
                  {activeBranches.map((branch) => (
                    <div className="project-branch-row" key={branch.id}>
                      <span className="min-w-0">
                        <strong>
                          {branch.isDefault ? "主线 · " : "分支 · "}
                          {branch.name}
                        </strong>
                        <small>
                          v{branch.version ?? 1}
                          {branch.description
                            ? ` · ${branch.description}`
                            : branch.isDefault
                              ? " · 默认执行分支"
                              : " · 可独立演进"}
                        </small>
                      </span>
                      <div className="project-branch-row-actions">
                        <Button
                          aria-label={`查看分支 ${branch.name}`}
                          onClick={() => {
                            setBranchId(branch.id);
                            setSelectedNodeId(null);
                          }}
                          size="compact"
                          variant="ghost"
                        >
                          查看
                        </Button>
                        <Button
                          aria-label={`编辑分支 ${branch.name}`}
                          onClick={() => {
                            setBranchEditor(branch);
                            setBranchEditForm({
                              name: branch.name,
                              description: branch.description ?? "",
                            });
                            setMergeSourceBranchId(null);
                          }}
                          size="compact"
                          variant="ghost"
                        >
                          <PencilLine size={14} />
                          编辑
                        </Button>
                        {!branch.isDefault ? (
                          <Button
                            aria-label={`合并分支 ${branch.name}`}
                            disabled={activeBranches.length < 2}
                            onClick={() => {
                              setMergeSourceBranchId(branch.id);
                              setMergeTargetBranchId(
                                activeBranches.find(
                                  (candidate) => candidate.id !== branch.id,
                                )?.id ?? "",
                              );
                              setBranchEditor(null);
                            }}
                            size="compact"
                            variant="secondary"
                          >
                            <GitMerge size={14} />
                            合并
                          </Button>
                        ) : null}
                        {!branch.isDefault ? (
                          <Button
                            aria-label={`归档分支 ${branch.name}`}
                            disabled={archiveBranch.isPending}
                            onClick={() => {
                              if (
                                window.confirm(
                                  `归档分支“${branch.name}”吗？它会从当前视图隐藏，但不会丢失任何版本或节点。`,
                                )
                              )
                                archiveBranch.mutate(branch);
                            }}
                            size="compact"
                            variant="ghost"
                          >
                            <Archive size={14} />
                            归档
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
                {branchEditor ? (
                  <form
                    className="project-branch-action-panel"
                    onSubmit={(event) => {
                      event.preventDefault();
                      updateBranch.mutate({
                        branch: branchEditor,
                        name: branchEditForm.name.trim(),
                        description: branchEditForm.description,
                      });
                    }}
                  >
                    <div>
                      <p className="app-section-label">编辑分支</p>
                      <strong>{branchEditor.name}</strong>
                    </div>
                    <Field label="分支名称">
                      <input
                        className={fieldClass}
                        maxLength={160}
                        onChange={(event) =>
                          setBranchEditForm({
                            ...branchEditForm,
                            name: event.target.value,
                          })
                        }
                        required
                        value={branchEditForm.name}
                      />
                    </Field>
                    <Field label="分支说明（可选）">
                      <input
                        className={fieldClass}
                        maxLength={10_000}
                        onChange={(event) =>
                          setBranchEditForm({
                            ...branchEditForm,
                            description: event.target.value,
                          })
                        }
                        value={branchEditForm.description}
                      />
                    </Field>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        disabled={
                          updateBranch.isPending || !branchEditForm.name.trim()
                        }
                        size="compact"
                        type="submit"
                      >
                        {updateBranch.isPending ? "正在保存…" : "保存分支"}
                      </Button>
                      <Button
                        onClick={() => setBranchEditor(null)}
                        size="compact"
                        type="button"
                        variant="ghost"
                      >
                        取消
                      </Button>
                    </div>
                  </form>
                ) : null}
                {mergeSourceBranchId
                  ? (() => {
                      const source = activeBranches.find(
                        (branch) => branch.id === mergeSourceBranchId,
                      );
                      if (!source) return null;
                      return (
                        <form
                          className="project-branch-action-panel"
                          onSubmit={(event) => {
                            event.preventDefault();
                            if (
                              window.confirm(
                                `确认将“${source.name}”合并到目标分支吗？有效节点和内部关联会复制到目标分支，来源分支随后归档。`,
                              )
                            )
                              mergeBranch.mutate({
                                branch: source,
                                targetBranchId: mergeTargetBranchId,
                              });
                          }}
                        >
                          <div>
                            <p className="app-section-label">合并分支</p>
                            <strong>{source.name}</strong>
                          </div>
                          <Field label="合并到活跃分支">
                            <select
                              className={fieldClass}
                              onChange={(event) =>
                                setMergeTargetBranchId(event.target.value)
                              }
                              value={mergeTargetBranchId}
                            >
                              <option value="">选择目标分支</option>
                              {activeBranches
                                .filter(
                                  (candidate) => candidate.id !== source.id,
                                )
                                .map((candidate) => (
                                  <option
                                    key={candidate.id}
                                    value={candidate.id}
                                  >
                                    {candidate.isDefault
                                      ? "主线 · "
                                      : "分支 · "}
                                    {candidate.name}
                                  </option>
                                ))}
                            </select>
                          </Field>
                          <p className="text-xs leading-5 text-[var(--text-muted)]">
                            不会覆盖目标已有节点；系统会在同一事务内复制来源分支的有效节点和内部关系、写入审计，再归档来源分支。
                          </p>
                          <div className="flex flex-wrap gap-2">
                            <Button
                              disabled={
                                mergeBranch.isPending || !mergeTargetBranchId
                              }
                              size="compact"
                              type="submit"
                            >
                              <GitMerge size={15} />
                              {mergeBranch.isPending ? "正在合并…" : "确认合并"}
                            </Button>
                            <Button
                              onClick={() => setMergeSourceBranchId(null)}
                              size="compact"
                              type="button"
                              variant="ghost"
                            >
                              取消
                            </Button>
                          </div>
                        </form>
                      );
                    })()
                  : null}
                {archivedBranches.length ? (
                  <div className="project-branch-archive-list">
                    <p className="app-section-label">已归档分支</p>
                    {archivedBranches.map((branch) => (
                      <div key={branch.id}>
                        <span>
                          <strong>{branch.name}</strong>
                          <small>
                            {branch.mergedAt
                              ? "已合并，保留来源历史以便审计"
                              : "已归档，可在不影响现有结构的前提下恢复"}
                          </small>
                        </span>
                        {!branch.mergedAt ? (
                          <Button
                            aria-label={`恢复分支 ${branch.name}`}
                            disabled={restoreBranch.isPending}
                            onClick={() => restoreBranch.mutate(branch)}
                            size="compact"
                            variant="secondary"
                          >
                            <RotateCcw size={14} />
                            恢复
                          </Button>
                        ) : (
                          <Badge tone="neutral">已合并</Badge>
                        )}
                      </div>
                    ))}
                  </div>
                ) : null}
                <ErrorMessage
                  error={
                    updateBranch.error ??
                    archiveBranch.error ??
                    restoreBranch.error ??
                    mergeBranch.error
                  }
                />
              </CardContent>
            </Card>
          ) : null}
          {showRecycle && canManage ? (
            <Card className="project-recycle-panel">
              <CardContent>
                <div className="project-create-panel-head">
                  <div>
                    <p className="app-section-label">可恢复项目节点</p>
                    <h2>
                      回收站中的节点可在保留期内恢复，恢复本身也会写入活动轨迹。
                    </h2>
                  </div>
                  <Button
                    onClick={() => setShowRecycle(false)}
                    size="compact"
                    variant="ghost"
                  >
                    关闭
                  </Button>
                </div>
                {recycleBin.isPending ? (
                  <LoadingBlock />
                ) : recycleBin.data?.items.length ? (
                  <div className="project-recycle-list">
                    {recycleBin.data.items.map((entry) => {
                      const title =
                        typeof entry.snapshot.title === "string"
                          ? entry.snapshot.title
                          : "未命名项目节点";
                      return (
                        <div key={entry.id}>
                          <span>
                            <strong>{title}</strong>
                            <small>
                              删除于{" "}
                              {new Intl.DateTimeFormat("zh-CN", {
                                month: "numeric",
                                day: "numeric",
                                hour: "2-digit",
                                minute: "2-digit",
                              }).format(new Date(entry.deletedAt))}
                              {entry.restoreUntil
                                ? ` · 可恢复至 ${new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" }).format(new Date(entry.restoreUntil))}`
                                : ""}
                            </small>
                          </span>
                          <Button
                            disabled={restoreRecycleNode.isPending}
                            onClick={() =>
                              restoreRecycleNode.mutate(entry.entityId)
                            }
                            size="compact"
                            variant="secondary"
                          >
                            <RotateCcw size={15} />
                            恢复
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <EmptyState
                    description="当前项目没有仍在可恢复期限内的已删除节点。"
                    icon={<Trash2 />}
                    title="回收站为空"
                  />
                )}
                <ErrorMessage
                  error={recycleBin.error ?? restoreRecycleNode.error}
                />
              </CardContent>
            </Card>
          ) : null}
          <div className="project-view-surface">
            {visibleNodes.length ? (
              view === "canvas" ? (
                <Suspense
                  fallback={
                    <div className="grid min-h-72 place-items-center">
                      <LoadingBlock />
                    </div>
                  }
                >
                  <ProjectCanvas
                    accent={tree.data.project.color}
                    edges={visibleEdges}
                    nodes={visibleCanvasNodes}
                    onNodeSelect={setSelectedNodeId}
                    selectedNodeId={selectedNodeId}
                  />
                </Suspense>
              ) : view === "timeline" ? (
                <Timeline
                  nodes={visibleNodes}
                  onSelect={setSelectedNodeId}
                  selectedNodeId={selectedNodeId}
                />
              ) : (
                <TreeList
                  assigneesByNodeId={assigneesByNodeId}
                  nodes={visibleNodes}
                  onSelect={setSelectedNodeId}
                  selectedNodeId={selectedNodeId}
                />
              )
            ) : (
              <EmptyState
                description={
                  search
                    ? "没有匹配节点。尝试更换关键词或切换分支。"
                    : "从第一个节点开始，建立阶段、任务、里程碑和交付物的可追溯结构。"
                }
                icon={<FolderKanban />}
                title={search ? "没有搜索结果" : "项目结构为空"}
              />
            )}
          </div>
          <div className="project-version-note">
            <FilePenLine size={15} />
            <span>
              节点创建、编辑、移动、删除和分支均由服务端写入版本与活动轨迹；结构图是事实的可视化，不是独立数据源。
            </span>
          </div>
          <ErrorMessage error={createBranch.error} />
        </main>
        {selected ? (
          <NodeInspector
            canManage={canManage}
            node={selected}
            nodes={allNodes}
            assignees={assigneesByNodeId.get(selected.id) ?? []}
            onClose={() => setSelectedNodeId(null)}
            onOpenRecycle={() => {
              setShowRecycle(true);
              setSelectedNodeId(null);
            }}
            projectId={projectId}
          />
        ) : (
          <aside className="project-workbench-guide">
            <p className="app-section-label">项目视图</p>
            <h2>从结构到排期，都指向同一条版本链。</h2>
            <div>
              <span>
                <Layers3 size={16} />
                <strong>结构画布</strong>
                <small>查看层级、依赖与分支关系。</small>
              </span>
              <span>
                <Clock3 size={16} />
                <strong>时间轴</strong>
                <small>只显示真实节点排期；未排期节点明确标记。</small>
              </span>
              <span>
                <ListTree size={16} />
                <strong>可访问列表</strong>
                <small>移动端与键盘操作的完整兜底。</small>
              </span>
            </div>
          </aside>
        )}
      </div>
    </>
  );
}
