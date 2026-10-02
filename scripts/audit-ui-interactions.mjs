import ts from "typescript";
import process from "node:process";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";

const categories = {
  actions: new Set(["button", "a", "Button", "Link", "NavLink"]),
  fields: new Set(["input", "select", "textarea"]),
  surfaces: new Set(["form", "Card", "article", "section"]),
  disclosures: new Set(["details", "summary"]),
};
const rows = [];
for (const folder of ["apps/web/src", "packages/ui/src"]) {
  for (const file of (await readdir(folder)).sort()) {
    if (!file.endsWith(".tsx") || file.includes(".test.")) continue;
    const path = join(folder, file), source = await readFile(path, "utf8");
    const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const counts = Object.fromEntries(Object.keys(categories).map((key) => [key, 0]));
    const components = [];
    function visit(node) {
      if (ts.isFunctionDeclaration(node) && node.name && /^[A-Z]/.test(node.name.text)) {
        components.push(`${node.name.text} (L${ast.getLineAndCharacterOfPosition(node.getStart()).line + 1})`);
      }
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const name = node.tagName.getText(ast);
        for (const [key, tags] of Object.entries(categories)) if (tags.has(name)) counts[key]++;
      }
      ts.forEachChild(node, visit);
    }
    visit(ast);
    rows.push({ path: relative(process.cwd(), path).replaceAll("\\", "/"), counts, components });
  }
}
const totals = Object.fromEntries(Object.keys(categories).map((key) => [key, rows.reduce((n, row) => n + row.counts[key], 0)]));
const output = [
  "# 前端组件与交互入口追踪清单", "",
  "由 `node scripts/audit-ui-interactions.mjs` 从 TypeScript AST 生成。数字是源码入口数，循环中的多个实例不重复计数；不是业务功能完成率。", "",
  "公共运行层为实际挂载的按钮、链接、输入、选择、折叠、表单、卡片、详情面板、状态和指标分配当前实例标识；门户中的图表和弹层同样覆盖。标识不包含成员、薪资、输入值或请求正文。", "",
  `扫描 ${rows.length} 个 TSX 文件；操作入口 ${totals.actions}，字段 ${totals.fields}，容器 ${totals.surfaces}，折叠入口 ${totals.disclosures}。`, "",
  "| 模块 | 操作 | 字段 | 容器 | 折叠 |", "| --- | ---: | ---: | ---: | ---: |",
  ...rows.map((row) => `| ${row.path} | ${row.counts.actions} | ${row.counts.fields} | ${row.counts.surfaces} | ${row.counts.disclosures} |`), "",
  "## 组件索引", "",
  ...rows.flatMap((row) => row.components.length ? [`### ${row.path}`, "", ...row.components.map((component) => `- ${component}`), ""] : []),
  "## 动态覆盖验证", "",
  "`tests/live/workspace.spec.ts` 在真实 API、数据库与文件服务下遍历管理员和员工页面，导出每个可见控件的实例标识、类型、尺寸和业务入口，并断言没有未注册的可交互控件。结果保存到每种尺寸的 `rendered-controls.json`。",
  "`interaction-controller.test.ts` 检查请求归属、并发、迟到完成、真实指标变化、原生校验与清理；浏览器回归检查手机、键盘、动效偏好和跨页编辑。独立业务控件的权限、持久化和业务规则仍由各自业务测试验证。", "",
].join("\n");
await writeFile("docs/frontend-interaction-inventory.md", output);
process.stdout.write(JSON.stringify({ files: rows.length, ...totals }) + "\n");
