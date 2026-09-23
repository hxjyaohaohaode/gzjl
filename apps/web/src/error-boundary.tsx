import { Component, type ReactNode } from "react";
import { AlertCircle } from "lucide-react";
import { Button } from "@workbench/ui";

export class WorkspaceErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  override componentDidCatch() {
    // Do not serialize component props or business data into browser logs.
    console.error("Workspace view failed to render.");
  }
  override render() {
    if (!this.state.failed) return this.props.children;
    return <section className="workspace-recovery" role="alert">
      <AlertCircle aria-hidden="true" size={28} />
      <h1>当前页面暂时无法显示</h1>
      <p>已保存的数据不受影响。可以先重新打开此页面；如果仍然失败，再刷新工作台。</p>
      <div className="flex flex-wrap justify-center gap-3">
        <Button onClick={() => this.setState({ failed: false })}>重新打开此页面</Button>
        <Button variant="secondary" onClick={() => window.location.reload()}>刷新工作台</Button>
      </div>
    </section>;
  }
}
