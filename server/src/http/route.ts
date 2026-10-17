import { Router, type Request, type RequestHandler, type Response } from "express";
import { z } from "zod";
import { registry } from "./openapi.js";
import { forbidden, unauthorized, validationError } from "../lib/errors.js";
import type { Permission } from "../rbac/permissions.js";
import type { AuthUser } from "../middleware/auth.js";
import { withIdempotency } from "./idempotency.js";

type Method = "get" | "post" | "put" | "patch" | "delete";

/** public = anyone; auth = any signed-in staff; otherwise the permission(s) required (all of them). */
export type Access = "public" | "auth" | Permission | Permission[];

export interface Ctx<B, Q, P> {
  req: Request;
  res: Response;
  body: B;
  query: Q;
  params: P;
  /** Signed-in user; undefined only on public routes. */
  user: AuthUser;
  ip: string;
}

export interface RouteDef<B extends z.ZodType, Q extends z.ZodType, P extends z.ZodType> {
  method: Method;
  path: string;
  summary: string;
  description?: string;
  access: Access;
  body?: B;
  query?: Q;
  params?: P;
  /** Honour the Idempotency-Key header (replays the first response for the same key). */
  idempotent?: boolean;
  middleware?: RequestHandler[];
  /** Handler streams/sends the response itself (files, redirects). */
  raw?: boolean;
  status?: number;
  handler: (ctx: Ctx<z.infer<B>, z.infer<Q>, z.infer<P>>) => Promise<unknown> | unknown;
}

/** Wraps list results so the envelope gets `meta` (pagination, totals). */
export class WithMeta<T> {
  constructor(
    public data: T,
    public meta: Record<string, unknown>,
  ) {}
}
export const withMeta = <T>(data: T, meta: Record<string, unknown>) => new WithMeta(data, meta);

const toOpenApiPath = (path: string) => path.replace(/:([A-Za-z0-9_]+)/g, "{$1}");

export function hasPermission(user: AuthUser | undefined, access: Access): boolean {
  if (access === "public") return true;
  if (!user) return false;
  if (access === "auth") return true;
  const needed = Array.isArray(access) ? access : [access];
  return needed.every((p) => user.permissions.has(p));
}

function parse<T extends z.ZodType>(schema: T | undefined, value: unknown, where: string): z.infer<T> {
  if (!schema) return value as z.infer<T>;
  const result = schema.safeParse(value ?? {});
  if (!result.success) {
    throw validationError(
      result.error.issues.map((i) => ({ in: where, path: i.path.join("."), message: i.message })),
    );
  }
  return result.data;
}

export function createModule(basePath: string, tag: string) {
  const router = Router();

  function route<B extends z.ZodType = z.ZodType, Q extends z.ZodType = z.ZodType, P extends z.ZodType = z.ZodType>(
    def: RouteDef<B, Q, P>,
  ) {
    const fullPath = `${basePath}${def.path === "/" ? "" : def.path}`;
    const permissionNote =
      def.access === "public"
        ? "Public."
        : def.access === "auth"
          ? "Any signed-in user."
          : `Requires: ${(Array.isArray(def.access) ? def.access : [def.access]).join(", ")}.`;

    registry.registerPath({
      method: def.method,
      path: toOpenApiPath(fullPath || "/"),
      tags: [tag],
      summary: def.summary,
      description: [def.description, permissionNote, def.idempotent ? "Supports the Idempotency-Key header." : ""]
        .filter(Boolean)
        .join("\n\n"),
      ...(def.access === "public" ? { security: [] } : {}),
      request: {
        ...(def.params ? { params: def.params as never } : {}),
        ...(def.query ? { query: def.query as never } : {}),
        ...(def.body ? { body: { content: { "application/json": { schema: def.body } } } } : {}),
      },
      responses: {
        [def.status ?? 200]: { description: "Success" },
        401: { description: "Not signed in" },
        403: { description: "Missing permission" },
        422: { description: "Validation error" },
      },
    });

    const handler: RequestHandler = async (req, res, next) => {
      try {
        const user = req.user;
        if (def.access !== "public" && !user) throw unauthorized();
        if (!hasPermission(user, def.access)) throw forbidden();

        const ctx: Ctx<z.infer<B>, z.infer<Q>, z.infer<P>> = {
          req,
          res,
          body: parse(def.body, req.body, "body"),
          query: parse(def.query, req.query, "query"),
          params: parse(def.params, req.params, "params"),
          user: user as AuthUser,
          ip: req.ip ?? "",
        };

        const run = async () => {
          const result = await def.handler(ctx);
          if (result instanceof WithMeta) return { success: true, data: result.data, meta: result.meta };
          return { success: true, data: result ?? null };
        };

        if (def.raw) {
          await def.handler(ctx);
          return;
        }
        const status = def.status ?? 200;
        const payload = def.idempotent ? await withIdempotency(req, status, run) : { status, body: await run() };
        res.status(payload.status).json(payload.body);
      } catch (err) {
        next(err);
      }
    };

    router[def.method](def.path, ...(def.middleware ?? []), handler);
  }

  return { router, route, basePath };
}

export type Module = ReturnType<typeof createModule>;

// Common reusable schemas
export const idParam = z.object({ id: z.string().min(1) });
export const pageQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
});
export const dateRangeQuery = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
export const moneySchema = z.union([z.number(), z.string().regex(/^-?\d+(\.\d{1,2})?$/)]).transform(String);
export const csvList = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((v) => (v === undefined ? undefined : (Array.isArray(v) ? v : v.split(",")).map((s) => s.trim()).filter(Boolean)));

export const pageMeta = (page: number, pageSize: number, total: number) => ({
  page,
  pageSize,
  total,
  totalPages: Math.max(1, Math.ceil(total / pageSize)),
});
