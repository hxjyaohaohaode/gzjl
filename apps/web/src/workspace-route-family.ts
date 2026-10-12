/** Related views retain navigation, scroll position and local editor state. */
export function workspaceRouteFamily(pathname: string): string {
  if (pathname === "/ai" || pathname.startsWith("/ai/reports") || pathname === "/ai/compose") return "/ai";
  if (pathname === "/payroll" || pathname.startsWith("/payroll/")) return "/payroll";
  if (pathname === "/payroll-management" || pathname.startsWith("/payroll-management/")) return "/payroll-management";
  if (pathname === "/approvals" || pathname.startsWith("/approvals/")) return "/approvals";
  return pathname;
}
