import { describe, expect, it } from "vitest";
import { generate } from "otplib";
import { api, staff } from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";
import { outbox } from "../src/lib/mailer.js";
import { MAX_FAILED_LOGINS } from "../src/modules/auth/auth.service.js";

describe("authentication", () => {
  it("logs in, returns profile with permissions, and logs out", async () => {
    const admin = await staff(["admin"]);
    const me = await admin.get("/api/v1/auth/me");
    expect(me.status).toBe(200);
    expect(me.body.data.email).toBe(admin.email);
    expect(me.body.data.permissions).toContain("orders.view");
    expect(me.body.data.permissions).not.toContain("roles.manage"); // admin ≠ super admin
    expect(JSON.stringify(me.body)).not.toMatch(/passwordHash/);

    expect((await admin.post("/api/v1/auth/logout")).status).toBe(200);
    expect((await admin.get("/api/v1/auth/me")).status).toBe(401);
  });

  it("rejects bad credentials without revealing whether the email exists", async () => {
    const a = await api.post("/api/v1/auth/login").send({ email: "nobody@test.local", password: "x" });
    const u = await staff(["analyst"]);
    const b = await api.post("/api/v1/auth/login").send({ email: u.email, password: "wrong-password1" });
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.body.error.message).toBe(b.body.error.message);
    const history = await prisma.loginHistory.findFirst({ where: { email: u.email, success: false } });
    expect(history?.reason).toBe("bad_password");
  });

  it("locks the account after repeated failures", async () => {
    const u = await staff(["analyst"]);
    for (let i = 0; i < MAX_FAILED_LOGINS; i++) {
      await api.post("/api/v1/auth/login").send({ email: u.email, password: "wrong-password1" });
    }
    const locked = await api.post("/api/v1/auth/login").send({ email: u.email, password: u.password });
    expect(locked.status).toBe(423);
    expect(locked.body.error.code).toBe("ACCOUNT_LOCKED");
  });

  it("requires a CSRF token for cookie-authenticated writes", async () => {
    const u = await staff(["analyst"]);
    const login = await api.post("/api/v1/auth/login").send({ email: u.email, password: u.password });
    const cookies = login.headers["set-cookie"] as unknown as string[];
    const cookieHeader = cookies.map((c) => c.split(";")[0]).join("; ");
    const csrf = login.body.data.csrfToken;

    const without = await api.post("/api/v1/auth/logout").set("Cookie", cookieHeader);
    expect(without.status).toBe(403);
    expect(without.body.error.code).toBe("CSRF_FAILED");

    const withToken = await api.post("/api/v1/auth/logout").set("Cookie", cookieHeader).set("x-csrf-token", csrf);
    expect(withToken.status).toBe(200);
  });

  it("supports TOTP two-factor login", async () => {
    const u = await staff(["analyst"]);
    const setup = await u.post("/api/v1/auth/2fa/setup");
    expect(setup.status).toBe(200);
    const secret = setup.body.data.secret as string;
    expect((await u.post("/api/v1/auth/2fa/enable", { code: "000000" })).status).toBe(400);
    expect((await u.post("/api/v1/auth/2fa/enable", { code: await generate({ secret }) })).status).toBe(200);

    const step1 = await api.post("/api/v1/auth/login").send({ email: u.email, password: u.password });
    expect(step1.body.data.twoFactorRequired).toBe(true);
    expect(step1.body.data.token).toBeUndefined();
    const pending = (step1.headers["set-cookie"] as unknown as string[]).find((c) => c.startsWith("bb_2fa="))!.split(";")[0];

    const bad = await api.post("/api/v1/auth/2fa/verify").set("Cookie", pending).send({ code: "123456" });
    expect(bad.status).toBe(401);
    const ok = await api.post("/api/v1/auth/2fa/verify").set("Cookie", pending).send({ code: await generate({ secret }) });
    expect(ok.status).toBe(200);
    const me = await api.get("/api/v1/auth/me").set("Authorization", `Bearer ${ok.body.data.token}`);
    expect(me.status).toBe(200);
  });

  it("resets a password via emailed single-use token and revokes sessions", async () => {
    const u = await staff(["analyst"]);
    outbox.length = 0;
    expect((await api.post("/api/v1/auth/forgot-password").send({ email: u.email })).status).toBe(200);
    expect((await api.post("/api/v1/auth/forgot-password").send({ email: "ghost@test.local" })).status).toBe(200);
    expect(outbox).toHaveLength(1);
    const token = outbox[0].text.match(/token=([\w-]+)/)![1];

    expect((await api.post("/api/v1/auth/reset-password").send({ token, password: "short" })).status).toBe(422);
    expect((await api.post("/api/v1/auth/reset-password").send({ token, password: "NewPassw0rd" })).status).toBe(200);
    expect((await api.post("/api/v1/auth/reset-password").send({ token, password: "NewPassw0rd2" })).status).toBe(400);
    expect((await u.get("/api/v1/auth/me")).status).toBe(401); // old session revoked
    const relogin = await api.post("/api/v1/auth/login").send({ email: u.email, password: "NewPassw0rd" });
    expect(relogin.status).toBe(200);
  });

  it("lists and revokes own sessions", async () => {
    const u = await staff(["analyst"]);
    const list = await u.get("/api/v1/auth/sessions");
    expect(list.body.data.some((s: { current: boolean }) => s.current)).toBe(true);
    const current = list.body.data.find((s: { current: boolean; id: string }) => s.current);
    expect((await u.delete(`/api/v1/auth/sessions/${current.id}`)).status).toBe(200);
    expect((await u.get("/api/v1/auth/me")).status).toBe(401);
  });
});

describe("role-based access control", () => {
  it("enforces permissions on the backend", async () => {
    const analyst = await staff(["analyst"]);
    expect((await analyst.get("/api/v1/users")).status).toBe(403);
    expect((await analyst.post("/api/v1/roles", { key: "x_role", name: "X", permissions: [] })).status).toBe(403);
    expect((await api.get("/api/v1/users")).status).toBe(401);
  });

  it("lets a super admin create a custom role and assign it", async () => {
    const sa = await staff(["super_admin"]);
    const role = await sa.post("/api/v1/roles", { key: `packer_${Date.now()}`, name: "Packer", permissions: ["orders.view", "inventory.view"] });
    expect(role.status).toBe(201);
    expect(role.body.data.permissions).toEqual(["inventory.view", "orders.view"]);

    const created = await sa.post("/api/v1/users", { email: `packer${Date.now()}@test.local`, name: "Packer One", password: "Passw0rd!", roleIds: [role.body.data.id] });
    expect(created.status).toBe(201);
    const login = await api.post("/api/v1/auth/login").send({ email: created.body.data.email, password: "Passw0rd!" });
    const me = await api.get("/api/v1/auth/me").set("Authorization", `Bearer ${login.body.data.token}`);
    expect(me.body.data.permissions).toEqual(["inventory.view", "orders.view"]);

    const audit = await sa.get(`/api/v1/audit-logs?entityType=Role&entityId=${role.body.data.id}`);
    expect(audit.body.data[0].action).toBe("role.created");
  });

  it("prevents a non-super admin from granting super admin", async () => {
    const admin = await staff(["admin"]);
    const superRole = await prisma.role.findUniqueOrThrow({ where: { key: "super_admin" } });
    const res = await admin.post("/api/v1/users", { email: `x${Date.now()}@test.local`, name: "Escalate", password: "Passw0rd!", roleIds: [superRole.id] });
    expect(res.status).toBe(403);
  });

  it("revokes sessions when a user is disabled", async () => {
    const admin = await staff(["admin"]);
    const victim = await staff(["analyst"]);
    const r = await admin.patch(`/api/v1/users/${victim.user.id}`, { status: "DISABLED" });
    expect(r.status).toBe(200);
    expect((await victim.get("/api/v1/auth/me")).status).toBe(401);
    const login = await api.post("/api/v1/auth/login").send({ email: victim.email, password: victim.password });
    expect(login.status).toBe(403);
  });

  it("validates request bodies with field-level errors", async () => {
    const sa = await staff(["super_admin"]);
    const res = await sa.post("/api/v1/users", { email: "not-an-email", name: "A", password: "x", roleIds: [] });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(res.body.error.details.map((d: { path: string }) => d.path)).toEqual(expect.arrayContaining(["email", "name", "roleIds"]));
  });
});

describe("platform", () => {
  it("serves health and OpenAPI docs", async () => {
    expect((await api.get("/api/v1/health")).body.data.db).toBe("ok");
    const doc = await api.get("/api/v1/openapi.json");
    expect(doc.body.paths["/auth/login"]).toBeDefined();
  });
});
