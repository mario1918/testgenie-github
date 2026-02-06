import { z } from "zod";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ENV_PATH = path.resolve(__dirname, "../../../.env");
dotenv.config({ path: ENV_PATH });

const AI_BE_HOST = process.env.AI_BE_HOST ?? process.env.HOST;
const AI_BE_PORT = process.env.AI_BE_PORT ?? process.env.PORT;
const AI_FRONTEND_PORT = process.env.AI_FRONTEND_PORT ?? process.env.FRONTEND_ORIGIN;

const envSchema = z.object({
  NODE_ENV: z.string().optional().default("development"),
  HOST: z.string().optional().default(AI_BE_HOST ?? "0.0.0.0"),
  PORT: z.coerce.number().int().positive().optional().default(AI_BE_PORT ? Number(AI_BE_PORT) : 4000),
  FRONTEND_ORIGIN: z.string().optional().default(AI_FRONTEND_PORT ?? "http://localhost:5173"),

  JIRA_ZEPHYR_PORT: z.coerce.number().int().positive().optional().default(3006),

  JIRA_SPRINT_FIELD_ID: z.string().optional(),

  ZEPHYR_PRODUCT: z.string().optional(),
  ZEPHYR_BASE_URL: z.string().optional(),
  ZEPHYR_ACCESS_KEY: z.string().optional(),
  ZEPHYR_SECRET_KEY: z.string().optional(),
  ZEPHYR_TEST_CASE_FILTER: z.string().optional().default("fail").transform((v) => {
    const lower = String(v || "fail").trim().toLowerCase();
    return lower === "all" || lower === "pass" || lower === "fail" ? lower : "fail";
  }),

  API_KEY: z.string().min(1).optional(),

  REQUIRE_BEDROCK: z.coerce.boolean().optional().default(false),

  AI_PROVIDER: z.enum(["bedrock", "proxy"]).optional().default("bedrock"),
  AI_PROXY_URL: z.string().url().optional(),
  AI_PROXY_API_KEY: z.string().min(1).optional(),
  AI_PROXY_TIMEOUT_MS: z.coerce.number().int().positive().optional().default(60000),

  AWS_REGION: z.string().min(1).optional(),
  BEDROCK_MODEL_ID: z
    .string()
    .min(1)
    .optional()
    .default("us.anthropic.claude-3-7-sonnet-20250219-v1:0"),
  BEDROCK_TEMPERATURE: z.coerce.number().min(0).max(1).optional().default(0.4),
  BEDROCK_MAX_TOKENS: z.coerce.number().int().positive().optional().default(1400),

  JIRA_BASE_URL: z.string().url().optional(),
  JIRA_EMAIL: z.string().min(1).optional(),
  JIRA_API_TOKEN: z.string().min(1).optional(),
  JIRA_PROJECT_KEY: z.string().min(1).optional(),
  JIRA_PARENT_ISSUE_KEY: z.string().min(1).optional(),
  JIRA_LINK_TYPE: z.string().min(1).optional().default("Relates"),

  COMPONENT_ASSIGNEES: z.string().optional(),
  COMPONENT_ASSIGNEES_TS_OUT: z.string().optional().default("apps/ai-frontend/src/generated/componentAssignees.ts")
});

export const env = envSchema.parse(process.env);

function parseComponentAssigneesOrThrow(raw) {
  if (!raw) return { byAssignee: {}, byComponent: {} };

  const trimmed = String(raw).trim();
  if (!trimmed) return { byAssignee: {}, byComponent: {} };

  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch (e) {
    try {
      const envText = fs.readFileSync(ENV_PATH, "utf8");
      const m = envText.match(/^[ \t]*COMPONENT_ASSIGNEES[ \t]*=[ \t]*({[\s\S]*?})[ \t]*$/m);
      const extracted = m?.[1] ? String(m[1]).trim() : "";
      if (extracted) {
        parsed = JSON.parse(extracted);
      } else {
        throw new Error("COMPONENT_ASSIGNEES not found as a JSON block in .env");
      }
    } catch {
      throw new Error(
        "COMPONENT_ASSIGNEES must be valid JSON (example: {\"User\":[\"Component A\"]}). " +
          "Tip: in .env keep it on ONE line, or use a multi-line JSON block exactly like: COMPONENT_ASSIGNEES={...}"
      );
    }
  }

  const shape = z.record(z.string().min(1), z.array(z.string().min(1))).safeParse(parsed);
  if (!shape.success) {
    throw new Error("COMPONENT_ASSIGNEES must be a JSON object of { [assignee: string]: string[] }.");
  }

  const byAssignee = shape.data;
  const byComponent = {};
  const duplicates = [];

  for (const [assignee, components] of Object.entries(byAssignee)) {
    for (const c of components) {
      const component = String(c).trim();
      if (!component) continue;
      const prev = byComponent[component];
      if (prev && prev !== assignee) {
        duplicates.push({ component, assignees: [prev, assignee] });
        continue;
      }
      byComponent[component] = assignee;
    }
  }

  if (duplicates.length) {
    const lines = duplicates
      .map((d) => `- ${d.component}: ${d.assignees.join(" vs ")}`)
      .join("\n");
    throw new Error(`Duplicate component assignments found in COMPONENT_ASSIGNEES:\n${lines}`);
  }

  return { byAssignee, byComponent };
}

function toStableJson(value) {
  if (Array.isArray(value)) return `[${value.map((v) => toStableJson(v)).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${toStableJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function generateComponentAssigneesTs({ byAssignee, byComponent }) {
  const byAssigneeJson = toStableJson(byAssignee);
  const byComponentJson = toStableJson(byComponent);
  return [
    "export type ComponentAssigneesByAssignee = Record<string, string[]>;",
    "export type ComponentAssigneeLookup = Record<string, string>;",
    `export const COMPONENT_ASSIGNEES_BY_ASSIGNEE: ComponentAssigneesByAssignee = ${byAssigneeJson};`,
    `export const COMPONENT_ASSIGNEES_BY_COMPONENT: ComponentAssigneeLookup = ${byComponentJson};`,
    ""
  ].join("\n");
}

function writeTsConfigIfChanged({ outFileAbs, content }) {
  const dir = path.dirname(outFileAbs);
  fs.mkdirSync(dir, { recursive: true });

  const existing = fs.existsSync(outFileAbs) ? fs.readFileSync(outFileAbs, "utf8") : "";
  if (existing === content) return;
  fs.writeFileSync(outFileAbs, content, "utf8");
}

export const componentAssignees = parseComponentAssigneesOrThrow(env.COMPONENT_ASSIGNEES);
export const componentAssigneeLookup = componentAssignees.byComponent;

try {
  const repoRoot = path.resolve(__dirname, "../../../");
  const outAbs = path.resolve(repoRoot, env.COMPONENT_ASSIGNEES_TS_OUT);
  const ts = generateComponentAssigneesTs(componentAssignees);
  writeTsConfigIfChanged({ outFileAbs: outAbs, content: ts });
} catch (e) {
  throw new Error(`Failed to auto-generate TypeScript config for COMPONENT_ASSIGNEES: ${String(e?.message || e)}`);
}

export const capabilities = {
  bedrock: Boolean(env.AWS_REGION),
  proxy: Boolean(env.AI_PROVIDER === "proxy" && env.AI_PROXY_URL),
  ai: Boolean((env.AI_PROVIDER === "bedrock" && env.AWS_REGION) || (env.AI_PROVIDER === "proxy" && env.AI_PROXY_URL)),
  jira: Boolean(env.JIRA_BASE_URL && env.JIRA_EMAIL && env.JIRA_API_TOKEN && env.JIRA_PROJECT_KEY)
};
