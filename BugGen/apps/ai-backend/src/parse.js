import { z } from "zod";

const jiraPrioritySchema = z.preprocess((val) => {
  if (typeof val !== "string") return undefined;
  const v = val.trim().toLowerCase();
  if (!v) return undefined;

  if (v === "blocker" || v === "p0" || v === "p1" || v === "highest" || v === "urgent") return "Blocker";
  if (v === "critical" || v === "high") return "Critical";
  if (v === "major" || v === "medium" || v === "p2") return "Major";
  if (v === "minor" || v === "low" || v === "p3") return "Minor";
  if (v === "trivial" || v === "p4" || v === "lowest") return "Trivial";

  // If model already returned a valid Jira priority with different casing
  const titleCased = v.charAt(0).toUpperCase() + v.slice(1);
  return titleCased;
}, z.enum(["Trivial", "Minor", "Major", "Critical", "Blocker"]));

const stepsToReproduceSchema = z.preprocess((val) => {
  if (Array.isArray(val)) return val;

  if (typeof val === "string") {
    const text = val.trim();
    if (!text) return [];

    // Split by new lines, and also handle cases like "1) ... 2) ..." in a single line.
    const rawParts = text.includes("\n")
      ? text.split(/\r?\n/)
      : text.split(/\s*(?:\d+\)|\d+\.|- |• )\s*/).filter(Boolean);

    return rawParts
      .map((s) => String(s).trim())
      .map((s) => s.replace(/^\s*(?:\d+\)|\d+\.|- |• )\s*/g, ""))
      .filter((s) => s.length > 0);
  }

  return [];
}, z.array(z.string().min(1)));

const bugReportSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional().default(""),
  stepsToReproduce: stepsToReproduceSchema.optional().default([]),
  expectedResult: z.string().optional().default(""),
  actualResult: z.string().optional().default(""),
  component: z.string().optional().default(""),
  environment: z.string().optional().default(""),
  reproducibility: z.string().optional().default(""),
  workaround: z.string().nullable().optional().default(null),
  impact: z.string().optional().default(""),
  jiraPriority: jiraPrioritySchema.optional()
});

function tryParseJson(text) {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, value: null };
  }
}

export function parseBugReportFromClaudeText(text) {
  const trimmed = String(text || "").trim();

  const direct = tryParseJson(trimmed);
  if (direct.ok) {
    return bugReportSchema.parse(direct.value);
  }

  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first !== -1 && last !== -1 && last > first) {
    const sliced = trimmed.slice(first, last + 1);
    const slicedParsed = tryParseJson(sliced);
    if (slicedParsed.ok) {
      return bugReportSchema.parse(slicedParsed.value);
    }
  }

  throw new Error("Claude response was not valid JSON.");
}
