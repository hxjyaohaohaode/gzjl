export interface WorkspacePage {
  title: string;
  area: string;
  purpose: string;
  parent?: { to: string; label: string };
}
const pages: Record<string, WorkspacePage> = {
  "/": { title: "今日工作台", area: "我的工作", purpose: "记录正在做的事，查看今日时间线、项目推进和待办。" },
  "/work": { title: "工作记录", area: "我的工作", purpose: "记录真实工作、关联项目和证据，再提交审核。" },
  "/calendar": { title: "工作日历", area: "我的工作", purpose: "按日、周、月安排计划，核对真实工作发生的时间。" },
  "/projects": { title: "项目", area: "协作", purpose: "从项目进入节点、工作线和交付进度，查看关联工作依据。" },
  "/team": { title: "团队动态", area: "协作", purpose: "查看有权限的工作动态，了解同项目成员的推进情况。" },
  "/analytics": { title: "数据分析", area: "分析与洞察", purpose: "用同一组筛选联动图表与明细，核对投入、进展和趋势。" },
  "/ai": { title: "AI 工作洞察", area: "分析与洞察", purpose: "基于授权工作事实生成总结与解释，从引用回看依据。" },
  "/payroll": { title: "本月薪资", area: "个人事务", purpose: "查看本人本月工资预估，区分已批准工时、待审影响和预测。" },
  "/payroll/history": { title: "历史工资单", area: "个人事务", purpose: "核对周期工资单、计算组成与收款状态。", parent: { to: "/payroll", label: "我的薪资" } },
  "/reimbursements": { title: "我的报销", area: "个人事务", purpose: "填写申请、补充凭证，跟踪本人报销的审批与结算进度。" },
  "/approvals": { title: "工时审批", area: "管理工作", purpose: "先核对异常和证据，再批准记录或注明退回原因。" },
  "/approvals/reimbursements": { title: "报销审批", area: "管理工作", purpose: "核对其他成员的申请与凭证，将批准金额归入开放周期。" },
  "/approvals/reimbursements/history": { title: "报销审批记录", area: "管理工作", purpose: "按归属范围回看已处理报销、审批说明与证据。", parent: { to: "/approvals/reimbursements", label: "报销审批" } },
  "/payroll-management": { title: "薪资总览", area: "管理工作", purpose: "查看团队预估与待完善事项，进入对应成员或周期处理。" },
  "/payroll-management/plans": { title: "成员方案", area: "管理工作", purpose: "按成员维护计薪方式、补贴和规则，明确新版本生效时间。", parent: { to: "/payroll-management", label: "薪资管理" } },
  "/payroll-management/periods": { title: "周期结算", area: "管理工作", purpose: "找到结算周期，依次计算、核对金额和确认交接。", parent: { to: "/payroll-management", label: "薪资管理" } },
  "/payroll-management/settings": { title: "结算设置", area: "管理工作", purpose: "设置新建周期默认使用的结算日期和计划导出时间。", parent: { to: "/payroll-management", label: "薪资管理" } },
  "/organization": { title: "组织与人员", area: "组织管理", purpose: "分别管理组织岗位、专业身份和访问权限，保留成员历史。" },
  "/organization/work-policy": { title: "工时提交规则", area: "组织管理", purpose: "配置工时补录范围与每月提交期限。", parent: { to: "/organization", label: "组织与人员" } },
  "/security": { title: "账户安全", area: "个人事务", purpose: "管理登录方式、密码、验证与当前会话。" },
  "/imports": { title: "数据导入", area: "组织管理", purpose: "选择导入类型，先预检字段与异常，再确认写入工作记录或项目。" },
  "/notification-preferences": { title: "通知设置", area: "个人事务", purpose: "选择提醒类别、浏览器通知和免打扰时间。" },
  "/login": { title: "登录", area: "账户", purpose: "登录组织工作台，继续你的工作。" },
};
export function workspacePage(pathname: string): WorkspacePage {
  if (pages[pathname]) return pages[pathname];
  if (pathname.startsWith("/projects/")) return { title: "项目工作区", area: "协作", purpose: "沿节点查看进度、协作者、版本与工作依据。", parent: { to: "/projects", label: "项目" } };
  if (pathname.startsWith("/payroll-management/runs/")) return { title: "薪资交接", area: "管理工作", purpose: "核对本批金额和待处理事项，下载明细或确认正式交接。", parent: { to: "/payroll-management/periods", label: "周期结算" } };
  return { title: "工作台", area: "工作空间", purpose: "" };
}
