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

const reproducibilitySchema = z.preprocess((val) => {
  if (typeof val !== "string") return "Always";
  const v = val.trim().toLowerCase();
  if (!v) return "Always";

  // Map various inputs to valid reproducibility values
  if (v === "always" || v === "100%" || v === "every time" || v === "consistently" || v === "constant") return "Always";
  if (v === "sometimes" || v === "intermittent" || v === "occasionally" || v === "50%" || v === "random" || v === "sporadic") return "Sometimes";
  if (v === "rarely" || v === "seldom" || v === "infrequent" || v === "once" || v === "hard to reproduce" || v === "difficult to reproduce") return "Rarely";
  if (v === "unable to reproduce" || v === "cannot reproduce" || v === "not reproducible") return "Rarely";

  // If model already returned a valid value with different casing
  const titleCased = v.charAt(0).toUpperCase() + v.slice(1);
  if (["Always", "Sometimes", "Rarely"].includes(titleCased)) return titleCased;

  // Default to Always for most bugs
  return "Always";
}, z.enum(["Always", "Sometimes", "Rarely"]));

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
  reproducibility: reproducibilitySchema.optional().default("Always"),
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

function inferReproducibilityFromDescription(report, originalPrompt = "") {
  const description = String(report.description || "").toLowerCase();
  const title = String(report.title || "").toLowerCase();
  const actualResult = String(report.actualResult || "").toLowerCase();
  const userPrompt = String(originalPrompt || "").toLowerCase();
  const allText = `${userPrompt} ${description} ${title} ${actualResult}`;

  // Check for "Rarely" indicators FIRST (more specific - single occurrence)
  const rarelyPatterns = [
    /\brarely\b/,
    /\bseldom\b/,
    /\binfrequent(ly)?\b/,
    /\bhard to reproduce\b/,
    /\bdifficult to reproduce\b/,
    /\bhappened once\b/,
    /\bonly once\b/,
    /\bone time\b/,
    /\bhappened one time\b/,
    /\boccurred once\b/,
    /\bcannot reproduce\b/,
    /\bunable to reproduce\b/
  ];

  for (const pattern of rarelyPatterns) {
    if (pattern.test(allText)) {
      return { ...report, reproducibility: "Rarely" };
    }
  }

  // Check for "Sometimes" indicators (intermittent issues)
  const sometimesPatterns = [
    /\bsometimes\b/,
    /\bintermittent(ly)?\b/,
    /\boccasional(ly)?\b/,
    /\bsporadic(ally)?\b/,
    /\brandom(ly)?\b/,
    /\bnot always\b/,
    /\bnot every time\b/,
    /\bonce in a while\b/,
    /\bfrom time to time\b/
  ];

  for (const pattern of sometimesPatterns) {
    if (pattern.test(allText)) {
      return { ...report, reproducibility: "Sometimes" };
    }
  }

  // Keep the existing reproducibility value (defaults to "Always" from schema)
  return report;
}

function normalizeComponent(report, originalPrompt = "") {
  const component = String(report.component || "").trim();
  const componentLower = component.toLowerCase();
  const description = String(report.description || "").toLowerCase();
  const title = String(report.title || "").toLowerCase();
  const userPrompt = String(originalPrompt || "").toLowerCase();
  const allText = `${userPrompt} ${description} ${title}`;

  // Check for BOM-related keywords FIRST (highest priority)
  // This catches: "bom", "open a bom", "openbom", "bom manager", etc.
  if (allText.includes("bom") || componentLower.includes("bom")) {
    return { ...report, component: "BOM Manager" };
  }

  // If AI returned "Supply Chain" but user mentioned BOM-related terms
  if (componentLower.includes("supply chain") && allText.includes("bom")) {
    return { ...report, component: "BOM Manager" };
  }

  // Component keyword mappings for other components
  const componentMappings = [
    { patterns: [/\bpart[- ]?search\b/i, /\bsearch\s+part/i], component: "Part Search" },
    { patterns: [/\bpart[- ]?details?\b/i], component: "Part Details" },
    { patterns: [/\bcompliance\b/i, /\brohs\b/i, /\breach\b/i], component: "Compliance" },
    { patterns: [/\breport[s]?\b/i], component: "Reports" },
    { patterns: [/\bexport\b/i], component: "Export" },
    { patterns: [/\bimport\b/i], component: "Import" },
    { patterns: [/\bauth(entication)?\b/i, /\blogin\b/i, /\blogout\b/i], component: "Authentication" },
    { patterns: [/\bnotification[s]?\b/i, /\balert[s]?\b/i], component: "Notifications" },
    { patterns: [/\bdashboard\b/i], component: "Dashboard" },
  ];

  // Check other component patterns
  for (const mapping of componentMappings) {
    for (const pattern of mapping.patterns) {
      if (pattern.test(allText)) {
        return { ...report, component: mapping.component };
      }
    }
  }

  return report;
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

export function parseBugReportFromClaudeText(text, originalPrompt = "") {
  const trimmed = String(text || "").trim();

  const direct = tryParseJson(trimmed);
  if (direct.ok) {
    const parsed = bugReportSchema.parse(direct.value);
    const withReproducibility = inferReproducibilityFromDescription(parsed, originalPrompt);
    const withComponent = normalizeComponent(withReproducibility, originalPrompt);
    return addComponentPrefixToTitle(withComponent);
  }

  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first !== -1 && last !== -1 && last > first) {
    const sliced = trimmed.slice(first, last + 1);
    const slicedParsed = tryParseJson(sliced);
    if (slicedParsed.ok) {
      const parsed = bugReportSchema.parse(slicedParsed.value);
      const withReproducibility = inferReproducibilityFromDescription(parsed, originalPrompt);
      const withComponent = normalizeComponent(withReproducibility, originalPrompt);
      return addComponentPrefixToTitle(withComponent);
    }
  }

  throw new Error("Claude response was not valid JSON.");
}
