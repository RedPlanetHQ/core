import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock env ────────────────────────────────────────────────────────────────
// We control the env object so tests can override individual vars.
const mockEnv = {
  COREBRAIN_DEFAULT_GATEWAY_URL: undefined as string | undefined,
  COREBRAIN_DEFAULT_GATEWAY_SECURITY_KEY: undefined as string | undefined,
  COREBRAIN_DEFAULT_GATEWAY_NAME: "local-gateway",
};

vi.mock("~/env.server", () => ({ env: mockEnv }));

// ── Mock registerGateway ────────────────────────────────────────────────────
const mockRegisterGateway = vi.fn();
vi.mock("../register.server", () => ({ registerGateway: mockRegisterGateway }));

// ── Mock logger ─────────────────────────────────────────────────────────────
const mockLogger = { warn: vi.fn(), info: vi.fn(), error: vi.fn() };
vi.mock("~/services/logger.service", () => ({ logger: mockLogger }));

// Import AFTER mocks are registered
import { maybeRegisterDefaultGateway } from "../default.server";

// ── Helpers ──────────────────────────────────────────────────────────────────
const WORKSPACE_ID = "ws-test-001";
const USER_ID = "user-test-001";
const GATEWAY_URL = "http://corebrain-gateway:7787";
const SECURITY_KEY = "test-security-key-32chars-minimum";

function callSubject() {
  return maybeRegisterDefaultGateway({ workspaceId: WORKSPACE_ID, userId: USER_ID });
}

describe("maybeRegisterDefaultGateway", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEnv.COREBRAIN_DEFAULT_GATEWAY_URL = undefined;
    mockEnv.COREBRAIN_DEFAULT_GATEWAY_SECURITY_KEY = undefined;
    mockEnv.COREBRAIN_DEFAULT_GATEWAY_NAME = "local-gateway";
  });

  // ── Guard conditions ───────────────────────────────────────────────────────

  it("returns without calling registerGateway when URL is not set", async () => {
    mockEnv.COREBRAIN_DEFAULT_GATEWAY_SECURITY_KEY = SECURITY_KEY;
    await callSubject();
    expect(mockRegisterGateway).not.toHaveBeenCalled();
  });

  it("returns without calling registerGateway when security key is not set", async () => {
    mockEnv.COREBRAIN_DEFAULT_GATEWAY_URL = GATEWAY_URL;
    await callSubject();
    expect(mockRegisterGateway).not.toHaveBeenCalled();
  });

  it("returns without calling registerGateway when both vars are absent", async () => {
    await callSubject();
    expect(mockRegisterGateway).not.toHaveBeenCalled();
  });

  it("returns without calling registerGateway when URL is empty string", async () => {
    mockEnv.COREBRAIN_DEFAULT_GATEWAY_URL = "";
    mockEnv.COREBRAIN_DEFAULT_GATEWAY_SECURITY_KEY = SECURITY_KEY;
    await callSubject();
    expect(mockRegisterGateway).not.toHaveBeenCalled();
  });

  it("returns without calling registerGateway when security key is empty string", async () => {
    mockEnv.COREBRAIN_DEFAULT_GATEWAY_URL = GATEWAY_URL;
    mockEnv.COREBRAIN_DEFAULT_GATEWAY_SECURITY_KEY = "";
    await callSubject();
    expect(mockRegisterGateway).not.toHaveBeenCalled();
  });

  // ── Successful registration ────────────────────────────────────────────────

  it("calls registerGateway with correct args when both env vars are set", async () => {
    mockEnv.COREBRAIN_DEFAULT_GATEWAY_URL = GATEWAY_URL;
    mockEnv.COREBRAIN_DEFAULT_GATEWAY_SECURITY_KEY = SECURITY_KEY;
    mockRegisterGateway.mockResolvedValue({ ok: true, gatewayId: "gw-123" });

    await callSubject();

    expect(mockRegisterGateway).toHaveBeenCalledOnce();
    expect(mockRegisterGateway).toHaveBeenCalledWith({
      baseUrl: GATEWAY_URL,
      securityKey: SECURITY_KEY,
      name: "local-gateway",
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
    });
  });

  it("uses COREBRAIN_DEFAULT_GATEWAY_NAME from env", async () => {
    mockEnv.COREBRAIN_DEFAULT_GATEWAY_URL = GATEWAY_URL;
    mockEnv.COREBRAIN_DEFAULT_GATEWAY_SECURITY_KEY = SECURITY_KEY;
    mockEnv.COREBRAIN_DEFAULT_GATEWAY_NAME = "my-custom-gateway";
    mockRegisterGateway.mockResolvedValue({ ok: true, gatewayId: "gw-456" });

    await callSubject();

    expect(mockRegisterGateway).toHaveBeenCalledWith(
      expect.objectContaining({ name: "my-custom-gateway" }),
    );
  });

  it("logs info on successful registration", async () => {
    mockEnv.COREBRAIN_DEFAULT_GATEWAY_URL = GATEWAY_URL;
    mockEnv.COREBRAIN_DEFAULT_GATEWAY_SECURITY_KEY = SECURITY_KEY;
    mockRegisterGateway.mockResolvedValue({ ok: true, gatewayId: "gw-789" });

    await callSubject();

    expect(mockLogger.info).toHaveBeenCalledOnce();
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.stringContaining("[default-gateway]"),
    );
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });

  // ── Failed registration ────────────────────────────────────────────────────

  it("logs warn and does not throw when registerGateway returns ok: false", async () => {
    mockEnv.COREBRAIN_DEFAULT_GATEWAY_URL = GATEWAY_URL;
    mockEnv.COREBRAIN_DEFAULT_GATEWAY_SECURITY_KEY = SECURITY_KEY;
    mockRegisterGateway.mockResolvedValue({ ok: false, error: "gateway unreachable" });

    await expect(callSubject()).resolves.toBeUndefined();

    expect(mockLogger.warn).toHaveBeenCalledOnce();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining("[default-gateway]"),
    );
    expect(mockLogger.info).not.toHaveBeenCalled();
  });

  it("includes the error message in the warn log", async () => {
    mockEnv.COREBRAIN_DEFAULT_GATEWAY_URL = GATEWAY_URL;
    mockEnv.COREBRAIN_DEFAULT_GATEWAY_SECURITY_KEY = SECURITY_KEY;
    mockRegisterGateway.mockResolvedValue({ ok: false, error: "gateway unreachable" });

    await callSubject();

    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining("gateway unreachable"),
    );
  });

  // ── Error resilience ───────────────────────────────────────────────────────

  it("does not throw when registerGateway rejects", async () => {
    mockEnv.COREBRAIN_DEFAULT_GATEWAY_URL = GATEWAY_URL;
    mockEnv.COREBRAIN_DEFAULT_GATEWAY_SECURITY_KEY = SECURITY_KEY;
    mockRegisterGateway.mockRejectedValue(new Error("network timeout"));

    await expect(callSubject()).resolves.toBeUndefined();
  });

  it("logs warn (not re-throws) when registerGateway throws", async () => {
    mockEnv.COREBRAIN_DEFAULT_GATEWAY_URL = GATEWAY_URL;
    mockEnv.COREBRAIN_DEFAULT_GATEWAY_SECURITY_KEY = SECURITY_KEY;
    mockRegisterGateway.mockRejectedValue(new Error("network timeout"));

    await callSubject();

    expect(mockLogger.warn).toHaveBeenCalledOnce();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining("[default-gateway]"),
    );
  });

  // ── Idempotency (via registerGateway contract) ─────────────────────────────

  it("passes the same args on repeated calls (idempotency delegated to registerGateway)", async () => {
    mockEnv.COREBRAIN_DEFAULT_GATEWAY_URL = GATEWAY_URL;
    mockEnv.COREBRAIN_DEFAULT_GATEWAY_SECURITY_KEY = SECURITY_KEY;
    mockRegisterGateway.mockResolvedValue({ ok: true, gatewayId: "gw-123" });

    await callSubject();
    await callSubject();

    expect(mockRegisterGateway).toHaveBeenCalledTimes(2);
    expect(mockRegisterGateway).toHaveBeenNthCalledWith(1, {
      baseUrl: GATEWAY_URL,
      securityKey: SECURITY_KEY,
      name: "local-gateway",
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
    });
    expect(mockRegisterGateway).toHaveBeenNthCalledWith(2, {
      baseUrl: GATEWAY_URL,
      securityKey: SECURITY_KEY,
      name: "local-gateway",
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
    });
  });
});
