import express from "express";
import cors from "cors";
import multer from "multer";
import { z } from "zod";

import { capabilities, env } from "./config.js";
import { generateBugReportWithClaude } from "./bedrock.js";
import { parseBugReportFromClaudeText } from "./parse.js";
import { attachFileToIssue, createJiraBug, linkIssueToParent, getProjectComponents, searchIssues, createJiraBugWithOptions, getAssignableUsers, getSprints, getPriorities } from "./jira.js";
import { JiraClient } from "./zephyr/jiraClient.js";
import { getZephyrAdapter } from "./zephyr/zephyrAdapter.js";

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled promise rejection", reason);
});

process.on("uncaughtException", (err) => {
  console.error("Uncaught exception", err);
});

const app = express();

app.use(express.json({ limit: "10mb" }));

app.use((err, req, res, next) => {
  if (err && err.type === "entity.parse.failed") {
    res.status(400).json({ error: "Invalid JSON body" });
    return;
  }
  next(err);
});

app.use(
  cors({
    origin: "*",
    credentials: false
  })
);

function createZephyrServicesOrThrow() {
  if (!env.JIRA_BASE_URL || !env.JIRA_EMAIL || !env.JIRA_API_TOKEN) {
    throw new Error("Jira is not configured for Zephyr APIs. Set JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN.");
  }

  const jira = new JiraClient({
    baseUrl: env.JIRA_BASE_URL,
    email: env.JIRA_EMAIL,
    apiToken: env.JIRA_API_TOKEN,
    sprintFieldId: env.JIRA_SPRINT_FIELD_ID
  });

  const zephyr = getZephyrAdapter({
    product: env.ZEPHYR_PRODUCT,
    baseUrl: env.ZEPHYR_BASE_URL,
    accessKey: env.ZEPHYR_ACCESS_KEY,
    secretKey: env.ZEPHYR_SECRET_KEY
  });

  return { jira, zephyr };
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/task/:issueKey", async (req, res) => {
  try {
    const { jira, zephyr } = createZephyrServicesOrThrow();

    const issueKey = z.string().min(1).parse(req.params.issueKey);
    if (!/^SE2-\d+$/i.test(issueKey)) {
      res
        .status(400)
        .json({ error: "This is not a correct issue key. Please use the format SE2-<digits> (example: SE2-123)." });
      return;
    }

    const issue = await jira.getIssue(issueKey);
    const linkedTests = await jira.getLinkedIssuesByType(issueKey, "Test");

    const mapWithConcurrency = async (items, limit, fn) => {
      const results = new Array(items.length);
      let nextIndex = 0;
      const worker = async () => {
        while (true) {
          const i = nextIndex++;
          if (i >= items.length) return;
          results[i] = await fn(items[i]);
        }
      };
      const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
      await Promise.all(workers);
      return results;
    };

    const testsWithStatus = await mapWithConcurrency(linkedTests, 6, async (t) => {
      const result = await zephyr.getTestStatus({ issueKey: t.key, issueId: t.id, projectId: t.projectId });
      return { key: t.key, summary: t.summary, zephyrStatus: result.status, zephyrError: result.error };
    });

    const failingTests = testsWithStatus.filter((t) => (t.zephyrStatus ?? "UNKNOWN") === "FAIL");

    const statusRank = {
      FAIL: 0,
      UNKNOWN: 1,
      PASS: 2
    };

    failingTests.sort((a, b) => {
      const ra = statusRank[a.zephyrStatus ?? "UNKNOWN"] ?? 99;
      const rb = statusRank[b.zephyrStatus ?? "UNKNOWN"] ?? 99;
      if (ra !== rb) return ra - rb;
      return String(a.key).localeCompare(String(b.key));
    });

    res.json({
      task: {
        key: issue.key,
        summary: issue.summary,
        components: issue.components ?? [],
        sprint: issue.sprint ?? null,
        assignee: issue.assignee ?? null,
        parent: issue.parent ?? null
      },
      meta: {
        linkedTestsCount: linkedTests.length,
        failingTestsCount: failingTests.length
      },
      tests: failingTests
    });
  } catch (err) {
    const raw = String(err?.message ?? "");
    const issueKey = String(req.params.issueKey ?? "");
    if (raw.includes("404") && raw.includes("Issue does not exist or you do not have permission to see it")) {
      res.status(404).json({ error: `Issue '${issueKey}' does not exist or you do not have permission to see it.` });
      return;
    }
    res.status(400).json({ error: err?.message ?? "Unknown error" });
  }
});

app.get("/jira/priorities", async (req, res) => {
  try {
    if (!capabilities.jira) {
      res.status(400).json({ error: "Jira is not configured" });
      return;
    }

    const query = String(req.query?.q || "").trim().toLowerCase();
    const priorities = await getPriorities();
    const filtered = query ? priorities.filter((p) => p.name.toLowerCase().includes(query)) : priorities;
    res.json({ priorities: filtered });
  } catch (err) {
    console.error("/jira/priorities failed", err?.message);
    res.status(500).json({ error: "Failed to fetch priorities" });
  }
});

app.get("/api/test/:issueKey/steps", async (req, res) => {
  try {
    const { jira, zephyr } = createZephyrServicesOrThrow();

    const issueKey = z.string().min(1).parse(req.params.issueKey);
    if (!/^SE2-\d+$/i.test(issueKey)) {
      res
        .status(400)
        .json({ error: "This is not a correct issue key. Please use the format SE2-<digits> (example: SE2-123)." });
      return;
    }

    const full = await jira.getIssue(issueKey);
    const steps = await zephyr.getTestSteps({ issueKey: full.key, issueId: full.id, projectId: full.projectId });
    res.json({ steps });
  } catch (err) {
    const raw = String(err?.message ?? "");
    const issueKey = String(req.params.issueKey ?? "");
    if (raw.includes("404") && raw.includes("Issue does not exist or you do not have permission to see it")) {
      res.status(404).json({ error: `Issue '${issueKey}' does not exist or you do not have permission to see it.` });
      return;
    }
    res.status(400).json({ error: err?.message ?? "Unknown error" });
  }
});

app.post("/api/ai/bug-prompt", async (req, res) => {
  try {
    const { jira, zephyr } = createZephyrServicesOrThrow();

    const bodySchema = z.object({
      taskKey: z.string().min(1),
      testKey: z.string().min(1)
    });
    const body = bodySchema.parse(req.body);

    if (!/^SE2-\d+$/i.test(body.taskKey) || !/^SE2-\d+$/i.test(body.testKey)) {
      res
        .status(400)
        .json({ error: "This is not a correct issue key. Please use the format SE2-<digits> (example: SE2-123)." });
      return;
    }

    const task = await jira.getIssue(body.taskKey);
    const test = await jira.getIssue(body.testKey);
    const steps = await zephyr.getTestSteps({ issueKey: test.key, issueId: test.id, projectId: test.projectId });

    const stepLines = [];
    for (const s of Array.isArray(steps) ? steps : []) {
      const raw = s?.raw ?? {};
      const teststep = raw?.teststep ?? {};
      const stepText = teststep.step ?? teststep.description ?? s?.step ?? "";
      const cleaned = String(stepText || "").trim();
      if (cleaned) stepLines.push(cleaned);
    }

    const parentIssueId = task.parent?.key ? String(task.parent.key) : "-";
    const component = Array.isArray(task.components) && task.components.length ? task.components.join(", ") : "-";
    const sprint = task.sprint?.name ? String(task.sprint.name) : "-";

    const prompt = [
      "Input Data:",
      `- Test Case Summary:`,
      `${test.summary || "-"}`,
      "- Test Case Steps:",
      `${stepLines.length ? stepLines.map((l, i) => `${i + 1}. ${l}`).join("\n") : "-"}`
    ].join("\n");

    res.json({
      prompt,
      fields: {
        taskKey: task.key,
        testKey: test.key,
        testCaseSummary: test.summary || "-",
        testCaseSteps: stepLines,
        parentIssueId,
        component,
        sprint
      }
    });
  } catch (err) {
    const raw = String(err?.message ?? "");
    const taskKey = String(req.body?.taskKey ?? "");
    const testKey = String(req.body?.testKey ?? "");
    if (raw.includes("404") && raw.includes("Issue does not exist or you do not have permission to see it")) {
      res
        .status(404)
        .json({ error: `Issue '${taskKey || testKey}' does not exist or you do not have permission to see it.` });
      return;
    }
    res.status(400).json({ error: err?.message ?? "Unknown error" });
  }
});

app.post("/api/bug", async (req, res) => {
  try {
    const { jira } = createZephyrServicesOrThrow();

    const bodySchema = z.object({
      taskKey: z.string().min(1),
      selectedTestKeys: z.array(z.string().min(1)).min(1),
      bugSummary: z.string().min(1).optional(),
      bugDescription: z.string().min(1).optional()
    });

    const body = bodySchema.parse(req.body);

    const task = await jira.getIssue(body.taskKey);
    const selectedTests = await Promise.all(body.selectedTestKeys.map((k) => jira.getIssue(k)));

    const summary =
      body.bugSummary ?? `Failing tests for ${task.key}: ${selectedTests.map((t) => t.key).join(", ")}`;

    const description =
      body.bugDescription ??
      [
        `Task: ${task.key} - ${task.summary}`,
        "",
        "Failing/selected tests:",
        ...selectedTests.map((t) => `- ${t.key} - ${t.summary}`)
      ].join("\n");

    const projectKey = String(task.key || "").split("-")[0] || "";
    if (!projectKey) {
      res.status(400).json({ error: "Could not infer Jira project key from task key." });
      return;
    }

    const bugKey = await jira.createBug({
      projectKey,
      issueTypeName: "Bug",
      summary,
      description
    });

    const linkType = env.JIRA_LINK_TYPE || "Relates";
    await jira.linkIssues(task.key, bugKey, linkType);
    await Promise.all(selectedTests.map((t) => jira.linkIssues(t.key, bugKey, linkType)));

    res.json({ bugKey });
  } catch (err) {
    res.status(400).json({ error: err?.message ?? "Unknown error" });
  }
});

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

app.get("/status", (req, res) => {
  res.json({
    ok: true,
    capabilities,
    requireBedrock: env.REQUIRE_BEDROCK,
    bedrockModelId: env.BEDROCK_MODEL_ID,
    aiProvider: env.AI_PROVIDER,
    aiProxyUrl: env.AI_PROVIDER === "proxy" ? env.AI_PROXY_URL : undefined
  });
});

function extractBearerToken(authHeader) {
  if (!authHeader) return null;
  const m = String(authHeader).match(/^Bearer\s+(.+)$/i);
  return m?.[1] || null;
}

function requireApiKeyIfConfigured(req, res) {
  if (!env.API_KEY) return true;
  const token = extractBearerToken(req.headers.authorization);
  if (!token || token !== env.API_KEY) {
    res.status(401).json({ error: "Unauthorized" });
    return false;
  }
  return true;
}

const chatRequestSchema = z.object({
  model: z.string().min(1).optional(),
  messages: z.array(
    z.object({
      role: z.enum(["system", "user", "assistant"]),
      content: z.union([
        z.string(),
        z.array(
          z.object({
            type: z.string().optional(),
            text: z.string().optional()
          })
        )
      ])
    })
  ),
  temperature: z.number().min(0).max(1).optional(),
  max_tokens: z.number().int().positive().optional()
});

function messageContentToText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((c) => (typeof c?.text === "string" ? c.text : ""))
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

async function invokeBedrockChat({ modelId, temperature, maxTokens, system, messages }) {
  const contentMessages = messages.map((m) => ({
    role: m.role,
    content: [{ type: "text", text: messageContentToText(m.content) }]
  }));

  const body = {
    anthropic_version: "bedrock-2023-05-31",
    system: system || undefined,
    max_tokens: maxTokens,
    temperature,
    messages: contentMessages
  };

  const { BedrockRuntimeClient, InvokeModelCommand } = await import("@aws-sdk/client-bedrock-runtime");
  const client = new BedrockRuntimeClient({ region: env.AWS_REGION });
  const cmd = new InvokeModelCommand({
    modelId: modelId,
    contentType: "application/json",
    accept: "application/json",
    body: new TextEncoder().encode(JSON.stringify(body))
  });

  const resp = await client.send(cmd);
  const raw = new TextDecoder().decode(resp.body);
  const parsed = JSON.parse(raw);
  const text = (parsed?.content || [])
    .filter((c) => c?.type === "text" && typeof c?.text === "string")
    .map((c) => c.text)
    .join("\n")
    .trim();

  return { parsed, text };
}

function buildProxyMessages(system, messages) {
  const proxyMessages = [];
  if (system) {
    proxyMessages.push({ role: "system", content: system });
  }
  messages.forEach((m) => {
    if (Array.isArray(m.content)) {
      proxyMessages.push({ role: m.role, content: m.content });
    } else {
      proxyMessages.push({ role: m.role, content: messageContentToText(m.content) });
    }
  });
  return proxyMessages;
}

async function invokeProxyChat({ modelId, temperature, maxTokens, system, messages }) {
  if (!env.AI_PROXY_URL) {
    throw new Error("AI proxy is not configured. Set AI_PROXY_URL.");
  }

  const proxyMessages = buildProxyMessages(system, messages);

  const payload = {
    model: modelId,
    messages: proxyMessages,
    temperature,
    max_tokens: maxTokens
  };

  const headers = {
    "Content-Type": "application/json"
  };
  if (env.AI_PROXY_API_KEY) {
    headers.Authorization = `Bearer ${env.AI_PROXY_API_KEY}`;
  }

  console.log("Fetching AI proxy:", env.AI_PROXY_URL);
  const resp = await fetch(env.AI_PROXY_URL, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(env.AI_PROXY_TIMEOUT_MS)
  });

  console.log("AI proxy response status:", resp.status);
  const respText = await resp.text().catch(() => "");
  console.log("AI proxy response length:", respText.length);
  let json = null;
  try {
    json = respText ? JSON.parse(respText) : null;
  } catch {
    json = null;
  }

  if (!resp.ok) {
    const errDetail = json?.error ?? respText;
    const errMsg =
      typeof errDetail === "string" && errDetail.trim().length
        ? errDetail
        : errDetail
          ? JSON.stringify(errDetail)
          : "";
    throw new Error(errMsg || `AI proxy request failed (${resp.status})`);
  }

  if (json === null) {
    throw new Error("AI proxy returned a non-JSON response");
  }

  const text =
    json?.choices?.[0]?.message?.content ||
    json?.choices?.[0]?.text ||
    json?.output_text ||
    "";

  if (!text || typeof text !== "string") {
    throw new Error("AI proxy returned an unexpected response format");
  }

  return { parsed: json, text: text.trim() };
}

async function* invokeProxyChatStream({ modelId, temperature, maxTokens, system, messages }) {
  if (!env.AI_PROXY_URL) {
    throw new Error("AI proxy is not configured. Set AI_PROXY_URL.");
  }

  const proxyMessages = buildProxyMessages(system, messages);

  const payload = {
    model: modelId,
    messages: proxyMessages,
    temperature,
    max_tokens: maxTokens,
    stream: true
  };

  const headers = {
    "Content-Type": "application/json"
  };
  if (env.AI_PROXY_API_KEY) {
    headers.Authorization = `Bearer ${env.AI_PROXY_API_KEY}`;
  }

  console.log("Fetching AI proxy (streaming):", env.AI_PROXY_URL);
  const resp = await fetch(env.AI_PROXY_URL, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(env.AI_PROXY_TIMEOUT_MS)
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    throw new Error(errText || `AI proxy request failed (${resp.status})`);
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed === "data: [DONE]") continue;
      if (trimmed.startsWith("data: ")) {
        try {
          const json = JSON.parse(trimmed.slice(6));
          const delta = json?.choices?.[0]?.delta?.content;
          if (delta) {
            yield delta;
          }
        } catch {
          // ignore parse errors for malformed chunks
        }
      }
    }
  }

  // Process any remaining buffer
  if (buffer.trim() && buffer.trim() !== "data: [DONE]" && buffer.trim().startsWith("data: ")) {
    try {
      const json = JSON.parse(buffer.trim().slice(6));
      const delta = json?.choices?.[0]?.delta?.content;
      if (delta) {
        yield delta;
      }
    } catch {
      // ignore
    }
  }
}

app.post("/chat/completions", async (req, res) => {
  const started = Date.now();

  try {
    if (!requireApiKeyIfConfigured(req, res)) return;
    if (!capabilities.ai) {
      res.status(400).json({
        error:
          env.AI_PROVIDER === "proxy"
            ? "AI proxy is not configured. Set AI_PROXY_URL (and optionally AI_PROXY_API_KEY)."
            : "Bedrock is not configured. Set AWS_REGION and AWS credentials."
      });
      return;
    }

    const body = chatRequestSchema.parse(req.body);

    const system = body.messages
      .filter((m) => m.role === "system")
      .map((m) => messageContentToText(m.content))
      .filter(Boolean)
      .join("\n\n")
      .trim();

    const messages = body.messages
      .filter((m) => m.role !== "system")
      .map((m) => ({ role: m.role, content: m.content }));

    const modelId = body.model || env.BEDROCK_MODEL_ID;
    const temperature = body.temperature ?? env.BEDROCK_TEMPERATURE;
    const maxTokens = body.max_tokens ?? env.BEDROCK_MAX_TOKENS;

    const { parsed, text } =
      env.AI_PROVIDER === "proxy"
        ? await invokeProxyChat({
            modelId,
            temperature,
            maxTokens,
            system,
            messages
          })
        : await invokeBedrockChat({
            modelId,
            temperature,
            maxTokens,
            system,
            messages
          });

    res.json({
      id: `chatcmpl_${Math.random().toString(16).slice(2)}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: modelId,
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: text },
          finish_reason: "stop"
        }
      ],
      usage: {
        prompt_tokens: parsed?.usage?.input_tokens,
        completion_tokens: parsed?.usage?.output_tokens,
        total_tokens:
          typeof parsed?.usage?.input_tokens === "number" && typeof parsed?.usage?.output_tokens === "number"
            ? parsed.usage.input_tokens + parsed.usage.output_tokens
            : undefined
      }
    });
  } catch (err) {
    const status = err?.name === "ZodError" ? 400 : 500;

    console.error("/chat/completions failed", {
      status,
      durationMs: Date.now() - started,
      message: err?.message,
      stack: err?.stack
    });

    res.status(status).json({
      error: status === 400 ? "Invalid request" : "Internal server error",
      details: status === 400 ? err?.issues : undefined
    });
  }
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024
  }
});

const bugRequestSchema = z.object({
  description: z.string().min(5, "Description is required")
});

function mockReport(description) {
  const base = String(description || "").trim();
  const short = base.length > 80 ? `${base.slice(0, 77)}...` : base;

  return {
    title: short ? `Bug: ${short}` : "Bug: Unexpected behavior",
    stepsToReproduce: ["Open the affected screen/page", "Perform the action described", "Observe the issue"],
    expectedResult: "The application behaves as expected without errors.",
    actualResult: "The application shows incorrect behavior / error as described.",
    severity: "Major",
    priority: "High",
    component: "UI",
    environment: "Unknown"
  };
}

async function generateReport({ description, file, files, conversationHistory, previousReport }) {
  if (!capabilities.ai) {
    if (env.REQUIRE_BEDROCK) {
      throw new Error(
        env.AI_PROVIDER === "proxy"
          ? "AI proxy is required but not configured. Set AI_PROXY_URL."
          : "Bedrock is required but not configured. Set AWS_REGION and AWS credentials."
      );
    }
    return mockReport(description);
  }

  if (env.AI_PROVIDER === "proxy") {
    const allFiles = files && files.length > 0 ? files : (file ? [file] : []);
    const hasImage = allFiles.some(f => f?.buffer && f?.mimetype?.startsWith("image/"));
    const isFollowUp = conversationHistory && conversationHistory.length > 0;
    
    const system = `You are an expert senior QA engineer at SiliconExpert, a leading electronic component data and supply chain intelligence company. You write exceptionally detailed, professional Jira bug reports.
${isFollowUp ? `
**FOLLOW-UP MODE**: This is a follow-up request. The user has already generated a bug report and now wants to modify it.
- The previous bug report is provided in the conversation
- Apply the user's requested changes to the existing report
- Keep all unchanged fields the same
- Only modify what the user specifically asks to change
- Return the COMPLETE updated bug report in JSON format (not just the changes)
` : ""}
Company Context:
- Product: SiliconExpert platform
- Main URL: https://a-qa-my.siliconexpert.com/
- Other domains: siliconexpert.com, app.siliconexpert.com
- Key features: Part search, BOM management, lifecycle analysis, compliance data, supply chain risk monitoring, PCN/EOL alerts, affected facilities, event tracking
- Users: Engineers, procurement teams, supply chain managers
- Tech stack: Web application with REST APIs, Oracle database, microservices architecture

Your task: Generate an extremely detailed, well-organized Jira bug report.
${hasImage ? `
**IMPORTANT - IMAGE ANALYSIS**: The user has attached screenshot(s). Carefully analyze ALL images provided:
- Identify the page/feature shown in each image
- Look for error messages, broken UI elements, or unexpected behavior
- Extract any visible text, error codes, or status messages
- Use visual details from the images to enhance the bug description

**FOLLOW USER INSTRUCTIONS EXACTLY**: Pay close attention to what the user says about each image:
- If user says "first image is actual" or "image 1 shows the bug" → Use that image to describe the Actual Result
- If user says "second image is expected" or "image 2 shows correct behavior" → Use that image to describe the Expected Result
- The user may say things like "first image = actual, second = expected" - follow these instructions precisely
- Describe what you SEE in each image based on the user's labels
- If the user provides an "expected" image, describe the correct/working state shown in that image for the Expected Result section
- If the user provides an "actual" image, describe the buggy/broken state shown in that image for the Actual Result section
- If no labels provided, assume all images show the actual (buggy) state

**IMAGE REFERENCES**: When describing images in your report:
- For Actual Result: "As shown in the screenshot, [describe what's visible in the actual/bug image]"
- For Expected Result: "The expected behavior (as shown in the reference screenshot) should be [describe what's visible in the expected image]"
` : ""}
Rules for EXCELLENT bug reports:
1. **Title**: Clear, specific, includes the affected feature/page and the symptom (e.g., "[BOM Manager] Export to Excel fails with 500 error for BOMs with >1000 parts")
2. **Steps to Reproduce**: Provide 5-10 detailed, numbered steps. Include:
   - Exact navigation path (e.g., "Navigate to https://a-qa-my.siliconexpert.com/bom-manager")
   - Specific user actions (clicks, inputs, selections)
   - Test data used if applicable
   - Preconditions if any
3. **Expected Result**: Detailed description of correct behavior
4. **Actual Result**: Detailed description including:
   - Exact error messages (if any)
   - HTTP status codes (if applicable)
   - Visual symptoms${hasImage ? " (describe what you see in the screenshot)" : ""}
   - Console errors (if mentioned)
5. **Severity**: Critical (system down/data loss), Major (feature broken), Minor (workaround exists), Trivial (cosmetic)
6. **Priority**: P1 (immediate), P2 (next sprint), P3 (backlog), P4 (nice to have)
7. **Component**: Be specific (UI, API, Database, Part Search, BOM Manager, Compliance, Reports, Authentication, Notifications, Export, Import, etc.)
8. **Environment**: Browser, OS, screen resolution if relevant, user role/permissions

Additional fields to include:
- **Reproducibility**: Always / Sometimes / Rarely / Unable to reproduce
- **Workaround**: If any workaround exists, describe it
- **Impact**: Describe business/user impact

Return ONLY valid JSON with these keys:
{
  "title": "string",
  "description": "string (a brief 1-2 sentence summary of the bug)",
  "stepsToReproduce": ["step1", "step2", ...],
  "expectedResult": "string",
  "actualResult": "string",
  "component": "string",
  "environment": "string",
  "reproducibility": "Always|Sometimes|Rarely",
  "workaround": "string or null",
  "impact": "string"
}`;

    let userContent;
    if (hasImage) {
      userContent = [];
      
      allFiles.forEach((f, idx) => {
        if (f?.buffer && f?.mimetype?.startsWith("image/")) {
          const imageBase64 = f.buffer.toString("base64");
          userContent.push({
            type: "image_url",
            image_url: {
              url: `data:${f.mimetype};base64,${imageBase64}`
            }
          });
        }
      });
      
      userContent.push({
        type: "text",
        text: description
      });
    } else {
      userContent = description;
    }

    const messages = [];
    
    if (conversationHistory && conversationHistory.length > 0) {
      conversationHistory.forEach(msg => {
        messages.push({ role: msg.role, content: msg.content });
      });
    }
    
    messages.push({ role: "user", content: userContent });

    const { text } = await invokeProxyChat({
      modelId: env.BEDROCK_MODEL_ID,
      temperature: env.BEDROCK_TEMPERATURE,
      maxTokens: env.BEDROCK_MAX_TOKENS,
      system,
      messages
    });

    return parseBugReportFromClaudeText(text);
  }

  const imageBase64 = file?.buffer ? file.buffer.toString("base64") : undefined;
  const imageMediaType = file?.mimetype;

  const { text: claudeText } = await generateBugReportWithClaude({
    description,
    imageBase64,
    imageMediaType
  });

  return parseBugReportFromClaudeText(claudeText);
}

app.post("/generate", upload.array("images", 10), async (req, res) => {
  const started = Date.now();

  console.log("/generate called", { description: req.body?.description?.substring(0, 50) });

  try {
    const parsedBody = bugRequestSchema.parse({
      description: req.body?.description
    });

    let conversationHistory = [];
    if (req.body?.conversationHistory) {
      try {
        conversationHistory = typeof req.body.conversationHistory === "string" 
          ? JSON.parse(req.body.conversationHistory) 
          : req.body.conversationHistory;
      } catch (e) {
        console.log("Failed to parse conversationHistory");
      }
    }

    console.log("Calling AI proxy...", { isFollowUp: conversationHistory.length > 0, historyLength: conversationHistory.length });
    const report = await generateReport({
      description: parsedBody.description,
      file: req.files?.[0],
      files: req.files || [],
      conversationHistory
    });

    console.log("/generate success", { durationMs: Date.now() - started });
    res.json({ report });
  } catch (err) {
    const status = err?.name === "ZodError" ? 400 : 500;

    console.error("/generate failed", {
      status,
      durationMs: Date.now() - started,
      message: err?.message,
      stack: err?.stack
    });

    res.status(status).json({
      error: status === 400 ? "Invalid request" : "Internal server error",
      details: status === 400 ? err?.issues : undefined
    });
  }
});

app.post("/generate-stream", upload.array("images", 10), async (req, res) => {
  const started = Date.now();

  console.log("/generate-stream called", { description: req.body?.description?.substring(0, 50) });

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("Access-Control-Allow-Origin", "*");

  try {
    const parsedBody = bugRequestSchema.parse({
      description: req.body?.description
    });

    let conversationHistory = [];
    if (req.body?.conversationHistory) {
      try {
        conversationHistory = typeof req.body.conversationHistory === "string" 
          ? JSON.parse(req.body.conversationHistory) 
          : req.body.conversationHistory;
      } catch (e) {
        console.log("Failed to parse conversationHistory");
      }
    }

    if (!capabilities.ai) {
      if (env.REQUIRE_BEDROCK) {
        throw new Error("AI proxy is required but not configured.");
      }
      const report = mockReport(parsedBody.description);
      res.write(`data: ${JSON.stringify({ type: "complete", report })}\n\n`);
      res.end();
      return;
    }

    const allFiles = req.files || [];
    const hasImage = allFiles.some(f => f?.buffer && f?.mimetype?.startsWith("image/"));
    const isFollowUp = conversationHistory && conversationHistory.length > 0;

    const system = `You are an expert senior QA engineer at SiliconExpert, a leading electronic component data and supply chain intelligence company. You write exceptionally detailed, professional Jira bug reports.
${isFollowUp ? `
**FOLLOW-UP MODE**: This is a follow-up request. The user has already generated a bug report and now wants to modify it.
- The previous bug report is provided in the conversation
- Apply the user's requested changes to the existing report
- Keep all unchanged fields the same
- Only modify what the user specifically asks to change
- Return the COMPLETE updated bug report in JSON format (not just the changes)
` : ""}
Company Context:
- Product: SiliconExpert platform
- Main URL: https://a-qa-my.siliconexpert.com/
- Other domains: siliconexpert.com, app.siliconexpert.com
- Key features: Part search, BOM management, lifecycle analysis, compliance data, supply chain risk monitoring, PCN/EOL alerts, affected facilities, event tracking
- Users: Engineers, procurement teams, supply chain managers
- Tech stack: Web application with REST APIs, Oracle database, microservices architecture

Your task: Generate an extremely detailed, well-organized Jira bug report.
${hasImage ? `
**IMPORTANT - IMAGE ANALYSIS**: The user has attached screenshot(s). Carefully analyze ALL images provided:
- Identify the page/feature shown in each image
- Look for error messages, broken UI elements, or unexpected behavior
- Extract any visible text, error codes, or status messages
- Use visual details from the images to enhance the bug description
` : ""}
Rules for EXCELLENT bug reports:
1. **Title**: Clear, specific, includes the affected feature/page and the symptom
2. **Steps to Reproduce**: Provide 5-10 detailed, numbered steps
3. **Expected Result**: Detailed description of correct behavior
4. **Actual Result**: Detailed description including exact error messages
5. **Component**: Be specific (UI, API, Database, Part Search, BOM Manager, etc.)
6. **Environment**: Browser, OS, screen resolution if relevant

Streaming output requirements:
1. First, output a human-readable bug report in Markdown using EXACTLY these sections in this order:
   - # Title
   - ## Description
   - ## Steps to Reproduce
   - ## Expected Result
   - ## Actual Result
   - ## Component
   - ## Environment
   - ## Reproducibility
   - ## Workaround
   - ## Impact
2. After the Markdown, output the marker <<BEGIN_JSON>> on its own line.
3. Then output ONLY the JSON object (no Markdown fences).
4. Then output the marker <<END_JSON>> on its own line.
5. The JSON must contain exactly these keys:
   title, description, stepsToReproduce, expectedResult, actualResult, component, environment, reproducibility, workaround, impact, jiraPriority
6. The jiraPriority value must be one of: Trivial, Minor, Major, Critical, Blocker
7. Output ONLY Markdown + the markers + JSON. No extra commentary.`;

    let userContent;
    if (hasImage) {
      userContent = [];
      allFiles.forEach((f) => {
        if (f?.buffer && f?.mimetype?.startsWith("image/")) {
          const imageBase64 = f.buffer.toString("base64");
          userContent.push({
            type: "image_url",
            image_url: { url: `data:${f.mimetype};base64,${imageBase64}` }
          });
        }
      });
      userContent.push({ type: "text", text: parsedBody.description });
    } else {
      userContent = parsedBody.description;
    }

    const messages = [];
    if (conversationHistory && conversationHistory.length > 0) {
      conversationHistory.forEach(msg => {
        messages.push({ role: msg.role, content: msg.content });
      });
    }
    messages.push({ role: "user", content: userContent });

    let fullText = "";
    let forwardedText = "";
    let jsonStarted = false;
    const stream = invokeProxyChatStream({
      modelId: env.BEDROCK_MODEL_ID,
      temperature: env.BEDROCK_TEMPERATURE,
      maxTokens: env.BEDROCK_MAX_TOKENS,
      system,
      messages
    });

    for await (const chunk of stream) {
      fullText += chunk;

      if (!jsonStarted) {
        forwardedText += chunk;
        const markerIdx = forwardedText.indexOf("<<BEGIN_JSON>>");
        if (markerIdx !== -1) {
          const beforeMarker = forwardedText.slice(0, markerIdx);
          if (beforeMarker) {
            res.write(`data: ${JSON.stringify({ type: "chunk", content: beforeMarker })}\n\n`);
          }
          jsonStarted = true;
        } else {
          res.write(`data: ${JSON.stringify({ type: "chunk", content: chunk })}\n\n`);
        }
      }
    }

    const markerMatch = fullText.match(/<<BEGIN_JSON>>\s*([\s\S]*?)\s*<<END_JSON>>/i);
    const jsonText = markerMatch?.[1]?.trim();

    const report = jsonText
      ? parseBugReportFromClaudeText(jsonText)
      : parseBugReportFromClaudeText(fullText);
    res.write(`data: ${JSON.stringify({ type: "complete", report })}\n\n`);
    console.log("/generate-stream success", { durationMs: Date.now() - started });
    res.end();
  } catch (err) {
    console.error("/generate-stream failed", {
      durationMs: Date.now() - started,
      message: err?.message,
      stack: err?.stack
    });
    res.write(`data: ${JSON.stringify({ type: "error", error: err?.message || "Internal server error" })}\n\n`);
    res.end();
  }
});

app.post("/bug", upload.single("image"), async (req, res) => {
  const started = Date.now();

  try {
    if (!capabilities.jira) {
      res.status(400).json({
        error: "Jira is not configured. Use /generate for preview mode or set JIRA_* environment variables."
      });
      return;
    }

    const parsedBody = bugRequestSchema.parse({
      description: req.body?.description
    });

    const file = req.file;
    const report = await generateReport({
      description: parsedBody.description,
      file
    });

    const issue = await createJiraBug({ report });

    if (file?.buffer) {
      await attachFileToIssue({
        issueKey: issue.key,
        buffer: file.buffer,
        filename: file.originalname || "screenshot",
        contentType: file.mimetype
      });
    }

    if (env.JIRA_PARENT_ISSUE_KEY) {
      try {
        await linkIssueToParent({
          issueKey: issue.key,
          parentKey: env.JIRA_PARENT_ISSUE_KEY
        });
      } catch (e) {
        console.error("Failed to link issue to parent", {
          parentKey: env.JIRA_PARENT_ISSUE_KEY,
          issueKey: issue.key,
          error: e?.message
        });
      }
    }

    res.json({
      jiraUrl: issue.url,
      issueKey: issue.key,
      report
    });
  } catch (err) {
    const status = err?.name === "ZodError" ? 400 : 500;

    console.error("/bug failed", {
      status,
      durationMs: Date.now() - started,
      message: err?.message,
      stack: err?.stack
    });

    res.status(status).json({
      error: status === 400 ? "Invalid request" : "Internal server error",
      details: status === 400 ? err?.issues : undefined
    });
  }
});

app.get("/jira/components", async (req, res) => {
  try {
    if (!capabilities.jira) {
      res.status(400).json({ error: "Jira is not configured" });
      return;
    }
    const query = req.query.q || "";
    const components = await getProjectComponents(query);
    res.json({ components });
  } catch (err) {
    console.error("/jira/components failed", err?.message);
    res.status(500).json({ error: "Failed to fetch components" });
  }
});

app.get("/jira/issues", async (req, res) => {
  try {
    if (!capabilities.jira) {
      res.status(400).json({ error: "Jira is not configured" });
      return;
    }
    const query = req.query.q || "";
    const issues = await searchIssues(query);
    res.json({ issues });
  } catch (err) {
    console.error("/jira/issues failed", err?.message);
    res.status(500).json({ error: "Failed to fetch issues" });
  }
});

app.get("/jira/users", async (req, res) => {
  try {
    if (!capabilities.jira) {
      res.status(400).json({ error: "Jira is not configured" });
      return;
    }
    const query = req.query.q || "";
    const users = await getAssignableUsers(query);
    res.json({ users });
  } catch (err) {
    console.error("/jira/users failed", err?.message);
    res.status(500).json({ error: "Failed to fetch users" });
  }
});

app.get("/jira/sprints", async (req, res) => {
  try {
    if (!capabilities.jira) {
      res.status(400).json({ error: "Jira is not configured" });
      return;
    }
    const query = req.query.q || "";
    const sprints = await getSprints(query);
    res.json({ sprints });
  } catch (err) {
    console.error("/jira/sprints failed", err?.message);
    res.status(500).json({ error: "Failed to fetch sprints" });
  }
});

app.post("/jira/create", upload.array("images", 10), async (req, res) => {
  const started = Date.now();

  try {
    if (!capabilities.jira) {
      res.status(400).json({ error: "Jira is not configured" });
      return;
    }

    const { report, componentId, componentIds, parentKey, relatedToKey, relatedToKeys, assigneeId, sprintId, jiraPriority, comment } = req.body;
    
    if (!report) {
      res.status(400).json({ error: "Report is required" });
      return;
    }

    const parsedReport = typeof report === "string" ? JSON.parse(report) : report;

    const compIds = componentIds 
      ? (Array.isArray(componentIds) ? componentIds : [componentIds])
      : (componentId ? [componentId] : []);

    const issue = await createJiraBugWithOptions({
      report: parsedReport,
      componentIds: compIds,
      parentKey: parentKey || null,
      relatedToKeys: Array.isArray(relatedToKeys)
        ? relatedToKeys
        : relatedToKeys
          ? [relatedToKeys]
          : relatedToKey
            ? [relatedToKey]
            : [],
      assigneeId: assigneeId || null,
      sprintId: sprintId || null,
      jiraPriority: jiraPriority || null,
      comment: comment || null
    });

    const files = req.files || [];
    for (const file of files) {
      if (file?.buffer) {
        await attachFileToIssue({
          issueKey: issue.key,
          buffer: file.buffer,
          filename: file.originalname || "screenshot",
          contentType: file.mimetype
        });
      }
    }

    res.json({
      jiraUrl: issue.url,
      issueKey: issue.key
    });
  } catch (err) {
    console.error("/jira/create failed", {
      durationMs: Date.now() - started,
      message: err?.message,
      stack: err?.stack
    });

    res.status(500).json({ error: err?.message || "Failed to create JIRA Bug" });
  }
});

app.listen(env.PORT, env.HOST, () => {
  console.log(`Backend listening on http://${env.HOST}:${env.PORT}`);
});
