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

function inferPriorityFromDescription(report, originalPrompt = "") {
  const description = String(report.description || "").toLowerCase();
  const title = String(report.title || "").toLowerCase();
  const actualResult = String(report.actualResult || "").toLowerCase();
  const impact = String(report.impact || "").toLowerCase();
  const userPrompt = String(originalPrompt || "").toLowerCase();
  const allText = `${userPrompt} ${description} ${title} ${actualResult} ${impact}`;

  // Blocker indicators - system unusable, data loss, security issues
  const blockerPatterns = [
    /\b(system|application|app|site|website|platform)\s+(crash(es|ed|ing)?|down|unavailable|not\s+working|broken|dead)\b/,
    /\bdata\s+(loss|lost|deleted|corruption|corrupted)\b/,
    /\bsecurity\s+(breach|vulnerability|exploit|hole)\b/,
    /\bcannot\s+(login|access|use|open|start|launch)\s+(the\s+)?(system|application|app|platform)\b/,
    /\b(complete|total|entire)\s+(outage|failure|breakdown)\b/,
    /\bblocks?\s+(all|entire|complete|everything|production|release|deployment)\b/,
    /\b(production|live|prod)\s+(down|broken|not\s+working)\b/,
    /\b(all|every|no)\s+users?\s+(cannot|unable\s+to|can't)\b/,
    /\bsystem\s+is\s+(completely\s+)?(broken|unusable|inaccessible)\b/
  ];

  for (const pattern of blockerPatterns) {
    if (pattern.test(allText)) {
      return { ...report, jiraPriority: "Blocker" };
    }
  }

  // Critical indicators - major feature broken, no workaround, affects many users
  const criticalPatterns = [
    /\b(critical|severe|major)\s+(bug|issue|problem|error|defect)\b/,
    /\b(main|primary|core|key|essential|critical)\s+(feature|functionality)\s+(not\s+working|broken|fails?|failing)\b/,
    /\bno\s+workaround\b/,
    /\baffects?\s+(many|all|most|multiple|numerous)\s+users?\b/,
    /\b(many|multiple|several|all)\s+users?\s+(affected|impacted|experiencing|reporting)\b/,
    /\b(payment|checkout|transaction|order)\s+(fail(s|ed|ing)?|not\s+working|broken)\b/,
    /\b(revenue|business)\s+(impact|loss|affecting)\b/,
    /\bcompletely\s+(broken|unusable|non-functional)\b/,
    /\bproduction\s+(issue|bug|problem|error)\b/
  ];

  for (const pattern of criticalPatterns) {
    if (pattern.test(allText)) {
      return { ...report, jiraPriority: "Critical" };
    }
  }

  // Major indicators - significant impact but has workaround
  const majorPatterns = [
    /\b(significant|substantial|considerable|important)\s+(impact|issue|problem)\b/,
    /\bhas\s+workaround\b/,
    /\bmissing\b/,
    /\bworkaround\s+(available|exists|possible)\b/,
    /\b(feature|functionality)\s+(partially|sometimes)\s+(broken|not\s+working|fails?)\b/,
    /\b(some|several|few)\s+users?\s+(affected|impacted|experiencing)\b/,
    /\b(incorrect|wrong|invalid)\s+(data|calculation|result|output)\b/,
    /\bperformance\s+(degradation|issue|problem|slow)\b/,
    /\b(slow|sluggish|laggy|delayed)\s+(response|loading|performance)\b/
  ];

  for (const pattern of majorPatterns) {
    if (pattern.test(allText)) {
      return { ...report, jiraPriority: "Major" };
    }
  }

  // Trivial indicators - cosmetic, typos, minor UI issues
  const trivialPatterns = [
    /\b(cosmetic|visual|aesthetic|styling|css)\s+(issue|problem|bug)\b/,
    /\b(typo|spelling|grammar|wording)\s+(error|mistake|issue)\b/,
    /\b(minor|small|tiny|slight)\s+(ui|visual|display|cosmetic)\s+(issue|glitch|problem)\b/,
    /\b(alignment|spacing|padding|margin|color|font)\s+(issue|problem|off|wrong)\b/,
    /\btext\s+(alignment|color|size|formatting)\b/,
    /\bno\s+(functional|business|user)\s+impact\b/,
    /\bjust\s+a\s+(typo|visual|cosmetic|ui)\b/
  ];

  for (const pattern of trivialPatterns) {
    if (pattern.test(allText)) {
      return { ...report, jiraPriority: "Trivial" };
    }
  }

  // Keep existing priority if no patterns match
  return report;
}

function normalizeComponent(report, originalPrompt = "") {
  const component = String(report.component || "").trim();
  const componentLower = component.toLowerCase();
  const description = String(report.description || "").toLowerCase();
  const title = String(report.title || "").toLowerCase();
  const userPromptOriginal = String(originalPrompt || "");
  const userPrompt = userPromptOriginal.toLowerCase();
  const allText = `${userPrompt} ${description} ${title}`;

  // PRIORITY 1: Check if user prompt has "- Components:" field and extract it (preserve original case)
  const componentsMatch = userPromptOriginal.match(/^[\s-]*components?\s*:\s*(.+?)$/im);
  if (componentsMatch) {
    const extractedComponent = componentsMatch[1].trim();
    if (extractedComponent && extractedComponent !== "-") {
      // Return the exact component from the prompt with original case preserved
      return { ...report, component: extractedComponent };
    }
  }

  // PRIORITY 2: If AI already provided a valid component, keep it
  if (component && component !== "-") {
    // Check for BOM-related keywords - override if needed
    if (allText.includes("bom") || componentLower.includes("bom")) {
      return { ...report, component: "BOM Manager" };
    }
    
    // If AI returned "Supply Chain" but user mentioned BOM-related terms
    if (componentLower.includes("supply chain") && allText.includes("bom")) {
      return { ...report, component: "BOM Manager" };
    }
    
    return report;
  }

  // PRIORITY 3: Fallback to keyword-based detection
  // Check for BOM-related keywords FIRST (highest priority)
  if (allText.includes("bom")) {
    return { ...report, component: "BOM Manager" };
  }

  // Component keyword mappings for other components
  const componentMappings = [
    { patterns: [/\bpart[- ]?search\b/i, /\bsearch\s+part/i], component: "Part Search" },
    { patterns: [/\bpart[- ]?details?\b/i], component: "Part Details" },
    { patterns: [/\bcompliance\b/i, /\brohs\b/i, /\breach\b/i], component: "Compliance" },
    { patterns: [/\bsupply[- ]?chain\b/i], component: "Supply Chain" },
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
  let title = String(report.title || "").trim();
  
  if (!component || !title) {
    return report;
  }
  
  // Remove any existing component prefix patterns from the title
  // Pattern 1: "Component: title" or "[Component]: title"
  const prefixPattern = new RegExp(`^\\[?${component.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\]?:\\s*`, 'i');
  title = title.replace(prefixPattern, '');
  
  // Pattern 2: "[Component] title" (bracket without colon)
  const bracketPattern = new RegExp(`^\\[${component.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\]\\s*`, 'i');
  title = title.replace(bracketPattern, '');
  
  // Pattern 3: Remove any other component name at the start (case insensitive)
  const componentWords = component.split(/\s+/);
  if (componentWords.length > 0) {
    const componentPattern = new RegExp(`^${componentWords.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+')}[:\\s-]+`, 'i');
    title = title.replace(componentPattern, '');
  }
  
  // Clean up the title
  title = title.trim();
  if (!title) {
    // If title became empty after cleanup, use original
    title = String(report.title || "").trim();
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
    const withPriority = inferPriorityFromDescription(withReproducibility, originalPrompt);
    const withComponent = normalizeComponent(withPriority, originalPrompt);
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
      const withPriority = inferPriorityFromDescription(withReproducibility, originalPrompt);
      const withComponent = normalizeComponent(withPriority, originalPrompt);
      return addComponentPrefixToTitle(withComponent);
    }
  }

  throw new Error("Claude response was not valid JSON.");
}
