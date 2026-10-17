import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { hashPassword } from "../src/modules/auth/auth.service.js";

export const app = createApp();
export const api = request(app);

let counter = 0;
const uid = () => `${Date.now().toString(36)}${(counter++).toString(36)}`;

/** Create a staff user with the given role keys and return a bearer-authenticated client. */
export async function staff(roleKeys: string[], password = "Passw0rd!") {
  const email = `user-${uid()}@test.local`;
  const roles = await prisma.role.findMany({ where: { key: { in: roleKeys } } });
  const user = await prisma.user.create({
    data: {
      email,
      name: `Test ${roleKeys.join("+")}`,
      passwordHash: await hashPassword(password),
      roles: { create: roles.map((r) => ({ roleId: r.id })) },
    },
  });
  const res = await api.post("/api/v1/auth/login").send({ email, password });
  if (res.status !== 200) throw new Error(`login failed: ${JSON.stringify(res.body)}`);
  const token = res.body.data.token as string;
  const auth = (r: request.Test) => r.set("Authorization", `Bearer ${token}`);
  return {
    user,
    email,
    password,
    token,
    get: (url: string) => auth(api.get(url)),
    post: (url: string, body?: object) => auth(api.post(url)).send(body ?? {}),
    put: (url: string, body?: object) => auth(api.put(url)).send(body ?? {}),
    patch: (url: string, body?: object) => auth(api.patch(url)).send(body ?? {}),
    delete: (url: string) => auth(api.delete(url)),
  };
}
export type Client = Awaited<ReturnType<typeof staff>>;

export const unique = uid;
