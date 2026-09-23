import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  });
}
const rows = [];
for (const file of files(join(root, "apps/server/src")).filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"))) {
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  const visit = (node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
        node.expression.expression.getText(source) === "app" &&
        /^(get|post|put|patch|delete|head|options)$/.test(node.expression.name.text)) {
      const route = node.arguments[0];
      let routeNames;
      if (route && ts.isStringLiteralLike(route)) routeNames = [route.text];
      else if (route && ts.isTemplateExpression(route) && route.templateSpans.length === 1) {
        const span = route.templateSpans[0];
        let parent = node.parent;
        while (parent && !ts.isForOfStatement(parent)) parent = parent.parent;
        if (parent && ts.isArrayLiteralExpression(parent.expression) &&
            parent.initializer.getText(source) === `const ${span.expression.getText(source)}` &&
            parent.expression.elements.every(ts.isStringLiteralLike)) {
          routeNames = parent.expression.elements.map((element) => `${route.head.text}${element.text}${span.literal.text}`);
        }
      }
      if (!routeNames) throw new Error(`Unresolved route in ${file}: ${route?.getText(source)}`);
      const statusCodes = new Set();
      const readCodes = (child) => {
        if (ts.isCallExpression(child) && ts.isPropertyAccessExpression(child.expression) && child.expression.name.text === "code") {
          const code = child.arguments[0];
          if (code && ts.isNumericLiteral(code)) statusCodes.add(Number(code.text));
        }
        ts.forEachChild(child, readCodes);
      };
      readCodes(node);
      const options = node.arguments.find((argument) => ts.isObjectLiteralExpression(argument));
      const prehandler = options?.properties.find((property) => property.name?.getText(source) === "preHandler");
      const websocket = options?.properties.some((property) => property.name?.getText(source) === "websocket");
      const path = relative(root, file).replaceAll("\\", "/");
      for (const routeName of routeNames) rows.push({ method: websocket ? "WS" : node.expression.name.text.toUpperCase(), route: routeName, path,
        line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
        gate: prehandler && ts.isPropertyAssignment(prehandler) ? prehandler.initializer.getText(source).replace(/\s+/g, " ") : websocket ? "连接内认证与 Origin 校验" : "见处理器及全局钩子",
        codes: [...statusCodes].sort().join(" / ") || "默认 200；其余见统一错误处理",
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}
rows.sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line);
const groups = Map.groupBy(rows, (row) => row.path);
const output = ["# 可复查的服务入口全集", "", "由 `node scripts/audit-inventory.mjs` 从 TypeScript AST 生成，禁止手工更改。这里只证明代码注册了入口；不代表需求完整或所有分支已通过测试。权限还可能在服务内部按数据范围检查，状态码还受认证、限流、CSRF 和统一错误处理影响。", "", `当前包含 **${rows.length} 个服务入口、${groups.size} 个注册文件**。前端功能、异步模式、隐性需求和验收状态见 [全量功能与需求核验](./functional-audit-2026-09-22.md)。`, ""];
for (const [path, entries] of groups) {
  output.push(`## ${path}`, "", "| 方法 | 入口 | 入口保护 | 局部显式状态码 | 代码位置 |", "| --- | --- | --- | --- | --- |");
  for (const row of entries) output.push(`| ${row.method} | \`${row.route}\` | ${row.gate.replaceAll("|", "\\|")} | ${row.codes} | [${row.line}](../${row.path}#L${row.line}) |`);
  output.push("");
}
writeFileSync(join(root, "docs/function-endpoints.generated.md"), output.join("\n"));
console.log(JSON.stringify({ endpoints: rows.length, files: groups.size, modules: Object.fromEntries([...groups].map(([path, entries]) => [path, entries.length])) }, null, 2));
