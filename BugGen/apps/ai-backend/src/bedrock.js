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
- Use these keys exactly: title, stepsToReproduce, expectedResult, actualResult, severity, jiraPriority, component, environment, impact.
- stepsToReproduce MUST be an array of short but specific steps.
- If information is missing, infer reasonable details explicitly in the fields (do not leave them empty), but avoid making up product names.
- jiraPriority is MANDATORY - you MUST carefully analyze the bug description and assign the most appropriate priority based on impact and severity.

Title Guidelines - CRITICAL:
- If the input contains "Test Case Summary:", use it as the PRIMARY basis for the bug title
- Transform the test case summary into a bug report title by describing what is MISSING or BROKEN
- Example: "Verify search field tooltip or help text is available" → "Search field tooltip or help text is missing"
- Example: "Verify export button works correctly" → "Export button not working correctly"
- DO NOT include the component name in the title (it will be added automatically)
- Focus on WHAT is broken/missing and WHEN/WHERE it happens
- Keep titles clear, concise, and between 50-100 characters when possible

Component Guidelines:
- If the input contains "Components:", extract and use that exact component name
- Common components: Part Search, Part Details, BOM Manager, Supply Chain, Compliance, Reports, Export, Import, Authentication, Notifications, Dashboard
- The component will be automatically prefixed to the title in "Component: title" format

Severity guidance:
- Blocker/Critical/Major/Minor/Trivial

jiraPriority - REQUIRED field. Analyze the bug description carefully and choose ONE of these exact values:

"Blocker" - Use when:
  • System/application crashes or completely unavailable
  • Data loss or corruption occurs
  • Security breach or vulnerability
  • Cannot login or access the system at all
  • Blocks all users from working or testing
  • Production is down
  Examples: "Application crashes on startup", "All users cannot login", "Database corruption detected"

"Critical" - Use when:
  • Core/main feature is completely broken with no workaround
  • Affects many/most users significantly
  • Payment/checkout/transaction failures
  • Production issue with business impact
  • Major functionality is non-functional
  Examples: "Search returns no results", "Payment processing fails", "Export feature not working"

"Major" - Use when:
  • Feature is partially broken but has a workaround
  • Affects some users or specific scenarios
  • Significant impact but not blocking
  • Performance degradation issues
  • Incorrect data/calculations
  Examples: "Filter sometimes doesn't work", "Slow page load times", "Wrong calculation in specific case"

"Minor" - Use when:
  • Small issue with easy workaround
  • Limited user impact
  • Edge case or uncommon scenario
  • UI issue that doesn't prevent functionality
  • Default choice if severity is unclear
  Examples: "Button label unclear", "Tooltip missing", "Minor display issue"

"Trivial" - Use when:
  • Purely cosmetic/visual issue
  • Typo, spelling, or grammar error
  • Minor UI alignment or styling issue
  • No functional or business impact whatsoever
  Examples: "Text color slightly off", "Typo in label", "Icon alignment issue"

IMPORTANT: Consider these factors when choosing priority:
1. How many users are affected? (all/many/some/few)
2. Is there a workaround available?
3. Does it block critical functionality?
4. What is the business/user impact?
5. Is it a production issue?

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
