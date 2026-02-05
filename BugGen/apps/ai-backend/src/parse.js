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
  jiraPriority: jiraPrioritySchema.optional().default("Minor")
});

function tryParseJson(text) {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, value: null };
  }
}

function addComponentPrefixToTitle(report) {
  const component = String(report.component || "").trim();
  const title = String(report.title || "").trim();
  
  if (!component || !title) {
    return report;
  }
  
  // Check if title already starts with the component prefix
  const prefixPattern = new RegExp(`^\\[?${component.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\]?:\\s*`, 'i');
  if (prefixPattern.test(title)) {
    return report;
  }
  
  // Also check for bracket format like [Component]
  const bracketPattern = new RegExp(`^\\[${component.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\]`, 'i');
  if (bracketPattern.test(title)) {
    return report;
  }
  
  // Replace " > " with ": " in the final title
  const finalTitle = `${component}: ${title}`.replace(/ > /g, ': ');
  
  return {
    ...report,
    title: finalTitle
  };
}

export function parseBugReportFromClaudeText(text) {
  const trimmed = String(text || "").trim();

  const direct = tryParseJson(trimmed);
  if (direct.ok) {
    const parsed = bugReportSchema.parse(direct.value);
    return addComponentPrefixToTitle(parsed);
  }

  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first !== -1 && last !== -1 && last > first) {
    const sliced = trimmed.slice(first, last + 1);
    const slicedParsed = tryParseJson(sliced);
    if (slicedParsed.ok) {
      const parsed = bugReportSchema.parse(slicedParsed.value);
      return addComponentPrefixToTitle(parsed);
    }
  }

  throw new Error("Claude response was not valid JSON.");
}
