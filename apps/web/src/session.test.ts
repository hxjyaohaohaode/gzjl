/** @vitest-environment jsdom */
import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, notifySessionChanged } from "./api.js";
import type * as ApiModule from "./api.js";
import { endCurrentSession } from "./session.js";

vi.mock("./api.js", async (importOriginal) => ({
  ...await importOriginal<typeof ApiModule>(),
  api: vi.fn(),
  notifySessionChanged: vi.fn(),
}));
vi.mock("./push-client.js", () => ({ detachCurrentBrowserPushBeforeLogout: vi.fn(async () => undefined) }));
afterEach(() => vi.clearAllMocks());

describe("confirmed session termination", () => {
  it("keeps the current identity and drafts when logout cannot be confirmed", async () => {
    const client = new QueryClient();
    const member = { user: { membershipId: "first" } };
    client.setQueryData(["me"], member);
    client.setQueryData(["work-sessions"], { items: ["draft"] });
    vi.mocked(api).mockRejectedValueOnce(new ApiError(503, "unavailable", "Unavailable"));
    await expect(endCurrentSession(client)).rejects.toThrow("尚未确认退出成功");
    expect(client.getQueryData(["me"])).toEqual(member);
    expect(client.getQueryData(["work-sessions"])).toEqual({ items: ["draft"] });
    expect(notifySessionChanged).not.toHaveBeenCalled();
    client.clear();
  });

  it("lets an already expired session finish logout", async () => {
    const client = new QueryClient();
    client.setQueryData(["me"], { user: { membershipId: "first" } });
    client.setQueryData(["payroll"], { amount: "100" });
    vi.mocked(api).mockRejectedValueOnce(new ApiError(401, "unauthorized", "Expired"));
    await endCurrentSession(client);
    expect(client.getQueryData(["me"])).toBeNull();
    expect(client.getQueryData(["payroll"])).toBeUndefined();
    expect(notifySessionChanged).toHaveBeenCalledOnce();
    client.clear();
  });

  it("prevents an in-flight identity response from signing the user back in", async () => {
    const client = new QueryClient();
    const member = { user: { membershipId: "first" } };
    client.setQueryData(["me"], member);
    let release!: (value: typeof member) => void;
    const pending = client.fetchQuery({ queryKey: ["me"], queryFn: () => new Promise<typeof member>((resolve) => { release = resolve; }) }).catch(() => undefined);
    vi.mocked(api).mockResolvedValueOnce(undefined);
    await endCurrentSession(client);
    release(member);
    await pending;
    expect(client.getQueryData(["me"])).toBeNull();
    expect(notifySessionChanged).toHaveBeenCalledOnce();
    client.clear();
  });
});
