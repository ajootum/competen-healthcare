import { z } from "zod";
import { CONTRACT_VERSION } from "../core/contracts";
import { SCOPES } from "../core/oauth";
import type { Route } from "./routes";

// LIFEOS-API-001 section 6. Generated from the route table, so it cannot describe an endpoint that does not exist.

const ERROR_SCHEMA = {
  type: "object",
  required: ["error"],
  properties: {
    error: {
      type: "object",
      required: ["code", "message", "traceId"],
      properties: { code: { type: "string" }, message: { type: "string" }, details: {}, traceId: { type: "string" } },
    },
  },
};

const jsonSchema = (schema: z.ZodType) => z.toJSONSchema(schema, { unrepresentable: "any", io: "input" });

const QUERY_PARAMS = [
  { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 200 } },
  { name: "cursor", in: "query", schema: { type: "string" } },
  { name: "includeArchived", in: "query", schema: { type: "boolean" } },
  { name: "status", in: "query", schema: { type: "string" } },
];

export function buildOpenApi(routes: Route[], only?: "public") {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const r of routes) {
    if (only && r.visibility !== only) continue;
    const path = r.path.replace(/:([a-z]+)/g, "{$1}");
    const pathParams = [...r.path.matchAll(/:([a-z]+)/g)].map(m => ({ name: m[1], in: "path", required: true, schema: { type: "string", format: "uuid" } }));
    const isWrite = r.method !== "GET";
    const output = (only && r.publicOutput) || r.output;
    const headers = isWrite ? [{ name: "Idempotency-Key", in: "header", required: true, schema: { type: "string", maxLength: 255 } }] : [];
    paths[path] ??= {};
    paths[path][r.method.toLowerCase()] = {
      summary: r.summary,
      "x-lifeos-visibility": r.visibility,
      "x-lifeos-scope": r.scope,
      "x-lifeos-rate-bucket": r.bucket,
      parameters: [...pathParams, ...headers, ...(r.list ? QUERY_PARAMS : [])],
      ...(r.input ? { requestBody: { required: true, content: { "application/json": { schema: jsonSchema(r.input) } } } } : {}),
      responses: {
        "2XX": {
          description: "Success",
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["data", "meta"],
                properties: {
                  data: r.list ? { type: "array", items: jsonSchema(output) } : jsonSchema(output),
                  meta: { type: "object", properties: { traceId: { type: "string" }, nextCursor: { type: ["string", "null"] }, replayed: { type: "boolean" } } },
                },
              },
            },
          },
        },
        default: { description: "Error", content: { "application/json": { schema: ERROR_SCHEMA } } },
      },
    };
  }
  return {
    openapi: "3.1.0",
    info: {
      title: "LifeOS API",
      version: `1.${CONTRACT_VERSION}.0`,
      description: only === "public"
        ? "LifeOS public API. Access is user-delegated with OAuth 2.1 and PKCE: an app acts for one person, within the scopes they approved, until they revoke it. There is no master API key."
        : "LifeOS Core and Commitment Engine, internal routes.",
    },
    servers: [{ url: "/api/lifeos/v1" }],
    security: only === "public" ? [{ oauth: [] }] : [{ session: [] }],
    components: {
      securitySchemes: only === "public"
        ? { oauth: { type: "oauth2", flows: { authorizationCode: { authorizationUrl: "/lifeos/authorize", tokenUrl: "/api/lifeos/v1/oauth/token", scopes: SCOPES } } } }
        : { session: { type: "apiKey", in: "cookie", name: "sb-<project-ref>-auth-token" } },
    },
    paths,
  };
}
