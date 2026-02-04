import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import { capabilities, env } from "./config.js";

function getClient() {
  if (!capabilities.bedrock) {
    throw new Error("Bedrock is not configured. Set AWS_REGION and AWS credentials.");
  }
  return new BedrockRuntimeClient({ region: env.AWS_REGION });
}

export async function generateBugReportWithClaude({ description, imageBase64, imageMediaType }) {
  const client = getClient();

  const promptText = `You are a senior QA engineer writing a high-quality Jira bug report.

Goal: produce a thorough, professional report that a developer can act on immediately.

Rules:
- Return ONLY valid JSON (no markdown, no code fences, no additional commentary).
- Use these keys exactly: title, stepsToReproduce, expectedResult, actualResult, severity, priority, component, environment.
- stepsToReproduce MUST be an array of short but specific steps.
- If information is missing, infer reasonable details explicitly in the fields (do not leave them empty), but avoid making up product names.
- Make the title specific (feature + symptom + condition).

Severity guidance:
- Blocker/Critical/Major/Minor/Trivial

Priority guidance:
- Highest/High/Medium/Low/Lowest

Bug description:
${description}`;

  const content = [{ type: "text", text: promptText }];

  if (imageBase64 && imageMediaType) {
    content.push({
      type: "image",
      source: {
        type: "base64",
        media_type: imageMediaType,
        data: imageBase64
      }
    });
  }

  const body = {
    anthropic_version: "bedrock-2023-05-31",
    max_tokens: env.BEDROCK_MAX_TOKENS,
    temperature: env.BEDROCK_TEMPERATURE,
    messages: [{ role: "user", content }]
  };

  const cmd = new InvokeModelCommand({
    modelId: env.BEDROCK_MODEL_ID,
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

  return { rawModelResponse: parsed, text };
}
