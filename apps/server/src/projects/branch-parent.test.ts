import { describe, expect, it } from "vitest";

import {
  assertValidBranchParent,
  ProjectTreeValidationError,
} from "./service.js";

const activeBranches = [
  { id: "main", parentBranchId: null },
  { id: "design", parentBranchId: "main" },
  { id: "frontend", parentBranchId: "design" },
];

describe("project branch parent validation", () => {
  it("allows moving a non-default branch to another active branch", () => {
    expect(() =>
      assertValidBranchParent({
        branchId: "frontend",
        isDefault: false,
        parentBranchId: "main",
        activeBranches,
      }),
    ).not.toThrow();
  });

  it("rejects moving the default branch below another branch", () => {
    expect(() =>
      assertValidBranchParent({
        branchId: "main",
        isDefault: true,
        parentBranchId: "design",
        activeBranches,
      }),
    ).toThrowError(new ProjectTreeValidationError("主线必须保留在项目根级。"));
  });

  it("rejects direct and transitive branch cycles", () => {
    expect(() =>
      assertValidBranchParent({
        branchId: "design",
        isDefault: false,
        parentBranchId: "design",
        activeBranches,
      }),
    ).toThrowError("分支不能挂载到自身。");

    expect(() =>
      assertValidBranchParent({
        branchId: "design",
        isDefault: false,
        parentBranchId: "frontend",
        activeBranches,
      }),
    ).toThrowError("移动会造成分支层级循环。");
  });

  it("rejects missing or archived parent branches", () => {
    expect(() =>
      assertValidBranchParent({
        branchId: "frontend",
        isDefault: false,
        parentBranchId: "archived",
        activeBranches,
      }),
    ).toThrowError("目标父分支不属于当前项目或已归档。");
  });
});
