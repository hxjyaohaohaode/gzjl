import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { EChartsCoreOption } from "echarts/core";
import {
  AlertCircle,
  ArrowLeft,
  ArrowUpRight,
  Bot,
  CalendarDays,
  Check,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  Crown,
  ExternalLink,
  Eye,
  EyeOff,
  FileCheck2,
  FileText,
  FolderKanban,
  KeyRound,
  ListTodo,
  LoaderCircle,
  Paperclip,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Sparkles,
  Settings2,
  Square,
  TimerReset,
  Users,
} from "lucide-react";
import {
  Component,
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Badge, Button, Card, CardContent, CardHeader } from "@workbench/ui";

import {
  api,
  ApiError,
  hasGrant,
  notifySessionChanged,
  resetCsrfToken,
  type Me,
} from "./api.js";
import { readableForeground } from "./color.js";
import { sendQueueableTimerEvent } from "./offline.js";
import {
  currentBrowserPushSubscription,
  detachCurrentBrowserPushBeforeLogout,
  disableCurrentBrowserPush,
  enableCurrentBrowserPush,
  pushBrowserSupported,
  type PushConfiguration,
} from "./push-client.js";

export const fieldClass =
  "min-h-11 w-full rounded-xl border border-transparent bg-[var(--surface-subtle)] px-3 text-sm text-[var(--text)] outline-none transition focus:border-[var(--accent)] focus:bg-[var(--surface)] focus:ring-2 focus:ring-[var(--accent-soft)]";
export const textAreaClass = `${fieldClass} min-h-28 py-3`;

export function PasswordInput({
  className = fieldClass,
  inputLabel,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  inputLabel: string;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <input
        {...props}
        aria-label={inputLabel}
        className={`${className} pr-12`}
        type={visible ? "text" : "password"}
      />
      <span
        aria-label={visible ? "隐藏输入内容" : "显示输入内容"}
        className="absolute inset-y-0 right-1 grid w-10 place-items-center rounded-lg text-[var(--text-muted)] transition hover:bg-[var(--surface)] hover:text-[var(--text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
        onClick={(event) => {
          event.preventDefault();
          setVisible((current) => !current);
        }}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          setVisible((current) => !current);
        }}
        role="button"
        tabIndex={0}
      >
        {visible ? <EyeOff size={17} /> : <Eye size={17} />}
      </span>
    </div>
  );
}
const timezone =
  Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Shanghai";
const AnalyticsChartLazy = lazy(() => import("./analytics-chart.js"));
const ProjectCanvasLazy = lazy(() => import("./project-canvas.js"));
class AnalyticsChartBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override componentDidCatch(error: unknown) {
    console.error("Analytics chart failed to render", error);
  }

  override render() {
    if (this.state.failed) {
      return (
        <div className="grid min-h-64 place-items-center rounded-xl bg-[var(--surface-subtle)] p-6 text-center">
          <div>
            <AlertCircle className="mx-auto text-[var(--danger)]" />
            <p className="mt-3 font-bold">图表暂时无法加载</p>
            <p className="mt-1 text-sm text-[var(--text-muted)]">其他数据仍可正常查看，刷新页面可重试。</p>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
function AnalyticsChart({
  ariaLabel,
  onDataSelect,
  option,
}: {
  ariaLabel: string;
  onDataSelect?: ((selection: { data: unknown; name: string; value: unknown }) => void) | undefined;
  option: EChartsCoreOption;
}) {
  return (
    <AnalyticsChartBoundary>
      <Suspense fallback={<LoadingBlock />}>
        <AnalyticsChartLazy ariaLabel={ariaLabel} onDataSelect={onDataSelect} option={option} />
      </Suspense>
    </AnalyticsChartBoundary>
  );
}
function ProjectCanvas({
  nodes,
  edges,
  accent,
}: {
  nodes: ProjectNode[];
  edges: ProjectEdge[];
  accent?: string;
}) {
  return (
    <Suspense fallback={<LoadingBlock />}>
      <ProjectCanvasLazy
        {...(accent ? { accent } : {})}
        edges={edges}
        nodes={nodes}
      />
    </Suspense>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="app-page-header flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-[28px] leading-none md:text-[34px]">{title}</h1>
        {description ? <p className="sr-only">{description}</p> : null}
      </div>
      {actions ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {actions}
        </div>
      ) : null}
    </header>
  );
}

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="app-field block">
      <span className="mb-1.5 block text-sm font-semibold">{label}</span>
      {children}
      {hint ? (
        <span className="mt-1.5 block text-xs text-[var(--text-muted)]">
          {hint}
        </span>
      ) : null}
    </label>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="app-empty-state flex min-h-64 flex-col items-center justify-center px-6 py-12 text-center">
      <div className="grid size-12 place-items-center rounded-2xl bg-[var(--surface-subtle)] text-[var(--text-muted)]">
        {icon}
      </div>
      <h2 className="mt-4 font-bold">{title}</h2>
      <p className="mt-2 max-w-md text-sm leading-6 text-[var(--text-muted)]">
        {description}
      </p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export function ErrorMessage({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <div
      className="flex gap-2 rounded-xl border border-[color-mix(in_srgb,var(--danger)_16%,transparent)] bg-[var(--danger-soft)] p-3 text-sm text-[var(--danger)]"
      role="alert"
    >
      <AlertCircle className="mt-0.5 shrink-0" size={17} />
      <span>
        {error instanceof Error ? error.message : "操作失败，请重试。"}
      </span>
    </div>
  );
}

export function LoadingBlock() {
  return (
    <div className="flex min-h-48 flex-col items-center justify-center gap-3 text-sm text-[var(--text-muted)]">
      <span className="grid size-9 place-items-center rounded-xl bg-[var(--surface-subtle)] text-[var(--accent-strong)]">
        <LoaderCircle className="animate-spin" size={17} />
      </span>
      正在加载真实数据…
    </div>
  );
}

function formatDateTime(value: string | Date): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}
function formatDuration(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const remainder = safeSeconds % 60;
  if (hours > 0) {
    return `${hours} 小时 ${minutes} 分${remainder ? ` ${remainder} 秒` : ""}`;
  }
  if (minutes > 0) return `${minutes} 分${remainder ? ` ${remainder} 秒` : ""}`;
  return `${remainder} 秒`;
}
function formatWorkAnomaly(flag: string): string {
  switch (flag) {
    case "net_duration_under_60_seconds":
      return "净工时不足 1 分钟，需复核";
    case "gross_duration_over_16_hours":
      return "总时段超过 16 小时，需复核";
    default:
      return "该记录需要人工复核";
  }
}
function formatCorrectionStatus(status: OwnWorkCorrection["correction"]["status"]): string {
  switch (status) {
    case "pending":
      return "更正申请待审核";
    case "approved":
      return "更正申请已确认（未产生薪资调整）";
    case "applied_next_period":
      return "更正申请已写入下期调整";
    case "rejected":
      return "更正申请已驳回";
  }
}
function localInput(date: Date): string {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 19);
}
function hexWithAlpha(hex: string, alpha: number): string {
  const value = hex.replace("#", "");
  if (!/^[0-9a-f]{6}$/i.test(value)) return `rgba(91, 92, 226, ${alpha})`;
  const red = Number.parseInt(value.slice(0, 2), 16);
  const green = Number.parseInt(value.slice(2, 4), 16);
  const blue = Number.parseInt(value.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}
function useChartPalette() {
  const [, setVersion] = useState(0);
  useEffect(() => {
    const observer = new MutationObserver(() =>
      setVersion((value) => value + 1),
    );
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", "style"],
    });
    return () => observer.disconnect();
  }, []);
  const styles = getComputedStyle(document.documentElement);
  const token = (name: string, fallback: string) =>
    styles.getPropertyValue(name).trim() || fallback;
  return {
    accent: token("--accent", "#5b5ce2"),
    border: token("--border", "#e2e7f0"),
    grid: token("--surface-subtle", "#f2f4fa"),
    surface: token("--surface-raised", "#ffffff"),
    text: token("--text", "#172036"),
    textMuted: token("--text-muted", "#65718a"),
    textSubtle: token("--text-subtle", "#929bb0"),
    warning: token("--warning", "#a85d00"),
    danger: token("--danger", "#c43d4b"),
  };
}
export function LoginPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [challengeToken, setChallengeToken] = useState("");
  const [code, setCode] = useState("");
  const enterWorkspace = async () => {
    resetCsrfToken();
    queryClient.removeQueries({
      predicate: (query) => query.queryKey[0] !== "me",
    });
    await queryClient.invalidateQueries({ queryKey: ["me"] });
    notifySessionChanged();
    navigate("/", { replace: true });
  };
  const login = useMutation({
    mutationFn: () =>
      api<{ mfaRequired?: boolean; challengeToken?: string }>(
        "/api/auth/login",
        { method: "POST", body: { identifier, password } },
      ),
    onSuccess: async (result) => {
      if (result.mfaRequired && result.challengeToken)
        setChallengeToken(result.challengeToken);
      else await enterWorkspace();
    },
  });
  const verifyMfa = useMutation({
    mutationFn: () =>
      api("/api/auth/login/mfa", {
        method: "POST",
        body: { challengeToken, code },
      }),
    onSuccess: enterWorkspace,
  });
  if (challengeToken)
    return (
      <AuthFrame
        title="验证身份"
        description="请输入身份验证器当前显示的 6 位动态验证码。验证完成前不会创建登录会话。"
      >
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            verifyMfa.mutate();
          }}
        >
          <Field hint="验证码每 30 秒更新一次。" label="动态验证码">
            <input
              autoComplete="one-time-code"
              className={fieldClass}
              inputMode="numeric"
              maxLength={6}
              onChange={(event) =>
                setCode(event.target.value.replace(/\D/g, ""))
              }
              pattern="[0-9]{6}"
              required
              value={code}
            />
          </Field>
          <ErrorMessage error={verifyMfa.error} />
          <Button
            className="w-full"
            disabled={verifyMfa.isPending || code.length !== 6}
            type="submit"
          >
            {verifyMfa.isPending ? "正在验证…" : "完成安全登录"}
          </Button>
          <Button
            className="w-full"
            onClick={() => {
              setChallengeToken("");
              setCode("");
            }}
            type="button"
            variant="ghost"
          >
            返回重新登录
          </Button>
        </form>
      </AuthFrame>
    );
  return (
    <AuthFrame
      title="登录工作台"
      description="使用组织中已验证的邮箱或手机号登录。"
    >
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          login.mutate();
        }}
      >
        <Field label="邮箱或手机号">
          <input
            autoComplete="username"
            className={fieldClass}
            name="username"
            onChange={(event) => setIdentifier(event.target.value)}
            required
            value={identifier}
          />
        </Field>
        <Field label="密码">
          <PasswordInput
            autoComplete="current-password"
            inputLabel="密码"
            minLength={8}
            name="password"
            onChange={(event) => setPassword(event.target.value)}
            required
            value={password}
          />
        </Field>
        <ErrorMessage error={login.error} />
        <Button className="w-full" disabled={login.isPending} type="submit">
          {login.isPending ? "正在安全登录…" : "登录"}
        </Button>
        <p className="text-center text-sm text-[var(--text-muted)]">
          <Link
            className="font-semibold text-[var(--accent-strong)]"
            to="/forgot-password"
          >
            忘记密码？
          </Link>
          <span aria-hidden="true"> · </span>首次部署？
          <Link
            className="font-semibold text-[var(--accent-strong)]"
            to="/setup"
          >
            初始化唯一 Owner
          </Link>
        </p>
      </form>
    </AuthFrame>
  );
}

interface PendingOwnershipTransfer {
  id: string;
  requestedAt: string;
  fromDisplayName: string;
}

interface PersonalIdentity {
  identityId: string;
  identityName: string;
  description: string | null;
  source: "organization" | "self_declared";
  verifiedAt: string | null;
}

interface PersonalIdentityRequest {
  id: string;
  action: "add" | "remove";
  requestedName: string;
  requestedIdentityId: string | null;
  reason: string | null;
  status: "pending" | "approved" | "rejected" | "cancelled";
  reviewNote: string | null;
  createdAt: string;
  reviewedAt: string | null;
}

interface PersonalIdentityProfile {
  identities: PersonalIdentity[];
  availableIdentities: Array<{
    id: string;
    name: string;
    description: string | null;
  }>;
  requests: PersonalIdentityRequest[];
}

interface AccountCredential {
  id: string;
  kind: "email" | "phone";
  maskedIdentifier: string;
  verifiedAt: string | null;
  createdAt: string;
}

interface AccountCredentialProfile {
  credentials: AccountCredential[];
  verifiedCount: number;
}

interface CredentialDeliveryResponse {
  credential: AccountCredential;
  delivery: {
    kind: "email" | "phone";
    expiresAt: string;
    status: "sent" | "retry_required";
    message?: string;
  };
}

function credentialKindLabel(kind: AccountCredential["kind"]): string {
  return kind === "email" ? "邮箱" : "手机号";
}

/**
 * New capability links put their token in the fragment, which browsers do not
 * send to the server. Retain the query-string fallback only for links issued
 * by an earlier deployment, then immediately remove either form from the bar.
 */
function oneTimeTokenFromLocation(): string {
  const url = new URL(window.location.href);
  const fragment = url.hash.startsWith("#")
    ? new URLSearchParams(url.hash.slice(1)).get("token")
    : null;
  return fragment ?? url.searchParams.get("token") ?? "";
}

function removeOneTimeTokenFromLocation(): void {
  const url = new URL(window.location.href);
  const fragment = url.hash.startsWith("#")
    ? new URLSearchParams(url.hash.slice(1))
    : null;
  if (!url.searchParams.has("token") && !fragment?.has("token")) return;
  url.searchParams.delete("token");
  url.hash = "";
  window.history.replaceState(
    window.history.state,
    "",
    `${url.pathname}${url.search}`,
  );
}

export function SecurityPage() {
  const queryClient = useQueryClient();
  const status = useQuery({
    queryKey: ["totp-status"],
    queryFn: () =>
      api<{ enabled: boolean; pending: boolean }>("/api/auth/mfa/totp"),
  });
  const pendingOwnershipTransfer = useQuery({
    queryKey: ["pending-ownership-transfer"],
    queryFn: () =>
      api<{ transfer: PendingOwnershipTransfer | null }>(
        "/api/organization/ownership-transfers/pending-for-me",
      ),
  });
  const personalIdentities = useQuery({
    queryKey: ["my-identities"],
    queryFn: () =>
      api<PersonalIdentityProfile>("/api/organization/my-identities"),
  });
  const credentials = useQuery({
    queryKey: ["account-credentials"],
    queryFn: () =>
      api<AccountCredentialProfile>("/api/auth/credentials"),
  });
  const [setup, setSetup] = useState<{
    secret: string;
    otpauthUri: string;
  } | null>(null);
  const [confirmationCode, setConfirmationCode] = useState("");
  const [disablePassword, setDisablePassword] = useState("");
  const [disableCode, setDisableCode] = useState("");
  const [ownershipPassword, setOwnershipPassword] = useState("");
  const [ownershipTotpCode, setOwnershipTotpCode] = useState("");
  const [selectedIdentityId, setSelectedIdentityId] = useState("");
  const [customIdentityName, setCustomIdentityName] = useState("");
  const [identityRequestReason, setIdentityRequestReason] = useState("");
  const [credentialKind, setCredentialKind] = useState<"email" | "phone">(
    "email",
  );
  const [credentialIdentifier, setCredentialIdentifier] = useState("");
  const [credentialPassword, setCredentialPassword] = useState("");
  const [credentialTotpCode, setCredentialTotpCode] = useState("");
  const [credentialFeedback, setCredentialFeedback] = useState<
    CredentialDeliveryResponse["delivery"] | null
  >(null);
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["totp-status"] });
  };
  const refreshCredentials = async () => {
    await queryClient.invalidateQueries({ queryKey: ["account-credentials"] });
  };
  const begin = useMutation({
    mutationFn: () =>
      api<{ secret: string; otpauthUri: string }>("/api/auth/mfa/totp/setup", {
        method: "POST",
      }),
    onSuccess: (value) => setSetup(value),
  });
  const confirm = useMutation({
    mutationFn: () =>
      api("/api/auth/mfa/totp/confirm", {
        method: "POST",
        body: { code: confirmationCode },
      }),
    onSuccess: async () => {
      setSetup(null);
      setConfirmationCode("");
      await refresh();
    },
  });
  const disable = useMutation({
    mutationFn: () =>
      api("/api/auth/mfa/totp", {
        method: "DELETE",
        body: { password: disablePassword, code: disableCode },
      }),
    onSuccess: async () => {
      setDisablePassword("");
      setDisableCode("");
      await refresh();
    },
  });
  const bindCredential = useMutation({
    mutationFn: () =>
      api<CredentialDeliveryResponse>("/api/auth/credentials", {
        method: "POST",
        body: {
          kind: credentialKind,
          identifier: credentialIdentifier.trim(),
          password: credentialPassword,
          ...(credentialTotpCode
            ? { totpCode: credentialTotpCode }
            : {}),
        },
      }),
    onSuccess: async (result) => {
      setCredentialFeedback(result.delivery);
      setCredentialIdentifier("");
      setCredentialPassword("");
      setCredentialTotpCode("");
      await refreshCredentials();
    },
  });
  const resendCredential = useMutation({
    mutationFn: (credentialId: string) =>
      api<CredentialDeliveryResponse>(
        `/api/auth/credentials/${credentialId}/resend`,
        {
          method: "POST",
          body: {
            password: credentialPassword,
            ...(credentialTotpCode
              ? { totpCode: credentialTotpCode }
              : {}),
          },
        },
      ),
    onSuccess: async (result) => {
      setCredentialFeedback(result.delivery);
      setCredentialPassword("");
      setCredentialTotpCode("");
      await refreshCredentials();
    },
  });
  const removeCredential = useMutation({
    mutationFn: (credentialId: string) =>
      api<{ removed: boolean }>(`/api/auth/credentials/${credentialId}`, {
        method: "DELETE",
        body: {
          password: credentialPassword,
          ...(credentialTotpCode
            ? { totpCode: credentialTotpCode }
            : {}),
        },
      }),
    onSuccess: async () => {
      setCredentialFeedback(null);
      setCredentialPassword("");
      setCredentialTotpCode("");
      await refreshCredentials();
    },
  });
  const confirmOwnershipTransfer = useMutation({
    mutationFn: ({
      transferId,
      password,
      totpCode,
    }: {
      transferId: string;
      password: string;
      totpCode?: string;
    }) =>
      api(`/api/organization/ownership-transfers/${transferId}/confirm`, {
        method: "POST",
        body: { password, ...(totpCode ? { totpCode } : {}) },
      }),
    onSuccess: async () => {
      setOwnershipPassword("");
      setOwnershipTotpCode("");
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["pending-ownership-transfer"],
        }),
        queryClient.invalidateQueries({ queryKey: ["organization"] }),
        queryClient.invalidateQueries({ queryKey: ["me"] }),
      ]);
    },
  });
  const rejectOwnershipTransfer = useMutation({
    mutationFn: (transferId: string) =>
      api(`/api/organization/ownership-transfers/${transferId}/cancel`, {
        method: "POST",
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["pending-ownership-transfer"],
        }),
        queryClient.invalidateQueries({ queryKey: ["organization"] }),
      ]);
    },
  });
  const requestIdentityChange = useMutation({
    mutationFn: (body: {
      action: "add" | "remove";
      identityId?: string;
      requestedName?: string;
      reason?: string;
    }) =>
      api("/api/organization/my-identities/requests", {
        method: "POST",
        body,
      }),
    onSuccess: async () => {
      setSelectedIdentityId("");
      setCustomIdentityName("");
      setIdentityRequestReason("");
      await queryClient.invalidateQueries({ queryKey: ["my-identities"] });
    },
  });
  const credentialActionAllowed =
    Boolean(credentialPassword) &&
    (!status.data?.enabled || /^\d{6}$/.test(credentialTotpCode));
  return (
    <>
      <PageHeader
        title="账户安全"
        description="管理可登录、找回密码的邮箱和手机号，以及动态验证码。每个登录标识都必须由对应渠道真实验证；共享密钥仅在设置时展示一次，服务端以 AES‑GCM 加密保存。"
      />
      <div className="grid max-w-4xl gap-5 lg:grid-cols-2">
        <Card className="lg:col-span-2">
          <CardHeader className="max-sm:flex-col max-sm:gap-3">
            <div className="min-w-0">
              <p className="app-section-label">登录与恢复方式</p>
              <h2 className="mt-2 flex items-center gap-2 font-bold">
                <KeyRound className="text-[var(--accent-strong)]" size={18} />
                邮箱与手机号
              </h2>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-[var(--text-muted)]">
                已验证的方式可用于登录和找回密码；待验证方式不会生效。你至少需要保留一个已验证的联系方式，所有新增、重发与移除操作都需要当前密码；若已启用动态验证码，还需一组未使用的动态码。
              </p>
            </div>
            <Badge
              className="shrink-0 self-start whitespace-nowrap"
              tone={
                credentials.data?.verifiedCount ? "positive" : "warning"
              }
            >
              {credentials.data?.verifiedCount ?? 0} 个已验证
            </Badge>
          </CardHeader>
          <CardContent className="space-y-5">
            {credentials.isPending ? (
              <LoadingBlock />
            ) : credentials.data ? (
              <div className="overflow-hidden rounded-2xl bg-[var(--surface-subtle)]">
                {credentials.data.credentials.map((credential) => {
                  const isLastVerified =
                    Boolean(credential.verifiedAt) &&
                    credentials.data!.verifiedCount <= 1;
                  return (
                    <div
                      className="flex flex-col gap-3 border-b border-[var(--border)] px-4 py-4 last:border-b-0 sm:flex-row sm:items-center sm:justify-between"
                      key={credential.id}
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-semibold">
                            {credentialKindLabel(credential.kind)}
                          </p>
                          <Badge
                            tone={
                              credential.verifiedAt ? "positive" : "warning"
                            }
                          >
                            {credential.verifiedAt ? "已验证" : "待验证"}
                          </Badge>
                        </div>
                        <p className="mt-1 break-all text-sm text-[var(--text-muted)]">
                          {credential.maskedIdentifier}
                        </p>
                        {!credential.verifiedAt ? (
                          <p className="mt-1 text-xs leading-5 text-[var(--warning)]">
                            验证完成前不能用于登录或找回密码。
                          </p>
                        ) : null}
                      </div>
                      <div className="flex shrink-0 flex-wrap gap-2">
                        {!credential.verifiedAt ? (
                          <Button
                            disabled={
                              !credentialActionAllowed ||
                              status.isLoading ||
                              status.isError ||
                              resendCredential.isPending
                            }
                            onClick={() => {
                              setCredentialFeedback(null);
                              resendCredential.mutate(credential.id);
                            }}
                            variant="secondary"
                          >
                            <RotateCcw size={15} />
                            {resendCredential.isPending
                              ? "正在重发…"
                              : "重新发送验证"}
                          </Button>
                        ) : null}
                        <Button
                          disabled={
                            !credentialActionAllowed ||
                            status.isLoading ||
                            status.isError ||
                            removeCredential.isPending ||
                            isLastVerified
                          }
                          onClick={() => {
                            if (
                              window.confirm(
                                credential.verifiedAt
                                  ? "确认移除此登录与找回方式吗？移除后无法恢复，除非重新绑定并完成验证。"
                                  : "确认移除此待验证联系方式吗？当前验证链接将立即失效。",
                              )
                            ) {
                              setCredentialFeedback(null);
                              removeCredential.mutate(credential.id);
                            }
                          }}
                          title={
                            isLastVerified
                              ? "必须保留至少一个已验证的邮箱或手机号。"
                              : undefined
                          }
                          variant="danger"
                        >
                          {removeCredential.isPending ? "正在移除…" : "移除"}
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : null}

            <form
              className="grid gap-3 rounded-2xl bg-[var(--surface-subtle)] p-4 md:grid-cols-2"
              onSubmit={(event) => {
                event.preventDefault();
                setCredentialFeedback(null);
                bindCredential.mutate();
              }}
            >
              <div className="md:col-span-2">
                <p className="text-sm font-semibold">新增登录与恢复方式</p>
                <p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">
                  邮箱需要已配置 SMTP；手机号需要已配置 Twilio。中国大陆手机号可直接填写 11 位，系统会在服务端统一规范化；国际号码可填写国家区号。未配置渠道时系统会明确拒绝，不会伪造“已发送”。
                </p>
              </div>
              <Field label="新联系方式类型">
                <select
                  className={fieldClass}
                  onChange={(event) => {
                    setCredentialKind(
                      event.target.value as "email" | "phone",
                    );
                    setCredentialIdentifier("");
                  }}
                  value={credentialKind}
                >
                  <option value="email">邮箱</option>
                  <option value="phone">手机号</option>
                </select>
              </Field>
              <Field
                hint={
                  credentialKind === "phone"
                    ? "例如 13812345678"
                    : "将收到一次性验证链接"
                }
                label={credentialKind === "email" ? "新邮箱" : "新手机号"}
              >
                <input
                  autoComplete={credentialKind === "email" ? "email" : "tel"}
                  className={fieldClass}
                  inputMode={credentialKind === "email" ? "email" : "tel"}
                  onChange={(event) =>
                    setCredentialIdentifier(event.target.value)
                  }
                  placeholder={
                    credentialKind === "email"
                      ? "name@example.com"
                      : "13812345678"
                  }
                  required
                  type={credentialKind === "email" ? "email" : "tel"}
                  value={credentialIdentifier}
                />
              </Field>
              <Field label="当前账户密码（用于联系方式操作）">
                <PasswordInput
                  autoComplete="current-password"
                  inputLabel="当前账户密码（用于联系方式操作）"
                  onChange={(event) => setCredentialPassword(event.target.value)}
                  required
                  value={credentialPassword}
                />
              </Field>
              {status.data?.enabled ? (
                <Field label="动态验证码（用于联系方式操作，6 位）">
                  <input
                    autoComplete="one-time-code"
                    className={fieldClass}
                    inputMode="numeric"
                    maxLength={6}
                    onChange={(event) =>
                      setCredentialTotpCode(
                        event.target.value.replace(/\D/g, "").slice(0, 6),
                      )
                    }
                    pattern="[0-9]*"
                    required
                    value={credentialTotpCode}
                  />
                </Field>
              ) : null}
              <div className="flex flex-wrap items-end gap-2 md:col-span-2">
                <Button
                  disabled={
                    bindCredential.isPending ||
                    !credentialIdentifier.trim() ||
                    !credentialActionAllowed ||
                    status.isLoading ||
                    status.isError
                  }
                  type="submit"
                >
                  <KeyRound size={16} />
                  {bindCredential.isPending
                    ? "正在创建验证…"
                    : "发送验证链接"}
                </Button>
                {credentialFeedback ? (
                  <p
                    className={
                      credentialFeedback.status === "sent"
                        ? "text-sm text-[var(--success)]"
                        : "text-sm text-[var(--warning)]"
                    }
                    role="status"
                  >
                    {credentialFeedback.status === "sent"
                      ? `${credentialKindLabel(credentialFeedback.kind)}验证消息已发送，请在 ${formatDateTime(credentialFeedback.expiresAt)} 前完成验证。`
                      : `联系方式已安全保存为待验证，但本次投递未完成：${credentialFeedback.message ?? "请检查通道配置后重新发送。"}`}
                  </p>
                ) : null}
              </div>
            </form>
            <ErrorMessage
              error={
                credentials.error ??
                bindCredential.error ??
                resendCredential.error ??
                removeCredential.error
              }
            />
          </CardContent>
        </Card>
        {pendingOwnershipTransfer.data?.transfer ? (
          <Card className="bg-[color-mix(in_srgb,var(--warning-soft)_72%,var(--surface))] lg:col-span-2">
            <CardHeader>
              <div>
                <p className="app-section-label text-[var(--warning)]">
                  高风险身份操作
                </p>
                <h2 className="mt-2 flex items-center gap-2 font-bold">
                  <Crown className="text-[var(--warning)]" size={18} />
                  待确认组织所有权转移
                </h2>
              </div>
              <Badge tone="warning">需要本人确认</Badge>
            </CardHeader>
            <CardContent>
              <p className="max-w-2xl text-sm leading-6 text-[var(--text-muted)]">
                {pendingOwnershipTransfer.data.transfer.fromDisplayName}
                已请求将唯一 Owner 身份转移给你。确认前，现任 Owner
                与现有权限保持不变；为避免遗留会话误操作，你还需要再次验证当前密码；
                已启用动态验证码时还须验证一组未使用的动态码。确认后，服务端会在同一事务内完成唯一
                Owner 的原子切换，并保留完整审计记录。
              </p>
              <p className="mt-2 text-xs text-[var(--text-subtle)]">
                请求时间：
                {formatDateTime(
                  pendingOwnershipTransfer.data.transfer.requestedAt,
                )}
              </p>
              <div className="mt-4 grid max-w-xl gap-3 sm:grid-cols-2">
                <Field label="当前密码（用于二次验证）">
                  <PasswordInput
                    autoComplete="current-password"
                    inputLabel="当前密码（用于二次验证）"
                    onChange={(event) => setOwnershipPassword(event.target.value)}
                    value={ownershipPassword}
                  />
                </Field>
                {status.data?.enabled ? (
                  <Field label="动态验证码（6 位）">
                    <input
                      autoComplete="one-time-code"
                      className={fieldClass}
                      inputMode="numeric"
                      maxLength={6}
                      onChange={(event) =>
                        setOwnershipTotpCode(
                          event.target.value.replace(/\D/g, "").slice(0, 6),
                        )
                      }
                      pattern="[0-9]*"
                      value={ownershipTotpCode}
                    />
                  </Field>
                ) : null}
              </div>
              <div className="mt-5 flex flex-wrap gap-2">
                <Button
                  disabled={
                    confirmOwnershipTransfer.isPending ||
                    status.isLoading ||
                    status.isError ||
                    !ownershipPassword ||
                    (status.data?.enabled && !/^\d{6}$/.test(ownershipTotpCode))
                  }
                  onClick={() => {
                    if (
                      window.confirm(
                        "确认接任唯一 Owner 吗？该操作会立即切换组织所有权。",
                      )
                    )
                      confirmOwnershipTransfer.mutate(
                        {
                          transferId:
                            pendingOwnershipTransfer.data!.transfer!.id,
                          password: ownershipPassword,
                          ...(ownershipTotpCode
                            ? { totpCode: ownershipTotpCode }
                            : {}),
                        },
                      );
                  }}
                >
                  <Crown size={16} />
                  {confirmOwnershipTransfer.isPending
                    ? "正在确认…"
                    : "确认接任 Owner"}
                </Button>
                <Button
                  disabled={rejectOwnershipTransfer.isPending}
                  onClick={() => {
                    if (window.confirm("确定拒绝这笔所有权转移吗？"))
                      rejectOwnershipTransfer.mutate(
                        pendingOwnershipTransfer.data!.transfer!.id,
                      );
                  }}
                  variant="secondary"
                >
                  拒绝转移
                </Button>
              </div>
              <div className="mt-3">
                <ErrorMessage
                  error={
                    confirmOwnershipTransfer.error ??
                    rejectOwnershipTransfer.error ?? status.error
                  }
                />
              </div>
            </CardContent>
          </Card>
        ) : null}
        <Card className="lg:col-span-2">
          <CardHeader className="max-sm:flex-col max-sm:gap-3">
            <div className="min-w-0">
              <p className="app-section-label">个人协作标签</p>
              <h2 className="mt-2 flex items-center gap-2 font-bold">
                <Sparkles className="text-[var(--accent-strong)]" size={18} />
                我的专业身份
              </h2>
              <p className="mt-1 text-sm text-[var(--text-muted)]">
                专业身份用于协作、工作类型和分析标签；它不授予角色权限，也不改变组织岗位。
              </p>
            </div>
            <Badge tone="info" className="shrink-0 self-start whitespace-nowrap">
              独立于权限
            </Badge>
          </CardHeader>
          <CardContent>
            {personalIdentities.isPending ? (
              <LoadingBlock />
            ) : (
              <>
                <div className="flex flex-wrap gap-2">
                  {personalIdentities.data?.identities.length ? (
                    personalIdentities.data.identities.map((identity) => (
                      <span
                        className="inline-flex items-center gap-2 rounded-full bg-[var(--accent-soft)] px-3 py-1.5 text-sm font-semibold text-[var(--accent-strong)]"
                        key={identity.identityId}
                      >
                        {identity.identityName}
                        <button
                          aria-label={`申请移除专业身份 ${identity.identityName}`}
                          className="rounded-full text-xs text-[var(--text-muted)] transition hover:text-[var(--danger)]"
                          disabled={requestIdentityChange.isPending}
                          onClick={() => {
                            if (
                              window.confirm(
                                `提交移除“${identity.identityName}”的申请吗？该操作需要管理人员审核。`,
                              )
                            )
                              requestIdentityChange.mutate({
                                action: "remove",
                                identityId: identity.identityId,
                              });
                          }}
                          type="button"
                        >
                          移除
                        </button>
                      </span>
                    ))
                  ) : (
                    <p className="text-sm text-[var(--text-muted)]">
                      还没有专业身份。可以从组织目录申请，或提交自定义身份供审核。
                    </p>
                  )}
                </div>
                <details className="mt-4 rounded-2xl bg-[var(--surface-subtle)] p-4">
                  <summary className="cursor-pointer text-sm font-semibold text-[var(--text)]">
                    申请新增专业身份
                  </summary>
                  <form
                    className="mt-4 grid gap-3 md:grid-cols-2"
                    onSubmit={(event) => {
                      event.preventDefault();
                      requestIdentityChange.mutate({
                        action: "add",
                        ...(selectedIdentityId
                          ? { identityId: selectedIdentityId }
                          : {}),
                        ...(customIdentityName.trim()
                          ? { requestedName: customIdentityName.trim() }
                          : {}),
                        ...(identityRequestReason.trim()
                          ? { reason: identityRequestReason.trim() }
                          : {}),
                      });
                    }}
                  >
                    <Field label="组织已有身份（可选）">
                      <select
                        className={fieldClass}
                        onChange={(event) =>
                          setSelectedIdentityId(event.target.value)
                        }
                        value={selectedIdentityId}
                      >
                        <option value="">选择已有身份</option>
                        {personalIdentities.data?.availableIdentities
                          .filter(
                            (identity) =>
                              !personalIdentities.data?.identities.some(
                                (assigned) =>
                                  assigned.identityId === identity.id,
                              ),
                          )
                          .map((identity) => (
                            <option key={identity.id} value={identity.id}>
                              {identity.name}
                            </option>
                          ))}
                      </select>
                    </Field>
                    <Field label="自定义身份名称（可选）">
                      <input
                        className={fieldClass}
                        disabled={Boolean(selectedIdentityId)}
                        maxLength={120}
                        onChange={(event) =>
                          setCustomIdentityName(event.target.value)
                        }
                        placeholder="例如：知识库开发"
                        value={customIdentityName}
                      />
                    </Field>
                    <div className="md:col-span-2">
                      <Field hint="可选，最多 2,000 字。" label="申请说明">
                        <textarea
                          className={textAreaClass}
                          maxLength={2000}
                          onChange={(event) =>
                            setIdentityRequestReason(event.target.value)
                          }
                          value={identityRequestReason}
                        />
                      </Field>
                    </div>
                    <div className="md:col-span-2 flex flex-wrap items-center gap-2">
                      <Button
                        disabled={
                          requestIdentityChange.isPending ||
                          (!selectedIdentityId && !customIdentityName.trim())
                        }
                        size="compact"
                        type="submit"
                      >
                        {requestIdentityChange.isPending
                          ? "正在提交…"
                          : "提交身份申请"}
                      </Button>
                      <span className="text-xs text-[var(--text-subtle)]">
                        申请不会自动获得管理、审批、薪资或数据访问权限。
                      </span>
                    </div>
                  </form>
                </details>
                {personalIdentities.data?.requests.length ? (
                  <div className="mt-4 space-y-2">
                    <p className="app-section-label">身份申请记录</p>
                    {personalIdentities.data.requests.map((request) => (
                      <div
                        className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-[var(--surface-subtle)] px-3 py-2.5"
                        key={request.id}
                      >
                        <span className="min-w-0">
                          <strong className="block text-sm">
                            {request.action === "add" ? "新增" : "移除"} ·{" "}
                            {request.requestedName}
                          </strong>
                          <small className="mt-0.5 block text-xs text-[var(--text-muted)]">
                            {formatDateTime(request.createdAt)}
                            {request.reviewNote
                              ? ` · 审核说明：${request.reviewNote}`
                              : ""}
                          </small>
                        </span>
                        <Badge
                          tone={
                            request.status === "approved"
                              ? "positive"
                              : request.status === "rejected"
                                ? "danger"
                                : request.status === "pending"
                                  ? "warning"
                                  : "neutral"
                          }
                        >
                          {request.status === "approved"
                            ? "已通过"
                            : request.status === "rejected"
                              ? "已拒绝"
                              : request.status === "pending"
                                ? "待审核"
                                : "已取消"}
                        </Badge>
                      </div>
                    ))}
                  </div>
                ) : null}
                <div className="mt-3">
                  <ErrorMessage
                    error={
                      personalIdentities.error ?? requestIdentityChange.error
                    }
                  />
                </div>
              </>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <div>
              <h2 className="font-bold">双因素认证（TOTP）</h2>
              <p className="mt-1 text-sm text-[var(--text-muted)]">
                密码之外再验证一次设备持有权。
              </p>
            </div>
            <Badge tone={status.data?.enabled ? "positive" : "neutral"}>
              {status.data?.enabled ? "已启用" : "未启用"}
            </Badge>
          </CardHeader>
          <CardContent className="space-y-4">
            {status.isPending ? (
              <LoadingBlock />
            ) : status.data?.enabled ? (
              <p className="text-sm leading-6 text-[var(--text-muted)]">
                登录时需要密码和身份验证器的 6
                位动态验证码。撤销时需要重新输入两项凭据。
              </p>
            ) : setup ? (
              <>
                <p className="text-sm leading-6 text-[var(--text-muted)]">
                  在身份验证器中选择“手动输入密钥”，账户名任意，类型选“基于时间”。请妥善保管，不要发送给任何人。
                </p>
                <Field label="一次性设置密钥">
                  <input
                    className={`${fieldClass} font-mono tracking-wider`}
                    readOnly
                    value={setup.secret}
                  />
                </Field>
                <details className="rounded-xl bg-[var(--surface-subtle)] p-3 text-xs text-[var(--text-muted)]">
                  <summary className="cursor-pointer font-semibold">
                    高级：otpauth 配置链接
                  </summary>
                  <code className="mt-2 block break-all select-all">
                    {setup.otpauthUri}
                  </code>
                </details>
                <form
                  className="space-y-3"
                  onSubmit={(event) => {
                    event.preventDefault();
                    confirm.mutate();
                  }}
                >
                  <Field label="验证身份验证器">
                    <input
                      autoComplete="one-time-code"
                      className={fieldClass}
                      inputMode="numeric"
                      maxLength={6}
                      onChange={(event) =>
                        setConfirmationCode(
                          event.target.value.replace(/\D/g, ""),
                        )
                      }
                      required
                      value={confirmationCode}
                    />
                  </Field>
                  <ErrorMessage error={confirm.error} />
                  <Button
                    disabled={
                      confirm.isPending || confirmationCode.length !== 6
                    }
                    type="submit"
                  >
                    {confirm.isPending ? "正在启用…" : "验证并启用"}
                  </Button>
                </form>
              </>
            ) : (
              <>
                <p className="text-sm leading-6 text-[var(--text-muted)]">
                  支持 Google Authenticator、Microsoft Authenticator、1Password
                  等标准身份验证器。
                </p>
                <ErrorMessage error={begin.error} />
                <Button
                  disabled={begin.isPending || status.data?.pending}
                  onClick={() => begin.mutate()}
                >
                  {begin.isPending ? "正在生成安全密钥…" : "开始设置"}
                </Button>
              </>
            )}
          </CardContent>
        </Card>
        {status.data?.enabled ? (
          <Card>
            <CardHeader>
              <h2 className="font-bold">撤销双因素认证</h2>
            </CardHeader>
            <CardContent>
              <form
                className="space-y-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  disable.mutate();
                }}
              >
                <p className="text-sm leading-6 text-[var(--text-muted)]">
                  这是敏感操作：需要当前密码和当前动态验证码。成功后，其它会话不会自动被撤销。
                </p>
                <Field label="当前密码">
                  <PasswordInput
                    autoComplete="current-password"
                    inputLabel="当前密码"
                    onChange={(event) => setDisablePassword(event.target.value)}
                    required
                    value={disablePassword}
                  />
                </Field>
                <Field label="动态验证码">
                  <input
                    autoComplete="one-time-code"
                    className={fieldClass}
                    inputMode="numeric"
                    maxLength={6}
                    onChange={(event) =>
                      setDisableCode(event.target.value.replace(/\D/g, ""))
                    }
                    required
                    value={disableCode}
                  />
                </Field>
                <ErrorMessage error={disable.error} />
                <Button
                  disabled={disable.isPending || disableCode.length !== 6}
                  type="submit"
                  variant="danger"
                >
                  {disable.isPending ? "正在撤销…" : "撤销双因素认证"}
                </Button>
              </form>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <h2 className="font-bold">恢复与设备管理</h2>
            </CardHeader>
            <CardContent>
              <p className="text-sm leading-6 text-[var(--text-muted)]">
                当前版本不生成恢复码。启用前请确认身份验证器已完成安全备份；遗失设备时，请由组织
                Owner 按既定身份核验流程协助处理。
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
}

const notificationCategories = [
  { category: "forgotten_work", title: "可能漏记", description: "较长时间没有新记录时提醒（默认由组织按需启用）。" },
  {
    category: "timer_long_running",
    title: "长时间计时",
    description: "计时器运行时间过长时提醒。",
  },
  { category: "work_overlap", title: "时间重叠", description: "非并行工作记录的时间范围相交时提醒。" },
  { category: "continuous_work_long", title: "连续工作偏长", description: "单段连续工作较长时温和提醒确认。" },
  { category: "duration_baseline_change", title: "近期时长变化", description: "相对本人近期基线变化明显时提醒核对。" },
  { category: "short_break", title: "工作间隔较短", description: "两段较长工作之间间隔过短时提醒。" },
  { category: "project_due_soon", title: "项目临期", description: "负责的项目节点临近截止时间时提醒。" },
  { category: "blocked_node_aging", title: "阻塞持续", description: "负责的项目节点持续阻塞时提醒。" },
  { category: "approval_returned", title: "审核退回", description: "工作记录被退回后提醒补充或修正。" },
  {
    category: "payroll_cutoff_pending",
    title: "薪资截止",
    description: "薪资截止日存在待处理事项时提醒。",
  },
  { category: "identity_request_result", title: "身份申请结果", description: "专业身份申请处理完成时提醒。" },
  { category: "export_ready", title: "导出完成", description: "后台导出文件准备完成时提醒。" },
  { category: "export_failed", title: "导出失败", description: "后台导出未完成时提醒并允许重试。" },
  {
    category: "ai_report_ready",
    title: "AI 报告完成",
    description: "异步洞察生成完成时提醒。",
  },
  {
    category: "ai_report_failed",
    title: "AI 报告失败",
    description: "异步洞察生成失败时提醒。",
  },
] as const;

interface NotificationPreference {
  category: string;
  inAppEnabled: boolean;
  mutedUntil: string | null;
  pushEnabled: boolean;
  emailEnabled: boolean;
  quietHours: Record<string, unknown>;
}

export function NotificationPreferencesPage() {
  const queryClient = useQueryClient();
  const [quietDraft, setQuietDraft] = useState<{
    start: string;
    end: string;
  } | null>(null);
  const preferences = useQuery({
    queryKey: ["notification-preferences"],
    queryFn: () =>
      api<{ items: NotificationPreference[] }>("/api/notification-preferences"),
  });
  const pushConfiguration = useQuery({
    queryKey: ["push-configuration"],
    queryFn: () => api<PushConfiguration>("/api/push/configuration"),
  });
  const currentSubscription = useQuery({
    queryKey: ["current-browser-push"],
    queryFn: () => currentBrowserPushSubscription().then(Boolean),
  });
  const savedQuiet = preferences.data?.items
    .map((item) => item.quietHours)
    .find(
      (item) =>
        typeof item.start === "string" && typeof item.end === "string",
    );
  const quietStart = quietDraft?.start ?? String(savedQuiet?.start ?? "22:00");
  const quietEnd = quietDraft?.end ?? String(savedQuiet?.end ?? "07:00");
  const currentBrowserSubscribed = Boolean(currentSubscription.data);

  const enablePush = useMutation({
    mutationFn: async () => {
      if (!pushConfiguration.data) throw new Error("推送配置仍在加载。");
      await enableCurrentBrowserPush(pushConfiguration.data);
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["current-browser-push"] }),
        queryClient.invalidateQueries({ queryKey: ["push-configuration"] }),
      ]);
    },
  });
  const disablePush = useMutation({
    mutationFn: disableCurrentBrowserPush,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["current-browser-push"] }),
        queryClient.invalidateQueries({ queryKey: ["push-configuration"] }),
      ]);
    },
  });
  const save = useMutation({
    mutationFn: (body: {
      category: string;
      inAppEnabled: boolean;
      pushEnabled: boolean;
      mutedUntil: string | null;
      quietHours: Record<string, unknown>;
    }) =>
      api("/api/notification-preferences", {
        method: "PUT",
        body: {
          ...body,
          emailEnabled: false,
        },
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["notification-preferences"],
      });
    },
  });
  const saveQuietHours = useMutation({
    mutationFn: (enabled: boolean) =>
      api("/api/notification-preferences/quiet-hours", {
        method: "PUT",
        body: {
          quietHours: enabled
            ? { start: quietStart, end: quietEnd, timeZone: timezone }
            : {},
        },
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["notification-preferences"],
      });
    },
  });
  const getPreference = (category: string) =>
    preferences.data?.items.find((item) => item.category === category) ?? {
      category,
      inAppEnabled: true,
      mutedUntil: null,
      pushEnabled: false,
      emailEnabled: false,
      quietHours: {},
    };
  const supportsPush = pushBrowserSupported();
  const pushAvailable = Boolean(pushConfiguration.data?.available);
  const savedQuietHours = preferences.data?.items.some(
    (item) =>
      typeof item.quietHours.start === "string" &&
      typeof item.quietHours.end === "string",
  );
  return (
    <>
      <PageHeader
        title="通知设置"
        description="按分类控制站内与浏览器提醒；浏览器订阅只作用于当前设备，关闭后不会影响其他已授权设备。"
      />
      <Card className="mb-5 max-w-4xl">
        <CardHeader>
          <div>
            <h2 className="font-bold">当前浏览器</h2>
            <p className="mt-1 text-sm text-[var(--text-muted)]">
              {!supportsPush
                ? "当前浏览器不支持标准 Web Push，站内提醒仍可正常使用。"
                : !pushAvailable
                  ? "服务端尚未配置 VAPID，站内提醒仍可正常使用。"
                  : currentBrowserSubscribed
                    ? `本设备已授权；账号共有 ${pushConfiguration.data?.activeSubscriptions.length ?? 0} 个有效浏览器订阅。`
                    : "服务已就绪；启用后再为需要的提醒分类打开推送。"}
            </p>
          </div>
          <Button
            disabled={
              pushConfiguration.isPending ||
              enablePush.isPending ||
              disablePush.isPending ||
              !supportsPush ||
              !pushAvailable
            }
            onClick={() =>
              currentBrowserSubscribed
                ? disablePush.mutate()
                : enablePush.mutate()
            }
            size="compact"
            variant={currentBrowserSubscribed ? "secondary" : "primary"}
          >
            {enablePush.isPending || disablePush.isPending
              ? "正在更新…"
              : currentBrowserSubscribed
                ? "关闭本设备推送"
                : "启用本设备推送"}
          </Button>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto_auto] sm:items-end">
            <label className="space-y-1.5 text-sm font-semibold">
              <span>免打扰开始</span>
              <input
                className={fieldClass}
                onChange={(event) =>
                  setQuietDraft({ start: event.target.value, end: quietEnd })
                }
                type="time"
                value={quietStart}
              />
            </label>
            <label className="space-y-1.5 text-sm font-semibold">
              <span>免打扰结束</span>
              <input
                className={fieldClass}
                onChange={(event) =>
                  setQuietDraft({ start: quietStart, end: event.target.value })
                }
                type="time"
                value={quietEnd}
              />
            </label>
            <Button
              disabled={saveQuietHours.isPending || quietStart === quietEnd}
              onClick={() => saveQuietHours.mutate(true)}
              size="compact"
              variant="secondary"
            >
              应用到全部分类
            </Button>
            <Button
              disabled={saveQuietHours.isPending || !savedQuietHours}
              onClick={() => saveQuietHours.mutate(false)}
              size="compact"
              variant="ghost"
            >
              清除免打扰
            </Button>
          </div>
          <p className="mt-2 text-xs text-[var(--text-muted)]">
            按当前设备时区 {timezone} 判断；跨午夜时段同样有效。免打扰只延后浏览器推送，不隐藏站内事实。
          </p>
          <div className="mt-3">
            <ErrorMessage
              error={
                pushConfiguration.error ??
                enablePush.error ??
                disablePush.error ??
                saveQuietHours.error
              }
            />
          </div>
        </CardContent>
      </Card>
      <Card className="max-w-4xl">
        <CardHeader>
          <div>
            <h2 className="font-bold">提醒分类</h2>
            <p className="mt-1 text-sm text-[var(--text-muted)]">
              各通道独立控制；临时静音会在截止时间自动恢复。
            </p>
          </div>
        </CardHeader>
        <CardContent>
          {preferences.isPending ? (
            <LoadingBlock />
          ) : (
            <div className="divide-y divide-[var(--border)]">
              {notificationCategories.map((item) => {
                const preference = getPreference(item.category);
                const muted =
                  preference.mutedUntil &&
                  new Date(preference.mutedUntil) > new Date();
                return (
                  <div
                    className="flex flex-col gap-3 py-4 first:pt-0 sm:flex-row sm:items-center"
                    key={item.category}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold">{item.title}</p>
                      <p className="mt-1 text-sm text-[var(--text-muted)]">
                        {item.description}
                        {muted
                          ? ` 已静音至 ${formatDateTime(preference.mutedUntil!)}`
                          : ""}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        disabled={save.isPending}
                        onClick={() =>
                          save.mutate({
                            category: item.category,
                            inAppEnabled: !preference.inAppEnabled,
                            pushEnabled: preference.pushEnabled,
                            mutedUntil: preference.mutedUntil,
                            quietHours: preference.quietHours,
                          })
                        }
                        size="compact"
                        variant={
                          preference.inAppEnabled ? "secondary" : "primary"
                        }
                      >
                        站内 {preference.inAppEnabled ? "已开" : "已关"}
                      </Button>
                      <Button
                        disabled={save.isPending || !currentBrowserSubscribed}
                        onClick={() =>
                          save.mutate({
                            category: item.category,
                            inAppEnabled: preference.inAppEnabled,
                            pushEnabled: !preference.pushEnabled,
                            mutedUntil: preference.mutedUntil,
                            quietHours: preference.quietHours,
                          })
                        }
                        size="compact"
                        variant={preference.pushEnabled ? "secondary" : "ghost"}
                      >
                        推送 {preference.pushEnabled ? "已开" : "已关"}
                      </Button>
                      {muted ? (
                        <Button
                          disabled={save.isPending}
                          onClick={() =>
                            save.mutate({
                              category: item.category,
                              inAppEnabled: preference.inAppEnabled,
                              pushEnabled: preference.pushEnabled,
                              mutedUntil: null,
                              quietHours: preference.quietHours,
                            })
                          }
                          size="compact"
                          variant="ghost"
                        >
                          取消静音
                        </Button>
                      ) : (
                        <Button
                          disabled={save.isPending || !preference.inAppEnabled}
                          onClick={() =>
                            save.mutate({
                              category: item.category,
                              inAppEnabled: preference.inAppEnabled,
                              pushEnabled: preference.pushEnabled,
                              mutedUntil: new Date(
                                Date.now() + 60 * 60_000,
                              ).toISOString(),
                              quietHours: preference.quietHours,
                            })
                          }
                          size="compact"
                          variant="ghost"
                        >
                          静音 1 小时
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <div className="mt-4">
            <ErrorMessage error={preferences.error ?? save.error} />
          </div>
        </CardContent>
      </Card>
    </>
  );
}

interface ImportPreview {
  importId: string;
  hash: string;
  rowCount: number;
  validCount: number;
  errors: Array<{ row: number; field: string; message: string }>;
}

export function ImportPage({ me }: { me: Me }) {
  const queryClient = useQueryClient();
  const [csv, setCsv] = useState("");
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const previewImport = useMutation({
    mutationFn: () =>
      api<ImportPreview>("/api/imports/work-sessions/preview", {
        method: "POST",
        body: { csv },
      }),
    onSuccess: setPreview,
  });
  const confirmImport = useMutation({
    mutationFn: () => {
      if (!preview) throw new Error("请先完成预览。");
      return api<{ importedCount: number }>(
        `/api/imports/${preview.importId}/confirm`,
        { method: "POST", body: { csv } },
      );
    },
    onSuccess: async () => {
      setPreview(null);
      setCsv("");
      setFileName("");
      await queryClient.invalidateQueries({ queryKey: ["work-sessions"] });
    },
  });
  if (
    !me.permissions.some(
      (grant) =>
        grant.permission === "import.scope" &&
        grant.scopeKind === "organization",
    )
  )
    return (
      <>
        <PageHeader title="导入工时" description="导入属于受控批量写入操作。" />
        <Card>
          <EmptyState
            description="你没有组织级导入授权；请联系组织管理员按范围授予 import.scope。"
            icon={<FileText />}
            title="没有导入权限"
          />
        </Card>
      </>
    );
  const selectFile = async (file: File | undefined) => {
    setPreview(null);
    setFileError(null);
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".csv")) {
      setFileError("请选择 CSV 文件。");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setFileError("CSV 文件不能超过 5 MB。");
      return;
    }
    setFileName(file.name);
    setCsv(await file.text());
  };
  const errors = preview?.errors ?? [];
  return (
    <>
      <PageHeader
        title="导入工时"
        description="文件仅在当前浏览器读取后提交预览。服务端会逐行校验并冻结内容哈希；确认时仅导入与预览完全相同的文件，任一行失败则整批不写入。"
      />
      <div className="grid max-w-5xl gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card>
          <CardHeader>
            <div>
              <h2 className="font-bold">上传 CSV</h2>
              <p className="mt-1 text-sm text-[var(--text-muted)]">
                必需列：startAt、endAt、content；可选列包括
                membershipId、timezone、result、blockers、nextStep、visibility。
              </p>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field
              hint="最大 5 MB、最多 10,000 条。填 membershipId 时会导入到该组织内的在职成员；留空才会导入到当前操作账号。"
              label="工时 CSV 文件"
            >
              <input
                accept=".csv,text/csv"
                className={fieldClass}
                onChange={(event) => void selectFile(event.target.files?.[0])}
                type="file"
              />
            </Field>
            {fileName ? (
              <p className="rounded-xl bg-[var(--surface-subtle)] p-3 text-sm">
                已选择：<strong>{fileName}</strong> ·{" "}
                {new Blob([csv]).size.toLocaleString("zh-CN")} bytes
              </p>
            ) : null}
            <ErrorMessage
              error={fileError ?? previewImport.error ?? confirmImport.error}
            />
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={!csv || previewImport.isPending}
                onClick={() => previewImport.mutate()}
              >
                {previewImport.isPending ? "正在逐行校验…" : "预览并校验"}
              </Button>
              <Button
                disabled={
                  !preview || errors.length > 0 || confirmImport.isPending
                }
                onClick={() => confirmImport.mutate()}
                variant="secondary"
              >
                {confirmImport.isPending ? "正在原子导入…" : "确认原子导入"}
              </Button>
            </div>
            {confirmImport.data ? (
              <p
                className="rounded-xl bg-[var(--success-soft)] p-3 text-sm text-[var(--success)]"
                role="status"
              >
                已原子导入 {confirmImport.data.importedCount} 条工时记录。
              </p>
            ) : null}
          </CardContent>
        </Card>
        <Card className="h-fit">
          <CardHeader>
            <h2 className="font-bold">预览结果</h2>
          </CardHeader>
          <CardContent>
            {preview ? (
              <div className="space-y-3">
                <StatusLine label="数据行" value={`${preview.rowCount} 条`} />
                <StatusLine label="可导入" value={`${preview.validCount} 条`} />
                <StatusLine label="错误" value={`${errors.length} 项`} />
                {errors.length === 0 ? (
                  <p className="rounded-xl bg-[var(--success-soft)] p-3 text-sm text-[var(--success)]">
                    校验通过，可以确认导入。
                  </p>
                ) : (
                  <p className="rounded-xl bg-[var(--danger-soft)] p-3 text-sm text-[var(--danger)]">
                    存在错误，确认按钮已禁用。修复原文件后请重新预览。
                  </p>
                )}
              </div>
            ) : (
              <p className="text-sm leading-6 text-[var(--text-muted)]">
                选择文件后点击“预览并校验”。不会在预览阶段写入任何工时。
              </p>
            )}
          </CardContent>
        </Card>
      </div>
      {errors.length ? (
        <Card className="mt-5 max-w-5xl">
          <CardHeader>
            <h2 className="font-bold">逐行错误</h2>
            <Badge tone="danger">最多显示全部返回错误</Badge>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[540px] text-left text-sm">
                <thead className="text-[var(--text-muted)]">
                  <tr>
                    <th className="pb-3 pr-4">行</th>
                    <th className="pb-3 pr-4">字段</th>
                    <th className="pb-3">原因</th>
                  </tr>
                </thead>
                <tbody>
                  {errors.map((error, index) => (
                    <tr
                      className="border-t border-[var(--border)]"
                      key={`${error.row}-${error.field}-${index}`}
                    >
                      <td className="py-3 pr-4 tabular-nums">{error.row}</td>
                      <td className="py-3 pr-4 font-mono text-xs">
                        {error.field}
                      </td>
                      <td className="py-3">{error.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </>
  );
}

export function PasswordResetRequestPage() {
  const requestReset = useMutation({
    mutationFn: (identifier: string) =>
      api<{ accepted: boolean; message: string }>(
        "/api/auth/password-reset/request",
        { method: "POST", body: { identifier } },
      ),
  });
  return (
    <AuthFrame
      title="重置密码"
      description="输入组织中登记的邮箱或手机号。无论该账号是否存在，系统都不会在此页面泄露账号状态；若组织已启用对应的真实投递渠道，链接会安全发送到已验证联系方式。"
    >
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          const formData = new FormData(event.currentTarget);
          const identifier = String(formData.get("identifier") ?? "").trim();
          if (!identifier) return;
          requestReset.mutate(identifier);
        }}
      >
        <Field label="邮箱或手机号">
          <input
            autoComplete="username"
            className={fieldClass}
            name="identifier"
            placeholder="邮箱、13812345678 或国际手机号"
            required
            type="text"
          />
        </Field>
        <ErrorMessage error={requestReset.error} />
        {requestReset.data ? (
          <p
            className="rounded-xl bg-[var(--success-soft)] p-3 text-sm text-[var(--success)]"
            role="status"
          >
            {requestReset.data.message}
          </p>
        ) : null}
        <p className="rounded-xl bg-[var(--surface-subtle)] px-3 py-2 text-xs leading-5 text-[var(--text-muted)]">
          若公司未启用自动邮件或短信，请联系唯一 Owner。出于账号安全，公开找回页面不会直接显示重置链接；Owner 可在组织成员详情完成二次验证后生成一次性手工链接并私下交付。
        </p>
        <Button
          className="w-full"
          disabled={requestReset.isPending}
          type="submit"
        >
          {requestReset.isPending ? "正在提交…" : "提交重置申请"}
        </Button>
        <p className="text-center text-sm">
          <Link
            className="font-semibold text-[var(--accent-strong)]"
            to="/login"
          >
            返回登录
          </Link>
        </p>
      </form>
    </AuthFrame>
  );
}

function ExistingSessionHandoff({
  currentSession,
  purpose,
}: {
  currentSession: Me | null;
  purpose: "接受邀请" | "重置密码";
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const logout = useMutation({
    mutationFn: async () => {
      await detachCurrentBrowserPushBeforeLogout();
      return api<void>("/api/auth/logout", { method: "POST" });
    },
    onSuccess: () => {
      resetCsrfToken();
      queryClient.removeQueries({
        predicate: (query) => query.queryKey[0] !== "me",
      });
      queryClient.setQueryData(["me"], null);
      notifySessionChanged();
    },
  });
  if (!currentSession) return null;
  return (
    <div className="space-y-4" role="status">
      <div className="rounded-2xl bg-[var(--warning-soft)] p-4 text-sm leading-6 text-[var(--text)]">
        <p className="font-bold">当前浏览器已登录其他账号</p>
        <p className="mt-1 text-[var(--text-muted)]">
          当前是{currentSession.user.isOwner ? "唯一 Owner" : "成员"}“
          {currentSession.user.displayName}”。为了避免把邀请或重置操作错误应用到当前账号，必须先退出当前会话，再继续{purpose}。一次性令牌只保留在本页内存中，不会写入浏览器存储。
        </p>
      </div>
      <ErrorMessage error={logout.error} />
      <Button
        className="w-full"
        disabled={logout.isPending}
        onClick={() => logout.mutate()}
        type="button"
      >
        {logout.isPending ? "正在安全退出…" : `退出当前账号并继续${purpose}`}
      </Button>
      <Button
        className="w-full"
        onClick={() => navigate("/", { replace: true })}
        type="button"
        variant="ghost"
      >
        返回当前账号
      </Button>
      <p className="text-center text-xs leading-5 text-[var(--text-muted)]">
        也可以在浏览器无痕窗口或另一浏览器中打开原始链接，以保留当前账号登录状态。
      </p>
    </div>
  );
}

export function PasswordResetPage({
  currentSession,
}: {
  currentSession: Me | null;
}) {
  const navigate = useNavigate();
  const [token] = useState(oneTimeTokenFromLocation);
  useEffect(() => {
    removeOneTimeTokenFromLocation();
  }, []);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const reset = useMutation({
    mutationFn: () => {
      if (password !== confirmation) throw new Error("两次输入的密码不一致。");
      return api("/api/auth/password-reset/complete", {
        method: "POST",
        body: { token, password },
      });
    },
    onSuccess: () => navigate("/login", { replace: true }),
  });
  return (
    <AuthFrame
      title="设置新密码"
      description="重置成功后，所有旧设备的登录会话都会被撤销。"
    >
      {currentSession ? (
        <ExistingSessionHandoff
          currentSession={currentSession}
          purpose="重置密码"
        />
      ) : (
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          reset.mutate();
        }}
      >
        <Field
          hint="至少 12 位，包含大小写字母、数字和特殊字符。"
          label="新密码"
        >
          <PasswordInput
            autoComplete="new-password"
            inputLabel="新密码"
            minLength={12}
            name="new-password"
            onChange={(event) => setPassword(event.target.value)}
            required
            value={password}
          />
        </Field>
        <Field label="确认新密码">
          <PasswordInput
            autoComplete="new-password"
            inputLabel="确认新密码"
            minLength={12}
            name="new-password-confirmation"
            onChange={(event) => setConfirmation(event.target.value)}
            required
            value={confirmation}
          />
        </Field>
        <ErrorMessage error={reset.error} />
        <Button
          className="w-full"
          disabled={!token || reset.isPending}
          type="submit"
        >
          {reset.isPending ? "正在安全重置…" : "重置密码并撤销旧会话"}
        </Button>
        {!token ? (
          <p className="text-sm text-[var(--danger)]" role="alert">
            链接中缺少一次性令牌，请重新申请重置邮件。
          </p>
        ) : null}
      </form>
      )}
    </AuthFrame>
  );
}

export function VerifyContactPage() {
  const navigate = useNavigate();
  const [token] = useState(oneTimeTokenFromLocation);
  const verify = useMutation({
    mutationFn: () =>
      api<{ verified: boolean; credential: AccountCredential }>(
        "/api/auth/credentials/verify",
        { method: "POST", body: { token } },
      ),
  });
  useEffect(() => {
    removeOneTimeTokenFromLocation();
  }, []);
  return (
    <AuthFrame
      title="验证联系方式"
      description="验证后，该邮箱或手机号才会成为可登录、可找回密码的账号标识。一次性令牌已从地址栏移除，验证结果仅由服务端确认。"
    >
      {verify.data?.verified ? (
        <div className="space-y-5">
          <div
            className="rounded-xl bg-[var(--success-soft)] p-4 text-sm leading-6 text-[var(--success)]"
            role="status"
          >
            {credentialKindLabel(verify.data.credential.kind)}已验证。现在可使用这项方式登录或找回密码。
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => navigate("/login")}>
              前往登录
            </Button>
            <Button onClick={() => navigate("/security")} variant="secondary">
              返回账户安全
            </Button>
          </div>
        </div>
      ) : (
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            verify.mutate();
          }}
        >
          <p className="rounded-xl bg-[var(--surface-subtle)] p-4 text-sm leading-6 text-[var(--text-muted)]">
            只有发送到该邮箱或手机号的本人才能打开这条链接。点击确认后，系统会消费一次性令牌；过期或已使用时请登录后在“账户安全”重新发送。
          </p>
          <ErrorMessage error={verify.error} />
          <Button
            className="w-full"
            disabled={!token || verify.isPending}
            type="submit"
          >
            <Check size={16} />
            {verify.isPending ? "正在验证…" : "确认验证联系方式"}
          </Button>
          {!token ? (
            <p className="text-sm text-[var(--danger)]" role="alert">
              链接中缺少一次性令牌，请从账户安全页面重新发送。
            </p>
          ) : null}
        </form>
      )}
    </AuthFrame>
  );
}

function AuthFrame({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="auth-shell grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(28rem,0.72fr)]">
      <section className="auth-story relative hidden overflow-hidden p-12 lg:flex lg:flex-col lg:justify-between">
        <div className="auth-brand flex items-center gap-3 text-sm font-bold text-[#253150]">
          <div className="auth-brand-mark grid size-10 place-items-center rounded-[14px]">
            <Clock3 size={20} />
          </div>
          <span>时序 · 工作智能</span>
        </div>
        <div className="auth-story-copy relative max-w-2xl">
          <p className="text-xs font-extrabold tracking-[0.16em] uppercase">
            Work intelligence, grounded in facts
          </p>
          <p className="mt-5 max-w-xl text-[42px] font-extrabold leading-[1.12] tracking-[-0.055em]">
            让每一段工作，
            <br />
            都有清晰的下一步。
          </p>
          <p className="mt-6 max-w-lg text-[15px] leading-7">
            记录、项目、审批、薪资与洞察共用同一条事实链。你专注推进工作，系统负责可靠地关联与解释。
          </p>
          <div className="mt-10 grid max-w-xl grid-cols-3 gap-3">
            <div className="auth-fact-card rounded-2xl border p-3">
              <p className="text-lg font-extrabold">01</p>
              <p className="mt-1 text-[11px] leading-4">记录真实工作</p>
            </div>
            <div className="auth-fact-card rounded-2xl border p-3">
              <p className="text-lg font-extrabold">02</p>
              <p className="mt-1 text-[11px] leading-4">关联项目事实</p>
            </div>
            <div className="auth-fact-card rounded-2xl border p-3">
              <p className="text-lg font-extrabold">03</p>
              <p className="mt-1 text-[11px] leading-4">生成可追溯洞察</p>
            </div>
          </div>
        </div>
        <p className="auth-story-footer text-xs text-[#7b88a3]">
          安全会话 · 最小权限 · 全程审计
        </p>
      </section>
      <section className="auth-panel relative flex items-center justify-center p-5 sm:p-10">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_100%_0%,color-mix(in_srgb,var(--accent)_10%,transparent),transparent_25rem)]" />
        <Card className="auth-panel-card relative w-full max-w-md shadow-[var(--shadow-float)]">
          <CardContent>
            <div className="mb-8">
              <div className="mb-5 grid size-10 place-items-center rounded-[14px] bg-[var(--accent-soft)] text-[var(--accent-strong)] lg:hidden">
                <Clock3 size={20} />
              </div>
              <p className="app-page-kicker">安全访问</p>
              <h1 className="mt-2 text-2xl font-extrabold tracking-[-0.04em]">
                {title}
              </h1>
              <p className="mt-3 text-sm leading-6 text-[var(--text-muted)]">
                {description}
              </p>
            </div>
            {children}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
export function SetupPage() {
  const navigate = useNavigate();
  const status = useQuery({
    queryKey: ["setup-status"],
    queryFn: () =>
      api<{ completed: boolean; setupAvailable: boolean }>("/api/setup/status"),
    retry: false,
  });
  const [form, setForm] = useState({
    organizationName: "",
    displayName: "",
    email: "",
    phone: "",
    password: "",
    token: "",
  });
  const setup = useMutation({
    mutationFn: () =>
      api("/api/setup/initial-owner", {
        method: "POST",
        headers: { "x-setup-token": form.token },
        body: {
          organizationName: form.organizationName,
          displayName: form.displayName,
          email: form.email,
          ...(form.phone.trim() ? { phone: form.phone.trim() } : {}),
          password: form.password,
          timezone,
        },
      }),
    onSuccess: () => navigate("/login", { replace: true }),
  });
  if (status.data?.completed)
    return (
      <AuthFrame
        title="初始化已完成"
        description="系统中已经存在唯一 Owner，初始化入口已永久锁定。"
      >
        <Button className="w-full" onClick={() => navigate("/login")}>
          返回登录
        </Button>
      </AuthFrame>
    );
  return (
    <AuthFrame
      title="初始化唯一 Owner"
      description="此操作只允许成功一次，并会在单个数据库事务中建立组织、Owner、角色与审计记录。邮箱是初始登录方式；可同时登记手机号，随后须通过真实短信验证才可用于登录或找回密码。"
    >
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          setup.mutate();
        }}
      >
        <Field label="组织名称">
          <input
            className={fieldClass}
            maxLength={120}
            minLength={2}
            onChange={(event) =>
              setForm({ ...form, organizationName: event.target.value })
            }
            required
            value={form.organizationName}
          />
        </Field>
        <Field label="Owner 姓名">
          <input
            className={fieldClass}
            maxLength={80}
            minLength={2}
            onChange={(event) =>
              setForm({ ...form, displayName: event.target.value })
            }
            required
            value={form.displayName}
          />
        </Field>
        <Field label="Owner 邮箱">
          <input
            autoComplete="email"
            className={fieldClass}
            onChange={(event) =>
              setForm({ ...form, email: event.target.value })
            }
            required
            type="email"
            value={form.email}
          />
        </Field>
        <Field
          hint="可选。中国大陆手机号直接填写 11 位；国际号码填写国家区号。初始化后在“账户安全”中通过真实短信完成验证，未验证前不会生效。"
          label="Owner 手机号（可选）"
        >
          <input
            autoComplete="tel"
            className={fieldClass}
            inputMode="tel"
            onChange={(event) =>
              setForm({ ...form, phone: event.target.value })
            }
            placeholder="13812345678"
            type="tel"
            value={form.phone}
          />
        </Field>
        <Field
          hint="至少 12 位，包含大小写字母、数字和特殊字符。"
          label="Owner 密码"
        >
          <PasswordInput
            autoComplete="new-password"
            inputLabel="Owner 密码"
            minLength={12}
            name="new-password"
            onChange={(event) =>
              setForm({ ...form, password: event.target.value })
            }
            required
            value={form.password}
          />
        </Field>
        <Field
          hint={
            status.data?.setupAvailable === false
              ? "服务端尚未配置 SETUP_TOKEN。"
              : "从部署环境变量 SETUP_TOKEN 获取，不会保存到浏览器。"
          }
          label="初始化令牌"
        >
          <PasswordInput
            autoComplete="off"
            inputLabel="初始化令牌"
            minLength={32}
            name="setup-token"
            onChange={(event) =>
              setForm({ ...form, token: event.target.value })
            }
            required
            value={form.token}
          />
        </Field>
        <ErrorMessage error={status.error ?? setup.error} />
        <Button
          className="w-full"
          disabled={setup.isPending || status.data?.setupAvailable === false}
          type="submit"
        >
          {setup.isPending ? "正在原子初始化…" : "创建组织与唯一 Owner"}
        </Button>
      </form>
    </AuthFrame>
  );
}

export function InvitationPage({
  currentSession,
}: {
  currentSession: Me | null;
}) {
  const navigate = useNavigate();
  const [token, setToken] = useState(oneTimeTokenFromLocation);
  useEffect(() => {
    removeOneTimeTokenFromLocation();
  }, []);
  const [password, setPassword] = useState("");
  const inspection = useQuery({
    queryKey: ["invitation-inspection"],
    queryFn: () =>
      api<{
        valid: boolean;
        serverTime: string;
        expiresAt: string | null;
        displayName: string | null;
      }>("/api/auth/invitations/inspect", {
        method: "POST",
        body: { token },
      }),
    enabled: Boolean(token),
    gcTime: 0,
    retry: false,
  });
  const accept = useMutation({
    mutationFn: () =>
      api("/api/auth/invitations/accept", {
        method: "POST",
        body: { token, password },
      }),
    onSuccess: () => navigate("/login", { replace: true }),
  });
  return (
    <AuthFrame
      title="接受组织邀请"
      description="设置个人密码后，邀请令牌会立即失效，成员状态变为在职。"
    >
      {currentSession ? (
        <ExistingSessionHandoff
          currentSession={currentSession}
          purpose="接受邀请"
        />
      ) : (
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          accept.mutate();
        }}
      >
        {token ? (
          inspection.isLoading ? (
            <p className="rounded-xl bg-[var(--surface-subtle)] px-3 py-2 text-sm text-[var(--text-muted)]">
              正在向服务端核验邀请链接…
            </p>
          ) : inspection.data?.valid ? (
            <p
              className="rounded-xl bg-[var(--success-soft)] px-3 py-2 text-sm text-[var(--success)]"
              role="status"
            >
              邀请有效
              {inspection.data.displayName
                ? `，将激活“${inspection.data.displayName}”`
                : ""}
              ；有效期至
              {inspection.data.expiresAt
                ? new Date(inspection.data.expiresAt).toLocaleString("zh-CN")
                : "未知时间"}
              。设置密码成功后才会失效。
            </p>
          ) : inspection.data?.valid === false ? (
            <p
              className="rounded-xl bg-[var(--danger-soft)] px-3 py-2 text-sm text-[var(--danger)]"
              role="alert"
            >
              这条邀请已经被使用、被新链接替代、被管理员撤销或超过有效期。请让管理员在对应的“待加入”成员详情中生成最新链接。
            </p>
          ) : (
            <p className="rounded-xl bg-[var(--warning-soft)] px-3 py-2 text-sm text-[var(--warning)]">
              暂时无法预检邀请；仍可提交，由服务端执行最终的单次原子校验。
            </p>
          )
        ) : (
          <Field hint="仅在没有完整链接时手工粘贴。" label="邀请令牌">
            <textarea
              autoComplete="off"
              className={textAreaClass}
              onChange={(event) => setToken(event.target.value)}
              required
              value={token}
            />
          </Field>
        )}
        <Field
          hint="至少 12 位，包含大小写字母、数字和特殊字符。"
          label="设置密码"
        >
          <PasswordInput
            autoComplete="new-password"
            inputLabel="设置密码"
            minLength={12}
            name="new-password"
            onChange={(event) => setPassword(event.target.value)}
            required
            value={password}
          />
        </Field>
        <ErrorMessage error={inspection.error ?? accept.error} />
        <Button
          className="w-full"
          disabled={
            accept.isPending ||
            inspection.isLoading ||
            inspection.data?.valid === false
          }
          type="submit"
        >
          {accept.isPending ? "正在加入组织…" : "接受邀请并激活账号"}
        </Button>
      </form>
      )}
    </AuthFrame>
  );
}

interface WorkSessionProjectLink {
  projectId: string;
  projectNodeId: string;
  projectNodeTitle: string;
  isPrimary: boolean;
  allocationBasisPoints: number;
}
interface WorkSession {
  id: string;
  startAt: string;
  endAt: string;
  timezone: string;
  netSeconds: number;
  content: string;
  result: string;
  blockers: string;
  nextStep: string;
  parallelWork: boolean;
  primaryProjectNodeId: string | null;
  projectLinks?: WorkSessionProjectLink[];
  source: string;
  recordKind: "fact" | "plan";
  submissionStatus: string;
  approvalStatus: string;
  version: number;
  visibility: string;
  breaks?: Array<{ startAt: string; endAt: string }>;
  anomalyFlags?: string[];
}

interface WorkSessionVersion {
  id: string;
  version: number;
  snapshot: unknown;
  changeReason: string | null;
  createdAt: string;
}

interface OwnWorkCorrection {
  correction: {
    id: string;
    workSessionId: string;
    status: "pending" | "approved" | "rejected" | "applied_next_period";
    reason: string;
    createdAt: string;
  };
}

function readWorkSnapshot(snapshot: unknown): {
  content: string | null;
  startAt: string | null;
  endAt: string | null;
  breaks: number | null;
  projectLinks: number | null;
} {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    return {
      content: null,
      startAt: null,
      endAt: null,
      breaks: null,
      projectLinks: null,
    };
  }
  const value = snapshot as Record<string, unknown>;
  return {
    content: typeof value.content === "string" ? value.content : null,
    startAt: typeof value.startAt === "string" ? value.startAt : null,
    endAt: typeof value.endAt === "string" ? value.endAt : null,
    breaks: Array.isArray(value.breaks) ? value.breaks.length : null,
    projectLinks: Array.isArray(value.projectLinks)
      ? value.projectLinks.length
      : null,
  };
}

function WorkVersionHistory({ sessionId }: { sessionId: string }) {
  const [open, setOpen] = useState(false);
  const history = useQuery({
    queryKey: ["work-session-versions", sessionId],
    queryFn: () =>
      api<{ items: WorkSessionVersion[] }>(
        `/api/work-sessions/${sessionId}/versions?limit=100`,
      ),
    enabled: open,
  });
  return (
    <section className="mt-1 px-2 pb-3" aria-label="工作记录版本历史">
      <button
        aria-expanded={open}
        className="text-xs font-bold text-[var(--accent-strong)]"
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        {open ? "收起版本历史" : "查看版本历史"}
      </button>
      {open ? (
        <div className="mt-2 space-y-2 rounded-xl bg-[var(--surface-subtle)] p-3">
          {history.isPending ? (
            <p className="text-xs text-[var(--text-muted)]">正在读取不可变快照…</p>
          ) : history.data?.items.length ? (
            history.data.items.map((entry) => {
              const snapshot = readWorkSnapshot(entry.snapshot);
              return (
                <div
                  className="rounded-lg bg-[var(--surface)] px-3 py-2 text-xs"
                  key={entry.id}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <strong>版本 {entry.version}</strong>
                    <span className="text-[var(--text-subtle)]">
                      {formatDateTime(entry.createdAt)}
                    </span>
                  </div>
                  <p className="mt-1 text-[var(--text-muted)]">
                    {entry.changeReason || "已保存事实快照"}
                    {snapshot.breaks !== null
                      ? ` · ${snapshot.breaks} 段休息`
                      : ""}
                    {snapshot.projectLinks !== null
                      ? ` · ${snapshot.projectLinks} 个项目关联`
                      : ""}
                  </p>
                  {snapshot.content ? (
                    <p className="mt-1 truncate text-[var(--text)]">
                      {snapshot.content}
                    </p>
                  ) : null}
                  {snapshot.startAt && snapshot.endAt ? (
                    <p className="mt-1 text-[var(--text-subtle)]">
                      {formatDateTime(snapshot.startAt)} –{" "}
                      {formatDateTime(snapshot.endAt)}
                    </p>
                  ) : null}
                </div>
              );
            })
          ) : (
            <p className="text-xs text-[var(--text-muted)]">
              当前记录尚未找到可展示的历史版本。
            </p>
          )}
          <ErrorMessage error={history.error} />
        </div>
      ) : null}
    </section>
  );
}

interface ManualWorkDraft {
  content: string;
  result: string;
  blockers: string;
  nextStep: string;
  startAt: string;
  endAt: string;
  visibility: string;
  parallelWork: boolean;
}

interface LocalManualPrefill {
  version: 1;
  savedAt: string;
  manual: ManualWorkDraft;
  breaks: Array<{ id: string; startAt: string; endAt: string }>;
  linkedProjectId: string;
  primaryProjectNodeId: string;
  linkedProjectNodes: LinkedProjectNode[];
}

const manualPrefillStorageKey = "workbench:manual-work-prefill:v1";
interface TimerState {
  id: string;
  status: "running" | "paused" | "on_break";
  startedAt: string;
  stateChangedAt: string;
  accumulatedSeconds: number;
  version: number;
  metadata: {
    content?: string;
    primaryProjectNodeId?: string | null;
    projectNodeIds?: string[];
  };
}
interface EvidenceAttachment {
  id: string;
  kind: "file" | "url" | "text";
  status: string;
  originalName: string | null;
  externalUrl: string | null;
  textContent?: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  visibility: string;
  note: string | null;
  sha256: string | null;
  version: number;
  uploadedAt: string;
  updatedAt: string;
}

interface EvidenceCapabilities {
  fileUploads: {
    available: boolean;
    maxBytes: number;
    acceptsArbitraryFormats: boolean;
    unavailableReason?: string;
  };
  references: { url: boolean; text: boolean };
}

interface EvidenceUploadIntent {
  attachment: EvidenceAttachment;
  uploadUrl: string;
  requiredHeaders: Record<string, string>;
}

type EvidenceUploadState =
  | "queued"
  | "hashing"
  | "uploading"
  | "verifying"
  | "complete"
  | "failed";

interface QueuedEvidenceFile {
  id: string;
  file: File;
  state: EvidenceUploadState;
  attachmentId?: string;
  error?: string;
}

interface EvidenceVersion {
  version: number;
  sha256: string | null;
  reason: string | null;
  replacedBy: string;
  createdAt: string;
}

function formatFileSize(sizeBytes: number | null): string {
  if (sizeBytes === null) return "大小未知";
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`;
  if (sizeBytes < 1024 * 1024 * 1024)
    return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(sizeBytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function evidenceUploadStateLabel(state: EvidenceUploadState): string {
  switch (state) {
    case "queued":
      return "等待上传";
    case "hashing":
      return "正在校验文件";
    case "uploading":
      return "正在直传";
    case "verifying":
      return "正在核验";
    case "complete":
      return "已完成";
    case "failed":
      return "需要重试";
  }
}

export function HomePage({ me }: { me: Me }) {
  const work = useQuery({
    queryKey: ["work-sessions", "home", "fact", 5],
    queryFn: () =>
      api<{ items: WorkSession[] }>(
        "/api/work-sessions?limit=5&recordKind=fact",
      ),
  });
  const timer = useQuery({
    queryKey: ["timer"],
    queryFn: () => api<{ timer: TimerState | null }>("/api/timer"),
  });
  const factualWork = (work.data?.items ?? []).filter(
    (item) => item.recordKind !== "plan",
  );
  const total =
    factualWork.reduce((sum, item) => sum + item.netSeconds, 0);
  const pendingCount =
    factualWork.filter((item) => item.approvalStatus === "pending_review")
      .length;
  const activeTimer = timer.data?.timer;

  return (
    <div className="home-page">
      <PageHeader title={`${me.user.displayName}，今天好`} />
      <div className="home-layout">
        <section className="home-primary">
          <Card className="home-focus-card">
            <CardHeader>
              <div>
                <div className="mb-3 flex items-center gap-2">
                  <span
                    className={
                      activeTimer?.status === "running"
                        ? "size-2 rounded-full bg-[var(--positive)] shadow-[0_0_0_4px_var(--positive-soft)]"
                        : "size-2 rounded-full bg-[var(--accent)]"
                    }
                  />
                  <p className="text-xs font-semibold text-[var(--text-muted)]">计时</p>
                </div>
                <h2 className="text-xl font-extrabold tracking-[-0.035em]">
                  当前计时
                </h2>
              </div>
              {activeTimer ? (
                <Badge
                  tone={
                    activeTimer.status === "running" ? "positive" : "warning"
                  }
                >
                  {activeTimer.status === "running"
                    ? "正在计时"
                    : activeTimer.status === "paused"
                      ? "已暂停"
                      : "休息中"}
                </Badge>
              ) : (
                <Badge>等待开始</Badge>
              )}
            </CardHeader>
            <CardContent>
              {timer.isPending ? (
                <LoadingBlock />
              ) : activeTimer ? (
                <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <p className="text-2xl font-extrabold tracking-[-0.04em]">
                      {activeTimer.metadata.content || "未命名工作"}
                    </p>
                    <p className="mt-2 text-sm text-[var(--text-muted)]">
                      开始于 {formatDateTime(activeTimer.startedAt)} ·
                      服务端累计{" "}
                      <strong className="text-[var(--text)]">
                        {formatDuration(activeTimer.accumulatedSeconds)}
                      </strong>
                    </p>
                  </div>
                  <Link to="/work">
                    <Button variant="secondary">
                      管理计时器
                      <ArrowUpRight size={16} />
                    </Button>
                  </Link>
                </div>
              ) : (
                <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex gap-4">
                    <div className="home-focus-orb grid size-12 shrink-0 place-items-center rounded-2xl text-[var(--accent-foreground)]">
                      <Clock3 size={22} />
                    </div>
                    <div>
                      <h3 className="font-bold">暂无计时</h3>
                    </div>
                  </div>
                  <Link to="/work">
                    <Button>
                      <Play size={16} />
                      开始计时
                    </Button>
                  </Link>
                </div>
              )}
            </CardContent>
          </Card>
          <div className="home-stats-grid">
            <Card className="home-stat-card">
              <CardContent>
                <p className="text-xs font-semibold text-[var(--text-muted)]">
                  最近记录时长
                </p>
                <p className="text-2xl font-extrabold tracking-[-0.04em] tabular-nums">
                  {formatDuration(total)}
                </p>
              </CardContent>
            </Card>
            <Card className="home-stat-card">
              <CardContent>
                <p className="text-xs font-semibold text-[var(--text-muted)]">
                  待处理审核
                </p>
                <p className="text-2xl font-extrabold tracking-[-0.04em] tabular-nums">
                  {pendingCount}
                  <span className="ml-1 text-sm font-semibold text-[var(--text-muted)]">
                    条
                  </span>
                </p>
              </CardContent>
            </Card>
          </div>
          <Card>
            <CardHeader>
              <div>
                <h2 className="font-extrabold tracking-[-0.025em]">
                  最近工作
                </h2>
              </div>
              <Link to="/work">
                <Button size="compact" variant="ghost">
                  全部记录
                  <ChevronRight size={15} />
                </Button>
              </Link>
            </CardHeader>
            <CardContent className="pt-5">
              {work.isPending ? (
                <LoadingBlock />
              ) : factualWork.length ? (
                <div className="divide-y divide-[var(--border)]">
                  {factualWork.map((item) => (
                    <WorkRow item={item} key={item.id} />
                  ))}
                </div>
              ) : (
                <EmptyState
                  description="开始计时或补录一段工作。"
                  icon={<TimerReset />}
                  title="还没有工作记录"
                />
              )}
            </CardContent>
          </Card>
        </section>
        <aside className="home-rail">
          <Card>
            <CardHeader>
              <div>
                <h2 className="font-extrabold tracking-[-0.025em]">
                  快速操作
                </h2>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              <Link
                className="home-action-link group flex items-center gap-3 rounded-xl border p-3 transition"
                to="/work"
              >
                <span className="grid size-9 place-items-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent-strong)]">
                  <Plus size={18} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-bold">补录一段工作</span>
                </span>
                <ArrowUpRight
                  className="text-[var(--text-subtle)] transition group-hover:text-[var(--accent-strong)]"
                  size={16}
                />
              </Link>
              <Link
                className="home-action-link group flex items-center gap-3 rounded-xl border p-3 transition"
                to="/projects"
              >
                <span className="grid size-9 place-items-center rounded-xl bg-[var(--info-soft)] text-[var(--info)]">
                  <ListTodo size={18} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-bold">查看项目推进</span>
                </span>
                <ArrowUpRight
                  className="text-[var(--text-subtle)] transition group-hover:text-[var(--accent-strong)]"
                  size={16}
                />
              </Link>
              <Link
                className="home-action-link group flex items-center gap-3 rounded-xl border p-3 transition"
                to="/ai"
              >
                <span className="grid size-9 place-items-center rounded-xl bg-[var(--warning-soft)] text-[var(--warning)]">
                  <Sparkles size={18} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-bold">生成工作洞察</span>
                </span>
                <ArrowUpRight
                  className="text-[var(--text-subtle)] transition group-hover:text-[var(--accent-strong)]"
                  size={16}
                />
              </Link>
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}

function StatusLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="home-fact-line flex items-center justify-between gap-4 rounded-xl px-3 py-3 text-sm">
      <span className="text-[var(--text-muted)]">{label}</span>
      <strong className="text-right">{value}</strong>
    </div>
  );
}

function WorkRow({ item, action }: { item: WorkSession; action?: ReactNode }) {
  const isPlan = item.recordKind === "plan";
  const statusTone =
    isPlan
      ? "info"
      : item.approvalStatus === "approved" || item.approvalStatus === "locked"
      ? "positive"
      : item.approvalStatus === "returned"
        ? "danger"
        : item.approvalStatus === "pending_review"
          ? "warning"
          : "neutral";
  const statusLabel = isPlan
    ? "计划草稿"
    : item.approvalStatus === "not_requested"
      ? "草稿"
      : item.approvalStatus === "pending_review"
        ? "待审核"
        : item.approvalStatus === "approved"
          ? "已批准"
          : item.approvalStatus === "returned"
            ? "已退回"
            : "已锁定";
  const projectLinks = item.projectLinks ?? [];
  return (
    <div className="work-row flex flex-col gap-3 px-2 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center" id={`work-session-${item.id}`}>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate font-semibold">{item.content}</p>
          <Badge tone={statusTone}>{statusLabel}</Badge>
        </div>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          {formatDateTime(item.startAt)} – {formatDateTime(item.endAt)} ·{" "}
          {formatDuration(item.netSeconds)} ·{" "}
          {isPlan ? "未计入事实" : item.source === "timer" ? "计时" : "手工"}
        </p>
        {item.anomalyFlags?.length ? (
          <div className="mt-2 flex flex-wrap gap-1.5" role="status">
            {item.anomalyFlags.map((flag) => (
              <span
                className="rounded-lg bg-[var(--danger-soft)] px-2 py-1 text-xs font-semibold text-[var(--danger)]"
                key={flag}
              >
                {formatWorkAnomaly(flag)}
              </span>
            ))}
          </div>
        ) : null}
        {projectLinks.length ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {projectLinks.map((link) => (
              <span
                className="inline-flex max-w-full items-center gap-1 rounded-lg bg-[var(--surface-subtle)] px-2 py-1 text-xs text-[var(--text-muted)]"
                key={link.projectNodeId}
              >
                <span
                  className={
                    link.isPrimary
                      ? "size-1.5 shrink-0 rounded-full bg-[var(--accent)]"
                      : "size-1.5 shrink-0 rounded-full bg-[var(--text-subtle)]"
                  }
                />
                {link.isPrimary ? "主关联" : "关联"} ·{" "}
                <span className="truncate">{link.projectNodeTitle}</span>
              </span>
            ))}
          </div>
        ) : null}
      </div>
      {action}
    </div>
  );
}

function dayHour(value: string | Date): number {
  const date = new Date(value);
  return date.getHours() + date.getMinutes() / 60;
}

function sameLocalDate(left: string | Date, right: string | Date): boolean {
  const leftDate = new Date(left);
  const rightDate = new Date(right);
  return (
    leftDate.getFullYear() === rightDate.getFullYear() &&
    leftDate.getMonth() === rightDate.getMonth() &&
    leftDate.getDate() === rightDate.getDate()
  );
}

function WorkDayTimeline({
  sessions,
  startAt,
  endAt,
  content,
  breaks,
}: {
  sessions: WorkSession[];
  startAt: string;
  endAt: string;
  content: string;
  breaks: Array<{ startAt: string; endAt: string }>;
}) {
  const startHour = 7;
  const endHour = 22;
  const totalHours = endHour - startHour;
  const manualStart = new Date(startAt);
  const manualEnd = new Date(endAt);
  const hasPreview =
    !Number.isNaN(manualStart.getTime()) &&
    !Number.isNaN(manualEnd.getTime()) &&
    manualEnd.getTime() > manualStart.getTime();
  const breakPreviews = breaks
    .map((entry) => ({
      startAt: new Date(entry.startAt),
      endAt: new Date(entry.endAt),
    }))
    .filter(
      (entry) =>
        !Number.isNaN(entry.startAt.getTime()) &&
        !Number.isNaN(entry.endAt.getTime()) &&
        entry.endAt > entry.startAt,
    );
  const toPosition = (value: string | Date) =>
    Math.max(
      0,
      Math.min(100, ((dayHour(value) - startHour) / totalHours) * 100),
    );
  const toHeight = (from: string | Date, to: string | Date) =>
    Math.max(
      6,
      Math.min(
        100,
        (((sameLocalDate(from, to) ? dayHour(to) : 24) - dayHour(from)) /
          totalHours) *
          100,
      ),
    );
  const daySessions = hasPreview
    ? sessions.filter((item) => sameLocalDate(item.startAt, manualStart))
    : sessions.slice(0, 5);
  const hours = ["07", "09", "11", "13", "15", "17", "19", "21"];

  return (
    <section className="work-day-timeline" aria-label="当日时间预览">
      <div className="work-day-timeline-head">
        <div>
          <p className="app-section-label">当日时间轴</p>
          <h3 className="mt-2 font-extrabold tracking-[-0.025em]">
            录入区间预览
          </h3>
          <p className="mt-1 max-w-sm text-xs leading-5 text-[var(--text-muted)]">
            时间预览随表单实时变化；保存时服务端会再次校验重叠、休息区间与净时长。
          </p>
        </div>
        <Badge tone="info">
          {hasPreview && !sameLocalDate(manualStart, manualEnd)
            ? "跨日预览"
            : "日内预览"}
        </Badge>
      </div>
      <div className="work-timeline-frame">
        <div className="work-timeline-hours">
          {hours.map((hour) => (
            <span key={hour}>{hour}:00</span>
          ))}
        </div>
        <div className="work-timeline-track">
          {daySessions.map((item) => (
            <div
              className="work-timeline-event"
              key={item.id}
              style={{
                top: `${toPosition(item.startAt)}%`,
                height: `${toHeight(item.startAt, item.endAt)}%`,
              }}
            >
              <strong className="truncate">{item.content}</strong>
              <small>
                {formatDateTime(item.startAt)} ·{" "}
                {formatDuration(item.netSeconds)}
              </small>
            </div>
          ))}
          {hasPreview ? (
            <div
              className="work-timeline-event is-preview"
              style={{
                top: `${toPosition(manualStart)}%`,
                height: `${toHeight(manualStart, manualEnd)}%`,
              }}
            >
              <strong className="truncate">
                {content.trim() || "正在录入的工作"}
              </strong>
              <small>
                {formatDateTime(manualStart)} – {formatDateTime(manualEnd)}
              </small>
            </div>
          ) : null}
          {breakPreviews.map((entry, index) => (
            <div
              className="work-timeline-break"
              key={[entry.startAt.toISOString(), index].join("-")}
              style={{
                top: String(toPosition(entry.startAt)) + "%",
                height: String(toHeight(entry.startAt, entry.endAt)) + "%",
              }}
            >
              <span>
                休息 · {formatDateTime(entry.startAt)} –{" "}
                {formatDateTime(entry.endAt)}
              </span>
            </div>
          ))}
        </div>
      </div>
      {hasPreview && !sameLocalDate(manualStart, manualEnd) ? (
        <p className="mt-3 text-xs leading-5 text-[var(--text-muted)]">
          该记录跨越午夜：时间线仅显示开始日片段；精确区间、净时长和薪资切分均由服务端按带时区的时间戳计算。
        </p>
      ) : null}
    </section>
  );
}
function EvidencePanel({ sessionId }: { sessionId: string }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [queuedFiles, setQueuedFiles] = useState<QueuedEvidenceFile[]>([]);
  const [reference, setReference] = useState("");
  const [textReference, setTextReference] = useState("");
  const [note, setNote] = useState("");
  const [visibility, setVisibility] = useState<
    "private" | "management_only" | "project_visible"
  >("management_only");
  const [replacementFor, setReplacementFor] = useState<string | null>(null);
  const [replacementReason, setReplacementReason] = useState("");
  const [versionsFor, setVersionsFor] = useState<string | null>(null);
  const evidence = useQuery({
    queryKey: ["evidence", sessionId],
    queryFn: () =>
      api<{ items: EvidenceAttachment[] }>(
        `/api/work-sessions/${sessionId}/attachments`,
      ),
    enabled: open,
  });
  const capabilities = useQuery({
    queryKey: ["evidence-capabilities"],
    queryFn: () => api<EvidenceCapabilities>("/api/evidence/capabilities"),
    enabled: open,
  });
  const versionHistory = useQuery({
    queryKey: ["evidence-versions", versionsFor],
    queryFn: () =>
      api<{ items: EvidenceVersion[] }>(
        `/api/attachments/${versionsFor!}/versions`,
      ),
    enabled: Boolean(versionsFor),
  });
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["evidence", sessionId] });
  };
  const updateQueuedFile = (
    id: string,
    update: Partial<QueuedEvidenceFile>,
  ) => {
    setQueuedFiles((current) =>
      current.map((item) => (item.id === id ? { ...item, ...update } : item)),
    );
  };
  const uploadOne = async (queued: QueuedEvidenceFile) => {
    const fileUploads = capabilities.data?.fileUploads;
    if (!fileUploads?.available) {
      throw new Error(
        "文件对象存储尚未配置。链接和文字证据仍可立即保存；请由 Owner 配置私有 S3 兼容存储后再上传文件。",
      );
    }
    if (queued.file.size > fileUploads.maxBytes) {
      throw new Error(
        `“${queued.file.name}”超过单件 ${formatFileSize(fileUploads.maxBytes)} 的安全上限。`,
      );
    }
    if (!crypto.subtle) {
      throw new Error("当前浏览器不支持文件完整性校验，请使用受支持的现代浏览器。 ");
    }
    updateQueuedFile(queued.id, { state: "hashing" });
    const bytes = await queued.file.arrayBuffer();
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const sha256 = Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    const fileInput = {
      originalName: queued.file.name,
      // Empty browser types are common for code and specialized artefacts.
      // The server stores every file as opaque binary for safe download.
      mimeType: queued.file.type || "application/octet-stream",
      sizeBytes: queued.file.size,
      sha256,
    };
    let intent: EvidenceUploadIntent;
    if (queued.attachmentId) {
      intent = await api<EvidenceUploadIntent>(
        `/api/attachments/${queued.attachmentId}/upload-url`,
        { method: "POST" },
      );
    } else {
      intent = await api<EvidenceUploadIntent>(
        replacementFor
          ? `/api/attachments/${replacementFor}/replacement-intent`
          : `/api/work-sessions/${sessionId}/attachments/upload-intent`,
        {
          method: "POST",
          body: replacementFor
            ? {
                ...fileInput,
                note: note.trim() || undefined,
                reason: replacementReason.trim() || "在工作台替换文件证据",
              }
            : {
                ...fileInput,
                visibility,
                note: note.trim() || undefined,
              },
        },
      );
    }
    updateQueuedFile(queued.id, {
      state: "uploading",
      attachmentId: intent.attachment.id,
    });
    const uploaded = await fetch(intent.uploadUrl, {
      method: "PUT",
      headers: intent.requiredHeaders,
      body: queued.file,
    });
    if (!uploaded.ok) {
      throw new Error(
        `“${queued.file.name}”未能上传到受保护的对象存储（HTTP ${uploaded.status}）。可直接重试。`,
      );
    }
    updateQueuedFile(queued.id, { state: "verifying" });
    await api(`/api/attachments/${intent.attachment.id}/complete`, {
      method: "POST",
    });
    updateQueuedFile(queued.id, { state: "complete" });
  };
  const upload = useMutation({
    mutationFn: async (onlyIds?: string[]) => {
      const candidates = queuedFiles.filter(
        (item) =>
          (item.state === "queued" || item.state === "failed") &&
          (!onlyIds || onlyIds.includes(item.id)),
      );
      if (!candidates.length) {
        throw new Error("请先选择至少一个待上传或待重试的文件。 ");
      }
      let succeeded = 0;
      let failed = 0;
      // Sequential uploads deliberately keep browser memory/network pressure
      // bounded. There is no application-level attachment-count cap, and one
      // failed file never prevents the remaining selected files from running.
      for (const queued of candidates) {
        try {
          await uploadOne(queued);
          succeeded += 1;
        } catch (error) {
          failed += 1;
          updateQueuedFile(queued.id, {
            state: "failed",
            error:
              error instanceof Error ? error.message : "文件上传失败，请重试。",
          });
        }
      }
      if (failed) {
        throw new Error(
          `${succeeded} 个文件已完成，${failed} 个文件未完成。失败项可单独或批量重试，不会重复创建证据。`,
        );
      }
      return { succeeded };
    },
    onSuccess: () => {
      if (replacementFor) {
        setReplacementFor(null);
        setReplacementReason("");
      }
    },
    onSettled: refresh,
  });
  const addUrl = useMutation({
    mutationFn: () =>
      api(`/api/work-sessions/${sessionId}/attachments/reference`, {
        method: "POST",
        body: {
          kind: "url",
          externalUrl: reference,
          visibility,
          note: note.trim() || undefined,
        },
      }),
    onSuccess: async () => {
      setReference("");
      await refresh();
    },
  });
  const addText = useMutation({
    mutationFn: () =>
      api(`/api/work-sessions/${sessionId}/attachments/reference`, {
        method: "POST",
        body: {
          kind: "text",
          textContent: textReference,
          visibility,
          note: note.trim() || undefined,
        },
      }),
    onSuccess: async () => {
      setTextReference("");
      await refresh();
    },
  });
  const download = useMutation({
    mutationFn: (id: string) =>
      api<{ url: string }>(`/api/attachments/${id}/download`),
    onSuccess: (data) => window.open(data.url, "_blank", "noopener,noreferrer"),
  });
  const remove = useMutation({
    mutationFn: (id: string) =>
      api(`/api/attachments/${id}`, {
        method: "DELETE",
        body: { reason: "在工作台删除证据" },
      }),
    onSuccess: refresh,
  });
  const fileUploads = capabilities.data?.fileUploads;
  return (
    <div className="mt-3 rounded-2xl bg-[var(--surface-subtle)] p-3">
      <Button
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        size="compact"
        variant="secondary"
      >
        <Paperclip size={15} />
        {open ? "收起证据" : "证据"}
      </Button>
      {open ? (
        <div className="mt-3 space-y-3">
          {capabilities.isPending ? (
            <p className="text-xs text-[var(--text-muted)]">
              正在确认文件存储能力…
            </p>
          ) : fileUploads?.available ? (
            <>
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  aria-label={replacementFor ? "选择替换文件" : "选择工作证据文件"}
                  className="block min-w-0 flex-1 text-sm"
                  multiple={!replacementFor}
                  onChange={(event) => {
                    const selected = Array.from(event.currentTarget.files ?? []);
                    if (!selected.length) return;
                    const files = replacementFor ? selected.slice(0, 1) : selected;
                    setQueuedFiles((current) =>
                      replacementFor
                        ? files.map((file) => ({
                            id: crypto.randomUUID(),
                            file,
                            state: "queued" as const,
                          }))
                        : [
                            ...current,
                            ...files.map((file) => ({
                              id: crypto.randomUUID(),
                              file,
                              state: "queued" as const,
                            })),
                          ],
                    );
                    event.currentTarget.value = "";
                  }}
                  type="file"
                />
                <Button
                  disabled={
                    !queuedFiles.some(
                      (item) => item.state === "queued" || item.state === "failed",
                    ) || upload.isPending
                  }
                  onClick={() => upload.mutate()}
                  size="compact"
                >
                  {upload.isPending
                    ? "上传中…"
                    : replacementFor
                      ? "确认替换"
                      : "上传队列"}
                </Button>
              </div>
              <p className="text-xs leading-5 text-[var(--text-muted)]">
                任意格式，可多选；单件上限 {formatFileSize(fileUploads.maxBytes)}。
              </p>
            </>
          ) : (
            <div
              className="rounded-xl bg-[var(--warning-soft)] px-3 py-2 text-xs leading-5 text-[var(--warning)]"
              role="status"
            >
              {fileUploads?.unavailableReason ?? "文件对象存储尚未配置。"} 暂时可添加链接或文字证据。
            </div>
          )}
          {replacementFor ? (
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                className={fieldClass}
                maxLength={1000}
                onChange={(event) => setReplacementReason(event.target.value)}
                placeholder="替换原因（将进入审计记录）"
                value={replacementReason}
              />
              <Button
                onClick={() => {
                  setReplacementFor(null);
                  setReplacementReason("");
                  setQueuedFiles([]);
                }}
                size="compact"
                variant="secondary"
              >
                取消替换
              </Button>
            </div>
          ) : null}
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
            <input
              className={fieldClass}
              maxLength={2000}
              onChange={(event) => setNote(event.target.value)}
              placeholder="证据备注（可选，适用于本次文件/链接/文字）"
              value={note}
            />
            <select
              aria-label="证据可见范围"
              className={fieldClass}
              onChange={(event) =>
                setVisibility(
                  event.target.value as
                    | "private"
                    | "management_only"
                    | "project_visible",
                )
              }
              value={visibility}
            >
              <option value="private">仅本人</option>
              <option value="management_only">管理可见</option>
              <option value="project_visible">关联项目可见</option>
            </select>
          </div>
          {queuedFiles.length ? (
            <div className="space-y-1" role="status">
              {queuedFiles.map((queued) => (
                <div
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-[var(--surface)] px-3 py-2 text-xs"
                  key={queued.id}
                >
                  <span className="min-w-0 flex-1 truncate">
                    <strong>{queued.file.name}</strong> · {formatFileSize(queued.file.size)} · {evidenceUploadStateLabel(queued.state)}
                    {queued.error ? `：${queued.error}` : ""}
                  </span>
                  <span className="flex shrink-0 gap-1">
                    {queued.state === "failed" ? (
                      <Button
                        disabled={upload.isPending}
                        onClick={() => upload.mutate([queued.id])}
                        size="compact"
                        variant="secondary"
                      >
                        重试
                      </Button>
                    ) : null}
                    {queued.state === "queued" || queued.state === "failed" ? (
                      <Button
                        disabled={upload.isPending}
                        onClick={() =>
                          setQueuedFiles((current) =>
                            current.filter((item) => item.id !== queued.id),
                          )
                        }
                        size="compact"
                        variant="ghost"
                      >
                        移除
                      </Button>
                    ) : null}
                  </span>
                </div>
              ))}
              {queuedFiles.some((item) => item.state === "complete") ? (
                <Button
                  onClick={() =>
                    setQueuedFiles((current) =>
                      current.filter((item) => item.state !== "complete"),
                    )
                  }
                  size="compact"
                  variant="ghost"
                >
                  清除已完成项
                </Button>
              ) : null}
            </div>
          ) : null}
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              className={fieldClass}
              onChange={(event) => setReference(event.target.value)}
              placeholder="https://… 关联外部证据"
              type="url"
              value={reference}
            />
            <Button
              disabled={!reference.trim() || addUrl.isPending}
              onClick={() => addUrl.mutate()}
              size="compact"
              variant="secondary"
            >
              添加链接
            </Button>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <textarea
              className={`${textAreaClass} min-h-20`}
              maxLength={20000}
              onChange={(event) => setTextReference(event.target.value)}
              placeholder="粘贴简短文字证据、会议纪要、命令输出或说明…"
              value={textReference}
            />
            <Button
              disabled={!textReference.trim() || addText.isPending}
              onClick={() => addText.mutate()}
              size="compact"
              variant="secondary"
            >
              保存文字
            </Button>
          </div>
          <ErrorMessage
            error={
              upload.error ??
              addUrl.error ??
              addText.error ??
              download.error ??
              remove.error ??
              evidence.error ??
              capabilities.error ??
              versionHistory.error
            }
          />
          {evidence.isPending ? (
            <p className="text-sm text-[var(--text-muted)]">正在读取证据…</p>
          ) : evidence.data?.items.length ? (
            <ul className="space-y-2">
              {evidence.data.items.map((item) => (
                <li
                  className="rounded-xl bg-[var(--surface)] px-3 py-2 text-sm"
                  key={item.id}
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <span className="min-w-0 flex-1">
                      <strong className="block truncate">
                        {item.kind === "file"
                          ? item.originalName
                          : item.kind === "url"
                            ? item.externalUrl
                            : item.textContent?.slice(0, 140)}
                      </strong>
                      <span className="mt-1 block text-xs leading-5 text-[var(--text-subtle)]">
                        {item.kind === "file"
                          ? `${formatFileSize(item.sizeBytes)} · ${item.mimeType ?? "二进制文件"}`
                          : item.kind === "text"
                            ? "文字证据"
                            : "外部链接"}
                        {" · "}
                        {item.visibility === "private"
                          ? "仅本人"
                          : item.visibility === "project_visible"
                            ? "关联项目可见"
                            : "管理可见"}
                        {" · "}
                        {item.status === "available"
                          ? "已通过核验"
                          : item.status === "pending_upload"
                            ? "待完成上传"
                            : item.status === "quarantined"
                              ? "已隔离"
                              : item.status}
                        {` · v${item.version}`}
                        {item.note ? ` · ${item.note}` : ""}
                      </span>
                    </span>
                    <span className="flex shrink-0 flex-wrap gap-1">
                      {item.kind === "file" ? (
                        <>
                          <Button
                            disabled={
                              download.isPending || item.status !== "available"
                            }
                            onClick={() => download.mutate(item.id)}
                            size="compact"
                            variant="secondary"
                          >
                            <FileText size={14} />
                            下载
                          </Button>
                          <Button
                            onClick={() => {
                              setReplacementFor(item.id);
                              setQueuedFiles([]);
                            }}
                            size="compact"
                            variant="secondary"
                          >
                            替换
                          </Button>
                          <Button
                            onClick={() =>
                              setVersionsFor((current) =>
                                current === item.id ? null : item.id,
                              )
                            }
                            size="compact"
                            variant="ghost"
                          >
                            历史
                          </Button>
                        </>
                      ) : item.kind === "url" && item.externalUrl ? (
                        <a
                          aria-label="打开外部证据"
                          className="inline-flex items-center px-2 text-[var(--accent-strong)]"
                          href={item.externalUrl}
                          rel="noreferrer"
                          target="_blank"
                        >
                          <ExternalLink size={16} />
                        </a>
                      ) : null}
                      <Button
                        disabled={remove.isPending}
                        onClick={() => {
                          if (window.confirm("删除后将保留审计记录，确定继续？"))
                            remove.mutate(item.id);
                        }}
                        size="compact"
                        variant="ghost"
                      >
                        删除
                      </Button>
                    </span>
                  </div>
                  {versionsFor === item.id ? (
                    <div className="mt-2 rounded-lg bg-[var(--surface-subtle)] px-3 py-2 text-xs text-[var(--text-muted)]">
                      {versionHistory.isPending ? (
                        "正在读取版本链…"
                      ) : versionHistory.data?.items.length ? (
                        <ul className="space-y-1">
                          {versionHistory.data.items.map((version) => (
                            <li key={version.version}>
                              v{version.version} · {version.reason || "原始版本"} · {new Date(version.createdAt).toLocaleString("zh-CN")}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        "当前文件尚无历史版本。"
                      )}
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-[var(--text-muted)]">暂无可见证据。</p>
          )}
        </div>
      ) : null}
    </div>
  );
}

function TimerProjectAssociation({
  projects,
  projectId,
  selectedNodes,
  primaryProjectNodeId,
  onProjectIdChange,
  onSelectedNodesChange,
  onPrimaryProjectNodeIdChange,
}: {
  projects: Project[];
  projectId: string;
  selectedNodes: LinkedProjectNode[];
  primaryProjectNodeId: string;
  onProjectIdChange: (projectId: string) => void;
  onSelectedNodesChange: (nodes: LinkedProjectNode[]) => void;
  onPrimaryProjectNodeIdChange: (nodeId: string) => void;
}) {
  const projectTree = useQuery({
    queryKey: ["timer-project-tree", projectId],
    queryFn: () =>
      api<{ nodes: ProjectNode[] }>(`/api/projects/${projectId}/tree`),
    enabled: Boolean(projectId),
  });
  const activeProject = projects.find((project) => project.id === projectId);
  const activeProjectLabel = activeProject
    ? `${activeProject.key} · ${activeProject.name}`
    : "当前项目";
  const activeNodeOptions: LinkedProjectNode[] = (
    projectTree.data?.nodes ?? []
  ).map((node) => ({
    id: node.id,
    projectId,
    projectLabel: activeProjectLabel,
    title: node.title,
    type: node.type,
    status: node.status,
  }));
  const primaryChoices = [...selectedNodes, ...activeNodeOptions].filter(
    (node, index, nodes) =>
      nodes.findIndex((candidate) => candidate.id === node.id) === index,
  );
  const addNode = (node: LinkedProjectNode, primary = false) => {
    onSelectedNodesChange(
      selectedNodes.some((candidate) => candidate.id === node.id)
        ? selectedNodes
        : [...selectedNodes, node],
    );
    if (primary || !primaryProjectNodeId) onPrimaryProjectNodeIdChange(node.id);
  };
  const removeNode = (nodeId: string) => {
    const remaining = selectedNodes.filter((node) => node.id !== nodeId);
    onSelectedNodesChange(remaining);
    if (primaryProjectNodeId === nodeId)
      onPrimaryProjectNodeIdChange(remaining[0]?.id ?? "");
  };

  return (
    <details className="timer-project-disclosure">
      <summary>
        <span className="timer-project-disclosure-title">
          <FolderKanban size={15} />
          关联项目节点（可选）
        </span>
        <span className="timer-project-disclosure-state">
          {selectedNodes.length
            ? `已关联 ${selectedNodes.length} / 32`
            : "未关联"}
        </span>
      </summary>
      <div className="timer-project-disclosure-body">
        <Field
          hint="计时结束后会把关联写入同一条工作事实；可跨项目逐个添加节点。"
          label="计时关联项目（可选）"
        >
          <select
            aria-label="计时关联项目（可选）"
            className={fieldClass}
            onChange={(event) => onProjectIdChange(event.target.value)}
            value={projectId}
          >
            <option value="">选择项目以添加节点</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.key} · {project.name}
              </option>
            ))}
          </select>
        </Field>
        {projectId ? (
          <Field
            hint={
              projectTree.isPending
                ? "正在读取该项目的可关联节点…"
                : "首个勾选节点会自动成为主关联；其余节点只保留工作上下文。"
            }
            label="从当前项目添加节点"
          >
            <div className="timer-project-node-list">
              {projectTree.isPending ? (
                <p>正在读取节点…</p>
              ) : activeNodeOptions.length ? (
                activeNodeOptions.map((node) => {
                  const selected = selectedNodes.some(
                    (candidate) => candidate.id === node.id,
                  );
                  return (
                    <label
                      className={
                        selected || selectedNodes.length < 32
                          ? "timer-project-node-row"
                          : "timer-project-node-row is-disabled"
                      }
                      key={node.id}
                    >
                      <input
                        aria-label={`计时关联 ${node.title}`}
                        checked={selected}
                        disabled={!selected && selectedNodes.length >= 32}
                        onChange={(event) =>
                          event.target.checked
                            ? addNode(node)
                            : removeNode(node.id)
                        }
                        type="checkbox"
                      />
                      <span className="min-w-0 flex-1 truncate">
                        {node.title}
                      </span>
                      <small>
                        {node.type} · {node.status}
                      </small>
                    </label>
                  );
                })
              ) : (
                <p>该项目暂无可关联节点。</p>
              )}
            </div>
          </Field>
        ) : (
          <p className="timer-project-association-note">
            不关联项目也可以开始计时；稍后可从工作记录中补录。
          </p>
        )}
        {projectId || selectedNodes.length ? (
          <Field
            hint="主关联用于项目投入归集；辅助关联不会重复计算时长。"
            label="计时主项目节点"
          >
            <select
              aria-label="计时主项目节点"
              className={fieldClass}
              onChange={(event) => {
                const node = primaryChoices.find(
                  (candidate) => candidate.id === event.target.value,
                );
                if (!node) {
                  onPrimaryProjectNodeIdChange("");
                  return;
                }
                addNode(node, true);
              }}
              required={selectedNodes.length > 0}
              value={primaryProjectNodeId}
            >
              <option value="">选择主项目节点</option>
              {primaryChoices.map((node) => (
                <option key={node.id} value={node.id}>
                  {node.projectLabel} · {node.title} · {node.type}
                </option>
              ))}
            </select>
          </Field>
        ) : null}
        {selectedNodes.length ? (
          <div className="timer-project-link-summary">
            <div>
              <strong>已关联 {selectedNodes.length} / 32 个节点</strong>
              <span>紫点表示主关联</span>
            </div>
            <div>
              {selectedNodes.map((node) => (
                <span key={node.id}>
                  <i
                    className={
                      node.id === primaryProjectNodeId ? "is-primary" : ""
                    }
                  />
                  <b className="truncate">{node.title}</b>
                  <button
                    aria-label={`移除计时关联 ${node.title}`}
                    onClick={() => removeNode(node.id)}
                    type="button"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          </div>
        ) : null}
        <ErrorMessage error={projectTree.error} />
      </div>
    </details>
  );
}

export function WorkPage() {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const now = new Date();
  const [manual, setManual] = useState<ManualWorkDraft>({
    content: "",
    result: "",
    blockers: "",
    nextStep: "",
    startAt: localInput(new Date(now.getTime() - 60 * 60_000)),
    endAt: localInput(now),
    visibility: "management_only",
    parallelWork: false,
  });
  const [manualBreaks, setManualBreaks] = useState<
    Array<{ id: string; startAt: string; endAt: string }>
  >([]);
  const [editingSession, setEditingSession] = useState<WorkSession | null>(
    null,
  );
  const [conflictSessionId, setConflictSessionId] = useState<string | null>(null);
  const [correctionSession, setCorrectionSession] =
    useState<WorkSession | null>(null);
  const [correctionReason, setCorrectionReason] = useState("");
  const [prefillMessage, setPrefillMessage] = useState<string | null>(null);
  const [timerContent, setTimerContent] = useState("");
  const [timerLinkedProjectId, setTimerLinkedProjectId] = useState("");
  const [timerPrimaryProjectNodeId, setTimerPrimaryProjectNodeId] =
    useState("");
  const [timerLinkedProjectNodes, setTimerLinkedProjectNodes] = useState<
    LinkedProjectNode[]
  >([]);
  const [linkedProjectId, setLinkedProjectId] = useState("");
  const [primaryProjectNodeId, setPrimaryProjectNodeId] = useState("");
  const [linkedProjectNodes, setLinkedProjectNodes] = useState<
    LinkedProjectNode[]
  >([]);
  const work = useQuery({
    queryKey: ["work-sessions", "work-editor", "all", 100],
    queryFn: () =>
      api<{ items: WorkSession[] }>("/api/work-sessions?limit=100"),
  });
  const corrections = useQuery({
    queryKey: ["work-corrections-mine"],
    queryFn: () =>
      api<{ items: OwnWorkCorrection[] }>(
        "/api/work-session-corrections/mine?limit=100",
      ),
  });
  const timer = useQuery({
    queryKey: ["timer"],
    queryFn: () => api<{ timer: TimerState | null }>("/api/timer"),
  });
  const projects = useQuery({
    queryKey: ["projects"],
    queryFn: () => api<{ items: Project[] }>("/api/projects"),
    enabled: showForm || !timer.data?.timer,
  });
  const linkedProjectTree = useQuery({
    queryKey: ["project-tree", linkedProjectId],
    queryFn: () =>
      api<{ nodes: ProjectNode[] }>(
        "/api/projects/" + linkedProjectId + "/tree",
      ),
    enabled: showForm && Boolean(linkedProjectId),
  });
  const activeProject = projects.data?.items.find(
    (project) => project.id === linkedProjectId,
  );
  const activeProjectLabel = activeProject
    ? `${activeProject.key} · ${activeProject.name}`
    : "当前项目";
  const activeProjectNodes = linkedProjectTree.data?.nodes ?? [];
  const activeNodeOptions: LinkedProjectNode[] = activeProjectNodes.map(
    (node) => ({
      id: node.id,
      projectId: linkedProjectId,
      projectLabel: activeProjectLabel,
      title: node.title,
      type: node.type,
      status: node.status,
    }),
  );
  const primaryChoices = [...linkedProjectNodes, ...activeNodeOptions].filter(
    (node, index, items) =>
      items.findIndex((candidate) => candidate.id === node.id) === index,
  );
  const addLinkedNode = (node: LinkedProjectNode, primary = false) => {
    setLinkedProjectNodes((current) =>
      current.some((candidate) => candidate.id === node.id)
        ? current
        : [...current, node],
    );
    if (primary || !primaryProjectNodeId) setPrimaryProjectNodeId(node.id);
  };
  const removeLinkedNode = (nodeId: string) => {
    const remaining = linkedProjectNodes.filter((node) => node.id !== nodeId);
    setLinkedProjectNodes(remaining);
    if (primaryProjectNodeId === nodeId)
      setPrimaryProjectNodeId(remaining[0]?.id ?? "");
  };
  const toggleLinkedNode = (node: LinkedProjectNode, checked: boolean) => {
    if (checked) addLinkedNode(node);
    else removeLinkedNode(node.id);
  };
  const choosePrimaryNode = (nodeId: string) => {
    const node = primaryChoices.find((candidate) => candidate.id === nodeId);
    if (!node) {
      setPrimaryProjectNodeId("");
      return;
    }
    addLinkedNode(node, true);
  };
  const resetManualEditor = () => {
    const resetAt = new Date();
    setEditingSession(null);
    setCorrectionSession(null);
    setCorrectionReason("");
    setManual({
      content: "",
      result: "",
      blockers: "",
      nextStep: "",
      startAt: localInput(new Date(resetAt.getTime() - 60 * 60_000)),
      endAt: localInput(resetAt),
      visibility: "management_only",
      parallelWork: false,
    });
    setManualBreaks([]);
    setLinkedProjectId("");
    setPrimaryProjectNodeId("");
    setLinkedProjectNodes([]);
    setPrefillMessage(null);
  };
  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["work-sessions"] }),
      queryClient.invalidateQueries({ queryKey: ["timer"] }),
      queryClient.invalidateQueries({ queryKey: ["work-corrections-mine"] }),
    ]);
  };
  const create = useMutation({
    mutationFn: (recordKind: "fact" | "plan") => {
      const incompleteBreak = manualBreaks.some(
        (entry) => Boolean(entry.startAt) !== Boolean(entry.endAt),
      );
      if (incompleteBreak) {
        throw new Error("每一段休息都需要同时填写开始与结束时间。");
      }
      if (correctionSession && correctionReason.trim().length < 5) {
        throw new Error("请清楚说明原始事实、拟议更正及可核验依据（至少 5 个字）。");
      }
      const breaks = manualBreaks
        .filter((entry) => entry.startAt && entry.endAt)
        .map((entry) => ({
          startAt: new Date(entry.startAt).toISOString(),
          endAt: new Date(entry.endAt).toISOString(),
        }));
      const body = {
        startAt: new Date(manual.startAt).toISOString(),
        endAt: new Date(manual.endAt).toISOString(),
        timezone:
          editingSession?.timezone ?? correctionSession?.timezone ?? timezone,
        source: correctionSession?.source ?? "manual",
        content: manual.content,
        result: manual.result,
        blockers: manual.blockers,
        nextStep: manual.nextStep,
        primaryProjectNodeId: primaryProjectNodeId || null,
        projectNodeIds: linkedProjectNodes.map((node) => node.id),
        visibility:
          recordKind === "plan" || editingSession?.recordKind === "plan"
            ? "private"
            : manual.visibility,
        parallelWork: manual.parallelWork,
        breaks,
      };
      return correctionSession
        ? api(`/api/work-sessions/${correctionSession.id}/corrections`, {
            method: "POST",
            body: { ...body, reason: correctionReason.trim() },
          })
        : editingSession
        ? api("/api/work-sessions/" + editingSession.id, {
            method: "PATCH",
            body: { ...body, expectedVersion: editingSession.version },
          })
        : api(
            recordKind === "plan" ? "/api/work-plans" : "/api/work-sessions",
            { method: "POST", body },
          );
    },
    onSuccess: async () => {
      setConflictSessionId(null);
      setShowForm(false);
      setEditingSession(null);
      setCorrectionSession(null);
      setCorrectionReason("");
      try {
        window.localStorage.removeItem(manualPrefillStorageKey);
      } catch {
        // The factual record has been saved; inability to clear an optional
        // browser-only prefill must not make the successful write look failed.
      }
      setPrefillMessage(null);
      setManual((current) => ({
        ...current,
        content: "",
        result: "",
        blockers: "",
        nextStep: "",
        parallelWork: false,
      }));
      setManualBreaks([]);
      setLinkedProjectId("");
      setPrimaryProjectNodeId("");
      setLinkedProjectNodes([]);
      await refresh();
    },
    onError: async (error) => {
      if (error instanceof ApiError && error.status === 409 && editingSession) {
        setConflictSessionId(editingSession.id);
        await queryClient.invalidateQueries({ queryKey: ["work-sessions"] });
      }
    },
  });
  const startTimer = useMutation({
    mutationFn: () =>
      sendQueueableTimerEvent("/api/timer/start", {
        eventId: crypto.randomUUID(),
        occurredAt: new Date().toISOString(),
        content: timerContent,
        timezone,
        visibility: "management_only",
        primaryProjectNodeId: timerPrimaryProjectNodeId || null,
        projectNodeIds: timerLinkedProjectNodes.map((node) => node.id),
      }),
    onSuccess: async () => {
      setTimerContent("");
      setTimerLinkedProjectId("");
      setTimerPrimaryProjectNodeId("");
      setTimerLinkedProjectNodes([]);
      await refresh();
    },
  });
  const transition = useMutation({
    mutationFn: ({
      timerId,
      eventType,
    }: {
      timerId: string;
      eventType: string;
    }) =>
      sendQueueableTimerEvent(`/api/timer/${timerId}/events`, {
        eventId: crypto.randomUUID(),
        eventType,
        occurredAt: new Date().toISOString(),
      }),
    onSuccess: refresh,
  });
  const submit = useMutation({
    mutationFn: (item: WorkSession) =>
      api(`/api/work-sessions/${item.id}/submit`, {
        method: "POST",
        body: { expectedVersion: item.version },
      }),
    onSuccess: refresh,
  });
  const realizePlan = useMutation({
    mutationFn: (item: WorkSession) =>
      api(`/api/work-plans/${item.id}/realize`, {
        method: "POST",
        body: { expectedVersion: item.version },
      }),
    onSuccess: refresh,
  });
  const openDraftEditor = (item: WorkSession) => {
    setConflictSessionId(null);
    setEditingSession(item);
    setCorrectionSession(null);
    setCorrectionReason("");
    setManual({
      content: item.content,
      result: item.result,
      blockers: item.blockers,
      nextStep: item.nextStep,
      startAt: localInput(new Date(item.startAt)),
      endAt: localInput(new Date(item.endAt)),
      visibility: item.visibility,
      parallelWork: item.parallelWork,
    });
    setManualBreaks(
      (item.breaks ?? []).map((entry) => ({
        id: crypto.randomUUID(),
        startAt: localInput(new Date(entry.startAt)),
        endAt: localInput(new Date(entry.endAt)),
      })),
    );
    const links = item.projectLinks ?? [];
    setLinkedProjectNodes(
      links.map((link) => ({
        id: link.projectNodeId,
        projectId: link.projectId,
        projectLabel: "已关联项目",
        title: link.projectNodeTitle,
        type: "task",
        status: "",
      })),
    );
    setPrimaryProjectNodeId(item.primaryProjectNodeId ?? "");
    setLinkedProjectId(
      links.find((link) => link.isPrimary)?.projectId ?? links[0]?.projectId ?? "",
    );
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const latestConflictedSession = conflictSessionId
    ? work.data?.items.find((item) => item.id === conflictSessionId) ?? null
    : null;
  useEffect(() => {
    if (!work.data || !window.location.hash.startsWith("#work-session-")) return;
    const targetId = window.location.hash.slice(1);
    window.requestAnimationFrame(() => {
      document.getElementById(targetId)?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    });
  }, [work.data]);
  const openCorrectionEditor = (item: WorkSession) => {
    setEditingSession(null);
    setCorrectionSession(item);
    setCorrectionReason("");
    setManual({
      content: item.content,
      result: item.result,
      blockers: item.blockers,
      nextStep: item.nextStep,
      startAt: localInput(new Date(item.startAt)),
      endAt: localInput(new Date(item.endAt)),
      visibility: item.visibility,
      parallelWork: item.parallelWork,
    });
    setManualBreaks(
      (item.breaks ?? []).map((entry) => ({
        id: crypto.randomUUID(),
        startAt: localInput(new Date(entry.startAt)),
        endAt: localInput(new Date(entry.endAt)),
      })),
    );
    const links = item.projectLinks ?? [];
    setLinkedProjectNodes(
      links.map((link) => ({
        id: link.projectNodeId,
        projectId: link.projectId,
        projectLabel: "已关联项目",
        title: link.projectNodeTitle,
        type: "task",
        status: "",
      })),
    );
    setPrimaryProjectNodeId(item.primaryProjectNodeId ?? "");
    setLinkedProjectId(
      links.find((link) => link.isPrimary)?.projectId ??
        links[0]?.projectId ??
        "",
    );
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const saveLocalPrefill = () => {
    if (editingSession || correctionSession) return;
    const payload: LocalManualPrefill = {
      version: 1,
      savedAt: new Date().toISOString(),
      manual,
      breaks: manualBreaks,
      linkedProjectId,
      primaryProjectNodeId,
      linkedProjectNodes,
    };
    try {
      window.localStorage.setItem(manualPrefillStorageKey, JSON.stringify(payload));
      setPrefillMessage(
        "已仅保存在当前浏览器。本机预填写不会创建工时，也不会进入薪资、审核或团队同步。",
      );
    } catch {
      setPrefillMessage("当前浏览器无法保存本机预填写，请检查隐私模式或存储权限。");
    }
  };
  const restoreLocalPrefill = () => {
    try {
      const raw = window.localStorage.getItem(manualPrefillStorageKey);
      if (!raw) {
        setPrefillMessage("当前浏览器没有可恢复的预填写。");
        return;
      }
      const candidate = JSON.parse(raw) as Partial<LocalManualPrefill>;
      const storedManual = candidate.manual;
      if (
        candidate.version !== 1 ||
        !storedManual ||
        typeof storedManual.content !== "string" ||
        typeof storedManual.result !== "string" ||
        typeof storedManual.blockers !== "string" ||
        typeof storedManual.nextStep !== "string" ||
        typeof storedManual.startAt !== "string" ||
        typeof storedManual.endAt !== "string" ||
        typeof storedManual.visibility !== "string" ||
        typeof storedManual.parallelWork !== "boolean"
      ) {
        throw new Error("invalid local prefill");
      }
      const storedBreaks = Array.isArray(candidate.breaks)
        ? candidate.breaks.filter(
            (entry): entry is { id: string; startAt: string; endAt: string } =>
              Boolean(entry) &&
              typeof entry.id === "string" &&
              typeof entry.startAt === "string" &&
              typeof entry.endAt === "string",
          )
        : [];
      const storedNodes = Array.isArray(candidate.linkedProjectNodes)
        ? candidate.linkedProjectNodes.filter(
            (entry): entry is LinkedProjectNode =>
              Boolean(entry) &&
              typeof entry.id === "string" &&
              typeof entry.projectId === "string" &&
              typeof entry.projectLabel === "string" &&
              typeof entry.title === "string" &&
              typeof entry.type === "string" &&
              typeof entry.status === "string",
          )
        : [];
      setEditingSession(null);
      setCorrectionSession(null);
      setCorrectionReason("");
      setManual(storedManual);
      setManualBreaks(storedBreaks);
      setLinkedProjectId(
        typeof candidate.linkedProjectId === "string"
          ? candidate.linkedProjectId
          : "",
      );
      setPrimaryProjectNodeId(
        typeof candidate.primaryProjectNodeId === "string"
          ? candidate.primaryProjectNodeId
          : "",
      );
      setLinkedProjectNodes(storedNodes);
      setShowForm(true);
      setPrefillMessage("已恢复本机预填写。保存草稿前请再次核验时间和项目关联。");
    } catch {
      setPrefillMessage("预填写内容无法读取，未写入任何工时。请重新填写。");
    }
  };
  const discardLocalPrefill = () => {
    try {
      window.localStorage.removeItem(manualPrefillStorageKey);
      setPrefillMessage("已删除当前浏览器中的预填写。");
    } catch {
      setPrefillMessage("当前浏览器无法删除该预填写，请检查存储权限。");
    }
  };
  const activeTimer = timer.data?.timer;
  const plannedWork = (work.data?.items ?? []).filter(
    (item) => item.recordKind === "plan",
  );
  const factualWork = (work.data?.items ?? []).filter(
    (item) => item.recordKind !== "plan",
  );
  const editingPlan = editingSession?.recordKind === "plan";
  const timerLabel =
    activeTimer?.status === "running"
      ? "正在计时"
      : activeTimer?.status === "paused"
        ? "已暂停"
        : activeTimer?.status === "on_break"
          ? "休息中"
          : "";
  const pendingCorrectionIds = useMemo(
    () =>
      new Set(
        (corrections.data?.items ?? [])
          .filter((item) => item.correction.status === "pending")
          .map((item) => item.correction.workSessionId),
      ),
    [corrections.data?.items],
  );
  const latestCorrectionBySession = useMemo(() => {
    const result = new Map<string, OwnWorkCorrection["correction"]>();
    for (const item of corrections.data?.items ?? []) {
      if (!result.has(item.correction.workSessionId)) {
        result.set(item.correction.workSessionId, item.correction);
      }
    }
    return result;
  }, [corrections.data?.items]);

  return (
    <>
      <PageHeader
        title="工作记录"
        description="记录真实工作区间、休息、结果与项目归属；提交后进入版本化审核链。"
        actions={
          <Button
            onClick={() => {
              if (
                showForm &&
                (editingSession || correctionSession) &&
                !window.confirm(
                  correctionSession
                    ? "放弃本次未提交的更正申请？这不会影响已结算的原始记录。"
                    : "放弃本次未保存的修改？这不会影响已保存的工作草稿。",
                )
              ) {
                return;
              }
              if (showForm && (editingSession || correctionSession))
                resetManualEditor();
              setShowForm((value) => !value);
            }}
            variant={showForm ? "secondary" : "primary"}
          >
            <Plus size={18} />
            {showForm ? "收起录入" : "手工录入"}
          </Button>
        }
      />
      {showForm ? (
        <Card className="work-editor mb-5">
          <div className="work-editor-grid">
            <div className="work-editor-form">
              <div className="mb-6 flex items-start justify-between gap-4">
                <div>
                  <p className="app-section-label">工作记录编辑器</p>
                  <h2 className="mt-2 text-lg font-extrabold tracking-[-0.03em]">
                    {editingSession
                      ? editingPlan
                        ? "编辑云端计划草稿"
                        : "编辑手工草稿"
                      : correctionSession
                        ? "发起已结算记录更正"
                        : "补录一段真实工作"}
                  </h2>
                  <p className="mt-2 max-w-xl text-sm leading-6 text-[var(--text-muted)]">
                    {editingSession
                      ? editingPlan
                        ? "计划只在你自己的跨端草稿中可见，不会进入统计、AI、薪资、证据或审核；实际结束后需明确转换为真实工时草稿。"
                        : "修改会生成新的版本快照；提交审核后的记录不可在此静默改写。"
                      : correctionSession
                        ? "原始锁定事实不会被改写。提交的是可审核的完整提案；若涉及已结算金额，审核人只能将明确金额放入后续开放周期。"
                        : "先准确描述时间和内容，保存草稿后再按需要提交审核。"}
                  </p>
                </div>
                <Badge>
                  {editingSession
                    ? editingPlan
                      ? "计划草稿"
                      : "编辑中"
                    : correctionSession
                      ? "更正申请"
                      : "草稿"}
                </Badge>
              </div>
              {!editingSession && !correctionSession ? (
                <div className="mb-5 flex flex-col gap-3 rounded-2xl bg-[var(--surface-subtle)] px-4 py-3 sm:flex-row sm:items-center">
                  <p className="min-w-0 flex-1 text-xs leading-5 text-[var(--text-muted)]">
                    提前写可保存为云端计划草稿：跨设备同步并保留版本，但不会进入事实、统计、AI、薪资、证据或审核。实际结束后须主动转换并核对；本机预填写仍可作为离线临时备份。
                  </p>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    <button
                      className="text-xs font-bold text-[var(--accent-strong)]"
                      onClick={saveLocalPrefill}
                      type="button"
                    >
                      本机保存预填写
                    </button>
                    <button
                      className="text-xs font-bold text-[var(--accent-strong)]"
                      onClick={restoreLocalPrefill}
                      type="button"
                    >
                      恢复预填写
                    </button>
                    <button
                      className="text-xs font-bold text-[var(--text-subtle)]"
                      onClick={discardLocalPrefill}
                      type="button"
                    >
                      删除
                    </button>
                  </div>
                </div>
              ) : null}
              {prefillMessage ? (
                <p className="mb-5 text-xs leading-5 text-[var(--text-muted)]">
                  {prefillMessage}
                </p>
              ) : null}
              <form
                className="grid gap-4 md:grid-cols-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  create.mutate(editingPlan ? "plan" : "fact");
                }}
              >
                <Field label="开始时间">
                  <input
                    className={fieldClass}
                    onChange={(event) =>
                      setManual({ ...manual, startAt: event.target.value })
                    }
                    required
                    step="1"
                    type="datetime-local"
                    value={manual.startAt}
                  />
                </Field>
                <Field label="结束时间">
                  <input
                    className={fieldClass}
                    onChange={(event) =>
                      setManual({ ...manual, endAt: event.target.value })
                    }
                    required
                    step="1"
                    type="datetime-local"
                    value={manual.endAt}
                  />
                </Field>
                <div className="md:col-span-2">
                  <Field
                    hint="清楚描述正在推进的事项，便于后续关联项目和审核。"
                    label="工作内容"
                  >
                    <textarea
                      className={textAreaClass}
                      maxLength={10000}
                      onChange={(event) =>
                        setManual({ ...manual, content: event.target.value })
                      }
                      placeholder="例如：梳理项目交付清单并更新节点状态"
                      required
                      value={manual.content}
                    />
                  </Field>
                </div>
                <div className="md:col-span-2">
                  <Field hint="可留空，提交前也可以继续补充。" label="工作结果">
                    <textarea
                      className={textAreaClass}
                      maxLength={10000}
                      onChange={(event) =>
                        setManual({ ...manual, result: event.target.value })
                      }
                      placeholder="已完成的结果、阻塞或下一步"
                      value={manual.result}
                    />
                  </Field>
                </div>
                <Field
                  hint="如依赖、风险或等待项；它会进入可追溯记录。"
                  label="阻塞与风险（可选）"
                >
                  <textarea
                    className={`${textAreaClass} min-h-24`}
                    maxLength={5000}
                    onChange={(event) =>
                      setManual({ ...manual, blockers: event.target.value })
                    }
                    placeholder="例如：等待接口凭据批准"
                    value={manual.blockers}
                  />
                </Field>
                <Field
                  hint="让下一位协作者能直接接续推进。"
                  label="下一步（可选）"
                >
                  <textarea
                    className={`${textAreaClass} min-h-24`}
                    maxLength={5000}
                    onChange={(event) =>
                      setManual({ ...manual, nextStep: event.target.value })
                    }
                    placeholder="例如：拿到凭据后完成联调并补充验证"
                    value={manual.nextStep}
                  />
                </Field>
                {correctionSession ? (
                  <div className="md:col-span-2">
                    <Field
                      hint="请写明原始事实、拟改为的事实，以及可供审核的证据或原因。原始锁定记录不会被直接覆盖。"
                      label="更正说明与依据"
                    >
                      <textarea
                        className={`${textAreaClass} min-h-28`}
                        maxLength={2000}
                        minLength={5}
                        onChange={(event) =>
                          setCorrectionReason(event.target.value)
                        }
                        placeholder="例如：原记录漏记 30 分钟客户会议；拟将结束时间由 18:00 更正为 18:30，会议纪要已附在证据中。"
                        required
                        value={correctionReason}
                      />
                    </Field>
                  </div>
                ) : null}
                <div className="md:col-span-2">
                  <div className="app-field">
                    <span className="mb-1.5 block text-sm font-semibold">
                      休息区间（可选）
                    </span>
                    <span className="mb-3 block text-xs text-[var(--text-muted)]">
                      支持多段休息，系统会从净工时中扣除；每段都必须完整且落在工作时间内。
                    </span>
                    <div className="space-y-2">
                      {manualBreaks.map((entry, index) => (
                        <div
                          className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]"
                          key={entry.id}
                        >
                          <input
                            aria-label={"第 " + (index + 1) + " 段休息开始"}
                            className={fieldClass}
                            onChange={(event) =>
                              setManualBreaks((current) =>
                                current.map((candidate) =>
                                  candidate.id === entry.id
                                    ? {
                                        ...candidate,
                                        startAt: event.target.value,
                                      }
                                    : candidate,
                                ),
                              )
                            }
                            step="1"
                            type="datetime-local"
                            value={entry.startAt}
                          />
                          <input
                            aria-label={"第 " + (index + 1) + " 段休息结束"}
                            className={fieldClass}
                            onChange={(event) =>
                              setManualBreaks((current) =>
                                current.map((candidate) =>
                                  candidate.id === entry.id
                                    ? {
                                        ...candidate,
                                        endAt: event.target.value,
                                      }
                                    : candidate,
                                ),
                              )
                            }
                            step="1"
                            type="datetime-local"
                            value={entry.endAt}
                          />
                          <button
                            aria-label={"移除第 " + (index + 1) + " 段休息"}
                            className="rounded-xl px-3 text-xs font-bold text-[var(--text-muted)] transition hover:bg-[var(--surface-subtle)] hover:text-[var(--danger)]"
                            onClick={() =>
                              setManualBreaks((current) =>
                                current.filter(
                                  (candidate) => candidate.id !== entry.id,
                                ),
                              )
                            }
                            type="button"
                          >
                            移除
                          </button>
                        </div>
                      ))}
                    </div>
                    <button
                      className="mt-3 text-xs font-bold text-[var(--accent-strong)] disabled:cursor-not-allowed disabled:opacity-45"
                      disabled={manualBreaks.length >= 100}
                      onClick={() =>
                        setManualBreaks((current) => [
                          ...current,
                          { id: crypto.randomUUID(), startAt: "", endAt: "" },
                        ])
                      }
                      type="button"
                    >
                      + 添加休息区间（{manualBreaks.length}/100）
                    </button>
                  </div>
                </div>
                <Field label="可见范围">
                  <select
                    className={fieldClass}
                    onChange={(event) =>
                      setManual({ ...manual, visibility: event.target.value })
                    }
                    value={manual.visibility}
                  >
                    <option value="private">仅自己</option>
                    <option value="management_only">管理范围</option>
                    <option value="project_visible">项目成员</option>
                  </select>
                </Field>
                <Field
                  hint="可不关联；选定项目后，可将一条工作同时关联至多条任务节点。"
                  label="关联项目（可选）"
                >
                  <select
                    aria-label="关联项目（可选）"
                    className={fieldClass}
                    onChange={(event) => setLinkedProjectId(event.target.value)}
                    value={linkedProjectId}
                  >
                    <option value="">选择项目以添加节点</option>
                    {projects.data?.items.map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.key} · {project.name}
                      </option>
                    ))}
                  </select>
                </Field>
                {linkedProjectId ? (
                  <div className="md:col-span-2">
                    <Field
                      hint={
                        linkedProjectTree.isPending
                          ? "正在读取该项目的可关联节点…"
                          : "勾选辅助节点；首个勾选节点会自动成为主关联。"
                      }
                      label="从当前项目添加节点"
                    >
                      <div className="max-h-44 space-y-1 overflow-y-auto rounded-xl bg-[var(--surface-subtle)] p-2">
                        {linkedProjectTree.isPending ? (
                          <p className="px-2 py-3 text-sm text-[var(--text-muted)]">
                            正在读取节点…
                          </p>
                        ) : activeNodeOptions.length ? (
                          activeNodeOptions.map((node) => {
                            const selected = linkedProjectNodes.some(
                              (candidate) => candidate.id === node.id,
                            );
                            return (
                              <label
                                className={
                                  selected || linkedProjectNodes.length < 32
                                    ? "flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 text-sm transition hover:bg-[var(--surface)]"
                                    : "flex cursor-not-allowed items-center gap-3 rounded-lg px-2 py-2 text-sm opacity-50"
                                }
                                key={node.id}
                              >
                                <input
                                  aria-label={`关联 ${node.title}`}
                                  checked={selected}
                                  className="size-4 accent-[var(--accent)]"
                                  disabled={
                                    !selected && linkedProjectNodes.length >= 32
                                  }
                                  onChange={(event) =>
                                    toggleLinkedNode(node, event.target.checked)
                                  }
                                  type="checkbox"
                                />
                                <span className="min-w-0 flex-1 truncate">
                                  {node.title}
                                </span>
                                <span className="shrink-0 text-xs text-[var(--text-subtle)]">
                                  {node.type} · {node.status}
                                </span>
                              </label>
                            );
                          })
                        ) : (
                          <p className="px-2 py-3 text-sm text-[var(--text-muted)]">
                            该项目暂无可关联节点。
                          </p>
                        )}
                      </div>
                    </Field>
                  </div>
                ) : (
                  <div className="flex items-end text-xs leading-5 text-[var(--text-muted)] md:col-span-2">
                    <p>
                      未关联时仍可保存个人工作草稿；后续可随时选择项目并添加多个节点。
                    </p>
                  </div>
                )}
                {linkedProjectId || linkedProjectNodes.length ? (
                  <>
                    <div className="md:col-span-2">
                      <Field
                        hint="主关联用于项目投入归集；其他关联保留工作上下文，不会重复计算时长。"
                        label="主项目节点"
                      >
                        <select
                          aria-label="主项目节点"
                          className={fieldClass}
                          onChange={(event) =>
                            choosePrimaryNode(event.target.value)
                          }
                          required={linkedProjectNodes.length > 0}
                          value={primaryProjectNodeId}
                        >
                          <option value="">选择主项目节点</option>
                          {primaryChoices.map((node) => (
                            <option key={node.id} value={node.id}>
                              {node.projectLabel} · {node.title} · {node.type}
                            </option>
                          ))}
                        </select>
                      </Field>
                    </div>
                    {linkedProjectNodes.length ? (
                      <div className="md:col-span-2">
                        <div className="w-full rounded-xl bg-[var(--surface-subtle)] p-3">
                          <div className="flex items-center justify-between gap-3">
                            <p className="text-xs font-bold text-[var(--text-muted)]">
                              已关联 {linkedProjectNodes.length} / 32 个节点
                            </p>
                            <span className="text-xs text-[var(--text-subtle)]">
                              主关联以紫点标记
                            </span>
                          </div>
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {linkedProjectNodes.map((node) => (
                              <span
                                className="inline-flex max-w-full items-center gap-1.5 rounded-lg bg-[var(--surface)] px-2 py-1 text-xs text-[var(--text-muted)]"
                                key={node.id}
                              >
                                <span
                                  className={
                                    node.id === primaryProjectNodeId
                                      ? "size-1.5 shrink-0 rounded-full bg-[var(--accent)]"
                                      : "size-1.5 shrink-0 rounded-full bg-[var(--text-subtle)]"
                                  }
                                />
                                <span className="max-w-32 truncate">
                                  {node.title}
                                </span>
                                <button
                                  aria-label={`移除关联 ${node.title}`}
                                  className="grid size-4 place-items-center rounded text-[var(--text-subtle)] transition hover:bg-[var(--surface-subtle)] hover:text-[var(--text)]"
                                  onClick={() => removeLinkedNode(node.id)}
                                  type="button"
                                >
                                  ×
                                </button>
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-end text-xs leading-5 text-[var(--text-muted)] md:col-span-2">
                        <p>
                          请选择一条主项目节点，或在上方勾选辅助节点后由系统自动指定主关联。
                        </p>
                      </div>
                    )}
                  </>
                ) : null}
                {conflictSessionId ? (
                  <div className="rounded-xl bg-[var(--warning-soft)] p-4 md:col-span-2">
                    <p className="text-sm font-bold text-[var(--warning)]">检测到跨设备版本冲突</p>
                    <p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">服务器上的记录已被其他设备更新。本地输入仍保留在表单中；请选择加载服务器版本，或把当前本地字段重新应用到最新版本后再次保存。</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button disabled={!latestConflictedSession} onClick={() => latestConflictedSession && openDraftEditor(latestConflictedSession)} size="compact" type="button" variant="secondary">加载服务器版本</Button>
                      <Button disabled={!latestConflictedSession} onClick={() => { if (!latestConflictedSession) return; setEditingSession(latestConflictedSession); setConflictSessionId(null); }} size="compact" type="button">保留本地字段并更新基线</Button>
                    </div>
                  </div>
                ) : null}
                <div className="flex items-end justify-end md:col-span-2">
                  <label className="mr-auto flex max-w-52 items-start gap-2 text-xs leading-5 text-[var(--text-muted)]">
                    <input
                      checked={manual.parallelWork}
                      className="mt-1 accent-[var(--accent)]"
                      onChange={(event) =>
                        setManual({
                          ...manual,
                          parallelWork: event.target.checked,
                        })
                      }
                      type="checkbox"
                    />
                    <span>
                      允许与另一条记录重叠。仅在确有并行工作时开启，服务端仍会保留事实与审计。
                    </span>
                  </label>
                  {!editingSession && !correctionSession ? (
                    <Button
                      disabled={
                        create.isPending ||
                        (linkedProjectNodes.length > 0 && !primaryProjectNodeId)
                      }
                      onClick={() => create.mutate("plan")}
                      type="button"
                      variant="secondary"
                    >
                      {create.isPending ? "正在保存…" : "保存云端计划"}
                    </Button>
                  ) : null}
                  <Button
                    disabled={
                      create.isPending ||
                      (linkedProjectNodes.length > 0 && !primaryProjectNodeId)
                    }
                    type="submit"
                  >
                    {create.isPending
                      ? "正在保存…"
                      : correctionSession
                        ? "提交更正申请"
                        : editingPlan
                          ? "保存计划修改"
                          : editingSession
                            ? "保存修改"
                            : "保存真实工时草稿"}
                  </Button>
                </div>
                <div className="md:col-span-2">
                  <ErrorMessage
                    error={
                      create.error ?? projects.error ?? linkedProjectTree.error
                    }
                  />
                </div>
              </form>
            </div>
            <aside className="work-editor-preview">
              <WorkDayTimeline
                breaks={manualBreaks}
                content={manual.content}
                endAt={manual.endAt}
                sessions={work.data?.items ?? []}
                startAt={manual.startAt}
              />
            </aside>
          </div>
        </Card>
      ) : null}
      <div className="grid gap-5 xl:grid-cols-[minmax(19rem,0.45fr)_minmax(0,1fr)]">
        <Card className="work-timer-card">
          <CardHeader>
            <div>
              <p className="app-section-label">实时记录</p>
              <h2 className="mt-2 font-extrabold tracking-[-0.025em]">
                主计时器
              </h2>
            </div>
            {activeTimer ? (
              <Badge
                tone={activeTimer.status === "running" ? "positive" : "warning"}
              >
                {timerLabel}
              </Badge>
            ) : (
              <Badge>待开始</Badge>
            )}
          </CardHeader>
          <CardContent>
            {timer.isPending ? (
              <LoadingBlock />
            ) : activeTimer ? (
              <div>
                <p className="text-lg font-bold">
                  {activeTimer.metadata.content || "未命名工作"}
                </p>
                <p className="mt-2 text-sm leading-6 text-[var(--text-muted)]">
                  服务器累计 {formatDuration(activeTimer.accumulatedSeconds)}
                  。跨设备状态以服务端事件为准。
                </p>
                {activeTimer.metadata.projectNodeIds?.length ? (
                  <p className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-[var(--surface-subtle)] px-2.5 py-1.5 text-xs font-semibold text-[var(--text-muted)]">
                    <FolderKanban size={14} />
                    已关联 {activeTimer.metadata.projectNodeIds.length}{" "}
                    个项目节点
                    {activeTimer.metadata.primaryProjectNodeId
                      ? " · 已指定主关联"
                      : ""}
                  </p>
                ) : null}
                <div className="mt-5 grid grid-cols-2 gap-2">
                  {activeTimer.status === "running" ? (
                    <Button
                      onClick={() =>
                        transition.mutate({
                          timerId: activeTimer.id,
                          eventType: "pause",
                        })
                      }
                      variant="secondary"
                    >
                      <Pause size={17} />
                      暂停
                    </Button>
                  ) : activeTimer.status === "paused" ? (
                    <Button
                      onClick={() =>
                        transition.mutate({
                          timerId: activeTimer.id,
                          eventType: "resume",
                        })
                      }
                    >
                      <Play size={17} />
                      继续
                    </Button>
                  ) : (
                    <Button
                      onClick={() =>
                        transition.mutate({
                          timerId: activeTimer.id,
                          eventType: "break_end",
                        })
                      }
                    >
                      <Play size={17} />
                      结束休息
                    </Button>
                  )}
                  {activeTimer.status !== "on_break" ? (
                    <Button
                      onClick={() =>
                        transition.mutate({
                          timerId: activeTimer.id,
                          eventType: "break_start",
                        })
                      }
                      variant="secondary"
                    >
                      <TimerReset size={17} />
                      休息
                    </Button>
                  ) : null}
                  <Button
                    className="col-span-2"
                    onClick={() =>
                      transition.mutate({
                        timerId: activeTimer.id,
                        eventType: "stop",
                      })
                    }
                    variant="danger"
                  >
                    <Square size={17} />
                    结束并生成工时
                  </Button>
                </div>
                <div className="mt-3">
                  <ErrorMessage error={transition.error} />
                </div>
              </div>
            ) : (
              <form
                className="space-y-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  startTimer.mutate();
                }}
              >
                <Field
                  hint="开始后可暂停、休息或结束；每一次状态变化都会记录。"
                  label="准备做什么"
                >
                  <textarea
                    className={textAreaClass}
                    onChange={(event) => setTimerContent(event.target.value)}
                    placeholder="例如：实现项目画布的筛选交互"
                    required
                    value={timerContent}
                  />
                </Field>
                <TimerProjectAssociation
                  onPrimaryProjectNodeIdChange={setTimerPrimaryProjectNodeId}
                  onProjectIdChange={setTimerLinkedProjectId}
                  onSelectedNodesChange={setTimerLinkedProjectNodes}
                  primaryProjectNodeId={timerPrimaryProjectNodeId}
                  projectId={timerLinkedProjectId}
                  projects={projects.data?.items ?? []}
                  selectedNodes={timerLinkedProjectNodes}
                />
                <Button
                  className="w-full"
                  disabled={
                    startTimer.isPending ||
                    (timerLinkedProjectNodes.length > 0 &&
                      !timerPrimaryProjectNodeId)
                  }
                  type="submit"
                >
                  <Play size={17} />
                  开始计时
                </Button>
                <ErrorMessage error={startTimer.error ?? projects.error} />
              </form>
            )}
          </CardContent>
        </Card>
        <Card className="work-list-card">
          <CardHeader>
            <div>
              <p className="app-section-label">可追溯记录</p>
              <h2 className="mt-2 font-extrabold tracking-[-0.025em]">
                全部记录
              </h2>
              <p className="mt-1 text-sm text-[var(--text-muted)]">
                当前账号本人范围
              </p>
            </div>
            <Badge>
              {factualWork.length} 条事实 · {plannedWork.length} 个计划
            </Badge>
          </CardHeader>
          <CardContent>
            {work.isPending ? (
              <LoadingBlock />
            ) : work.data?.items.length ? (
              <div className="divide-y divide-[var(--border)]">
                {work.data.items.map((item) => {
                  const correction = latestCorrectionBySession.get(item.id);
                  return (
                  <div key={item.id}>
                    <WorkRow
                      action={
                        item.recordKind === "plan" ? (
                          <div className="flex flex-wrap gap-2">
                            <Button
                              disabled={create.isPending}
                              onClick={() => openDraftEditor(item)}
                              size="compact"
                              variant="ghost"
                            >
                              编辑计划
                            </Button>
                            <Button
                              disabled={realizePlan.isPending}
                              onClick={() => realizePlan.mutate(item)}
                              size="compact"
                              variant="secondary"
                            >
                              转为真实草稿
                            </Button>
                          </div>
                        ) : item.approvalStatus === "locked" ? (
                          <Button
                            disabled={
                              create.isPending ||
                              pendingCorrectionIds.has(item.id)
                            }
                            onClick={() => openCorrectionEditor(item)}
                            size="compact"
                            variant="secondary"
                          >
                            {pendingCorrectionIds.has(item.id)
                              ? "更正审核中"
                              : "发起更正"}
                          </Button>
                        ) : item.submissionStatus === "draft" ? (
                          <div className="flex flex-wrap gap-2">
                            {item.source === "manual" ? (
                              <Button
                                disabled={create.isPending}
                                onClick={() => openDraftEditor(item)}
                                size="compact"
                                variant="ghost"
                              >
                                编辑草稿
                              </Button>
                            ) : null}
                            <Button
                              disabled={submit.isPending}
                              onClick={() => submit.mutate(item)}
                              size="compact"
                              variant="secondary"
                            >
                              提交审核
                            </Button>
                          </div>
                        ) : null
                      }
                      item={item}
                    />
                    {item.recordKind === "fact" ? (
                      <EvidencePanel sessionId={item.id} />
                    ) : null}
                    <WorkVersionHistory sessionId={item.id} />
                    {correction ? (
                      <p
                        className={
                          correction.status === "rejected"
                            ? "px-2 pb-3 text-xs text-[var(--danger)]"
                            : "px-2 pb-3 text-xs text-[var(--text-muted)]"
                        }
                        role="status"
                      >
                        {formatCorrectionStatus(correction.status)} ·{" "}
                        {formatDateTime(correction.createdAt)}
                      </p>
                    ) : null}
                  </div>
                  );
                })}
              </div>
            ) : (
              <EmptyState
                description="现在可以手工录入，或使用左侧主计时器。"
                icon={<Clock3 />}
                title="还没有工时记录"
              />
            )}
            <ErrorMessage error={realizePlan.error} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
interface Project {
  id: string;
  key: string;
  name: string;
  description: string | null;
  color: string;
  status: string;
  version: number;
  updatedAt: string;
}
interface ProjectNode {
  id: string;
  branchId: string;
  parentId: string | null;
  type: string;
  title: string;
  status: string;
  progress: string;
  version: number;
  sortOrder: number;
}
interface LinkedProjectNode {
  id: string;
  projectId: string;
  projectLabel: string;
  title: string;
  type: string;
  status: string;
}
interface Branch {
  id: string;
  name: string;
  isDefault: boolean;
}
interface ProjectEdge {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  type: string;
  label: string | null;
}

export function ProjectsPage({ me }: { me: Me }) {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    key: "",
    name: "",
    description: "",
    color: "#5b5ce2",
  });
  const projects = useQuery({
    queryKey: ["projects"],
    queryFn: () => api<{ items: Project[] }>("/api/projects"),
  });
  const create = useMutation({
    mutationFn: () => api("/api/projects", { method: "POST", body: form }),
    onSuccess: async () => {
      setShowForm(false);
      setForm({ ...form, key: "", name: "", description: "" });
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
  });

  return (
    <>
      <PageHeader
        title="项目"
        description="项目由可版本化的分支和树节点组成；移动、回滚和删除都会留下活动轨迹。"
        actions={
          hasGrant(me, "project.create") ? (
            <Button onClick={() => setShowForm((value) => !value)}>
              <Plus size={18} />
              新建项目
            </Button>
          ) : undefined
        }
      />
      {showForm ? (
        <Card className="mb-5">
          <CardContent>
            <div className="mb-5">
              <p className="app-section-label">新项目</p>
              <h2 className="mt-2 font-extrabold tracking-[-0.025em]">
                建立项目与默认主线
              </h2>
            </div>
            <form
              className="grid gap-4 md:grid-cols-2"
              onSubmit={(event) => {
                event.preventDefault();
                create.mutate();
              }}
            >
              <Field hint="用于节点、导出与筛选中的稳定标识。" label="项目代号">
                <input
                  className={fieldClass}
                  maxLength={16}
                  onChange={(event) =>
                    setForm({ ...form, key: event.target.value })
                  }
                  placeholder="例如 WIP"
                  required
                  value={form.key}
                />
              </Field>
              <Field label="项目名称">
                <input
                  className={fieldClass}
                  maxLength={160}
                  onChange={(event) =>
                    setForm({ ...form, name: event.target.value })
                  }
                  required
                  value={form.name}
                />
              </Field>
              <div className="md:col-span-2">
                <Field label="项目说明">
                  <textarea
                    className={textAreaClass}
                    onChange={(event) =>
                      setForm({ ...form, description: event.target.value })
                    }
                    placeholder="说明目标、范围或交付预期"
                    value={form.description}
                  />
                </Field>
              </div>
              <div className="flex items-end gap-3 md:col-span-2 md:justify-end">
                <span className="mr-auto text-xs text-[var(--text-muted)]">
                  创建后可在树形画布中维护阶段、节点和分支。
                </span>
                <Button disabled={create.isPending} type="submit">
                  {create.isPending ? "正在创建…" : "创建项目与主分支"}
                </Button>
              </div>
              <div className="md:col-span-2">
                <ErrorMessage error={create.error} />
              </div>
            </form>
          </CardContent>
        </Card>
      ) : null}
      {projects.isPending ? (
        <Card>
          <LoadingBlock />
        </Card>
      ) : projects.data?.items.length ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {projects.data.items.map((project) => (
            <Link key={project.id} to={`/projects/${project.id}`}>
              <Card className="project-card">
                <CardContent>
                  <div className="flex items-start justify-between gap-3">
                    <div
                      className="project-color-mark grid size-11 place-items-center rounded-[0.9rem] text-sm font-bold"
                      style={{
                        background: project.color,
                        color: readableForeground(project.color),
                      }}
                    >
                      {project.key.slice(0, 2)}
                    </div>
                    <Badge
                      tone={
                        project.status === "active" ? "positive" : "neutral"
                      }
                    >
                      {projectStatusLabels[project.status] ?? project.status}
                    </Badge>
                  </div>
                  <div className="mt-6">
                    <p className="app-section-label">项目总览</p>
                    <h2 className="mt-2 font-extrabold tracking-[-0.025em]">
                      {project.name}
                    </h2>
                    <p className="mt-2 line-clamp-2 min-h-10 text-sm leading-5 text-[var(--text-muted)]">
                      {project.description || "暂无项目说明"}
                    </p>
                  </div>
                  <div className="mt-5 flex items-center justify-between border-t border-[var(--border)] pt-4 text-xs text-[var(--text-subtle)]">
                    <span>版本 {project.version}</span>
                    <span className="inline-flex items-center gap-1">
                      更新于 {formatDateTime(project.updatedAt)}
                      <ArrowUpRight size={13} />
                    </span>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      ) : (
        <Card>
          <EmptyState
            action={
              hasGrant(me, "project.create") ? (
                <Button onClick={() => setShowForm(true)}>
                  创建第一个项目
                </Button>
              ) : null
            }
            description="有权限的成员创建项目后，项目树会显示在这里。"
            icon={<FolderKanban />}
            title="没有可访问的项目"
          />
        </Card>
      )}
    </>
  );
}

export function LegacyProjectDetailPage({ me }: { me: Me }) {
  const { projectId = "" } = useParams();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [branchName, setBranchName] = useState("");
  const [projectSearch, setProjectSearch] = useState("");
  const [view, setView] = useState<"canvas" | "list">("canvas");
  const tree = useQuery({
    queryKey: ["project-tree", projectId],
    queryFn: () =>
      api<{
        project: Project;
        branches: Branch[];
        nodes: ProjectNode[];
        edges: ProjectEdge[];
      }>(`/api/projects/${projectId}/tree`),
  });
  const canManage = me.permissions.some(
    (grant) =>
      grant.permission === "project.manage" &&
      (grant.scopeKind === "organization" || grant.scopeId === projectId),
  );
  const create = useMutation({
    mutationFn: () => {
      const branch =
        tree.data?.branches.find((item) => item.isDefault) ??
        tree.data?.branches[0];
      if (!branch) throw new Error("项目没有可用分支");
      return api(`/api/projects/${projectId}/nodes`, {
        method: "POST",
        body: {
          branchId: branch.id,
          parentId: null,
          type: "task",
          title,
          sortOrder: tree.data?.nodes.length ?? 0,
        },
      });
    },
    onSuccess: async () => {
      setTitle("");
      await queryClient.invalidateQueries({
        queryKey: ["project-tree", projectId],
      });
    },
  });
  const createBranch = useMutation({
    mutationFn: () =>
      api(`/api/projects/${projectId}/branches`, {
        method: "POST",
        body: {
          name: branchName,
          parentBranchId: tree.data?.branches.find((item) => item.isDefault)
            ?.id,
        },
      }),
    onSuccess: async () => {
      setBranchName("");
      await queryClient.invalidateQueries({
        queryKey: ["project-tree", projectId],
      });
    },
  });
  const ordered = useMemo(() => {
    const nodes = tree.data?.nodes ?? [];
    const result: Array<{ node: ProjectNode; depth: number }> = [];
    const visit = (parentId: string | null, depth: number) =>
      nodes
        .filter((node) => node.parentId === parentId)
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .forEach((node) => {
          result.push({ node, depth });
          visit(node.id, depth + 1);
        });
    visit(null, 0);
    return result;
  }, [tree.data?.nodes]);
  const normalizedSearch = projectSearch.trim().toLocaleLowerCase();
  const filteredOrdered = normalizedSearch
    ? ordered.filter(
        ({ node }) =>
          node.title.toLocaleLowerCase().includes(normalizedSearch) ||
          node.type.toLocaleLowerCase().includes(normalizedSearch) ||
          node.status.toLocaleLowerCase().includes(normalizedSearch),
      )
    : ordered;
  const visibleNodeIds = new Set(filteredOrdered.map(({ node }) => node.id));
  const canvasNodes = normalizedSearch
    ? (tree.data?.nodes ?? []).filter((node) => visibleNodeIds.has(node.id))
    : (tree.data?.nodes ?? []);
  const canvasEdges = normalizedSearch
    ? (tree.data?.edges ?? []).filter(
        (edge) =>
          visibleNodeIds.has(edge.sourceNodeId) &&
          visibleNodeIds.has(edge.targetNodeId),
      )
    : (tree.data?.edges ?? []);

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
        description={`${tree.data.project.key} · ${tree.data.branches.length} 个分支 · ${tree.data.nodes.length} 个有效节点`}
        actions={
          <Link to="/projects">
            <Button variant="secondary">
              <ArrowLeft size={17} />
              返回项目
            </Button>
          </Link>
        }
      />
      <Card>
        <CardHeader>
          <div>
            <p className="app-section-label">版本化项目演进图</p>
            <h2 className="mt-2 font-extrabold tracking-[-0.025em]">
              项目结构
            </h2>
            <p className="mt-1 text-sm text-[var(--text-muted)]">
              画布用于理解层级和关系；列表是移动端及无障碍兜底。所有结构修改均由版本控制。
            </p>
          </div>
          <Badge tone="info">v{tree.data.project.version}</Badge>
        </CardHeader>
        <CardContent>
          <div className="project-toolbar">
            <div className="flex gap-2">
              <Button
                onClick={() => setView("canvas")}
                size="compact"
                variant={view === "canvas" ? "primary" : "secondary"}
              >
                画布
              </Button>
              <Button
                onClick={() => setView("list")}
                size="compact"
                variant={view === "list" ? "primary" : "secondary"}
              >
                列表
              </Button>
            </div>
            <input
              aria-label="搜索项目节点"
              className={`${fieldClass} min-w-[12rem] flex-1 py-1.5`}
              onChange={(event) => setProjectSearch(event.target.value)}
              placeholder="搜索节点、状态或类型"
              value={projectSearch}
            />
            <span className="whitespace-nowrap text-xs text-[var(--text-muted)]">
              {filteredOrdered.length} / {tree.data.nodes.length} 个节点
            </span>
          </div>
          {canManage ? (
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <form
                className="flex gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  create.mutate();
                }}
              >
                <input
                  className={fieldClass}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="新增顶层任务"
                  required
                  value={title}
                />
                <Button disabled={create.isPending} type="submit">
                  <Plus size={17} />
                  添加
                </Button>
              </form>
              <form
                className="flex gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  createBranch.mutate();
                }}
              >
                <input
                  className={fieldClass}
                  onChange={(event) => setBranchName(event.target.value)}
                  placeholder="从主线创建分支"
                  required
                  value={branchName}
                />
                <Button disabled={createBranch.isPending} type="submit">
                  新分支
                </Button>
              </form>
            </div>
          ) : null}
          <div className="mt-4">
            <ErrorMessage error={create.error ?? createBranch.error} />
          </div>
          {filteredOrdered.length ? (
            <div className="mt-5">
              {view === "canvas" ? (
                <ProjectCanvas
                  accent={tree.data.project.color}
                  edges={canvasEdges}
                  nodes={canvasNodes}
                />
              ) : (
                <div className="project-tree-list divide-y divide-[var(--border)]">
                  {filteredOrdered.map(({ node, depth }) => (
                    <div
                      className="flex items-center gap-3 py-3"
                      key={node.id}
                      style={{ paddingLeft: `${Math.min(depth, 8) * 22}px` }}
                    >
                      <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-[var(--surface-subtle)] text-[var(--accent-strong)]">
                        <ChevronRight size={16} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold">
                          {node.title}
                        </p>
                        <p className="text-xs text-[var(--text-muted)]">
                          {node.type} · v{node.version}
                        </p>
                      </div>
                      <Badge
                        tone={
                          node.status === "completed"
                            ? "positive"
                            : node.status === "blocked"
                              ? "danger"
                              : "neutral"
                        }
                      >
                        {node.status}
                      </Badge>
                      <span className="w-14 text-right text-xs text-[var(--text-muted)]">
                        {Number(node.progress)}%
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <EmptyState
              description={
                normalizedSearch
                  ? "没有匹配的节点，换个关键词试试。"
                  : "添加任务、阶段、里程碑或交付物，形成可追溯项目树。"
              }
              icon={<FolderKanban />}
              title={normalizedSearch ? "没有搜索结果" : "项目树为空"}
            />
          )}
        </CardContent>
      </Card>
    </>
  );
}
interface ApprovalItem {
  request: {
    id: string;
    priority: string;
    requestedAt: string;
    anomalyFlags: string[];
  };
  session: WorkSession;
  requesterOrgUnitId: string | null;
}

interface PendingWorkCorrection {
  correction: {
    id: string;
    baseVersion: number;
    proposedSnapshot: unknown;
    reason: string;
    status: string;
    createdAt: string;
  };
  session: WorkSession;
  requesterDisplayName: string;
  nextOpenPeriod: {
    id: string;
    name: string;
    startsAt: string;
    endsAt: string;
  } | null;
}

function readCorrectionProposal(snapshot: unknown): {
  content: string | null;
  startAt: string | null;
  endAt: string | null;
  breaks: number | null;
} {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    return { content: null, startAt: null, endAt: null, breaks: null };
  }
  const root = snapshot as Record<string, unknown>;
  const proposal = root.workSession;
  if (!proposal || typeof proposal !== "object" || Array.isArray(proposal)) {
    return { content: null, startAt: null, endAt: null, breaks: null };
  }
  const value = proposal as Record<string, unknown>;
  return {
    content: typeof value.content === "string" ? value.content : null,
    startAt: typeof value.startAt === "string" ? value.startAt : null,
    endAt: typeof value.endAt === "string" ? value.endAt : null,
    breaks: Array.isArray(value.breaks) ? value.breaks.length : null,
  };
}

export function ApprovalsPage() {
  const queryClient = useQueryClient();
  const [correctionInputs, setCorrectionInputs] = useState<
    Record<string, { amount: string; reviewNote: string }>
  >({});
  const approvals = useQuery({
    queryKey: ["approvals"],
    queryFn: () => api<{ items: ApprovalItem[] }>("/api/approvals?limit=100"),
  });
  const corrections = useQuery({
    queryKey: ["work-corrections-pending"],
    queryFn: () =>
      api<{ items: PendingWorkCorrection[] }>(
        "/api/work-session-corrections/pending?limit=100",
      ),
  });
  const decide = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: string }) =>
      api(`/api/approvals/${id}/decision`, {
        method: "POST",
        body: {
          decision,
          ...(decision === "returned"
            ? { reason: "请补充工作结果后重新提交" }
            : {}),
        },
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["approvals"] }),
        queryClient.invalidateQueries({ queryKey: ["work-sessions"] }),
      ]);
    },
  });
  const decideCorrection = useMutation({
    mutationFn: ({
      item,
      decision,
    }: {
      item: PendingWorkCorrection;
      decision: "approved" | "rejected";
    }) => {
      const current = correctionInputs[item.correction.id] ?? {
        amount: "",
        reviewNote: "",
      };
      return api(
        `/api/work-session-corrections/${item.correction.id}/decision`,
        {
          method: "POST",
          body: {
            decision,
            ...(current.reviewNote.trim()
              ? { reviewNote: current.reviewNote.trim() }
              : {}),
            ...(decision === "approved" && current.amount.trim()
              ? {
                  adjustmentAmount: current.amount.trim(),
                }
              : {}),
          },
        },
      );
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["work-corrections-pending"] }),
        queryClient.invalidateQueries({ queryKey: ["work-corrections-mine"] }),
        queryClient.invalidateQueries({ queryKey: ["work-sessions"] }),
        queryClient.invalidateQueries({ queryKey: ["payroll-me"] }),
      ]);
    },
  });
  return (
    <>
      <PageHeader
        title="审批"
        description="仅显示当前角色和授权范围内的待审事实；批准、退回与更正均保留前后快照。"
      />
      {approvals.isPending ? (
        <Card>
          <LoadingBlock />
        </Card>
      ) : approvals.data?.items.length ? (
        <div className="space-y-4">
          {approvals.data.items.map((item) => (
            <Card key={item.request.id}>
              <CardContent>
                <div className="flex flex-col gap-4 md:flex-row md:items-center">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h2 className="truncate font-bold">
                        {item.session.content}
                      </h2>
                      <Badge
                        tone={
                          item.request.priority === "high"
                            ? "danger"
                            : "warning"
                        }
                      >
                        {item.request.priority === "high"
                          ? "高优先级"
                          : "待审核"}
                      </Badge>
                    </div>
                    <p className="mt-2 text-sm text-[var(--text-muted)]">
                      {formatDateTime(item.session.startAt)} –{" "}
                      {formatDateTime(item.session.endAt)} ·{" "}
                      {formatDuration(item.session.netSeconds)} · 版本{" "}
                      {item.session.version}
                    </p>
                    {item.request.anomalyFlags.length ? (
                      <div className="mt-2 flex flex-wrap gap-1.5" role="status">
                        {item.request.anomalyFlags.map((flag) => (
                          <span
                            className="rounded-lg bg-[var(--danger-soft)] px-2 py-1 text-xs font-semibold text-[var(--danger)]"
                            key={flag}
                          >
                            {formatWorkAnomaly(flag)}
                          </span>
                        ))}
                      </div>
                    ) : null}
                    {item.session.result ? (
                      <p className="mt-2 text-sm">
                        结果：{item.session.result}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      disabled={decide.isPending}
                      onClick={() =>
                        decide.mutate({
                          id: item.request.id,
                          decision: "returned",
                        })
                      }
                      variant="secondary"
                    >
                      <RotateCcw size={17} />
                      退回
                    </Button>
                    <Button
                      disabled={decide.isPending}
                      onClick={() =>
                        decide.mutate({
                          id: item.request.id,
                          decision: "approved",
                        })
                      }
                    >
                      <Check size={17} />
                      批准
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <EmptyState
            description="新提交且位于你授权范围内的工时会出现在这里。"
            icon={<FileCheck2 />}
            title="没有待处理审批"
          />
        </Card>
      )}
      {corrections.isPending ? (
        <Card className="mt-5">
          <LoadingBlock />
        </Card>
      ) : corrections.data?.items.length ? (
        <section className="mt-5 space-y-4" aria-label="已结算工时更正申请">
          <div>
            <p className="app-section-label">已结算记录更正</p>
            <h2 className="mt-2 text-lg font-extrabold tracking-[-0.025em]">
              不覆盖历史，只审核提案与下期调整
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--text-muted)]">
              原始锁定工时与工资单始终保留。填写明确金额时，系统只会把经你确认的调整写入原周期之后的第一个开放周期，币种由该周期的有效薪资方案决定；留空则仅留存审核结论。
            </p>
          </div>
          {corrections.data.items.map((item) => {
            const proposal = readCorrectionProposal(
              item.correction.proposedSnapshot,
            );
            const current = correctionInputs[item.correction.id] ?? {
              amount: "",
              reviewNote: "",
            };
            const setInput = (
              patch: Partial<{ amount: string; reviewNote: string }>,
            ) =>
              setCorrectionInputs((all) => ({
                ...all,
                [item.correction.id]: { ...current, ...patch },
              }));
            return (
              <Card key={item.correction.id}>
                <CardContent className="space-y-4">
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-bold">
                          {item.requesterDisplayName} 的已结算更正申请
                        </h3>
                        <Badge tone="warning">原始版本 {item.correction.baseVersion}</Badge>
                      </div>
                      <p className="mt-2 text-sm text-[var(--text-muted)]">
                        原始：{item.session.content} ·{" "}
                        {formatDateTime(item.session.startAt)} –{" "}
                        {formatDateTime(item.session.endAt)}
                      </p>
                      <p className="mt-2 text-sm leading-6">
                        申请说明：{item.correction.reason}
                      </p>
                      {proposal.content ? (
                        <p className="mt-2 text-sm leading-6 text-[var(--text-muted)]">
                          拟议：{proposal.content}
                          {proposal.startAt && proposal.endAt
                            ? ` · ${formatDateTime(proposal.startAt)} – ${formatDateTime(proposal.endAt)}`
                            : ""}
                          {proposal.breaks !== null
                            ? ` · ${proposal.breaks} 段休息`
                            : ""}
                        </p>
                      ) : (
                        <p className="mt-2 text-sm text-[var(--danger)]">
                          提案快照结构异常，不能在此页面安全处理。
                        </p>
                      )}
                    </div>
                    <span className="shrink-0 text-xs text-[var(--text-subtle)]">
                      申请于 {formatDateTime(item.correction.createdAt)}
                    </span>
                  </div>
                  <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                    <Field
                      hint={
                        item.nextOpenPeriod
                          ? `可选；填写后会进入“${item.nextOpenPeriod.name}”的下期调整，币种由该成员在该周期的有效薪资方案决定。`
                          : "当前找不到原周期后的开放薪资周期；留空可以仅确认申请。"
                      }
                      label="下期调整金额（可选）"
                    >
                      <input
                        className={fieldClass}
                        disabled={!item.nextOpenPeriod}
                        inputMode="decimal"
                        maxLength={22}
                        onChange={(event) => setInput({ amount: event.target.value })}
                        placeholder="例如 120.00 或 -120.00（最多 14 位整数）"
                        value={current.amount}
                      />
                    </Field>
                    <Field label="审核说明">
                      <input
                        className={fieldClass}
                        maxLength={2000}
                        onChange={(event) => setInput({ reviewNote: event.target.value })}
                        placeholder="驳回时必填"
                        value={current.reviewNote}
                      />
                    </Field>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      disabled={
                        decideCorrection.isPending ||
                        !proposal.content ||
                        (Boolean(current.amount.trim()) && !item.nextOpenPeriod)
                      }
                      onClick={() =>
                        decideCorrection.mutate({ item, decision: "approved" })
                      }
                    >
                      <Check size={17} />
                      {current.amount.trim()
                        ? "批准并写入下期调整"
                        : "批准并留存结论"}
                    </Button>
                    <Button
                      disabled={
                        decideCorrection.isPending ||
                        current.reviewNote.trim().length === 0
                      }
                      onClick={() =>
                        decideCorrection.mutate({ item, decision: "rejected" })
                      }
                      variant="secondary"
                    >
                      <RotateCcw size={17} />
                      驳回申请
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </section>
      ) : null}
      <div className="mt-4">
        <ErrorMessage
          error={approvals.error ?? decide.error ?? corrections.error ?? decideCorrection.error}
        />
      </div>
    </>
  );
}

interface PayrollRecord {
  item: {
    id: string;
    currency: string;
    approvedSeconds: number;
    pendingSeconds: number;
    grossAmount: string;
    adjustmentAmount: string;
    finalAmount: string;
    estimate: boolean;
    needsReview: boolean;
  };
  run: {
    id: string;
    runNumber: number;
    status: string;
    calculationVersion: string;
  };
  period: { name: string; startsAt: string; endsAt: string; status: string };
  components: Array<{
    id: string;
    type: string;
    label: string;
    quantity: string | null;
    unit: string | null;
    rate: string | null;
    multiplier: string | null;
    amount: string;
  }>;
  dailyBreakdown: Array<{
    date: string;
    amount: string;
    estimatedAmount: string;
  }>;
}
interface PayrollOwnResponse {
  items: PayrollRecord[];
  summary: Array<{
    currency: string;
    settledAmount: string;
    pendingAmount: string;
    totalAmount: string;
  }>;
}
type CompensationPlanType =
  | "hourly"
  | "daily"
  | "monthly"
  | "fixed_period"
  | "project_based"
  | "hybrid";
interface PayrollManagementOverview {
  members: Array<{
    membershipId: string;
    displayName: string;
    status: string;
    plan: null | {
      plan: {
        id: string;
        name: string;
        type: CompensationPlanType;
        currency: string;
        activeVersion: number;
      };
      version: {
        version: number;
        type: CompensationPlanType;
        baseAmount: string;
        pendingReviewCountsInEstimate: boolean;
        effectiveFrom: string;
        effectiveTo: string | null;
        config: { fixedAmount?: string };
      };
      rules: Array<{
        id: string;
        type: "weekday" | "weekend" | "holiday" | "night_window" | "overtime";
        priority: number;
        multiplier: string;
        startHour?: number;
        endHour?: number;
        thresholdSeconds?: number;
        holidayDates?: string[];
      }>;
    };
  }>;
  periods: Array<{
    id: string;
    name: string;
    status: string;
    startsAt: string;
    endsAt: string;
    cutoffAt: string;
  }>;
  runs: Array<{
    run: { id: string; runNumber: number; status: string; createdAt: string };
    period: { id: string; name: string };
  }>;
}

const compensationTypeLabels: Record<CompensationPlanType, string> = {
  hourly: "时薪",
  daily: "日薪",
  monthly: "月薪",
  fixed_period: "固定周期金额",
  project_based: "项目制",
  hybrid: "混合计薪",
};

function PayrollManagementPanel() {
  const queryClient = useQueryClient();
  const management = useQuery({
    queryKey: ["payroll-management"],
    queryFn: () => api<PayrollManagementOverview>("/api/payroll/management"),
  });
  const activeMembers = useMemo(
    () =>
      management.data?.members.filter((member) => member.status === "active") ?? [],
    [management.data?.members],
  );
  const [selectedMemberId, setSelectedMemberId] = useState("");
  const [planForm, setPlanForm] = useState(() => ({
    name: "主薪资方案",
    type: "hourly" as CompensationPlanType,
    currency: "CNY",
    baseAmount: "",
    fixedAmount: "",
    effectiveFrom: localInput(new Date(Date.now() + 60_000)),
    pendingReviewCountsInEstimate: true,
    weekdayEnabled: false,
    weekdayMultiplier: "1",
    weekendEnabled: false,
    weekendMultiplier: "2",
    holidayEnabled: false,
    holidayMultiplier: "3",
    holidayDates: "",
    nightEnabled: false,
    nightMultiplier: "1.5",
    nightStartHour: 22,
    nightEndHour: 6,
    overtimeEnabled: false,
    overtimeMultiplier: "1.5",
    overtimeHours: 8,
  }));
  const [periodForm, setPeriodForm] = useState(() => {
    const current = new Date();
    return {
      name: `${current.getFullYear()} 年 ${current.getMonth() + 1} 月`,
      startsAt: localInput(new Date(current.getFullYear(), current.getMonth(), 1)),
      endsAt: localInput(new Date(current.getFullYear(), current.getMonth() + 1, 1)),
      cutoffAt: localInput(new Date(current.getFullYear(), current.getMonth() + 1, 10, 18)),
    };
  });
  const selectMember = (membershipId: string) => {
    setSelectedMemberId(membershipId);
    const selected = activeMembers.find((item) => item.membershipId === membershipId);
    const selectedRules = selected?.plan?.rules ?? [];
    const weekdayRule = selectedRules.find((item) => item.type === "weekday");
    const weekendRule = selectedRules.find((item) => item.type === "weekend");
    const holidayRule = selectedRules.find((item) => item.type === "holiday");
    const nightRule = selectedRules.find((item) => item.type === "night_window");
    const overtimeRule = selectedRules.find((item) => item.type === "overtime");
    setPlanForm((current) => ({
      ...current,
      name: selected?.plan?.plan.name ?? "主薪资方案",
      type: selected?.plan?.version.type ?? "hourly",
      currency: selected?.plan?.plan.currency ?? "CNY",
      baseAmount: selected?.plan?.version.baseAmount ?? "",
      fixedAmount: selected?.plan?.version.config.fixedAmount ?? "",
      pendingReviewCountsInEstimate:
        selected?.plan?.version.pendingReviewCountsInEstimate ?? true,
      weekdayEnabled: Boolean(weekdayRule),
      weekdayMultiplier: weekdayRule?.multiplier ?? "1",
      weekendEnabled: Boolean(weekendRule),
      weekendMultiplier: weekendRule?.multiplier ?? "2",
      holidayEnabled: Boolean(holidayRule),
      holidayMultiplier: holidayRule?.multiplier ?? "3",
      holidayDates: holidayRule?.holidayDates?.join(", ") ?? "",
      nightEnabled: Boolean(nightRule),
      nightMultiplier: nightRule?.multiplier ?? "1.5",
      nightStartHour: nightRule?.startHour ?? 22,
      nightEndHour: nightRule?.endHour ?? 6,
      overtimeEnabled: Boolean(overtimeRule),
      overtimeMultiplier: overtimeRule?.multiplier ?? "1.5",
      overtimeHours: (overtimeRule?.thresholdSeconds ?? 28_800) / 3_600,
      effectiveFrom: localInput(new Date(Date.now() + 60_000)),
    }));
  };
  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["payroll-management"] }),
      queryClient.invalidateQueries({ queryKey: ["payroll-me"] }),
    ]);
  };
  const savePlan = useMutation({
    mutationFn: () => {
      const rules = [
        ...(planForm.weekdayEnabled
          ? [{ type: "weekday", priority: 50, multiplier: planForm.weekdayMultiplier }]
          : []),
        ...(planForm.weekendEnabled
          ? [{ type: "weekend", priority: 100, multiplier: planForm.weekendMultiplier }]
          : []),
        ...(planForm.holidayEnabled
          ? [{
              type: "holiday",
              priority: 150,
              multiplier: planForm.holidayMultiplier,
              holidayDates: planForm.holidayDates
                .split(/[，,\s]+/)
                .map((item) => item.trim())
                .filter(Boolean),
            }]
          : []),
        ...(planForm.nightEnabled
          ? [{
              type: "night_window",
              priority: 200,
              multiplier: planForm.nightMultiplier,
              startHour: planForm.nightStartHour,
              endHour: planForm.nightEndHour,
            }]
          : []),
        ...(planForm.overtimeEnabled
          ? [{
              type: "overtime",
              priority: 300,
              multiplier: planForm.overtimeMultiplier,
              thresholdSeconds: Math.round(planForm.overtimeHours * 3_600),
            }]
          : []),
      ];
      return api(`/api/payroll/members/${selectedMemberId}/plan`, {
        method: "PUT",
        body: {
          name: planForm.name,
          type: planForm.type,
          currency: planForm.currency,
          baseAmount: planForm.baseAmount,
          ...(planForm.type === "hybrid" ? { fixedAmount: planForm.fixedAmount } : {}),
          effectiveFrom: new Date(planForm.effectiveFrom).toISOString(),
          pendingReviewCountsInEstimate: planForm.pendingReviewCountsInEstimate,
          rules,
        },
      });
    },
    onSuccess: refresh,
  });
  const createPeriod = useMutation({
    mutationFn: () =>
      api("/api/payroll/periods", {
        method: "POST",
        body: {
          name: periodForm.name,
          timezone,
          startsAt: new Date(periodForm.startsAt).toISOString(),
          endsAt: new Date(periodForm.endsAt).toISOString(),
          cutoffAt: new Date(periodForm.cutoffAt).toISOString(),
        },
      }),
    onSuccess: refresh,
  });
  const calculatePeriod = useMutation({
    mutationFn: (periodId: string) =>
      api(`/api/pay-periods/${periodId}/calculate`, { method: "POST" }),
    onSuccess: refresh,
  });
  const settleRun = useMutation({
    mutationFn: (runId: string) =>
      api(`/api/payroll-runs/${runId}/settle`, { method: "POST" }),
    onSuccess: refresh,
  });
  return (
    <section className="mb-6 space-y-5" aria-label="薪资管理">
      <Card>
        <CardHeader>
          <div>
            <p className="app-page-kicker">Owner 管理</p>
            <h2 className="mt-1 text-lg font-bold">成员薪资方案</h2>
          </div>
          <Badge tone="info">版本化 · 生效日期 · 审计</Badge>
        </CardHeader>
        <CardContent>
          <div className="mb-5 grid gap-2 sm:grid-cols-2 xl:grid-cols-4" aria-label="薪资对象列表">
            {activeMembers.map((member) => (
              <button
                aria-pressed={selectedMemberId === member.membershipId}
                className={`rounded-xl px-4 py-3 text-left transition ${selectedMemberId === member.membershipId ? "bg-[var(--accent-soft)] text-[var(--accent-strong)]" : "bg-[var(--surface-subtle)] hover:bg-[var(--surface-tint)]"}`}
                key={member.membershipId}
                onClick={() => selectMember(member.membershipId)}
                type="button"
              >
                <span className="block font-bold">{member.displayName}</span>
                <span className="mt-1 block text-xs opacity-70">
                  {member.plan
                    ? `${compensationTypeLabels[member.plan.version.type]} · ${member.plan.plan.currency} ${Number(member.plan.version.baseAmount).toFixed(2)}`
                    : "尚未配置"}
                </span>
              </button>
            ))}
          </div>
          <form
            className="grid gap-4 xl:grid-cols-4"
            onSubmit={(event) => {
              event.preventDefault();
              savePlan.mutate();
            }}
          >
            <Field label="成员">
              <select className={fieldClass} onChange={(event) => selectMember(event.target.value)} required value={selectedMemberId}>
                <option value="">选择已激活成员</option>
                {activeMembers.map((member) => <option key={member.membershipId} value={member.membershipId}>{member.displayName}</option>)}
              </select>
            </Field>
            <Field label="计薪类型">
              <select className={fieldClass} onChange={(event) => setPlanForm({ ...planForm, type: event.target.value as CompensationPlanType })} value={planForm.type}>
                {Object.entries(compensationTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </Field>
            <Field label={planForm.type === "hourly" || planForm.type === "hybrid" ? "基础时薪" : "基础金额"}>
              <input className={fieldClass} inputMode="decimal" min="0" onChange={(event) => setPlanForm({ ...planForm, baseAmount: event.target.value })} placeholder="例如 80.00" required step="0.000001" type="number" value={planForm.baseAmount} />
            </Field>
            <Field label="币种">
              <input className={fieldClass} maxLength={3} onChange={(event) => setPlanForm({ ...planForm, currency: event.target.value.toUpperCase() })} required value={planForm.currency} />
            </Field>
            <Field label="方案名称">
              <input className={fieldClass} onChange={(event) => setPlanForm({ ...planForm, name: event.target.value })} required value={planForm.name} />
            </Field>
            <Field hint="新版本不得倒改已生效历史。" label="新版本生效时间">
              <input className={fieldClass} onChange={(event) => setPlanForm({ ...planForm, effectiveFrom: event.target.value })} required type="datetime-local" value={planForm.effectiveFrom} />
            </Field>
            {planForm.type === "hybrid" ? (
              <Field label="固定部分金额">
                <input className={fieldClass} min="0" onChange={(event) => setPlanForm({ ...planForm, fixedAmount: event.target.value })} required step="0.000001" type="number" value={planForm.fixedAmount} />
              </Field>
            ) : null}
            <label className="flex min-h-11 items-center gap-3 rounded-xl bg-[var(--surface-subtle)] px-3 text-sm">
              <input checked={planForm.pendingReviewCountsInEstimate} onChange={(event) => setPlanForm({ ...planForm, pendingReviewCountsInEstimate: event.target.checked })} type="checkbox" />
              待审核工时计入预估
            </label>
            <div className="grid gap-3 xl:col-span-4 md:grid-cols-2 xl:grid-cols-5">
              <label className="rounded-xl bg-[var(--surface-subtle)] p-3 text-sm">
                <span className="flex items-center gap-2 font-semibold"><input checked={planForm.weekdayEnabled} onChange={(event) => setPlanForm({ ...planForm, weekdayEnabled: event.target.checked })} type="checkbox" />工作日倍率</span>
                <input className={`${fieldClass} mt-2`} disabled={!planForm.weekdayEnabled} min="0" onChange={(event) => setPlanForm({ ...planForm, weekdayMultiplier: event.target.value })} step="0.01" type="number" value={planForm.weekdayMultiplier} />
              </label>
              <label className="rounded-xl bg-[var(--surface-subtle)] p-3 text-sm">
                <span className="flex items-center gap-2 font-semibold"><input checked={planForm.weekendEnabled} onChange={(event) => setPlanForm({ ...planForm, weekendEnabled: event.target.checked })} type="checkbox" />周末倍率</span>
                <input className={`${fieldClass} mt-2`} disabled={!planForm.weekendEnabled} min="0" onChange={(event) => setPlanForm({ ...planForm, weekendMultiplier: event.target.value })} step="0.01" type="number" value={planForm.weekendMultiplier} />
              </label>
              <label className="rounded-xl bg-[var(--surface-subtle)] p-3 text-sm">
                <span className="flex items-center gap-2 font-semibold"><input checked={planForm.holidayEnabled} onChange={(event) => setPlanForm({ ...planForm, holidayEnabled: event.target.checked })} type="checkbox" />节假日倍率</span>
                <input className={`${fieldClass} mt-2`} disabled={!planForm.holidayEnabled} min="0" onChange={(event) => setPlanForm({ ...planForm, holidayMultiplier: event.target.value })} step="0.01" type="number" value={planForm.holidayMultiplier} />
                <input aria-label="节假日日期" className={`${fieldClass} mt-2`} disabled={!planForm.holidayEnabled} onChange={(event) => setPlanForm({ ...planForm, holidayDates: event.target.value })} placeholder="2026-10-01, 2026-10-02" value={planForm.holidayDates} />
              </label>
              <label className="rounded-xl bg-[var(--surface-subtle)] p-3 text-sm">
                <span className="flex items-center gap-2 font-semibold"><input checked={planForm.nightEnabled} onChange={(event) => setPlanForm({ ...planForm, nightEnabled: event.target.checked })} type="checkbox" />夜间倍率（22:00–06:00）</span>
                <input className={`${fieldClass} mt-2`} disabled={!planForm.nightEnabled} min="0" onChange={(event) => setPlanForm({ ...planForm, nightMultiplier: event.target.value })} step="0.01" type="number" value={planForm.nightMultiplier} />
              </label>
              <label className="rounded-xl bg-[var(--surface-subtle)] p-3 text-sm">
                <span className="flex items-center gap-2 font-semibold"><input checked={planForm.overtimeEnabled} onChange={(event) => setPlanForm({ ...planForm, overtimeEnabled: event.target.checked })} type="checkbox" />超过 8 小时倍率</span>
                <input className={`${fieldClass} mt-2`} disabled={!planForm.overtimeEnabled} min="0" onChange={(event) => setPlanForm({ ...planForm, overtimeMultiplier: event.target.value })} step="0.01" type="number" value={planForm.overtimeMultiplier} />
              </label>
            </div>
            <div className="xl:col-span-4 flex flex-wrap items-center gap-3">
              <Button disabled={!selectedMemberId || savePlan.isPending} type="submit">{savePlan.isPending ? "正在保存版本…" : "保存薪资方案新版本"}</Button>
              {selectedMemberId ? <span className="text-xs text-[var(--text-muted)]">当前版本：{activeMembers.find((item) => item.membershipId === selectedMemberId)?.plan?.version.version ?? "未配置"}</span> : null}
            </div>
          </form>
          <ErrorMessage error={management.error ?? savePlan.error} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <div><p className="app-page-kicker">结算控制</p><h2 className="mt-1 text-lg font-bold">薪资周期与批次</h2></div>
        </CardHeader>
        <CardContent>
          <form className="grid gap-4 lg:grid-cols-4" onSubmit={(event) => { event.preventDefault(); createPeriod.mutate(); }}>
            <Field label="周期名称"><input className={fieldClass} onChange={(event) => setPeriodForm({ ...periodForm, name: event.target.value })} required value={periodForm.name} /></Field>
            <Field label="开始"><input className={fieldClass} onChange={(event) => setPeriodForm({ ...periodForm, startsAt: event.target.value })} required type="datetime-local" value={periodForm.startsAt} /></Field>
            <Field label="结束（不含）"><input className={fieldClass} onChange={(event) => setPeriodForm({ ...periodForm, endsAt: event.target.value })} required type="datetime-local" value={periodForm.endsAt} /></Field>
            <Field label="确认截止"><input className={fieldClass} onChange={(event) => setPeriodForm({ ...periodForm, cutoffAt: event.target.value })} required type="datetime-local" value={periodForm.cutoffAt} /></Field>
            <div className="lg:col-span-4"><Button disabled={createPeriod.isPending} type="submit">创建薪资周期</Button></div>
          </form>
          <div className="mt-5 space-y-2">
            {management.data?.periods.map((period) => (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-[var(--surface-subtle)] px-4 py-3" key={period.id}>
                <div><p className="font-semibold">{period.name}</p><p className="text-xs text-[var(--text-muted)]">{formatDateTime(period.startsAt)} – {formatDateTime(period.endsAt)} · {period.status}</p></div>
                <Button disabled={period.status !== "open" || calculatePeriod.isPending} onClick={() => calculatePeriod.mutate(period.id)} type="button" variant="secondary">计算本周期</Button>
              </div>
            ))}
          </div>
          {management.data?.runs.some((entry) => entry.run.status === "ready") ? (
            <div className="mt-5 space-y-2">
              {management.data.runs.filter((entry) => entry.run.status === "ready").map((entry) => (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-[var(--success-soft)] px-4 py-3" key={entry.run.id}>
                  <span className="text-sm font-semibold">{entry.period.name} · 批次 #{entry.run.runNumber} 已就绪</span>
                  <Button disabled={settleRun.isPending} onClick={() => settleRun.mutate(entry.run.id)} type="button">确认结算并锁定</Button>
                </div>
              ))}
            </div>
          ) : null}
          <ErrorMessage error={createPeriod.error ?? calculatePeriod.error ?? settleRun.error} />
        </CardContent>
      </Card>
    </section>
  );
}

export function PayrollPage({ me }: { me: Me }) {
  const chartPalette = useChartPalette();
  const payroll = useQuery({
    queryKey: ["payroll-me"],
    queryFn: () => api<PayrollOwnResponse>("/api/payroll/me"),
  });
  const [selectedPayrollId, setSelectedPayrollId] = useState("");
  const selected =
    payroll.data?.items.find((record) => record.item.id === selectedPayrollId) ??
    payroll.data?.items[0] ??
    null;
  const money = (currency: string, amount: string) => {
    try {
      return new Intl.NumberFormat("zh-CN", {
        style: "currency",
        currency,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(Number(amount));
    } catch {
      return `${currency} ${Number(amount).toFixed(2)}`;
    }
  };
  const dailyOption = useMemo<EChartsCoreOption>(() => ({
    animationDuration: 260,
    grid: { left: 64, right: 22, top: 28, bottom: 58 },
    tooltip: {
      trigger: "axis",
      backgroundColor: chartPalette.surface,
      borderColor: chartPalette.border,
      textStyle: { color: chartPalette.text },
      valueFormatter: (value: string | number) =>
        selected ? money(selected.item.currency, String(value)) : String(value),
    },
    xAxis: {
      type: "category",
      data: selected?.dailyBreakdown.map((item) => item.date.slice(5)) ?? [],
      axisLabel: { hideOverlap: true, color: chartPalette.textSubtle },
      axisLine: { lineStyle: { color: chartPalette.border } },
    },
    yAxis: {
      type: "value",
      axisLabel: { color: chartPalette.textSubtle },
      splitLine: { lineStyle: { color: chartPalette.grid } },
    },
    dataZoom: [
      { type: "inside" },
      {
        type: "slider",
        height: 18,
        bottom: 12,
        borderColor: "transparent",
        fillerColor: hexWithAlpha(chartPalette.accent, 0.14),
        handleStyle: { color: chartPalette.accent },
      },
    ],
    series: [
      {
        type: "bar",
        name: "每日薪资",
        data: selected?.dailyBreakdown.map((item) => Number(item.amount)) ?? [],
        itemStyle: { color: chartPalette.accent, borderRadius: [7, 7, 0, 0] },
      },
    ],
  }), [chartPalette, selected]);
  const periodOption = useMemo<EChartsCoreOption>(() => ({
    animationDuration: 260,
    grid: { left: 64, right: 22, top: 28, bottom: 62 },
    tooltip: {
      trigger: "axis",
      backgroundColor: chartPalette.surface,
      borderColor: chartPalette.border,
      textStyle: { color: chartPalette.text },
    },
    xAxis: {
      type: "category",
      data: [...(payroll.data?.items ?? [])].reverse().map((record) => record.period.name),
      axisLabel: { hideOverlap: true, rotate: 18, color: chartPalette.textSubtle },
      axisLine: { lineStyle: { color: chartPalette.border } },
    },
    yAxis: {
      type: "value",
      axisLabel: { color: chartPalette.textSubtle },
      splitLine: { lineStyle: { color: chartPalette.grid } },
    },
    dataZoom: [{ type: "inside" }],
    series: [{
      type: "line",
      name: "周期薪资",
      smooth: true,
      symbolSize: 8,
      data: [...(payroll.data?.items ?? [])].reverse().map((record) => Number(record.item.finalAmount)),
      lineStyle: { color: chartPalette.accent, width: 3 },
      itemStyle: { color: chartPalette.accent },
      areaStyle: { color: hexWithAlpha(chartPalette.accent, 0.12) },
    }],
  }), [chartPalette, payroll.data?.items]);
  const waterfallOption = useMemo<EChartsCoreOption>(() => {
    let running = 0;
    const labels: string[] = [];
    const offsets: number[] = [];
    const deltas: Array<{ value: number; actual: number; itemStyle: { color: string; borderRadius: number[] } }> = [];
    for (const component of selected?.components ?? []) {
      const amount = Number(component.amount);
      if (!Number.isFinite(amount)) continue;
      labels.push(component.label);
      offsets.push(Math.min(running, running + amount));
      deltas.push({
        value: Math.abs(amount),
        actual: amount,
        itemStyle: {
          color: amount < 0 ? chartPalette.danger : chartPalette.accent,
          borderRadius: [5, 5, 5, 5],
        },
      });
      running += amount;
    }
    const finalAmount = Number(selected?.item.finalAmount ?? 0);
    labels.push("最终金额");
    offsets.push(Math.min(0, finalAmount));
    deltas.push({
      value: Math.abs(finalAmount),
      actual: finalAmount,
      itemStyle: { color: chartPalette.text, borderRadius: [5, 5, 5, 5] },
    });
    return {
      animationDuration: 240,
      grid: { left: 64, right: 18, top: 24, bottom: 74 },
      tooltip: {
        trigger: "axis",
        confine: true,
        axisPointer: { type: "shadow" },
        backgroundColor: chartPalette.surface,
        borderColor: chartPalette.border,
        textStyle: { color: chartPalette.text },
        formatter: (params: Array<{ data?: { actual?: number }; axisValue?: string }>) => {
          const point = params.find((item) => typeof item.data?.actual === "number");
          return `${point?.axisValue ?? ""}<br/>${money(selected?.item.currency ?? "CNY", String(point?.data?.actual ?? 0))}`;
        },
      },
      xAxis: { type: "category", data: labels, axisLabel: { width: 86, overflow: "truncate", rotate: 18, color: chartPalette.textSubtle }, axisLine: { lineStyle: { color: chartPalette.border } } },
      yAxis: { type: "value", axisLabel: { color: chartPalette.textSubtle }, splitLine: { lineStyle: { color: chartPalette.grid } } },
      dataZoom: [{ type: "inside" }],
      series: [
        { type: "bar", stack: "salary-waterfall", silent: true, data: offsets, itemStyle: { color: "transparent" }, emphasis: { itemStyle: { color: "transparent" } }, tooltip: { show: false } },
        { type: "bar", name: "金额变化", stack: "salary-waterfall", data: deltas, label: { show: true, position: "top", color: chartPalette.textMuted, formatter: (params: { data?: { actual?: number } }) => `${Number(params.data?.actual ?? 0) >= 0 ? "+" : ""}${Number(params.data?.actual ?? 0).toFixed(2)}` } },
      ],
    };
  }, [chartPalette, selected]);
  return (
    <>
      <PageHeader
        title={hasGrant(me, "payroll.configure") ? "薪资管理与我的薪资" : "我的薪资"}
      />
      {hasGrant(me, "payroll.configure") ? <PayrollManagementPanel /> : null}
      {payroll.isPending ? (
        <Card>
          <LoadingBlock />
        </Card>
      ) : payroll.data?.items.length && selected ? (
        <div className="space-y-5">
          <section className="grid gap-3 md:grid-cols-3" aria-label="薪资总览">
            {(payroll.data.summary.length ? payroll.data.summary : [{
              currency: selected.item.currency,
              settledAmount: "0",
              pendingAmount: selected.item.finalAmount,
              totalAmount: selected.item.finalAmount,
            }]).map((summary) => (
              <div className="contents" key={summary.currency}>
                <Card><CardContent><StatusLine label="当前应结" value={money(summary.currency, summary.pendingAmount)} /></CardContent></Card>
                <Card><CardContent><StatusLine label="已结累计" value={money(summary.currency, summary.settledAmount)} /></CardContent></Card>
                <Card><CardContent><StatusLine label="累计薪资" value={money(summary.currency, summary.totalAmount)} /></CardContent></Card>
              </div>
            ))}
          </section>

          <div className="flex flex-wrap items-end justify-between gap-3">
            <Field label="查看薪资周期">
              <select className={`${fieldClass} min-w-64`} onChange={(event) => setSelectedPayrollId(event.target.value)} value={selected.item.id}>
                {payroll.data.items.map((record) => (
                  <option key={record.item.id} value={record.item.id}>
                    {record.period.name} · {money(record.item.currency, record.item.finalAmount)}
                  </option>
                ))}
              </select>
            </Field>
            <div className="flex items-center gap-2">
              <Badge tone={selected.run.status === "settled" ? "positive" : selected.item.needsReview ? "danger" : selected.item.estimate ? "warning" : "info"}>
                {selected.run.status === "settled" ? "已结算" : selected.item.estimate ? "预估" : "待结算"}
              </Badge>
              <span className="text-sm text-[var(--text-muted)]">已批 {formatDuration(selected.item.approvedSeconds)}{selected.item.pendingSeconds ? ` · 待审 ${formatDuration(selected.item.pendingSeconds)}` : ""}</span>
            </div>
          </div>

          <section className="grid gap-5 xl:grid-cols-2" aria-label="薪资趋势图表">
            <Card className="analytics-chart-card">
              <CardHeader><h2 className="font-bold">每日薪资</h2><Badge>{selected.period.name}</Badge></CardHeader>
              <CardContent><AnalyticsChart ariaLabel={`${selected.period.name}每日薪资`} option={dailyOption} /></CardContent>
            </Card>
            <Card className="analytics-chart-card">
              <CardHeader><h2 className="font-bold">周期趋势</h2><Badge>{payroll.data.items.length} 期</Badge></CardHeader>
              <CardContent><AnalyticsChart ariaLabel="周期薪资趋势" option={periodOption} /></CardContent>
            </Card>
            <Card className="analytics-chart-card xl:col-span-2">
              <CardHeader><h2 className="font-bold">薪资构成瀑布</h2><Badge>{selected.components.length} 个可追溯分项</Badge></CardHeader>
              <CardContent><AnalyticsChart ariaLabel={`${selected.period.name}薪资构成瀑布图`} option={waterfallOption} /></CardContent>
            </Card>
          </section>

          <Card>
            <CardHeader>
              <div><p className="app-page-kicker">{selected.period.name}</p><h2 className="mt-1 text-lg font-bold">计薪明细</h2></div>
              <strong className="text-2xl tabular-nums">{money(selected.item.currency, selected.item.finalAmount)}</strong>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 sm:grid-cols-3">
                <StatusLine label="应计" value={money(selected.item.currency, selected.item.grossAmount)} />
                <StatusLine label="调整" value={money(selected.item.currency, selected.item.adjustmentAmount)} />
                <StatusLine label="最终" value={money(selected.item.currency, selected.item.finalAmount)} />
              </div>
              <div className="mt-5 divide-y divide-[var(--border)]">
                {selected.components.map((component) => (
                  <div className="flex items-center justify-between gap-4 py-3 text-sm" key={component.id}>
                    <div><p className="font-semibold">{component.label}</p><p className="text-xs text-[var(--text-muted)]">{component.quantity ? `${Number(component.quantity).toLocaleString("zh-CN")} ${component.unit ?? ""}` : component.type}{component.multiplier ? ` · ${Number(component.multiplier)}×` : ""}</p></div>
                    <strong className="tabular-nums">{money(selected.item.currency, component.amount)}</strong>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      ) : (
        <Card>
          <EmptyState
            description="管理员计算薪资后会在这里显示。"
            icon={<CircleDollarSign />}
            title="暂无薪资批次"
          />
        </Card>
      )}
      <div className="mt-4">
        <ErrorMessage error={payroll.error} />
      </div>
    </>
  );
}

type CalendarView = "day" | "week" | "month" | "list";

function calendarStartOfDay(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

function addCalendarDays(value: Date, days: number): Date {
  const next = new Date(value);
  next.setDate(next.getDate() + days);
  return next;
}

function calendarKey(value: Date): string {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

function calendarTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

export function LegacyCalendarPageV2() {
  const queryClient = useQueryClient();
  const [view, setView] = useState<CalendarView>("week");
  const [anchorDate, setAnchorDate] = useState(() => new Date());
  const work = useQuery({
    queryKey: ["work-sessions"],
    queryFn: () =>
      api<{ items: WorkSession[] }>("/api/work-sessions?limit=100"),
  });
  const reschedule = useMutation({
    mutationFn: ({ item, days }: { item: WorkSession; days: number }) => {
      const shift = days * 86_400_000;
      return api(`/api/work-sessions/${item.id}/schedule`, {
        method: "PATCH",
        body: {
          expectedVersion: item.version,
          startAt: new Date(
            new Date(item.startAt).getTime() + shift,
          ).toISOString(),
          endAt: new Date(new Date(item.endAt).getTime() + shift).toISOString(),
        },
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["work-sessions"] });
    },
  });
  const today = useMemo(() => calendarStartOfDay(new Date()), []);
  const dayStart = calendarStartOfDay(anchorDate);
  const weekStart = addCalendarDays(dayStart, -((dayStart.getDay() + 6) % 7));
  const monthStart = new Date(dayStart.getFullYear(), dayStart.getMonth(), 1);
  const periodStart =
    view === "month" ? monthStart : view === "day" ? dayStart : weekStart;
  const periodEnd =
    view === "month"
      ? new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 1)
      : addCalendarDays(periodStart, view === "day" ? 1 : 7);
  const sessions = work.data?.items ?? [];
  const periodSessions = sessions.filter((item) => {
    const startsAt = new Date(item.startAt).getTime();
    return startsAt >= periodStart.getTime() && startsAt < periodEnd.getTime();
  });
  const sessionsByDate = (() => {
    const result = new Map<string, WorkSession[]>();
    for (const item of periodSessions) {
      const key = calendarKey(new Date(item.startAt));
      result.set(key, [...(result.get(key) ?? []), item]);
    }
    return result;
  })();
  const listGroups = (() => {
    const result = new Map<string, WorkSession[]>();
    for (const item of periodSessions) {
      const date = new Date(item.startAt);
      const key = new Intl.DateTimeFormat("zh-CN", {
        weekday: "short",
        month: "long",
        day: "numeric",
      }).format(date);
      result.set(key, [...(result.get(key) ?? []), item]);
    }
    return [...result.entries()];
  })();
  const weekDays = Array.from({ length: 7 }, (_, index) =>
    addCalendarDays(weekStart, index),
  );
  const firstMonthGridDate = addCalendarDays(
    monthStart,
    -((monthStart.getDay() + 6) % 7),
  );
  const monthDays = Array.from({ length: 42 }, (_, index) =>
    addCalendarDays(firstMonthGridDate, index),
  );
  const isToday = (date: Date) => calendarKey(date) === calendarKey(today);
  const movePeriod = (direction: number) =>
    setAnchorDate((date) => {
      const next = new Date(date);
      if (view === "month") next.setMonth(next.getMonth() + direction);
      else next.setDate(next.getDate() + direction * (view === "day" ? 1 : 7));
      return next;
    });
  const rangeLabel =
    view === "month"
      ? new Intl.DateTimeFormat("zh-CN", {
          year: "numeric",
          month: "long",
        }).format(anchorDate)
      : view === "day"
        ? new Intl.DateTimeFormat("zh-CN", {
            year: "numeric",
            month: "long",
            day: "numeric",
            weekday: "long",
          }).format(anchorDate)
        : `${new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric" }).format(weekStart)} – ${new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric" }).format(addCalendarDays(weekStart, 6))}`;
  const calendarEvent = (item: WorkSession) => (
    <div className="calendar-event" key={item.id}>
      <time>
        {calendarTime(item.startAt)} – {calendarTime(item.endAt)}
      </time>
      <strong className="block truncate">{item.content}</strong>
    </div>
  );

  return (
    <>
      <PageHeader
        title="工作日历"
        description="将真实工作放进可操作的时间视图；草稿改期由服务端保持时长、同步休息段、校验重叠并记录版本。"
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => movePeriod(-1)}
              size="compact"
              variant="secondary"
            >
              上一周期
            </Button>
            <Button
              onClick={() => setAnchorDate(new Date())}
              size="compact"
              variant="secondary"
            >
              今天
            </Button>
            <Button
              onClick={() => movePeriod(1)}
              size="compact"
              variant="secondary"
            >
              下一周期
            </Button>
            {(
              [
                ["day", "日"],
                ["week", "周"],
                ["month", "月"],
                ["list", "列表"],
              ] as const
            ).map(([item, label]) => (
              <Button
                key={item}
                onClick={() => setView(item)}
                size="compact"
                variant={view === item ? "primary" : "secondary"}
              >
                {label}
              </Button>
            ))}
          </div>
        }
      />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm font-semibold text-[var(--text-muted)]">
          当前周期：{rangeLabel}
        </p>
        <span className="text-xs text-[var(--text-subtle)]">
          记录颜色与状态来自同一条工作事实链
        </span>
      </div>
      {work.isPending ? (
        <Card>
          <LoadingBlock />
        </Card>
      ) : (
        <>
          <section aria-label="工作日历视图" className="calendar-shell">
            {view === "week" ? (
              <div className="calendar-week-scroll">
                <div className="calendar-week-grid">
                  {weekDays.map((date) => (
                    <div
                      className={`calendar-week-heading ${isToday(date) ? "is-today" : ""}`}
                      key={calendarKey(date)}
                    >
                      <span>
                        {new Intl.DateTimeFormat("zh-CN", {
                          weekday: "short",
                        }).format(date)}
                      </span>
                      <strong>{date.getDate()}</strong>
                    </div>
                  ))}
                  {weekDays.map((date) => (
                    <div
                      className="calendar-week-column"
                      key={`column-${calendarKey(date)}`}
                    >
                      {sessionsByDate
                        .get(calendarKey(date))
                        ?.map(calendarEvent)}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            {view === "month" ? (
              <div className="calendar-month-grid">
                {["一", "二", "三", "四", "五", "六", "日"].map((label) => (
                  <div className="calendar-month-weekday" key={label}>
                    周{label}
                  </div>
                ))}
                {monthDays.map((date) => (
                  <div
                    className={`calendar-month-day ${date.getMonth() !== monthStart.getMonth() ? "is-outside" : ""} ${isToday(date) ? "is-today" : ""}`}
                    key={calendarKey(date)}
                  >
                    <span className="calendar-day-number">
                      {date.getDate()}
                    </span>
                    {sessionsByDate
                      .get(calendarKey(date))
                      ?.slice(0, 3)
                      .map(calendarEvent)}
                  </div>
                ))}
              </div>
            ) : null}
            {view === "day" ? (
              <div className="calendar-day-view">
                <div className="calendar-day-hours">
                  {[
                    "07:00",
                    "09:00",
                    "11:00",
                    "13:00",
                    "15:00",
                    "17:00",
                    "19:00",
                    "21:00",
                  ].map((hour) => (
                    <span key={hour}>{hour}</span>
                  ))}
                </div>
                <div className="calendar-day-track">
                  {periodSessions.map((item) => {
                    const top = Math.max(
                      0,
                      Math.min(100, ((dayHour(item.startAt) - 7) / 15) * 100),
                    );
                    const height = Math.max(
                      6,
                      Math.min(
                        100,
                        ((dayHour(item.endAt) - dayHour(item.startAt)) / 15) *
                          100,
                      ),
                    );
                    return (
                      <div
                        className="calendar-event"
                        key={item.id}
                        style={{ top: `${top}%`, height: `${height}%` }}
                      >
                        <time>
                          {calendarTime(item.startAt)} –{" "}
                          {calendarTime(item.endAt)} ·{" "}
                          {formatDuration(item.netSeconds)}
                        </time>
                        <strong className="block truncate">
                          {item.content}
                        </strong>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}
            {view === "list" ? (
              <div className="p-5">
                {listGroups.length ? (
                  <div className="space-y-5">
                    {listGroups.map(([date, items]) => (
                      <section key={date}>
                        <div className="mb-2 flex items-center justify-between">
                          <h2 className="text-sm font-bold">{date}</h2>
                          <Badge tone="info">
                            {formatDuration(
                              items.reduce(
                                (sum, item) => sum + item.netSeconds,
                                0,
                              ),
                            )}
                          </Badge>
                        </div>
                        <div className="divide-y divide-[var(--border)]">
                          {items.map((item) => (
                            <WorkRow item={item} key={item.id} />
                          ))}
                        </div>
                      </section>
                    ))}
                  </div>
                ) : (
                  <EmptyState
                    description="当前周期没有工时；创建记录后会按个人时区显示。"
                    icon={<CalendarDays />}
                    title="日历中还没有记录"
                  />
                )}
              </div>
            ) : null}
          </section>
          <Card className="calendar-audit-card">
            <CardHeader>
              <div>
                <p className="app-section-label">事实明细</p>
                <h2 className="mt-2 font-extrabold tracking-[-0.025em]">
                  当前周期的工作记录
                </h2>
                <p className="mt-1 text-sm text-[var(--text-muted)]">
                  需要改期的草稿可在这里操作；已提交记录保持审核轨迹。
                </p>
              </div>
              <Badge tone="info">
                {formatDuration(
                  periodSessions.reduce(
                    (sum, item) => sum + item.netSeconds,
                    0,
                  ),
                )}
              </Badge>
            </CardHeader>
            <CardContent>
              {periodSessions.length ? (
                <div className="divide-y divide-[var(--border)]">
                  {periodSessions.map((item) => (
                    <div
                      className="flex flex-col gap-3 px-2 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center"
                      key={item.id}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold">
                          {formatDateTime(item.startAt)} –{" "}
                          {formatDateTime(item.endAt)}
                        </p>
                        <p className="mt-1 text-xs text-[var(--text-muted)]">
                          {formatDuration(item.netSeconds)} ·{" "}
                          {item.source === "timer" ? "计时记录" : "手工记录"} ·{" "}
                          {item.submissionStatus === "draft"
                            ? "草稿可改期"
                            : "已进入提交流程"}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <Badge
                          tone={
                            item.submissionStatus === "draft"
                              ? "warning"
                              : "neutral"
                          }
                        >
                          {item.submissionStatus === "draft"
                            ? "草稿"
                            : "已提交"}
                        </Badge>
                        {item.submissionStatus === "draft" ? (
                          <span className="flex gap-1">
                            <Button
                              disabled={reschedule.isPending}
                              onClick={() =>
                                reschedule.mutate({ item, days: -1 })
                              }
                              size="compact"
                              variant="secondary"
                            >
                              前一天
                            </Button>
                            <Button
                              disabled={reschedule.isPending}
                              onClick={() =>
                                reschedule.mutate({ item, days: 1 })
                              }
                              size="compact"
                              variant="secondary"
                            >
                              后一天
                            </Button>
                          </span>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState
                  description="当前周期没有工时；创建记录后会按个人时区显示。"
                  icon={<CalendarDays />}
                  title="没有可对账的记录"
                />
              )}
              <ErrorMessage error={reschedule.error} />
            </CardContent>
          </Card>
        </>
      )}
    </>
  );
}
export function LegacyCalendarPage() {
  const queryClient = useQueryClient();
  const [view, setView] = useState<"day" | "week" | "month">("week");
  const work = useQuery({
    queryKey: ["work-sessions"],
    queryFn: () =>
      api<{ items: WorkSession[] }>("/api/work-sessions?limit=100"),
  });
  const reschedule = useMutation({
    mutationFn: ({ item, days }: { item: WorkSession; days: number }) => {
      const shift = days * 86_400_000;
      return api(`/api/work-sessions/${item.id}/schedule`, {
        method: "PATCH",
        body: {
          expectedVersion: item.version,
          startAt: new Date(
            new Date(item.startAt).getTime() + shift,
          ).toISOString(),
          endAt: new Date(new Date(item.endAt).getTime() + shift).toISOString(),
        },
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["work-sessions"] });
    },
  });
  const groups = useMemo(() => {
    const now = new Date();
    const dayStart = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    ).getTime();
    const weekStart = dayStart - ((now.getDay() + 6) % 7) * 86_400_000;
    const month = `${now.getFullYear()}-${now.getMonth()}`;
    const result = new Map<string, WorkSession[]>();
    for (const item of work.data?.items ?? []) {
      const date = new Date(item.startAt);
      const timestamp = new Date(
        date.getFullYear(),
        date.getMonth(),
        date.getDate(),
      ).getTime();
      if (
        (view === "day" && timestamp !== dayStart) ||
        (view === "week" &&
          (timestamp < weekStart || timestamp >= weekStart + 7 * 86_400_000)) ||
        (view === "month" &&
          `${date.getFullYear()}-${date.getMonth()}` !== month)
      )
        continue;
      const key = new Intl.DateTimeFormat("zh-CN", {
        weekday: "short",
        month: "long",
        day: "numeric",
      }).format(date);
      result.set(key, [...(result.get(key) ?? []), item]);
    }
    return [...result.entries()];
  }, [view, work.data]);
  return (
    <>
      <PageHeader
        title="工作日历"
        description="日/周/月视图只展示真实工时。草稿可向前或向后改期；服务端会保持时长、同步休息段、校验重叠并记录版本。"
        actions={
          <div className="flex gap-2">
            {(["day", "week", "month"] as const).map((item) => (
              <Button
                key={item}
                onClick={() => setView(item)}
                size="compact"
                variant={view === item ? "primary" : "secondary"}
              >
                {item === "day" ? "日" : item === "week" ? "周" : "月"}
              </Button>
            ))}
          </div>
        }
      />
      {work.isPending ? (
        <Card>
          <LoadingBlock />
        </Card>
      ) : groups.length ? (
        <div className="space-y-5">
          {groups.map(([date, items]) => (
            <Card key={date}>
              <CardHeader>
                <h2 className="font-bold">{date}</h2>
                <Badge tone="info">
                  {formatDuration(
                    items.reduce((sum, item) => sum + item.netSeconds, 0),
                  )}
                </Badge>
              </CardHeader>
              <CardContent>
                <div className="divide-y divide-[var(--border)]">
                  {items.map((item) => (
                    <WorkRow
                      action={
                        item.submissionStatus === "draft" ? (
                          <span className="flex gap-1">
                            <Button
                              disabled={reschedule.isPending}
                              onClick={() =>
                                reschedule.mutate({ item, days: -1 })
                              }
                              size="compact"
                              variant="secondary"
                            >
                              前一天
                            </Button>
                            <Button
                              disabled={reschedule.isPending}
                              onClick={() =>
                                reschedule.mutate({ item, days: 1 })
                              }
                              size="compact"
                              variant="secondary"
                            >
                              后一天
                            </Button>
                          </span>
                        ) : null
                      }
                      item={item}
                      key={item.id}
                    />
                  ))}
                </div>
                <ErrorMessage error={reschedule.error} />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <EmptyState
            description={`当前${view === "day" ? "日" : view === "week" ? "周" : "月"}没有工时；创建记录后会按个人时区显示。`}
            icon={<CalendarDays />}
            title="日历中还没有记录"
          />
        </Card>
      )}
    </>
  );
}

interface TeamActivity {
  id: string;
  membershipId: string;
  displayName: string;
  content: string;
  result: string;
  activityAt: string;
  hasFullTiming: boolean;
  startAt: string | null;
  endAt: string | null;
  netSeconds: number | null;
  projectName: string | null;
}
interface TeamMemberActivity {
  membershipId: string;
  displayName: string;
  avatarUrl: string | null;
  positionTitle: string | null;
  projectNames: string[];
  professionalIdentities: string[];
  lastActivity: TeamActivity | null;
}
interface TeamActivityResponse {
  scope: "organization" | "shared_projects";
  items: TeamActivity[];
  members: TeamMemberActivity[];
}
export function TeamPage() {
  const activity = useQuery({
    queryKey: ["team-activity"],
    queryFn: () =>
      api<TeamActivityResponse>("/api/team-activity?limit=50"),
  });
  return (
    <>
      <PageHeader title="团队动态" />
      {activity.isPending ? (
        <Card>
          <LoadingBlock />
        </Card>
      ) : activity.data ? (
        <div className="team-activity-layout">
          <section className="team-member-overview" aria-label="可见协作成员">
            <div className="team-section-heading">
              <h2>协作成员</h2>
              <Badge tone="neutral">
                {activity.data.scope === "organization" ? "全组织" : "同项目"}
              </Badge>
            </div>
            <div className="team-member-grid">
              {activity.data.members.map((member) => (
                <article className="team-member-item" key={member.membershipId}>
                  {member.avatarUrl ? (
                    <img alt="" src={member.avatarUrl} />
                  ) : (
                    <span className="team-member-avatar">
                      {member.displayName.slice(0, 1)}
                    </span>
                  )}
                  <div className="min-w-0">
                    <strong>{member.displayName}</strong>
                    <small>
                      {[member.positionTitle, ...member.professionalIdentities]
                        .filter(Boolean)
                        .slice(0, 2)
                        .join(" · ") || member.projectNames.slice(0, 2).join(" · ") || "项目成员"}
                    </small>
                    <time dateTime={member.lastActivity?.activityAt}>
                      {member.lastActivity
                        ? `最后工作 ${formatDateTime(member.lastActivity.activityAt)}`
                        : "暂无公开工作记录"}
                    </time>
                  </div>
                </article>
              ))}
            </div>
          </section>

          {activity.data.items.length ? (
            <section className="team-activity-feed" aria-label="公开工作动态">
              <div className="team-section-heading">
                <h2>最近工作</h2>
              </div>
              {activity.data.items.map((item) => (
                <article className="team-activity-item" key={item.id}>
                  <span className="team-member-avatar">
                    {item.displayName.slice(0, 1)}
                  </span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <strong>{item.displayName}</strong>
                      {item.projectName ? (
                        <Badge tone="info">{item.projectName}</Badge>
                      ) : null}
                    </div>
                    <p>{item.content}</p>
                    {item.result ? <small>结果：{item.result}</small> : null}
                    <time dateTime={item.activityAt}>
                      {item.hasFullTiming && item.startAt && item.netSeconds !== null
                        ? `${formatDateTime(item.startAt)} · ${formatDuration(item.netSeconds)}`
                        : `最后工作 ${formatDateTime(item.activityAt)}`}
                    </time>
                  </div>
                </article>
              ))}
            </section>
          ) : (
            <Card>
              <EmptyState
                description="成员发布项目可见工作后会出现在这里。"
                icon={<Users />}
                title="暂无公开工作动态"
              />
            </Card>
          )}
        </div>
      ) : (
        <Card>
          <EmptyState
            description="暂时无法读取团队动态。"
            icon={<Users />}
            title="团队动态不可用"
          />
        </Card>
      )}
      <div className="mt-4">
        <ErrorMessage error={activity.error} />
      </div>
    </>
  );
}

interface AnalyticsSummary {
  range: { from: string; to: string; timezone: string };
  totals: {
    sessionCount: number;
    totalSeconds: number;
    approvedSeconds: number;
    pendingSeconds: number;
  };
  byDay: Array<{ date: string; seconds: number }>;
  byMember: Array<{
    membershipId: string;
    displayName: string;
    seconds: number;
  }>;
  byProject: Array<{
    projectId: string | null;
    projectName: string;
    projectStatus: string | null;
    dueAt: string | null;
    seconds: number;
  }>;
  byWorkType: Array<{ workTypeId: string | null; workTypeName: string; seconds: number }>;
  byOrgUnit: Array<{ orgUnitId: string | null; orgUnitName: string; seconds: number }>;
  bySource: Array<{ source: string; seconds: number; count: number }>;
  byApproval: Array<{ status: string; seconds: number; count: number }>;
  byHour: Array<{ hour: number; seconds: number; count: number }>;
  projectWorkTypes: Array<{
    projectId: string | null;
    projectName: string;
    workTypeId: string | null;
    workTypeName: string;
    seconds: number;
  }>;
  flow: {
    nodes: Array<{
      id: string;
      label: string;
      kind: "project" | "work_type" | "approval";
    }>;
    links: Array<{ source: string; target: string; seconds: number }>;
  };
  anomalies: Array<{ category: string; count: number; seconds: number }>;
  projectHealth: Array<{
    projectId: string;
    projectName: string;
    status: string | null;
    dueAt: string | null;
    seconds: number;
    progress: number;
    blockedNodes: number;
    totalNodes: number;
  }>;
  forecast: {
    observed: Array<{ date: string; seconds: number }>;
    predicted: Array<{
      date: string;
      seconds: number;
      lowerSeconds: number;
      upperSeconds: number;
    }>;
  };
  availableFilters: {
    members: Array<{ id: string; label: string }>;
    projects: Array<{ id: string; label: string }>;
    workTypes: Array<{ id: string; label: string }>;
    orgUnits: Array<{ id: string; label: string }>;
    approvalStates: string[];
    sourceTypes: string[];
  };
  funnel: Array<{ stage: string; count: number }>;
}

interface AnalyticsFilterState {
  projectId: string;
  workTypeId: string;
  memberId: string;
  orgUnitId: string;
  approvalState: string;
  sourceType: string;
}

const emptyAnalyticsFilters: AnalyticsFilterState = {
  projectId: "",
  workTypeId: "",
  memberId: "",
  orgUnitId: "",
  approvalState: "",
  sourceType: "",
};

const approvalLabels: Record<string, string> = {
  not_requested: "未提交审核",
  pending_review: "待审核",
  approved: "已批准",
  returned: "已退回",
  locked: "已锁定",
};

const sourceLabels: Record<string, string> = {
  manual: "手动记录",
  timer: "实时计时",
  import: "批量导入",
};

const projectStatusLabels: Record<string, string> = {
  planned: "计划中",
  active: "进行中",
  paused: "已暂停",
  completed: "已完成",
  archived: "已归档",
};

function analyticsSelectionId(data: unknown, key: string): string | null {
  if (!data || typeof data !== "object") return null;
  const value = (data as Record<string, unknown>)[key];
  return typeof value === "string" && value !== "unassigned" ? value : null;
}

type BackgroundExportStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "expired";

interface BackgroundExportJob {
  id: string;
  exportType: "work_sessions";
  format: "csv" | "json" | "xlsx" | "pdf";
  status: BackgroundExportStatus;
  progress: number;
  attempt: number;
  maxAttempts: number;
  fileName: string | null;
  contentType: string | null;
  byteSize: number | null;
  rowCount: number | null;
  sha256: string | null;
  errorCode: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  expiresAt: string | null;
  downloadReady: boolean;
}

interface BackgroundExportCapabilities {
  available: boolean;
  formats: Array<"csv" | "json" | "xlsx" | "pdf">;
  retentionHours: number;
  unavailableReason?: string;
}

const exportStatusMeta: Record<
  BackgroundExportStatus,
  { label: string; tone: "neutral" | "positive" | "warning" | "danger" | "info" }
> = {
  queued: { label: "等待处理", tone: "neutral" },
  running: { label: "生成中", tone: "info" },
  completed: { label: "可下载", tone: "positive" },
  failed: { label: "失败", tone: "danger" },
  cancelled: { label: "已取消", tone: "neutral" },
  expired: { label: "已过期", tone: "warning" },
};

function exportErrorMessage(code: string | null): string | null {
  if (!code) return null;
  const messages: Record<string, string> = {
    export_storage_unavailable: "私有对象存储未配置。",
    export_too_large: "记录超过 50,000 条或文本超过 25 MiB，请缩小时间范围。",
    export_job_invalid: "任务参数无效，请重新创建。",
    export_render_failed: "文件生成失败，可以重试。",
    export_upload_failed: "文件上传失败，可以重试。",
    export_generation_failed: "后台生成失败，可以重试。",
    export_lease_expired: "Worker 中断后已自动恢复任务。",
  };
  return messages[code] ?? "后台导出未完成，可以重试。";
}

function formatExportFileSize(bytes: number | null): string {
  if (bytes === null) return "";
  if (bytes < 1_024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${(bytes / 1_024).toFixed(1)} KB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

function BackgroundExportPanel({ from, to }: { from: Date; to: Date }) {
  const queryClient = useQueryClient();
  const [format, setFormat] = useState<"csv" | "json" | "xlsx" | "pdf">("xlsx");
  const capabilities = useQuery({
    queryKey: ["export-capabilities"],
    queryFn: () => api<BackgroundExportCapabilities>("/api/exports/capabilities"),
    staleTime: 60_000,
  });
  const jobs = useQuery({
    queryKey: ["background-exports"],
    queryFn: () => api<{ items: BackgroundExportJob[] }>("/api/exports"),
    refetchInterval: (query) =>
      query.state.data?.items.some((job) => ["queued", "running"].includes(job.status))
        ? 5_000
        : false,
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["background-exports"] });
  const createExport = useMutation({
    mutationFn: () =>
      api<BackgroundExportJob>("/api/exports", {
        method: "POST",
        body: {
          exportType: "work_sessions",
          format,
          from: from.toISOString(),
          to: to.toISOString(),
        },
      }),
    onSuccess: refresh,
  });
  const cancelExport = useMutation({
    mutationFn: (exportId: string) =>
      api<BackgroundExportJob>(`/api/exports/${exportId}`, { method: "DELETE" }),
    onSuccess: refresh,
  });
  const retryExport = useMutation({
    mutationFn: (exportId: string) =>
      api<BackgroundExportJob>(`/api/exports/${exportId}/retry`, { method: "POST" }),
    onSuccess: refresh,
  });
  const downloadExport = useMutation({
    mutationFn: (exportId: string) =>
      api<{ url: string; expiresInSeconds: number; fileName: string; sha256: string | null }>(
        `/api/exports/${exportId}/download`,
      ),
    onSuccess: (download) => {
      const anchor = document.createElement("a");
      anchor.href = download.url;
      anchor.download = download.fileName;
      anchor.rel = "noopener";
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
    },
  });

  const mutationError =
    createExport.error ?? cancelExport.error ?? retryExport.error ?? downloadExport.error;
  const storageReady = capabilities.data?.available === true;

  return (
    <Card className="mt-5">
      <CardHeader>
        <div>
          <p className="app-section-label">文件中心</p>
          <h2 className="mt-2 font-extrabold tracking-[-0.025em]">后台导出</h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="导出格式"
            className={`${fieldClass} min-h-9 w-auto py-1`}
            onChange={(event) => setFormat(event.target.value as typeof format)}
            value={format}
          >
            <option value="xlsx">Excel</option>
            <option value="csv">CSV</option>
            <option value="pdf">PDF</option>
            <option value="json">JSON</option>
          </select>
          <Button
            disabled={!storageReady || createExport.isPending}
            onClick={() => createExport.mutate()}
            size="compact"
          >
            {createExport.isPending ? "正在创建…" : "创建导出"}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {capabilities.isPending || jobs.isPending ? <LoadingBlock /> : null}
        {capabilities.data && !capabilities.data.available ? (
          <div className="rounded-2xl bg-[var(--warning-soft)] px-4 py-3 text-sm text-[var(--warning)]">
            {capabilities.data.unavailableReason ?? "私有对象存储尚未配置。"}
          </div>
        ) : null}
        {jobs.data?.items.length ? (
          <div className="space-y-2">
            {jobs.data.items.slice(0, 10).map((job) => {
              const status = exportStatusMeta[job.status];
              const details = [
                job.rowCount === null ? null : `${job.rowCount.toLocaleString("zh-CN")} 条`,
                formatExportFileSize(job.byteSize) || null,
                job.expiresAt && job.status === "completed"
                  ? `有效至 ${formatDateTime(job.expiresAt)}`
                  : null,
              ].filter(Boolean);
              return (
                <div
                  className="rounded-2xl bg-[var(--surface-subtle)] px-4 py-3"
                  key={job.id}
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold uppercase">{job.format}</span>
                        <Badge tone={status.tone}>{status.label}</Badge>
                        <span className="text-xs text-[var(--text-subtle)]">
                          {formatDateTime(job.createdAt)}
                        </span>
                      </div>
                      {details.length ? (
                        <p className="mt-1 text-xs text-[var(--text-muted)]">
                          {details.join(" · ")}
                        </p>
                      ) : null}
                      {exportErrorMessage(job.errorCode) ? (
                        <p className="mt-1 text-xs text-[var(--danger)]">
                          {exportErrorMessage(job.errorCode)}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-2">
                      {job.downloadReady ? (
                        <Button
                          disabled={downloadExport.isPending}
                          onClick={() => downloadExport.mutate(job.id)}
                          size="compact"
                          variant="secondary"
                        >
                          下载
                        </Button>
                      ) : null}
                      {job.status === "failed" ? (
                        <Button
                          disabled={retryExport.isPending}
                          onClick={() => retryExport.mutate(job.id)}
                          size="compact"
                          variant="secondary"
                        >
                          重试
                        </Button>
                      ) : null}
                      {["queued", "running"].includes(job.status) ? (
                        <Button
                          disabled={cancelExport.isPending}
                          onClick={() => cancelExport.mutate(job.id)}
                          size="compact"
                          variant="ghost"
                        >
                          取消
                        </Button>
                      ) : null}
                    </div>
                  </div>
                  {["queued", "running"].includes(job.status) ? (
                    <div
                      aria-label={`导出进度 ${job.progress}%`}
                      className="mt-3 h-1.5 overflow-hidden rounded-full bg-[var(--surface)]"
                      role="progressbar"
                      aria-valuemax={100}
                      aria-valuemin={0}
                      aria-valuenow={job.progress}
                    >
                      <div
                        className="h-full rounded-full bg-[var(--accent)] transition-[width]"
                        style={{ width: `${Math.max(2, job.progress)}%` }}
                      />
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : !jobs.isPending ? (
          <p className="py-4 text-sm text-[var(--text-muted)]">
            选择格式后创建任务；文件生成完成会出现在这里，并保留 24 小时。
          </p>
        ) : null}
        <ErrorMessage error={capabilities.error ?? jobs.error ?? mutationError} />
      </CardContent>
    </Card>
  );
}

export function AnalyticsPage({ me }: { me: Me }) {
  const [days, setDays] = useState(30);
  const [filters, setFilters] = useState<AnalyticsFilterState>(emptyAnalyticsFilters);
  const chartPalette = useChartPalette();
  const to = useMemo(() => new Date(), []);
  const from = useMemo(
    () => new Date(to.getTime() - days * 86_400_000),
    [days, to],
  );
  const analyticsUrl = useMemo(() => {
    const query = new URLSearchParams({
      from: from.toISOString(),
      to: to.toISOString(),
    });
    if (filters.projectId) query.set("projectIds", filters.projectId);
    if (filters.workTypeId) query.set("workTypeIds", filters.workTypeId);
    if (filters.memberId) query.set("memberIds", filters.memberId);
    if (filters.orgUnitId) query.set("orgUnitIds", filters.orgUnitId);
    if (filters.approvalState) query.set("approvalStates", filters.approvalState);
    if (filters.sourceType) query.set("sourceTypes", filters.sourceType);
    return `/api/analytics/summary?${query.toString()}`;
  }, [filters, from, to]);
  const analytics = useQuery({
    queryKey: ["analytics", me.user.membershipId, days, filters],
    queryFn: () => api<AnalyticsSummary>(analyticsUrl),
    staleTime: 0,
  });
  const activeFilterCount = Object.values(filters).filter(Boolean).length;
  const changeFilter = (key: keyof AnalyticsFilterState, value: string) =>
    setFilters((current) => ({ ...current, [key]: value }));
  const trendOption = useMemo<EChartsCoreOption>(
    () => ({
      animationDuration: 240,
      grid: { left: 52, right: 20, top: 24, bottom: 56 },
      tooltip: {
        trigger: "axis",
        confine: true,
        backgroundColor: chartPalette.surface,
        borderColor: chartPalette.border,
        textStyle: { color: chartPalette.text },
        valueFormatter: (value: string | number) =>
          formatDuration(Number(value)),
      },
      xAxis: {
        type: "category",
        data: analytics.data?.byDay.map((item) => item.date.slice(5)) ?? [],
        axisLabel: { hideOverlap: true, color: chartPalette.textSubtle },
        axisLine: { lineStyle: { color: chartPalette.border } },
      },
      yAxis: {
        type: "value",
        axisLabel: {
          formatter: (value: string | number) =>
            `${Math.round(Number(value) / 3600)}h`,
          color: chartPalette.textSubtle,
        },
        splitLine: { lineStyle: { color: chartPalette.grid } },
      },
      dataZoom: [
        { type: "inside" },
        {
          type: "slider",
          height: 18,
          bottom: 12,
          borderColor: "transparent",
          fillerColor: hexWithAlpha(chartPalette.accent, 0.12),
          handleStyle: { color: chartPalette.accent },
        },
      ],
      series: [
        {
          type: "line",
          name: "净工时",
          smooth: true,
          symbolSize: 7,
          data: analytics.data?.byDay.map((item) => item.seconds) ?? [],
          areaStyle: { color: hexWithAlpha(chartPalette.accent, 0.15) },
          lineStyle: { color: chartPalette.accent, width: 3 },
          itemStyle: { color: chartPalette.accent },
        },
      ],
    }),
    [analytics.data?.byDay, chartPalette],
  );
  const projectOption = useMemo<EChartsCoreOption>(
    () => ({
      animationDuration: 240,
      grid: { left: 110, right: 24, top: 20, bottom: 24 },
      tooltip: {
        trigger: "axis",
        confine: true,
        axisPointer: { type: "shadow" },
        backgroundColor: chartPalette.surface,
        borderColor: chartPalette.border,
        textStyle: { color: chartPalette.text },
        valueFormatter: (value: string | number) =>
          formatDuration(Number(value)),
      },
      xAxis: {
        type: "value",
        axisLabel: {
          formatter: (value: string | number) =>
            `${Math.round(Number(value) / 3600)}h`,
          color: chartPalette.textSubtle,
        },
        splitLine: { lineStyle: { color: chartPalette.grid } },
      },
      yAxis: {
        type: "category",
        data: analytics.data?.byProject.map((item) => item.projectName) ?? [],
        axisLabel: {
          width: 95,
          overflow: "truncate",
          color: chartPalette.textMuted,
        },
        axisLine: { lineStyle: { color: chartPalette.border } },
      },
      series: [
        {
          type: "bar",
          name: "净工时",
          data: analytics.data?.byProject.map((item) => ({
            value: item.seconds,
            projectId: item.projectId,
          })) ?? [],
          itemStyle: { color: chartPalette.accent, borderRadius: [0, 7, 7, 0] },
        },
      ],
    }),
    [analytics.data?.byProject, chartPalette],
  );
  const rhythmOption = useMemo<EChartsCoreOption>(() => ({
    animationDuration: 240,
    grid: { left: 52, right: 18, top: 32, bottom: 40 },
    tooltip: { trigger: "axis", confine: true, backgroundColor: chartPalette.surface, borderColor: chartPalette.border, textStyle: { color: chartPalette.text }, valueFormatter: (value: string | number) => formatDuration(Number(value)) },
    xAxis: { type: "category", data: analytics.data?.byHour.map((item) => `${String(item.hour).padStart(2, "0")}:00`) ?? [], axisLabel: { interval: 2, color: chartPalette.textSubtle }, axisLine: { lineStyle: { color: chartPalette.border } } },
    yAxis: { type: "value", axisLabel: { formatter: (value: string | number) => `${Math.round(Number(value) / 3600)}h`, color: chartPalette.textSubtle }, splitLine: { lineStyle: { color: chartPalette.grid } } },
    series: [{ type: "line", name: "记录时长", smooth: true, showSymbol: false, data: analytics.data?.byHour.map((item) => item.seconds) ?? [], lineStyle: { color: chartPalette.accent, width: 3 }, areaStyle: { color: hexWithAlpha(chartPalette.accent, 0.12) } }],
  }), [analytics.data?.byHour, chartPalette]);
  const approvalOption = useMemo<EChartsCoreOption>(() => ({
    animationDuration: 240,
    tooltip: { trigger: "item", confine: true, backgroundColor: chartPalette.surface, borderColor: chartPalette.border, textStyle: { color: chartPalette.text }, formatter: (params: { name?: string; value?: number; percent?: number }) => `${params.name ?? ""}<br/>${formatDuration(Number(params.value ?? 0))} · ${params.percent ?? 0}%` },
    legend: { bottom: 0, textStyle: { color: chartPalette.textMuted } },
    series: [{ type: "pie", radius: ["45%", "70%"], center: ["50%", "44%"], avoidLabelOverlap: true, label: { show: false }, emphasis: { label: { show: true, fontWeight: "bold" } }, data: analytics.data?.byApproval.map((item) => ({ name: approvalLabels[item.status] ?? item.status, value: item.seconds, approvalState: item.status })) ?? [] }],
  }), [analytics.data?.byApproval, chartPalette]);
  const heatmapOption = useMemo<EChartsCoreOption>(() => ({
    tooltip: { confine: true, backgroundColor: chartPalette.surface, borderColor: chartPalette.border, textStyle: { color: chartPalette.text }, formatter: (params: { value?: [string, number] }) => `${params.value?.[0] ?? ""}<br/>${formatDuration(params.value?.[1] ?? 0)}` },
    visualMap: { min: 0, max: Math.max(...(analytics.data?.byDay.map((item) => item.seconds) ?? [1])), show: false, inRange: { color: [chartPalette.grid, hexWithAlpha(chartPalette.accent, 0.45), chartPalette.accent] } },
    calendar: { range: [from.toISOString().slice(0, 10), to.toISOString().slice(0, 10)], cellSize: ["auto", 18], splitLine: { show: false }, itemStyle: { color: chartPalette.grid, borderColor: chartPalette.surface, borderWidth: 3 }, dayLabel: { color: chartPalette.textSubtle }, monthLabel: { color: chartPalette.textMuted }, yearLabel: { show: false } },
    series: [{ type: "heatmap", coordinateSystem: "calendar", data: analytics.data?.byDay.map((item) => [item.date, item.seconds]) ?? [] }],
  }), [analytics.data?.byDay, chartPalette, from, to]);
  const funnelOption = useMemo<EChartsCoreOption>(() => ({
    animationDuration: 240,
    tooltip: { trigger: "item", confine: true, backgroundColor: chartPalette.surface, borderColor: chartPalette.border, textStyle: { color: chartPalette.text } },
    series: [{ type: "funnel", left: "4%", width: "68%", top: 18, bottom: 18, minSize: "24%", maxSize: "100%", sort: "none", gap: 4, label: { color: chartPalette.text, formatter: "{b} {c}" }, labelLine: { length: 8 }, itemStyle: { borderColor: chartPalette.surface, borderWidth: 2 }, data: analytics.data?.funnel.map((item) => ({ name: item.stage, value: item.count })) ?? [] }],
  }), [analytics.data?.funnel, chartPalette]);
  const forecastOption = useMemo<EChartsCoreOption>(() => {
    const observed = analytics.data?.forecast.observed ?? [];
    const predicted = analytics.data?.forecast.predicted ?? [];
    const labels = [...observed.map((item) => item.date.slice(5)), ...predicted.map((item) => item.date.slice(5))];
    const observedPadding = Array.from({ length: observed.length }, () => null);
    return {
      animationDuration: 240,
      legend: { bottom: 2, textStyle: { color: chartPalette.textMuted } },
      grid: { left: 54, right: 18, top: 24, bottom: 66 },
      tooltip: {
        trigger: "axis",
        confine: true,
        backgroundColor: chartPalette.surface,
        borderColor: chartPalette.border,
        textStyle: { color: chartPalette.text },
        valueFormatter: (value: string | number) => formatDuration(Number(value)),
      },
      xAxis: {
        type: "category",
        data: labels,
        axisLabel: { hideOverlap: true, color: chartPalette.textSubtle },
        axisLine: { lineStyle: { color: chartPalette.border } },
      },
      yAxis: {
        type: "value",
        axisLabel: { formatter: (value: string | number) => `${Math.round(Number(value) / 3_600)}h`, color: chartPalette.textSubtle },
        splitLine: { lineStyle: { color: chartPalette.grid } },
      },
      dataZoom: [{ type: "inside" }],
      series: [
        {
          type: "line",
          name: "已发生事实",
          smooth: true,
          data: [...observed.map((item) => item.seconds), ...predicted.map(() => null)],
          lineStyle: { color: chartPalette.accent, width: 3 },
          itemStyle: { color: chartPalette.accent },
        },
        {
          type: "line",
          name: "预测下界",
          stack: "forecast-band",
          symbol: "none",
          data: [...observedPadding, ...predicted.map((item) => item.lowerSeconds)],
          lineStyle: { opacity: 0 },
          areaStyle: { opacity: 0 },
          tooltip: { show: false },
        },
        {
          type: "line",
          name: "预测区间",
          stack: "forecast-band",
          symbol: "none",
          data: [...observedPadding, ...predicted.map((item) => item.upperSeconds - item.lowerSeconds)],
          lineStyle: { opacity: 0 },
          areaStyle: { color: hexWithAlpha(chartPalette.accent, 0.2) },
          tooltip: { show: false },
        },
        {
          type: "line",
          name: "程序预测",
          smooth: true,
          symbol: "emptyCircle",
          data: [...observedPadding, ...predicted.map((item) => item.seconds)],
          lineStyle: { color: chartPalette.accent, width: 2, type: "dashed" },
          itemStyle: { color: chartPalette.surface, borderColor: chartPalette.accent, borderWidth: 2 },
        },
      ],
    };
  }, [analytics.data?.forecast, chartPalette]);
  const sankeyOption = useMemo<EChartsCoreOption>(() => ({
    animationDuration: 260,
    tooltip: {
      trigger: "item",
      confine: true,
      backgroundColor: chartPalette.surface,
      borderColor: chartPalette.border,
      textStyle: { color: chartPalette.text },
      valueFormatter: (value: string | number) => formatDuration(Number(value)),
    },
    series: [{
      type: "sankey",
      left: 10,
      right: 22,
      top: 16,
      bottom: 16,
      nodeGap: 12,
      nodeWidth: 14,
      draggable: false,
      emphasis: { focus: "adjacency" },
      lineStyle: { color: "gradient", curveness: 0.45, opacity: 0.28 },
      label: {
        color: chartPalette.textMuted,
        formatter: (params: { data?: { label?: string } }) => params.data?.label ?? "",
      },
      data: analytics.data?.flow.nodes.map((node) => ({
        name: node.id,
        label: node.label,
        kind: node.kind,
        dimensionId: node.id.slice(node.id.indexOf(":") + 1),
        itemStyle: {
          color: node.kind === "project"
            ? chartPalette.accent
            : node.kind === "work_type"
              ? hexWithAlpha(chartPalette.accent, 0.65)
              : chartPalette.textSubtle,
        },
      })) ?? [],
      links: analytics.data?.flow.links.map((link) => ({
        source: link.source,
        target: link.target,
        value: link.seconds,
      })) ?? [],
    }],
  }), [analytics.data?.flow, chartPalette]);
  const sunburstOption = useMemo<EChartsCoreOption>(() => {
    const projects = new Map<string, { name: string; projectId: string | null; value: number; children: Array<{ name: string; value: number; workTypeId: string | null }> }>();
    for (const item of analytics.data?.projectWorkTypes ?? []) {
      const key = item.projectId ?? "unassigned";
      const project = projects.get(key) ?? { name: item.projectName, projectId: item.projectId, value: 0, children: [] };
      project.value += item.seconds;
      project.children.push({ name: item.workTypeName, value: item.seconds, workTypeId: item.workTypeId });
      projects.set(key, project);
    }
    return {
      animationDuration: 260,
      tooltip: {
        trigger: "item",
        confine: true,
        backgroundColor: chartPalette.surface,
        borderColor: chartPalette.border,
        textStyle: { color: chartPalette.text },
        valueFormatter: (value: string | number) => formatDuration(Number(value)),
      },
      series: [{
        type: "sunburst",
        radius: [30, "88%"],
        sort: undefined,
        emphasis: { focus: "ancestor" },
        label: { rotate: 0, minAngle: 10, width: 80, overflow: "truncate", color: chartPalette.textMuted },
        itemStyle: { borderColor: chartPalette.surface, borderWidth: 2 },
        data: [...projects.values()],
      }],
    };
  }, [analytics.data?.projectWorkTypes, chartPalette]);
  const memberOption = useMemo<EChartsCoreOption>(() => ({
    animationDuration: 220,
    grid: { left: 92, right: 18, top: 18, bottom: 28 },
    tooltip: { trigger: "axis", confine: true, axisPointer: { type: "shadow" }, backgroundColor: chartPalette.surface, borderColor: chartPalette.border, textStyle: { color: chartPalette.text }, valueFormatter: (value: string | number) => formatDuration(Number(value)) },
    xAxis: { type: "value", axisLabel: { formatter: (value: string | number) => `${Math.round(Number(value) / 3_600)}h`, color: chartPalette.textSubtle }, splitLine: { lineStyle: { color: chartPalette.grid } } },
    yAxis: { type: "category", data: analytics.data?.byMember.map((item) => item.displayName) ?? [], axisLabel: { width: 76, overflow: "truncate", color: chartPalette.textMuted }, axisLine: { lineStyle: { color: chartPalette.border } } },
    series: [{ type: "bar", name: "范围内工时", data: analytics.data?.byMember.map((item) => ({ value: item.seconds, membershipId: item.membershipId })) ?? [], itemStyle: { color: hexWithAlpha(chartPalette.accent, 0.72), borderRadius: [0, 7, 7, 0] } }],
  }), [analytics.data?.byMember, chartPalette]);
  const projectHealthOption = useMemo<EChartsCoreOption>(() => ({
    animationDuration: 240,
    legend: { bottom: 0, textStyle: { color: chartPalette.textMuted } },
    grid: { left: 54, right: 54, top: 28, bottom: 68 },
    tooltip: { trigger: "axis", confine: true, backgroundColor: chartPalette.surface, borderColor: chartPalette.border, textStyle: { color: chartPalette.text } },
    xAxis: { type: "category", data: analytics.data?.projectHealth.map((item) => item.projectName) ?? [], axisLabel: { width: 82, overflow: "truncate", color: chartPalette.textSubtle }, axisLine: { lineStyle: { color: chartPalette.border } } },
    yAxis: [
      { type: "value", name: "工时", axisLabel: { formatter: (value: string | number) => `${Math.round(Number(value) / 3_600)}h`, color: chartPalette.textSubtle }, splitLine: { lineStyle: { color: chartPalette.grid } } },
      { type: "value", name: "进度", min: 0, max: 100, axisLabel: { formatter: "{value}%", color: chartPalette.textSubtle }, splitLine: { show: false } },
    ],
    dataZoom: [{ type: "inside" }],
    series: [
      { type: "bar", name: "净工时", data: analytics.data?.projectHealth.map((item) => item.seconds) ?? [], itemStyle: { color: hexWithAlpha(chartPalette.accent, 0.56), borderRadius: [6, 6, 0, 0] } },
      { type: "line", name: "节点加权进度", yAxisIndex: 1, data: analytics.data?.projectHealth.map((item) => item.progress) ?? [], lineStyle: { color: chartPalette.accent, width: 3 }, itemStyle: { color: chartPalette.accent } },
    ],
  }), [analytics.data?.projectHealth, chartPalette]);
  const anomalyOption = useMemo<EChartsCoreOption>(() => ({
    animationDuration: 220,
    grid: { left: 150, right: 20, top: 18, bottom: 28 },
    tooltip: { trigger: "axis", confine: true, axisPointer: { type: "shadow" }, backgroundColor: chartPalette.surface, borderColor: chartPalette.border, textStyle: { color: chartPalette.text } },
    xAxis: { type: "value", minInterval: 1, axisLabel: { color: chartPalette.textSubtle }, splitLine: { lineStyle: { color: chartPalette.grid } } },
    yAxis: { type: "category", data: analytics.data?.anomalies.map((item) => item.category === "net_duration_under_60_seconds" ? "不足 1 分钟" : item.category === "gross_duration_over_16_hours" ? "超过 16 小时" : item.category) ?? [], axisLabel: { width: 136, overflow: "truncate", color: chartPalette.textMuted }, axisLine: { lineStyle: { color: chartPalette.border } } },
    series: [{ type: "bar", name: "记录数", data: analytics.data?.anomalies.map((item) => item.count) ?? [], itemStyle: { color: chartPalette.warning, borderRadius: [0, 7, 7, 0] } }],
  }), [analytics.data?.anomalies, chartPalette]);
  const canExport = me.permissions.some(
    (grant) => grant.permission === "export.scope",
  );
  const maxProjectSeconds = Math.max(
    ...(analytics.data?.byProject.map((item) => item.seconds) ?? [1]),
    1,
  );

  return (
    <>
      <PageHeader
        title="数据分析"
        actions={
          <>
            <select
              aria-label="时间范围"
              className={fieldClass}
              onChange={(event) => setDays(Number(event.target.value))}
              value={days}
            >
              <option value={7}>最近 7 天</option>
              <option value={30}>最近 30 天</option>
              <option value={90}>最近 90 天</option>
            </select>
            {activeFilterCount ? (
              <Button onClick={() => setFilters(emptyAnalyticsFilters)} size="compact" variant="secondary">
                清除筛选 · {activeFilterCount}
              </Button>
            ) : null}
            {canExport ? (
              <Badge tone="info">支持 CSV / JSON / Excel / PDF</Badge>
            ) : null}
          </>
        }
      />
      {analytics.data?.availableFilters ? (
        <section
          aria-label="分析联动筛选"
          className="mb-5 grid gap-2 rounded-2xl bg-[var(--surface-subtle)] p-3 sm:grid-cols-2 xl:grid-cols-6"
        >
          <select aria-label="筛选项目" className={fieldClass} onChange={(event) => changeFilter("projectId", event.target.value)} value={filters.projectId}>
            <option value="">全部项目</option>
            {analytics.data.availableFilters.projects.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
          <select aria-label="筛选工作类型" className={fieldClass} onChange={(event) => changeFilter("workTypeId", event.target.value)} value={filters.workTypeId}>
            <option value="">全部类型</option>
            {analytics.data.availableFilters.workTypes.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
          <select aria-label="筛选成员" className={fieldClass} onChange={(event) => changeFilter("memberId", event.target.value)} value={filters.memberId}>
            <option value="">全部可见成员</option>
            {analytics.data.availableFilters.members.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
          <select aria-label="筛选组织单元" className={fieldClass} onChange={(event) => changeFilter("orgUnitId", event.target.value)} value={filters.orgUnitId}>
            <option value="">全部组织单元</option>
            {analytics.data.availableFilters.orgUnits.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
          <select aria-label="筛选审核状态" className={fieldClass} onChange={(event) => changeFilter("approvalState", event.target.value)} value={filters.approvalState}>
            <option value="">全部审核状态</option>
            {analytics.data.availableFilters.approvalStates.map((item) => <option key={item} value={item}>{approvalLabels[item] ?? item}</option>)}
          </select>
          <select aria-label="筛选记录来源" className={fieldClass} onChange={(event) => changeFilter("sourceType", event.target.value)} value={filters.sourceType}>
            <option value="">全部记录来源</option>
            {analytics.data.availableFilters.sourceTypes.map((item) => <option key={item} value={item}>{sourceLabels[item] ?? item}</option>)}
          </select>
          {analytics.isFetching && !analytics.isPending ? <span className="sr-only" role="status">正在更新筛选结果</span> : null}
        </section>
      ) : null}
      {analytics.isPending ? (
        <Card>
          <LoadingBlock />
        </Card>
      ) : analytics.data ? (
        <>
          {canExport ? <BackgroundExportPanel from={from} to={to} /> : null}
          <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Metric
              hint={`最近 ${days} 天`}
              label="记录数"
              value={`${analytics.data.totals.sessionCount} 条`}
            />
            <Metric
              hint="净时长"
              label="总工时"
              value={formatDuration(analytics.data.totals.totalSeconds)}
            />
            <Metric
              hint="已确认"
              label="已批准"
              value={formatDuration(analytics.data.totals.approvedSeconds)}
            />
            <Metric
              hint="待处理"
              label="待审核"
              value={formatDuration(analytics.data.totals.pendingSeconds)}
            />
          </div>
          <div className="mt-5 grid gap-5 xl:grid-cols-2">
            <Card className="analytics-chart-card">
              <CardHeader>
                <div>
                  <p className="app-section-label">时间维度</p>
                  <h2 className="mt-2 font-extrabold tracking-[-0.025em]">
                    每日净工时趋势
                  </h2>
                </div>
              </CardHeader>
              <CardContent>
                {analytics.data.byDay.length ? (
                  <AnalyticsChart
                    ariaLabel="每日净工时趋势图"
                    option={trendOption}
                  />
                ) : (
                  <EmptyState
                    description="该区间没有工时。"
                    icon={<CalendarDays />}
                    title="没有趋势数据"
                  />
                )}
              </CardContent>
            </Card>
            <Card className="analytics-chart-card">
              <CardHeader>
                <div>
                  <p className="app-section-label">项目维度</p>
                  <h2 className="mt-2 font-extrabold tracking-[-0.025em]">
                    项目投入分布
                  </h2>
                </div>
              </CardHeader>
              <CardContent>
                {analytics.data.byProject.length ? (
                  <AnalyticsChart
                    ariaLabel="项目投入分布图"
                    onDataSelect={({ data }) => {
                      const projectId = analyticsSelectionId(data, "projectId");
                      if (projectId) changeFilter("projectId", projectId);
                    }}
                    option={projectOption}
                  />
                ) : (
                  <EmptyState
                    description="该区间没有项目归属数据。"
                    icon={<FolderKanban />}
                    title="没有项目分布"
                  />
                )}
              </CardContent>
            </Card>
          </div>
          <div className="mt-5 grid gap-5 xl:grid-cols-2">
            <Card className="analytics-chart-card">
              <CardHeader><div><p className="app-section-label">时段分布</p><h2 className="mt-2 font-extrabold tracking-[-0.025em]">24 小时工作节奏</h2></div></CardHeader>
              <CardContent>{analytics.data.byHour.some((item) => item.seconds > 0) ? <AnalyticsChart ariaLabel="24 小时工作节奏图" option={rhythmOption} /> : <EmptyState description="该区间没有可汇总的时段。" icon={<Clock3 />} title="没有节奏数据" />}</CardContent>
            </Card>
            <Card className="analytics-chart-card">
              <CardHeader><div><p className="app-section-label">日历密度</p><h2 className="mt-2 font-extrabold tracking-[-0.025em]">工作记录热力图</h2></div></CardHeader>
              <CardContent>{analytics.data.byDay.length ? <AnalyticsChart ariaLabel="工作记录日历热力图" option={heatmapOption} /> : <EmptyState description="该区间没有工时。" icon={<CalendarDays />} title="没有热力数据" />}</CardContent>
            </Card>
            <Card className="analytics-chart-card">
              <CardHeader><div><p className="app-section-label">审核结构</p><h2 className="mt-2 font-extrabold tracking-[-0.025em]">审核状态分布</h2></div></CardHeader>
              <CardContent>{analytics.data.byApproval.length ? <AnalyticsChart ariaLabel="审核状态分布图" onDataSelect={({ data }) => { const status = analyticsSelectionId(data, "approvalState"); if (status) changeFilter("approvalState", status); }} option={approvalOption} /> : <EmptyState description="该区间没有审核数据。" icon={<FileCheck2 />} title="没有审核分布" />}</CardContent>
            </Card>
            <Card className="analytics-chart-card">
              <CardHeader><div><p className="app-section-label">事实流转</p><h2 className="mt-2 font-extrabold tracking-[-0.025em]">记录到计薪漏斗</h2></div></CardHeader>
              <CardContent>{analytics.data.funnel[0]?.count ? <AnalyticsChart ariaLabel="记录到计薪漏斗图" option={funnelOption} /> : <EmptyState description="该区间没有可流转的记录。" icon={<ListTodo />} title="没有流转数据" />}</CardContent>
            </Card>
          </div>
          <div className="mt-5 grid gap-5 xl:grid-cols-2">
            <Card className="analytics-chart-card">
              <CardHeader>
                <div><p className="app-section-label">趋势边界</p><h2 className="mt-2 font-extrabold tracking-[-0.025em]">事实与未来 7 天预测</h2></div>
                <Badge tone="warning">预测不参与薪资或考核</Badge>
              </CardHeader>
              <CardContent>
                {analytics.data.forecast.predicted.length ? <AnalyticsChart ariaLabel="事实与未来工时预测带" option={forecastOption} /> : <EmptyState description="至少需要 3 个自然日才能计算预测区间。" icon={<CalendarDays />} title="样本不足" />}
              </CardContent>
            </Card>
            <Card className="analytics-chart-card">
              <CardHeader><div><p className="app-section-label">投入路径</p><h2 className="mt-2 font-extrabold tracking-[-0.025em]">项目 → 类型 → 审核</h2></div></CardHeader>
              <CardContent>
                {analytics.data.flow.links.length ? (
                  <AnalyticsChart
                    ariaLabel="项目工作类型与审核流向桑基图"
                    onDataSelect={({ data }) => {
                      const kind = analyticsSelectionId(data, "kind");
                      const dimensionId = analyticsSelectionId(data, "dimensionId");
                      if (!kind || !dimensionId) return;
                      if (kind === "project") changeFilter("projectId", dimensionId);
                      if (kind === "work_type") changeFilter("workTypeId", dimensionId);
                      if (kind === "approval") changeFilter("approvalState", dimensionId);
                    }}
                    option={sankeyOption}
                  />
                ) : <EmptyState description="筛选范围内没有可组成投入路径的事实。" icon={<ListTodo />} title="没有流向数据" />}
              </CardContent>
            </Card>
            <Card className="analytics-chart-card">
              <CardHeader><div><p className="app-section-label">层级占比</p><h2 className="mt-2 font-extrabold tracking-[-0.025em]">项目与工作类型</h2></div></CardHeader>
              <CardContent>
                {analytics.data.projectWorkTypes.length ? (
                  <AnalyticsChart
                    ariaLabel="项目与工作类型旭日图"
                    onDataSelect={({ data }) => {
                      const workTypeId = analyticsSelectionId(data, "workTypeId");
                      const projectId = analyticsSelectionId(data, "projectId");
                      if (workTypeId) changeFilter("workTypeId", workTypeId);
                      else if (projectId) changeFilter("projectId", projectId);
                    }}
                    option={sunburstOption}
                  />
                ) : <EmptyState description="筛选范围内没有项目与类型的联合分布。" icon={<FolderKanban />} title="没有层级数据" />}
              </CardContent>
            </Card>
            <Card className="analytics-chart-card">
              <CardHeader><div><p className="app-section-label">团队负载</p><h2 className="mt-2 font-extrabold tracking-[-0.025em]">可见成员工作量分布</h2></div></CardHeader>
              <CardContent>
                {analytics.data.byMember.length ? (
                  <AnalyticsChart
                    ariaLabel="成员工作量分布图"
                    onDataSelect={({ data }) => { const memberId = analyticsSelectionId(data, "membershipId"); if (memberId) changeFilter("memberId", memberId); }}
                    option={memberOption}
                  />
                ) : <EmptyState description="筛选范围内没有可见成员工时。" icon={<Users />} title="没有负载数据" />}
              </CardContent>
            </Card>
            <Card className="analytics-chart-card">
              <CardHeader><div><p className="app-section-label">项目健康</p><h2 className="mt-2 font-extrabold tracking-[-0.025em]">投入与节点进度</h2></div></CardHeader>
              <CardContent>{analytics.data.projectHealth.length ? <AnalyticsChart ariaLabel="项目工时与加权进度图" option={projectHealthOption} /> : <EmptyState description="筛选范围内没有可对账的项目节点。" icon={<FolderKanban />} title="没有项目健康数据" />}</CardContent>
            </Card>
            <Card className="analytics-chart-card">
              <CardHeader><div><p className="app-section-label">异常检查</p><h2 className="mt-2 font-extrabold tracking-[-0.025em]">需要人工确认的记录</h2></div></CardHeader>
              <CardContent>{analytics.data.anomalies.length ? <AnalyticsChart ariaLabel="异常记录类别图" option={anomalyOption} /> : <EmptyState description="当前筛选范围没有时长异常标记。" icon={<Check />} title="没有异常" />}</CardContent>
            </Card>
          </div>
          <Card className="mt-5">
            <CardHeader>
              <div>
                <p className="app-section-label">逐项对账</p>
                <h2 className="mt-2 font-extrabold tracking-[-0.025em]">
                  项目投入明细
                </h2>
              </div>
              <Badge tone="info">
                {analytics.data.byProject.length} 个项目
              </Badge>
            </CardHeader>
            <CardContent>
              {analytics.data.byProject.length ? (
                <div className="space-y-1">
                  {analytics.data.byProject.map((item) => (
                    <button
                      aria-pressed={item.projectId === filters.projectId}
                      className="analytics-breakdown-row flex w-full items-center gap-4 p-3 text-left disabled:cursor-default"
                      disabled={!item.projectId}
                      key={item.projectId ?? "none"}
                      onClick={() => item.projectId && changeFilter("projectId", item.projectId)}
                      type="button"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-3">
                          <span className="truncate text-sm font-semibold">
                            {item.projectName}
                          </span>
                          <span className="shrink-0 text-xs font-semibold text-[var(--text-muted)]">
                            {formatDuration(item.seconds)}
                          </span>
                        </div>
                        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--surface-subtle)]">
                          <div
                            className="h-full rounded-full bg-[var(--accent)]"
                            style={{
                              width: `${Math.max(4, (item.seconds / maxProjectSeconds) * 100)}%`,
                            }}
                          />
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-[var(--text-muted)]">
                  暂无可对账的项目投入。
                </p>
              )}
            </CardContent>
          </Card>
          {analytics.data.projectHealth.length ? (
            <Card className="mt-5">
              <CardHeader><div><p className="app-section-label">项目对账</p><h2 className="mt-2 font-extrabold tracking-[-0.025em]">进度、阻塞与投入</h2></div></CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[680px] text-left text-sm">
                    <thead className="text-xs text-[var(--text-subtle)]"><tr><th className="px-3 py-2">项目</th><th className="px-3 py-2">状态</th><th className="px-3 py-2">净工时</th><th className="px-3 py-2">加权进度</th><th className="px-3 py-2">阻塞节点</th><th className="px-3 py-2">截止时间</th></tr></thead>
                    <tbody className="divide-y divide-[var(--border-soft)]">
                      {analytics.data.projectHealth.map((item) => (
                        <tr key={item.projectId}>
                          <td className="px-3 py-3"><button className="font-semibold text-[var(--accent)]" onClick={() => changeFilter("projectId", item.projectId)} type="button">{item.projectName}</button></td>
                          <td className="px-3 py-3">{item.status ? projectStatusLabels[item.status] ?? item.status : "—"}</td>
                          <td className="px-3 py-3 tabular-nums">{formatDuration(item.seconds)}</td>
                          <td className="px-3 py-3 tabular-nums">{item.progress.toFixed(1)}%</td>
                          <td className="px-3 py-3 tabular-nums">{item.blockedNodes} / {item.totalNodes}</td>
                          <td className="px-3 py-3">{item.dueAt ? formatDateTime(item.dueAt) : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          ) : null}
          <Card className="mt-5">
            <CardHeader><div><p className="app-section-label">分类对账</p><h2 className="mt-2 font-extrabold tracking-[-0.025em]">类型、审核、组织与来源</h2></div></CardHeader>
            <CardContent className="grid gap-6 md:grid-cols-2 xl:grid-cols-4">
              <div><h3 className="text-sm font-bold">工作类型</h3><div className="mt-2 divide-y divide-[var(--border-soft)]">{analytics.data.byWorkType.map((item) => <button aria-pressed={item.workTypeId === filters.workTypeId} className="flex w-full items-center justify-between gap-3 py-2 text-left text-sm" disabled={!item.workTypeId} key={item.workTypeId ?? "none"} onClick={() => item.workTypeId && changeFilter("workTypeId", item.workTypeId)} type="button"><span>{item.workTypeName}</span><strong className="tabular-nums">{formatDuration(item.seconds)}</strong></button>)}</div></div>
              <div><h3 className="text-sm font-bold">审核状态</h3><div className="mt-2 divide-y divide-[var(--border-soft)]">{analytics.data.byApproval.map((item) => <button aria-pressed={item.status === filters.approvalState} className="flex w-full items-center justify-between gap-3 py-2 text-left text-sm" key={item.status} onClick={() => changeFilter("approvalState", item.status)} type="button"><span>{approvalLabels[item.status] ?? item.status} · {item.count} 条</span><strong className="tabular-nums">{formatDuration(item.seconds)}</strong></button>)}</div></div>
              <div><h3 className="text-sm font-bold">组织单元</h3><div className="mt-2 divide-y divide-[var(--border-soft)]">{analytics.data.byOrgUnit.map((item) => <button aria-pressed={item.orgUnitId === filters.orgUnitId} className="flex w-full items-center justify-between gap-3 py-2 text-left text-sm" disabled={!item.orgUnitId} key={item.orgUnitId ?? "none"} onClick={() => item.orgUnitId && changeFilter("orgUnitId", item.orgUnitId)} type="button"><span>{item.orgUnitName}</span><strong className="tabular-nums">{formatDuration(item.seconds)}</strong></button>)}</div></div>
              <div><h3 className="text-sm font-bold">记录来源</h3><div className="mt-2 divide-y divide-[var(--border-soft)]">{analytics.data.bySource.map((item) => <button aria-pressed={item.source === filters.sourceType} className="flex w-full items-center justify-between gap-3 py-2 text-left text-sm" key={item.source} onClick={() => changeFilter("sourceType", item.source)} type="button"><span>{sourceLabels[item.source] ?? item.source} · {item.count} 条</span><strong className="tabular-nums">{formatDuration(item.seconds)}</strong></button>)}</div></div>
            </CardContent>
          </Card>
        </>
      ) : null}
      <div className="mt-4">
        <ErrorMessage error={analytics.error} />
      </div>
    </>
  );
}

function Metric({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <Card className="metric-card">
      <CardContent>
        <p className="text-sm font-semibold text-[var(--text-muted)]">
          {label}
        </p>
        <p className="text-2xl font-extrabold tracking-[-0.04em] tabular-nums">
          {value}
        </p>
        <p className="text-xs text-[var(--text-subtle)]">{hint}</p>
      </CardContent>
    </Card>
  );
}
interface AiReportRecord {
  job: {
    id: string;
    taskType: AiTaskType;
    status: string;
    errorSummary: string | null;
    queuedAt: string;
    scope: {
      scope?: "self" | "team";
      question?: string;
      conversationId?: string;
      from?: string;
      to?: string;
    };
  };
  report: {
    id: string;
    title: string;
    summary: string;
    structuredOutput: {
      highlights?: string[];
      risks?: string[];
      suggestions?: string[];
    };
    sourceCount: number;
    generatedAt: string;
  } | null;
}

interface AiReportDetail extends AiReportRecord {
  sources: Array<{
    id: string;
    entityType: string;
    entityId: string;
    entityVersion: string | null;
    label: string;
  }>;
}

type AiTaskType =
  | "daily_summary"
  | "weekly_summary"
  | "monthly_summary"
  | "work_rhythm"
  | "project_progress"
  | "project_blockers"
  | "organization_summary"
  | "salary_explanation"
  | "assistant_chat";

const aiPageAreaValues = [
  "home",
  "work",
  "calendar",
  "projects",
  "project",
  "team",
  "analytics",
  "payroll",
  "approvals",
  "organization",
  "security",
  "notifications",
  "imports",
  "ai",
] as const;
type AiPageArea = (typeof aiPageAreaValues)[number];

const aiTaskPresets: Array<{
  type: AiTaskType;
  label: string;
  rangeDays: number;
  teamOnly?: boolean;
  selfOnly?: boolean;
  requiresOwnPayroll?: boolean;
}> = [
  { type: "daily_summary", label: "总结今日", rangeDays: 1 },
  { type: "weekly_summary", label: "生成周报", rangeDays: 7 },
  { type: "monthly_summary", label: "月度回顾", rangeDays: 31 },
  { type: "work_rhythm", label: "工作节奏", rangeDays: 31 },
  { type: "project_progress", label: "项目进展", rangeDays: 31 },
  { type: "project_blockers", label: "项目阻塞", rangeDays: 31 },
  { type: "organization_summary", label: "团队总结", rangeDays: 7, teamOnly: true },
  {
    type: "salary_explanation",
    label: "解释我的薪资",
    rangeDays: 93,
    selfOnly: true,
    requiresOwnPayroll: true,
  },
];

interface AiSettings {
  source: "organization" | "deployment_default";
  enabled: boolean;
  baseUrl: string;
  model: string;
  hasApiKey: boolean;
  encryptionReady: boolean;
  usable: boolean;
  dailyRequestLimit: number;
  monthlyRequestLimit: number;
  maxOutputTokens: number;
  usage: { daily: number; monthly: number; timezone: string };
}

interface AiProviderCheck {
  id: string;
  source: "organization" | "deployment_default";
  endpointHost: string;
  model: string;
  status: "running" | "succeeded" | "failed";
  latencyMs: number;
  httpStatus: number | null;
  errorSummary: string | null;
  providerRequestId: string | null;
  checkedAt: string;
}

function AiSettingsPanel({ onClose }: { onClose: () => void }) {
  const settings = useQuery({
    queryKey: ["ai-settings"],
    queryFn: () => api<AiSettings>("/api/ai/settings"),
  });
  if (settings.isPending) {
    return (
      <Card className="ai-settings-card">
        <LoadingBlock />
      </Card>
    );
  }
  if (settings.isError) {
    return (
      <Card className="ai-settings-card">
        <CardContent className="p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="app-section-label">Owner only</p>
              <h2 className="mt-2 font-extrabold">组织级 AI 配置</h2>
            </div>
            <Button onClick={onClose} size="compact" variant="secondary">
              关闭
            </Button>
          </div>
          <ErrorMessage error={settings.error} />
        </CardContent>
      </Card>
    );
  }
  const current = settings.data!;
  const settingsKey = [
    current.source,
    current.enabled,
    current.baseUrl,
    current.model,
    current.hasApiKey,
    current.encryptionReady,
    current.dailyRequestLimit,
    current.monthlyRequestLimit,
    current.maxOutputTokens,
  ].join("|");
  return <AiSettingsEditor current={current} key={settingsKey} onClose={onClose} />;
}

function AiSettingsEditor({
  current,
  onClose,
}: {
  current: AiSettings;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const checks = useQuery({
    queryKey: ["ai-provider-checks"],
    queryFn: () =>
      api<{ items: AiProviderCheck[] }>("/api/ai/settings/checks"),
  });
  const [form, setForm] = useState(() => ({
    enabled: current.enabled,
    baseUrl: current.baseUrl,
    model: current.model,
    dailyRequestLimit: current.dailyRequestLimit,
    monthlyRequestLimit: current.monthlyRequestLimit,
    maxOutputTokens: current.maxOutputTokens,
    apiKey: "",
    clearApiKey: false,
    password: "",
    totpCode: "",
  }));
  const save = useMutation({
    mutationFn: () =>
      api<AiSettings>("/api/ai/settings", {
        method: "PUT",
        body: {
          enabled: form.enabled,
          baseUrl: form.baseUrl,
          model: form.model,
          dailyRequestLimit: form.dailyRequestLimit,
          monthlyRequestLimit: form.monthlyRequestLimit,
          maxOutputTokens: form.maxOutputTokens,
          ...(form.apiKey.trim() ? { apiKey: form.apiKey.trim() } : {}),
          clearApiKey: form.clearApiKey,
          password: form.password,
          ...(form.totpCode.trim() ? { totpCode: form.totpCode.trim() } : {}),
        },
      }),
    onSuccess: async (updated) => {
      setForm({
        enabled: updated.enabled,
        baseUrl: updated.baseUrl,
        model: updated.model,
        dailyRequestLimit: updated.dailyRequestLimit,
        monthlyRequestLimit: updated.monthlyRequestLimit,
        maxOutputTokens: updated.maxOutputTokens,
        apiKey: "",
        clearApiKey: false,
        password: "",
        totpCode: "",
      });
      queryClient.setQueryData<AiSettings>(["ai-settings"], updated);
      await queryClient.invalidateQueries({ queryKey: ["ai-settings"] });
    },
  });
  const checkProvider = useMutation({
    mutationFn: () =>
      api<{ check: AiProviderCheck }>("/api/ai/settings/check", {
        method: "POST",
        body: {
          password: form.password,
          ...(form.totpCode.trim() ? { totpCode: form.totpCode.trim() } : {}),
        },
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["ai-provider-checks"] }),
        queryClient.invalidateQueries({ queryKey: ["ai-settings"] }),
      ]);
    },
  });
  const updateNumber = (
    field:
      | "dailyRequestLimit"
      | "monthlyRequestLimit"
      | "maxOutputTokens",
    value: string,
  ) => {
    const parsed = Number(value);
    setForm((existing) => ({
      ...existing,
      [field]: Number.isFinite(parsed) ? Math.round(parsed) : 0,
    }));
  };

  return (
    <Card className="ai-settings-card">
      <CardContent className="p-5 sm:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="app-section-label">Owner only · organization scope</p>
            <h2 className="mt-2 text-xl font-extrabold tracking-[-0.035em]">
              组织级 AI 与成本控制
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--text-muted)]">
              员工不会接触 API Key。保存时会先做密码二次验证；已保存的密钥仅以加密形式存在服务端，页面永远只显示是否已配置。
            </p>
          </div>
          <Button onClick={onClose} size="compact" variant="secondary">
            关闭配置
          </Button>
        </div>
        <div className="ai-settings-status-grid mt-5">
          <div>
            <small>配置来源</small>
            <strong>
              {current.source === "organization" ? "本组织配置" : "部署默认配置"}
            </strong>
          </div>
          <div>
            <small>密钥状态</small>
            <strong>{current.hasApiKey ? "已配置（不回显）" : "未配置"}</strong>
          </div>
          <div>
            <small>今日 / 本月请求</small>
            <strong>
              {current.usage.daily} / {current.dailyRequestLimit} · {current.usage.monthly} / {current.monthlyRequestLimit}
            </strong>
          </div>
          <div>
            <small>当前可用性</small>
            <strong>{current.usable ? "可生成报告" : "尚不可用"}</strong>
          </div>
        </div>
        {!current.encryptionReady ? (
          <p className="mt-4 rounded-xl bg-[var(--warning-soft)] px-3 py-2 text-xs leading-5 text-[var(--warning)]">
            生产服务尚未提供 AI_CONFIG_ENCRYPTION_KEY。可查看默认配置，但不能安全保存组织 API Key；请先在 API 服务和 Worker 中填入同一随机密钥。
          </p>
        ) : null}
        <form
          className="mt-5 grid gap-4 md:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            save.mutate();
          }}
        >
          <label className="flex items-center gap-3 rounded-xl bg-[var(--surface-subtle)] px-3 py-3 text-sm font-semibold md:col-span-2">
            <input
              checked={form.enabled}
              onChange={(event) =>
                setForm((current) => ({ ...current, enabled: event.target.checked }))
              }
              type="checkbox"
            />
            启用本组织 AI 工作洞察
          </label>
          <Field
            hint="生产环境必须是 HTTPS；使用 OpenAI 兼容的 /v4 或同类基础路径，不要填写 /chat/completions。"
            label="AI Base URL"
          >
            <input
              autoCapitalize="none"
              className={fieldClass}
              onChange={(event) =>
                setForm((current) => ({ ...current, baseUrl: event.target.value }))
              }
              required
              type="url"
              value={form.baseUrl}
            />
          </Field>
          <Field hint="例如 glm-4.7-flash；由你的 AI 供应商决定。" label="模型标识">
            <input
              autoCapitalize="none"
              className={fieldClass}
              onChange={(event) =>
                setForm((current) => ({ ...current, model: event.target.value }))
              }
              required
              value={form.model}
            />
          </Field>
          <Field
            hint={current.hasApiKey ? "留空会保留当前密钥；输入新值会安全替换它。" : "首次启用必须填写；保存后不可再次查看。"}
            label="API Key"
          >
            <PasswordInput
              autoComplete="new-password"
              inputLabel="API Key"
              onChange={(event) =>
                setForm((current) => ({ ...current, apiKey: event.target.value }))
              }
              placeholder={current.hasApiKey ? "已保存，输入新密钥才会替换" : "仅在服务端加密保存"}
              value={form.apiKey}
            />
          </Field>
          <Field hint="限制单份报告长度，直接控制输出成本。" label="最大输出 Token">
            <input
              className={fieldClass}
              max={16000}
              min={128}
              onChange={(event) => updateNumber("maxOutputTokens", event.target.value)}
              required
              type="number"
              value={form.maxOutputTokens}
            />
          </Field>
          <Field hint={`按 ${current.usage.timezone} 组织时区计数。重复相同事实的请求会复用已有任务。`} label="每日请求上限">
            <input
              className={fieldClass}
              max={10000}
              min={1}
              onChange={(event) => updateNumber("dailyRequestLimit", event.target.value)}
              required
              type="number"
              value={form.dailyRequestLimit}
            />
          </Field>
          <Field hint="失败任务也会计入额度，避免供应商异常时反复消耗。" label="每月请求上限">
            <input
              className={fieldClass}
              max={300000}
              min={1}
              onChange={(event) => updateNumber("monthlyRequestLimit", event.target.value)}
              required
              type="number"
              value={form.monthlyRequestLimit}
            />
          </Field>
          <Field hint="修改组织密钥、模型或额度需重新输入当前密码。" label="当前 Owner 密码">
            <PasswordInput
              autoComplete="current-password"
              inputLabel="当前 Owner 密码"
              minLength={8}
              onChange={(event) =>
                setForm((current) => ({ ...current, password: event.target.value }))
              }
              required
              value={form.password}
            />
          </Field>
          <Field hint="若当前 Owner 已启用双因素认证，则必填。" label="动态验证码（如已启用）">
            <input
              autoComplete="one-time-code"
              className={fieldClass}
              inputMode="numeric"
              maxLength={6}
              onChange={(event) =>
                setForm((current) => ({ ...current, totpCode: event.target.value }))
              }
              placeholder="6 位"
              value={form.totpCode}
            />
          </Field>
          <label className="flex items-center gap-2 text-xs leading-5 text-[var(--text-muted)] md:col-span-2">
            <input
              checked={form.clearApiKey}
              disabled={Boolean(form.apiKey.trim())}
              onChange={(event) =>
                setForm((current) => ({ ...current, clearApiKey: event.target.checked }))
              }
              type="checkbox"
            />
            清除已保存密钥并停用组织 AI（不能与替换密钥同时使用）
          </label>
          <div className="flex flex-wrap items-center gap-3 md:col-span-2">
            <Button disabled={save.isPending} type="submit">
              <KeyRound size={16} />
              {save.isPending ? "正在安全保存…" : "验证并保存组织配置"}
            </Button>
            <Button
              disabled={
                checkProvider.isPending ||
                form.password.length < 8 ||
                !current.usable
              }
              onClick={() => checkProvider.mutate()}
              type="button"
              variant="secondary"
            >
              <Bot size={16} />
              {checkProvider.isPending ? "正在测试…" : "测试已保存配置"}
            </Button>
          </div>
          <div className="md:col-span-2">
            <ErrorMessage error={save.error ?? checkProvider.error} />
          </div>
        </form>
        <section className="mt-5" aria-label="AI 连接测试历史">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-bold">连接记录</h3>
            <span className="text-xs text-[var(--text-subtle)]">
              测试会产生一次极小调用
            </span>
          </div>
          {checks.isPending ? (
            <div className="mt-3"><LoadingBlock /></div>
          ) : checks.data?.items.length ? (
            <div className="mt-3 grid gap-2">
              {checks.data.items.map((item) => (
                <div className="ai-provider-check" key={item.id}>
                  <Badge tone={item.status === "succeeded" ? "positive" : item.status === "running" ? "warning" : "danger"}>
                    {item.status === "succeeded" ? "连接成功" : item.status === "running" ? "测试中" : "连接失败"}
                  </Badge>
                  <strong>{item.endpointHost} · {item.model}</strong>
                  <span>{item.latencyMs} ms · {formatDateTime(item.checkedAt)}</span>
                  {item.errorSummary ? <small>{item.errorSummary}</small> : null}
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-3 text-sm text-[var(--text-muted)]">尚未测试连接。</p>
          )}
          <ErrorMessage error={checks.error} />
        </section>
      </CardContent>
    </Card>
  );
}

export function AiPage({ me }: { me: Me }) {
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const requestedConversationId = searchParams.get("conversation") ?? "primary";
  const conversationId = /^[a-zA-Z0-9_-]{1,64}$/.test(requestedConversationId)
    ? requestedConversationId
    : "primary";
  const requestedPageArea = searchParams.get("area");
  const pageArea = aiPageAreaValues.includes(requestedPageArea as AiPageArea)
    ? (requestedPageArea as AiPageArea)
    : null;
  const requestedEntityId = searchParams.get("entity");
  const pageContext = pageArea
    ? {
        area: pageArea,
        ...(pageArea === "project" &&
        requestedEntityId &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          requestedEntityId,
        )
          ? { entityId: requestedEntityId }
          : {}),
      }
    : undefined;
  const reports = useQuery({
    queryKey: ["ai-reports"],
    queryFn: () => api<{ items: AiReportRecord[] }>("/api/ai/reports"),
    refetchInterval: (query) =>
      query.state.data?.items.some((item) =>
        ["queued", "running"].includes(item.job.status),
      )
        ? 5_000
        : false,
  });
  const [scope, setScope] = useState<"self" | "team">("self");
  const [taskType, setTaskType] = useState<AiTaskType>("weekly_summary");
  const [question, setQuestion] = useState("");
  const [activeReportId, setActiveReportId] = useState<string | null>(() => searchParams.get("report"));
  const [settingsOpen, setSettingsOpen] = useState(false);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  // Keep one five-minute-aligned seven-day range for the lifetime of this
  // screen. A double click, reconnect, or React Query retry then resolves to
  // the same server-side job instead of paying for a nearly-identical prompt
  // whose only difference is the current millisecond.
  const reportRange = useMemo(() => {
    const to = new Date();
    to.setSeconds(0, 0);
    to.setMinutes(Math.floor(to.getMinutes() / 5) * 5);
    const days = aiTaskPresets.find((preset) => preset.type === taskType)?.rangeDays ?? 7;
    return {
      from: new Date(to.getTime() - days * 86_400_000).toISOString(),
      to: to.toISOString(),
    };
  }, [taskType]);
  const create = useMutation({
    mutationFn: () =>
      api("/api/ai/reports", {
        method: "POST",
        body: { taskType, scope, ...reportRange },
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["ai-reports"] });
    },
  });
  const sendChat = useMutation({
    mutationFn: () => {
      const to = new Date();
      to.setSeconds(0, 0);
      return api("/api/ai/reports", {
        method: "POST",
        body: {
          taskType: "assistant_chat",
          scope,
          question: question.trim(),
          conversationId,
          ...(pageContext ? { pageContext } : {}),
          from: new Date(to.getTime() - 31 * 86_400_000).toISOString(),
          to: to.toISOString(),
        },
      });
    },
    onSuccess: async () => {
      setQuestion("");
      await queryClient.invalidateQueries({ queryKey: ["ai-reports"] });
    },
  });
  const cancel = useMutation({
    mutationFn: (jobId: string) =>
      api(`/api/ai/jobs/${jobId}/cancel`, { method: "POST" }),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["ai-reports"] }),
  });
  const retry = useMutation({
    mutationFn: (jobId: string) =>
      api(`/api/ai/jobs/${jobId}/retry`, { method: "POST" }),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["ai-reports"] }),
  });
  const canAnalyzeTeam = me.permissions.some(
    (grant) =>
      grant.permission === "ai.team_analysis" &&
      grant.scopeKind === "organization",
  );
  const canViewOwnPayroll = hasGrant(me, "payroll.view_own");
  const allItems = reports.data?.items ?? [];
  const reportItems = allItems.filter((item) => item.job.taskType !== "assistant_chat");
  const chatItems = allItems
    .filter(
      (item) =>
        item.job.taskType === "assistant_chat" &&
        (item.job.scope.conversationId ?? "primary") === conversationId,
    )
    .reverse();
  const chatUpdateKey = chatItems
    .map((item) => `${item.job.id}:${item.job.status}:${Boolean(item.report)}`)
    .join("|");
  useEffect(() => {
    const container = chatScrollRef.current;
    if (!container) return;
    container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
  }, [chatUpdateKey]);
  const selected =
    reportItems.find((item) => item.job.id === activeReportId || item.report?.id === activeReportId) ??
    reportItems[0] ??
    null;
  const selectedReport = selected?.report ?? null;
  const selectedDetail = useQuery({
    queryKey: ["ai-report-detail", selectedReport?.id],
    queryFn: () => api<AiReportDetail>(`/api/ai/reports/${selectedReport!.id}`),
    enabled: Boolean(selectedReport?.id),
  });
  const isSalaryReport = selected?.job.taskType === "salary_explanation";

  return (
    <>
      <PageHeader
        title="AI 工作洞察"
        actions={
          <>
            <label className="sr-only" htmlFor="ai-scope">AI 分析范围</label>
            <select
              className={`${fieldClass} min-h-10 w-auto min-w-32`}
              id="ai-scope"
              onChange={(event) => {
                const nextScope = event.target.value as "self" | "team";
                setScope(nextScope);
                if (nextScope === "team" && taskType === "salary_explanation") {
                  setTaskType("weekly_summary");
                }
              }}
              value={scope}
            >
              <option value="self">本人范围</option>
              {canAnalyzeTeam ? <option value="team">团队范围</option> : null}
            </select>
            {me.user.isOwner ? (
              <Button onClick={() => setSettingsOpen((open) => !open)} variant="secondary">
                <Settings2 size={16} />
                组织 AI 配置
              </Button>
            ) : null}
          </>
        }
      />
      {settingsOpen ? <AiSettingsPanel onClose={() => setSettingsOpen(false)} /> : null}
      {reports.isPending ? (
        <Card>
          <LoadingBlock />
        </Card>
      ) : (
        <div className="ai-workspace">
          <aside className="ai-history">
            <Card>
              <CardHeader>
                <div>
                  <h2 className="font-extrabold tracking-[-0.025em]">
                    报告历史
                  </h2>
                </div>
                <Badge>{reportItems.length}</Badge>
              </CardHeader>
              <div className="ai-history-list">
                {reportItems.length ? (
                  reportItems.map((item) => (
                    <button
                      aria-pressed={selected?.job.id === item.job.id}
                      className={`ai-history-item ${selected?.job.id === item.job.id ? "is-active" : ""}`}
                      key={item.job.id}
                      onClick={() => setActiveReportId(item.job.id)}
                      type="button"
                    >
                      <strong>{item.report?.title || aiTaskPresets.find((preset) => preset.type === item.job.taskType)?.label || "报告任务"}</strong>
                      <small>
                        {item.report
                          ? `${formatDateTime(item.report.generatedAt)} · ${item.report.sourceCount} 个来源`
                          : item.job.status === "failed"
                            ? "生成失败"
                            : item.job.status === "cancelled"
                              ? "已取消，可重新生成"
                            : "正在生成"}
                      </small>
                    </button>
                  ))
                ) : (
                  <p className="px-3 py-7 text-sm leading-6 text-[var(--text-muted)]">
                    还没有报告。生成后会在这里保留历史与来源数量。
                  </p>
                )}
              </div>
            </Card>
          </aside>
          <section className="min-w-0">
            <Card className="ai-chat-card">
              <CardHeader>
                <div>
                  <p className="app-page-kicker">基于当前授权事实</p>
                  <h2 className="mt-1 text-xl font-extrabold tracking-[-0.04em]">和 AI 对话</h2>
                </div>
                <Badge tone="info">
                  {pageContext ? "当前页面上下文" : "实时授权上下文"}
                </Badge>
              </CardHeader>
              <CardContent>
                {chatItems.length ? (
                  <div className="max-h-[32rem] space-y-4 overflow-y-auto pr-1" aria-live="polite" ref={chatScrollRef}>
                    {chatItems.map((item) => (
                      <div className="space-y-2" key={item.job.id}>
                        <div className="ml-auto max-w-[88%] rounded-2xl rounded-br-md bg-[var(--accent)] px-4 py-3 text-sm leading-6 text-[var(--accent-foreground)]">
                          {item.job.scope.question || "工作分析"}
                        </div>
                        <div className="max-w-[92%] rounded-2xl rounded-bl-md bg-[var(--surface-subtle)] px-4 py-3 text-sm leading-7">
                          {item.report?.summary ??
                            (item.job.status === "failed"
                              ? item.job.errorSummary || "本次回答生成失败，可以重试。"
                              : item.job.status === "cancelled"
                                ? "本次对话已取消。"
                                : "正在结合最新工时、成员和项目状态生成回答…")}
                          {!item.report && ["queued", "running"].includes(item.job.status) ? (
                            <div className="mt-2">
                              <Button disabled={cancel.isPending} onClick={() => cancel.mutate(item.job.id)} size="compact" variant="secondary">取消</Button>
                            </div>
                          ) : null}
                          {!item.report && ["failed", "cancelled"].includes(item.job.status) ? (
                            <div className="mt-2">
                              <Button disabled={retry.isPending} onClick={() => retry.mutate(item.job.id)} size="compact" variant="secondary">
                                <RotateCcw size={14} />重试
                              </Button>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="py-6 text-center text-sm text-[var(--text-muted)]">
                    可以询问工作进展、项目阻塞、成员状态或下一步安排。
                  </div>
                )}
                <form
                  className="mt-4 flex flex-col gap-3"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (question.trim().length >= 2) sendChat.mutate();
                  }}
                >
                  <textarea
                    aria-label="向 AI 提问"
                    className={`${textAreaClass} min-h-28 resize-y`}
                    maxLength={2_000}
                    onChange={(event) => setQuestion(event.target.value)}
                    placeholder={scope === "team" ? "例如：哪些项目当前受阻，分别需要谁处理？" : "例如：总结我本周的投入、成果和待处理事项。"}
                    value={question}
                  />
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap gap-2">
                      {(scope === "team"
                        ? ["总结团队今天的进展", "梳理项目阻塞与责任人", "列出下一步协作优先级"]
                        : ["总结我今天的工作", "梳理当前项目阻塞", "给出下一步优先级"]
                      ).map((prompt) => (
                        <button className="rounded-lg bg-[var(--surface-subtle)] px-3 py-2 text-xs font-semibold hover:bg-[var(--accent-soft)]" key={prompt} onClick={() => setQuestion(prompt)} type="button">{prompt}</button>
                      ))}
                    </div>
                    <Button disabled={question.trim().length < 2 || sendChat.isPending} type="submit">
                      <ArrowUpRight size={16} />
                      {sendChat.isPending ? "正在发送…" : "发送"}
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
            <Card className="ai-compose-card mt-5">
              <CardContent>
                <div className="flex items-start justify-between gap-3">
                  <h2 className="text-xl font-extrabold tracking-[-0.04em]">
                    快捷分析报告
                  </h2>
                  <Badge>{scope === "team" ? "团队" : "本人"}</Badge>
                </div>
                <div className="mt-5 flex flex-wrap items-center gap-3">
                  {aiTaskPresets
                    .filter(
                      (preset) =>
                        (!preset.teamOnly || canAnalyzeTeam) &&
                        (!preset.requiresOwnPayroll || canViewOwnPayroll),
                    )
                    .map((preset) => (
                      <Button
                        aria-pressed={taskType === preset.type}
                        key={preset.type}
                        onClick={() => {
                          setTaskType(preset.type);
                          if (preset.teamOnly) setScope("team");
                          if (preset.selfOnly) setScope("self");
                        }}
                        size="compact"
                        variant={taskType === preset.type ? "primary" : "secondary"}
                      >
                        {preset.label}
                      </Button>
                    ))}
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <Button
                    disabled={create.isPending}
                    onClick={() => create.mutate()}
                  >
                    {create.isPending ? "正在提交任务…" : "生成所选洞察"}
                    <ArrowUpRight size={16} />
                  </Button>
                </div>
              </CardContent>
            </Card>
            {selected ? (
              <Card className="ai-report-card mt-5">
                <CardHeader>
                  {selectedReport ? (
                    <div>
                      <p className="app-section-label">已生成报告</p>
                      <h2 className="mt-2 font-extrabold tracking-[-0.025em]">
                        {selectedReport.title}
                      </h2>
                      <p className="mt-1 text-sm text-[var(--text-muted)]">
                        生成于 {formatDateTime(selectedReport.generatedAt)} ·
                        已引用 {selectedReport.sourceCount} 个授权来源
                      </p>
                    </div>
                  ) : (
                    <div>
                      <p className="app-section-label">后台任务</p>
                      <h2 className="mt-2 font-extrabold tracking-[-0.025em]">
                        报告任务
                      </h2>
                      <p className="mt-1 text-sm text-[var(--text-muted)]">
                        {selected.job.status === "failed"
                          ? selected.job.errorSummary || "生成失败"
                          : selected.job.status === "cancelled"
                            ? "任务已取消，未生成或改写任何业务事实。"
                            : "后台正在基于聚合事实生成，不阻塞其他操作。"}
                      </p>
                    </div>
                  )}
                  <Badge
                    tone={
                      selectedReport
                        ? "positive"
                        : selected.job.status === "failed"
                          ? "danger"
                          : selected.job.status === "cancelled"
                            ? "neutral"
                            : "warning"
                    }
                  >
                    {selectedReport ? "可查看" : selected.job.status}
                  </Badge>
                </CardHeader>
                <CardContent>
                  {selectedReport ? (
                    <>
                      <p className="text-sm leading-7 text-[var(--text-muted)]">
                        {selectedReport.summary}
                      </p>
                      <div className="mt-5 grid gap-4 md:grid-cols-3">
                        <InsightList
                          items={
                            selectedReport.structuredOutput.highlights ?? []
                          }
                          title={isSalaryReport ? "工资事实" : "进展亮点"}
                          tone="positive"
                        />
                        <InsightList
                          items={selectedReport.structuredOutput.risks ?? []}
                          title={isSalaryReport ? "待确认项" : "风险提示"}
                          tone="danger"
                        />
                        <InsightList
                          items={
                            selectedReport.structuredOutput.suggestions ?? []
                          }
                          title={isSalaryReport ? "核对建议" : "建议"}
                          tone="info"
                        />
                      </div>
                      <section className="mt-5" aria-label="报告事实来源">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <h3 className="text-sm font-bold">事实来源</h3>
                          <Badge>
                            {selectedDetail.data?.sources.length ?? selectedReport.sourceCount} 项
                          </Badge>
                        </div>
                        {selectedDetail.isPending ? (
                          <div className="mt-3"><LoadingBlock /></div>
                        ) : selectedDetail.data?.sources.length ? (
                          <div className="mt-3 flex flex-wrap gap-2">
                            {selectedDetail.data.sources.map((source) => (
                              <span
                                className="rounded-lg bg-[var(--surface-subtle)] px-3 py-2 text-xs leading-5 text-[var(--text-muted)]"
                                key={source.id}
                                title={`${source.entityType}${source.entityVersion ? ` · v${source.entityVersion}` : ""}`}
                              >
                                {source.label}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <p className="mt-3 text-sm text-[var(--text-muted)]">
                            本报告没有可展示的实体来源；请仅将摘要作为辅助说明。
                          </p>
                        )}
                        <ErrorMessage error={selectedDetail.error} />
                      </section>
                    </>
                  ) : (
                    <div className="min-h-48">
                      <EmptyState
                        description={
                          selected.job.status === "failed"
                            ? selected.job.errorSummary ||
                              "生成失败，请稍后重新创建报告。"
                            : selected.job.status === "cancelled"
                              ? "该任务已安全取消；如仍需要此报告，可以重新生成。"
                            : "报告完成后，摘要、风险和建议会基于同一授权范围显示在这里。"
                        }
                        icon={<Bot />}
                        title={
                          selected.job.status === "failed"
                            ? "报告未完成"
                            : selected.job.status === "cancelled"
                              ? "任务已取消"
                            : "正在整理事实"
                        }
                      />
                      <div className="mt-4 flex justify-center gap-2">
                        {selected.job.status === "queued" || selected.job.status === "running" ? (
                          <Button disabled={cancel.isPending} onClick={() => cancel.mutate(selected.job.id)} size="compact" variant="secondary">
                            {cancel.isPending ? "正在取消…" : "取消任务"}
                          </Button>
                        ) : null}
                        {selected.job.status === "failed" || selected.job.status === "cancelled" ? (
                          <Button disabled={retry.isPending} onClick={() => retry.mutate(selected.job.id)} size="compact" variant="secondary">
                            <RotateCcw size={15} />
                            {retry.isPending ? "正在重试…" : "重新生成"}
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            ) : (
              <Card className="ai-report-card mt-5">
                <EmptyState
                  action={
                    <Button onClick={() => create.mutate()}>
                      <Bot size={17} />
                      生成第一份报告
                    </Button>
                  }
                  description="选择一种报告，系统会在后台整理当前授权范围内的事实。"
                  icon={<Bot />}
                  title="从一份可追溯的报告开始"
                />
              </Card>
            )}
          </section>
        </div>
      )}
      <div className="mt-4">
        <ErrorMessage error={reports.error ?? create.error ?? sendChat.error ?? cancel.error ?? retry.error} />
      </div>
    </>
  );
}

function InsightList({
  title,
  items,
  tone,
}: {
  title: string;
  items: string[];
  tone: "positive" | "danger" | "info";
}) {
  return (
    <div className="rounded-xl bg-[var(--surface-tint)] p-4">
      <Badge tone={tone}>{title}</Badge>
      {items.length ? (
        <ul className="mt-3 space-y-2 text-sm leading-6">
          {items.map((item, index) => (
            <li className="flex gap-2" key={`${title}-${index}`}>
              <span aria-hidden="true">•</span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-[var(--text-muted)]">
          没有足够事实支持此项结论。
        </p>
      )}
    </div>
  );
}
interface OrganizationOverview {
  organization: { id: string; name: string; timezone: string } | null;
  units: Array<{ id: string; parentId: string | null; name: string }>;
  members: Array<{
    membership: {
      id: string;
      status: string;
      positionTitle: string | null;
      orgUnitId: string | null;
    };
    user: { displayName: string };
    positionTitle: string | null;
    unitName: string | null;
  }>;
  roles: Array<{
    id: string;
    name: string;
    kind: string;
    description: string | null;
  }>;
}
export function LegacyOrganizationPage() {
  const queryClient = useQueryClient();
  const organization = useQuery({
    queryKey: ["organization"],
    queryFn: () => api<OrganizationOverview>("/api/organization"),
  });
  const invitableRoles = useMemo(
    () =>
      (organization.data?.roles ?? []).filter(
        (role) => role.kind !== "owner",
      ),
    [organization.data?.roles],
  );
  const [unitName, setUnitName] = useState("");
  const [invite, setInvite] = useState({
    displayName: "",
    email: "",
    positionTitle: "",
    orgUnitId: "",
    roleId: "",
  });
  const [inviteDelivery, setInviteDelivery] = useState<{
    kind: "email" | "phone";
    expiresAt: string;
  } | null>(null);
  const selectedInviteRole =
    invitableRoles.find((role) => role.id === invite.roleId) ??
    invitableRoles.find((role) => role.kind === "member");
  const effectiveInviteRoleId = selectedInviteRole?.id ?? "";
  const canSubmitInvite = Boolean(effectiveInviteRoleId);
  const createUnit = useMutation({
    mutationFn: () =>
      api("/api/organization/units", {
        method: "POST",
        body: { name: unitName, parentId: null },
      }),
    onSuccess: async () => {
      setUnitName("");
      await queryClient.invalidateQueries({ queryKey: ["organization"] });
    },
  });
  const inviteMember = useMutation({
    mutationFn: () =>
      api<{
        delivery: { kind: "email" | "phone"; expiresAt: string };
      }>("/api/organization/invitations", {
        method: "POST",
        body: {
          displayName: invite.displayName,
          identifier: invite.email,
          kind: "email",
          positionTitle: invite.positionTitle || undefined,
          orgUnitId: invite.orgUnitId || null,
          roleId: effectiveInviteRoleId,
        },
      }),
    onSuccess: async (data) => {
      setInviteDelivery(data.delivery);
      setInvite({
        displayName: "",
        email: "",
        positionTitle: "",
        orgUnitId: "",
        roleId: "",
      });
      await queryClient.invalidateQueries({ queryKey: ["organization"] });
    },
  });
  const setMemberStatus = useMutation({
    mutationFn: ({
      membershipId,
      status,
    }: {
      membershipId: string;
      status: "active" | "inactive";
    }) =>
      api(`/api/organization/members/${membershipId}/status`, {
        method: "PATCH",
        body: { status },
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["organization"] });
    },
  });
  return (
    <>
      <PageHeader
        title="组织与人员"
        description="访问角色决定能做什么，组织单元决定管理范围，专业身份用于业务标签；三者不混用。"
      />
      {organization.isPending ? (
        <Card>
          <LoadingBlock />
        </Card>
      ) : organization.data ? (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
          <div className="space-y-5">
            <Card>
              <CardHeader>
                <div>
                  <h2 className="font-bold">成员</h2>
                  <p className="mt-1 text-sm text-[var(--text-muted)]">
                    {organization.data.organization?.name} ·{" "}
                    {organization.data.organization?.timezone}
                  </p>
                </div>
                <Badge tone="info">{organization.data.members.length} 人</Badge>
              </CardHeader>
              <CardContent>
                <div className="divide-y divide-[var(--border)]">
                  {organization.data.members.map((item) => (
                    <div
                      className="flex items-center gap-3 py-3"
                      key={item.membership.id}
                    >
                      <div className="grid size-9 place-items-center rounded-full bg-[var(--accent-soft)] font-bold text-[var(--accent-strong)]">
                        {item.user.displayName.slice(0, 1)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold">
                          {item.user.displayName}
                        </p>
                        <p className="truncate text-xs text-[var(--text-muted)]">
                          {item.positionTitle || "未设置岗位"} ·{" "}
                          {item.unitName || "未分配组织单元"}
                        </p>
                      </div>
                      <Badge
                        tone={
                          item.membership.status === "active"
                            ? "positive"
                            : "warning"
                        }
                      >
                        {item.membership.status === "active"
                          ? "在职"
                          : item.membership.status === "inactive"
                            ? "已停用"
                            : "待加入"}
                      </Badge>
                      {item.membership.status !== "invited" ? (
                        <Button
                          disabled={setMemberStatus.isPending}
                          onClick={() =>
                            setMemberStatus.mutate({
                              membershipId: item.membership.id,
                              status:
                                item.membership.status === "active"
                                  ? "inactive"
                                  : "active",
                            })
                          }
                          size="compact"
                          variant="secondary"
                        >
                          {item.membership.status === "active"
                            ? "停用"
                            : "恢复"}
                        </Button>
                      ) : null}
                    </div>
                  ))}
                </div>
                <ErrorMessage error={setMemberStatus.error} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <h2 className="font-bold">组织单元</h2>
              </CardHeader>
              <CardContent>
                <form
                  className="mb-4 flex gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    createUnit.mutate();
                  }}
                >
                  <input
                    className={fieldClass}
                    onChange={(event) => setUnitName(event.target.value)}
                    placeholder="新增一级组织单元"
                    required
                    value={unitName}
                  />
                  <Button disabled={createUnit.isPending} type="submit">
                    <Plus size={17} />
                    添加
                  </Button>
                </form>
                <div className="flex flex-wrap gap-2">
                  {organization.data.units.map((unit) => (
                    <Badge key={unit.id}>{unit.name}</Badge>
                  ))}
                </div>
                <ErrorMessage error={createUnit.error} />
              </CardContent>
            </Card>
          </div>
          <Card className="h-fit">
            <CardHeader>
              <h2 className="font-bold">邀请成员</h2>
            </CardHeader>
            <CardContent>
              <form
                className="space-y-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!canSubmitInvite) return;
                  inviteMember.mutate();
                }}
              >
                <Field label="姓名">
                  <input
                    className={fieldClass}
                    onChange={(event) =>
                      setInvite({ ...invite, displayName: event.target.value })
                    }
                    required
                    value={invite.displayName}
                  />
                </Field>
                <Field label="邮箱">
                  <input
                    className={fieldClass}
                    onChange={(event) =>
                      setInvite({ ...invite, email: event.target.value })
                    }
                    required
                    type="email"
                    value={invite.email}
                  />
                </Field>
                <Field label="岗位">
                  <input
                    className={fieldClass}
                    onChange={(event) =>
                      setInvite({
                        ...invite,
                        positionTitle: event.target.value,
                      })
                    }
                    value={invite.positionTitle}
                  />
                </Field>
                <Field label="组织单元">
                  <select
                    className={fieldClass}
                    onChange={(event) =>
                      setInvite({ ...invite, orgUnitId: event.target.value })
                    }
                    value={invite.orgUnitId}
                  >
                    <option value="">暂不分配</option>
                    {organization.data.units.map((unit) => (
                      <option key={unit.id} value={unit.id}>
                        {unit.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="访问角色">
                  <select
                    className={fieldClass}
                    disabled={
                      inviteMember.isPending || invitableRoles.length === 0
                    }
                    onChange={(event) =>
                      setInvite({ ...invite, roleId: event.target.value })
                    }
                    required={invitableRoles.length > 0}
                    value={effectiveInviteRoleId}
                  >
                    <option value="">
                      {invitableRoles.length
                        ? "请选择"
                        : "正在同步可邀请角色…"}
                    </option>
                    {invitableRoles.map((role) => (
                      <option key={role.id} value={role.id}>
                        {role.name}
                      </option>
                    ))}
                  </select>
                </Field>
                {!canSubmitInvite ? (
                  <p className="text-xs leading-5 text-[var(--text-muted)]" role="status">
                    正在恢复可邀请角色目录；目录可用前不会发送缺少访问角色的邀请。
                  </p>
                ) : null}
                <Button
                  className="w-full"
                  disabled={inviteMember.isPending || !canSubmitInvite}
                  type="submit"
                >
                  发送邀请
                </Button>
                <ErrorMessage error={inviteMember.error} />
                {inviteDelivery ? (
                  <div className="rounded-xl bg-[var(--warning-soft)] p-3 text-xs leading-5 text-[var(--warning)]">
                    <strong className="block">白名单邀请已进入投递通道</strong>
                    <span className="mt-1 block">
                      邀请链接只会发送至受邀成员的邮箱，且将在
                      {" "}
                      {new Date(inviteDelivery.expiresAt).toLocaleString("zh-CN")}
                      {" "}
                      后过期。服务未配置时会明确报错，绝不会展示令牌。
                    </span>
                  </div>
                ) : null}
              </form>
            </CardContent>
          </Card>
        </div>
      ) : null}
      <div className="mt-4">
        <ErrorMessage error={organization.error} />
      </div>
    </>
  );
}
export function NotFoundPage() {
  return (
    <div className="grid min-h-dvh place-items-center bg-[var(--canvas)] p-6 text-center">
      <div>
        <p className="text-6xl font-bold text-[var(--accent)]">404</p>
        <h1 className="mt-4 text-xl font-bold">页面不存在</h1>
        <Link className="mt-5 inline-block" to="/">
          <Button>返回工作台</Button>
        </Link>
      </div>
    </div>
  );
}

export { OrganizationPage } from "./organization-workbench.js";
export { CalendarPage } from "./calendar-workbench.js";
export { ProjectDetailPage } from "./project-workbench.js";
