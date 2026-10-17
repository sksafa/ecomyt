import { z } from "zod";
import { extendZodWithOpenApi, OpenAPIRegistry, OpenApiGeneratorV31 } from "@asteasolutions/zod-to-openapi";

extendZodWithOpenApi(z);

export const registry = new OpenAPIRegistry();

registry.registerComponent("securitySchemes", "sessionCookie", {
  type: "apiKey",
  in: "cookie",
  name: "bb_session",
  description: "Session cookie set by POST /api/v1/auth/login. State-changing requests also need the x-csrf-token header.",
});
registry.registerComponent("securitySchemes", "bearer", {
  type: "http",
  scheme: "bearer",
  description: "Session token (same value as the cookie) for non-browser clients.",
});

export function buildOpenApiDocument() {
  return new OpenApiGeneratorV31(registry.definitions).generateDocument({
    openapi: "3.1.0",
    info: {
      title: "Bent & Bound Management API",
      version: "1.0.0",
      description:
        "All responses use the envelope `{ success, data, meta? }` or `{ success: false, error: { code, message, details? } }`. " +
        "Money values are decimal strings in BDT. Dates are ISO-8601 UTC; business-day filters (`from`/`to`) are Asia/Dhaka dates.",
    },
    servers: [{ url: "/api/v1" }],
    security: [{ sessionCookie: [] }, { bearer: [] }],
  });
}
