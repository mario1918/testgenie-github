import { z } from "zod";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

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
  JIRA_LINK_TYPE: z.string().min(1).optional().default("Relates")
});

export const env = envSchema.parse(process.env);

export const capabilities = {
  bedrock: Boolean(env.AWS_REGION),
  proxy: Boolean(env.AI_PROVIDER === "proxy" && env.AI_PROXY_URL),
  ai: Boolean((env.AI_PROVIDER === "bedrock" && env.AWS_REGION) || (env.AI_PROVIDER === "proxy" && env.AI_PROXY_URL)),
  jira: Boolean(env.JIRA_BASE_URL && env.JIRA_EMAIL && env.JIRA_API_TOKEN && env.JIRA_PROJECT_KEY)
};
