import { useQuery } from "@tanstack/react-query";
import { api } from "./api.js";

interface ProgressNode {
  id: string;
  projectId: string;
  projectLabel: string;
  title: string;
  type: string;
  status: string;
  progress?: string;
  progressMode?: "manual" | "weighted_children" | "time_weighted_children" | "milestone_based" | undefined;
  parentId?: string | null;
}

export function WorkProgressReporter({ node, value, onChange, onAddNode, canAdd, fieldClass }: {
  node: ProgressNode;
  value: string | undefined;
  onChange: (value: string | undefined) => void;
  onAddNode: (node: ProgressNode) => void;
  canAdd: boolean;
  fieldClass: string;
}) {
  const tree = useQuery({
    queryKey: ["project-tree", node.projectId],
    queryFn: () => api<{ nodes: ProgressNode[] }>(`/api/projects/${node.projectId}/tree`),
  });
  const current = tree.data?.nodes.find((candidate) => candidate.id === node.id) ?? node;
  const automatic = current.progressMode && current.progressMode !== "manual";
  const descendants = new Set([node.id]);
  const pending = [node.id];
  for (let index = 0; index < pending.length; index += 1) {
    for (const child of tree.data?.nodes ?? []) {
      if (child.parentId === pending[index] && !descendants.has(child.id)) {
        descendants.add(child.id);
        pending.push(child.id);
      }
    }
  }
  const children = (tree.data?.nodes ?? []).filter((child) => child.id !== node.id && descendants.has(child.id) && child.progressMode === "manual");
  const enabled = value !== undefined && !automatic;
  return (
    <section className="work-progress-reporter" aria-label={`${node.title}进度更新`}>
      <div className="work-progress-reporter-head">
        <div>
          <strong>{node.projectLabel} · {node.title}</strong>
          <small>当前完成度 {Number(current.progress ?? 0)}%{automatic ? " · 由子节点自动汇总" : " · 勾选后随本次工作一起更新"}</small>
        </div>
        <output>{enabled && value !== "" ? `${value}%` : "不更新"}</output>
      </div>
      {automatic ? (
        <label className="work-progress-child-picker">
          选择要更新的子节点
          <select aria-label={`${node.title}的子节点`} className={fieldClass} disabled={!canAdd} value="" onChange={(event) => {
            const child = children.find((candidate) => candidate.id === event.target.value);
            if (child) onAddNode({ ...child, projectId: node.projectId, projectLabel: node.projectLabel });
          }}>
            <option value="">添加具体任务并填写完成度</option>
            {children.map((child) => <option key={child.id} value={child.id}>{child.title} · {Number(child.progress ?? 0)}%</option>)}
          </select>
          {tree.isPending ? <small>正在读取子节点…</small> : !children.length ? <small>当前阶段下没有可手动更新的子任务。</small> : null}
          {value !== undefined ? <button type="button" onClick={() => onChange(undefined)}>该节点已改为自动汇总，清除已填进度</button> : null}
        </label>
      ) : (
        <>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" aria-label={`更新 ${node.title} 的进度`} checked={enabled} onChange={(event) => onChange(event.target.checked ? String(Number(current.progress ?? 0)) : undefined)} />
            更新此节点完成度
          </label>
          {enabled ? (
            <>
              <div className="work-progress-reporter-controls">
                <input aria-label={`${node.title}完成度滑块`} type="range" min="0" max="100" step="1" value={value || "0"} onChange={(event) => onChange(event.target.value)} />
                <input aria-label={`${node.title}完成度`} className={fieldClass} type="number" inputMode="decimal" min="0" max="100" step="0.01" required value={value} onChange={(event) => onChange(event.target.value)} />
              </div>
              <div className="work-progress-presets" role="group" aria-label={`${node.title}快捷设置完成度`}>
                {[0, 25, 50, 75, 100].map((progress) => <button key={progress} type="button" aria-pressed={value === String(progress)} onClick={() => onChange(String(progress))}>{progress}%</button>)}
                <button type="button" onClick={() => onChange(undefined)}>不更新</button>
              </div>
            </>
          ) : null}
        </>
      )}
      {tree.isError ? <p role="alert">读取当前进度失败，请重试。<button type="button" onClick={() => void tree.refetch()}>重新读取</button></p> : null}
    </section>
  );
}
