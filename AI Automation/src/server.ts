import express from "express";
import dotenv from "dotenv";
import path from "path";
import axios from "axios";
import * as fs from "fs";
import { JiraToPlaywrightOrchestrator } from "./orchestrator";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Validate required environment variables
const requiredEnvVars = ["JIRA_BASE_URL", "JIRA_EMAIL", "JIRA_API_TOKEN"];
const missingEnvVars = requiredEnvVars.filter((key) => !process.env[key]);

if (missingEnvVars.length > 0) {
  console.error(
    `❌ Missing required environment variables: ${missingEnvVars.join(", ")}`
  );
  process.exit(1);
}

// Initialize orchestrator
let orchestrator: JiraToPlaywrightOrchestrator;

try {
  orchestrator = new JiraToPlaywrightOrchestrator(
    {
      baseUrl: process.env.JIRA_BASE_URL!,
      email: process.env.JIRA_EMAIL!,
      apiToken: process.env.JIRA_API_TOKEN!,
    },
    "./output"
  );
  console.log("✅ Orchestrator initialized successfully");
} catch (error: any) {
  console.error("❌ Failed to initialize orchestrator:", error.message);
  process.exit(1);
}

// Helper function for extracting plain text
function extractPlainText(adfContent: any): string {
  if (!adfContent) return "";
  if (typeof adfContent === "string") return adfContent;

  let text = "";
  const traverse = (node: any) => {
    if (node.type === "text") {
      text += node.text || "";
    }
    if (node.content && Array.isArray(node.content)) {
      node.content.forEach(traverse);
    }
  };

  traverse(adfContent);
  return text.trim();
}

function getEgyptTimeString() {
  return new Date().toLocaleString("en-GB", {
    timeZone: "Africa/Cairo",
  });
}

// Dashboard route
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: getEgyptTimeString() });
});

// API info endpoint
app.get("/api/info", (req, res) => {
  res.json({
    name: "JIRA to Playwright",
    version: "1.0.0",
    endpoints: {
      dashboard: "GET /",
      health: "GET /health",
      info: "GET /api/info",
      story: "GET /api/story/:storyId",
      generatePrompt: "POST /api/generate-prompt",
    },
  });
});

// Fetch test cases for a story (without generating prompt)
app.get("/api/story/:storyId", async (req, res) => {
  try {
    const { storyId } = req.params;

    if (!storyId) {
      return res.status(400).json({ error: "Story ID is required" });
    }

    console.log(`\n🔍 Fetching test cases for story: ${storyId}`);

    const auth = Buffer.from(
      `${process.env.JIRA_EMAIL}:${process.env.JIRA_API_TOKEN}`
    ).toString("base64");

    const storyUrl = `${process.env.JIRA_BASE_URL}/rest/api/3/issue/${storyId}`;
    const storyResponse = await axios.get(storyUrl, {
      headers: { Authorization: `Basic ${auth}` },
    });

    console.log("✅ Story details fetched from JIRA");

    const storyData = storyResponse.data;
    const testCaseIds: string[] = [];

    // Check issue links
    const issueLinks = storyData.fields?.issuelinks || [];
    for (const link of issueLinks) {
      const linkedIssue = link.outwardIssue || link.inwardIssue;
      if (linkedIssue && linkedIssue.fields?.issuetype?.name === "Test") {
        testCaseIds.push(linkedIssue.key);
      }
    }

    // Check subtasks
    const subtasks = storyData.fields?.subtasks || [];
    for (const subtask of subtasks) {
      if (subtask.fields?.issuetype?.name === "Test") {
        testCaseIds.push(subtask.key);
      }
    }

    console.log(
      `🧪 Collected ${testCaseIds.length} test case IDs:`,
      testCaseIds
    );
    if (testCaseIds.length === 0) {
      return res.status(404).json({
        error: "No test cases found for this story",
        storyId,
      });
    }

    // Fetch basic info for each test case
    const testCases = [];
    for (const tcId of testCaseIds) {
      try {
        console.log(`   ↳ Fetching test case: ${tcId}`);

        const tcUrl = `${process.env.JIRA_BASE_URL}/rest/api/3/issue/${tcId}`;
        const tcResponse = await axios.get(tcUrl, {
          headers: { Authorization: `Basic ${auth}` },
        });

        const fields = tcResponse.data.fields || {};
        testCases.push({
          id: tcId,
          name: fields.summary || tcId,
          priority: fields.priority?.name || "Medium",
          status: fields.status?.name || "Draft",
        });

        console.log(`   ✅ Done: ${tcId}`);
      } catch (error: any) {
        console.warn(`   ⚠️ Failed to fetch ${tcId}:`, error.message);
      }
    }
    console.log(
      `✅ Finished fetching ${testCases.length} test cases for story ${storyId}`
    );
    res.json({
      success: true,
      storyId,
      testCasesCount: testCases.length,
      testCases,
    });
  } catch (error: any) {
    console.error("Error in /api/story/:storyId:", error);

    res.status(500).json({
      error: "Internal server error",
      message: error.message,
    });
  }
});

// Generate prompt for selected test cases with new format
app.post("/api/generate-prompt", async (req, res) => {
  try {
    const { storyId, testCaseIds, config, projectPath } = req.body;

    if (
      !storyId ||
      !testCaseIds ||
      !Array.isArray(testCaseIds) ||
      testCaseIds.length === 0
    ) {
      return res
        .status(400)
        .json({ error: "Story ID and test case IDs are required" });
    }

    console.log(
      `📝 Generating prompt for ${testCaseIds.length} selected test cases...`
    );
    if (projectPath) {
      console.log(`📂 Project path provided: ${projectPath}`);
    }

    const auth = Buffer.from(
      `${process.env.JIRA_EMAIL!}:${process.env.JIRA_API_TOKEN!}`
    ).toString("base64");

    // Fetch selected test cases
    const selectedTestCases: any[] = [];
    for (const testCaseId of testCaseIds) {
      try {
        const url = `${process.env
          .JIRA_BASE_URL!}/rest/api/3/issue/${testCaseId}`;
        const response = await axios.get(url, {
          headers: { Authorization: `Basic ${auth}` },
        });

        if (response.data) {
          const fields = response.data.fields;
          selectedTestCases.push({
            id: testCaseId,
            name: `${fields.summary} (${testCaseId})`,
            description: extractPlainText(fields.description),
            priority: fields.priority?.name || "Medium",
            status: fields.status?.name || "Draft",
            preconditions: fields.customfield_15164
              ? extractPlainText(fields.customfield_15164)
              : "None",
            category: fields.components?.[0]?.name || "Functional",
          });
        }
      } catch (error: any) {
        console.warn(`⚠️ Failed to fetch ${testCaseId}:`, error.message);
      }
    }

    // Generate enhanced prompt
    // Generate enhanced prompt
    const timestamp = new Date().toISOString().replace(/:/g, "-");
    const filename = `${storyId}_${timestamp}.prompt.md`;

    // Ensure .output directory exists
    const outputDir = ".output";
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
      console.log(`✅ Created output directory: ${outputDir}`);
    }

    const filepath = path.join(outputDir, filename);

    // Analyze the project structure if available
    let projectContext = "";
    if (projectPath && fs.existsSync(projectPath)) {
      projectContext = await analyzeProjectStructure(projectPath);
    }

    let prompt = `# Playwright Test Automation - Code Generation Request

## 🎯 Context: Existing Playwright Project

**Important:** This is an EXISTING project with working code.

${projectContext}

---

## 🚨 CRITICAL INSTRUCTION - READ FIRST

**YOU MUST ONLY CREATE NEW FILES - NEVER MODIFY EXISTING FILES**

Why?
- Existing files contain working code for other tests
- Modifying them may break existing functionality
- All new code should be isolated in new files

What you CAN do:
- ✅ **CREATE** new test files in \`src/tests/${storyId}/\`
- ✅ **CREATE** new Page Objects in \`src/services/${storyId}/\`
- ✅ **IMPORT** existing utilities/base classes
- ✅ **REFERENCE** existing Page Objects (import and use them)

What you CANNOT do:
- ❌ **MODIFY** any existing file
- ❌ **EDIT** existing Page Objects
- ❌ **CHANGE** existing test files
- ❌ **UPDATE** any file outside \`src/tests/${storyId}/\` or \`src/services/${storyId}/\`

---

## 📝 Test Generation Request

**Story ID:** ${storyId}
**Generated:** ${new Date().toISOString()}
**Test Cases Count:** ${selectedTestCases.length}
**Base URL:** ${config?.baseUrl || "https://a-qa-my.siliconexpert.com"}

---

## ⚙️ Project Configuration

### ⚠️ CRITICAL: Authentication is Handled Globally

**DO NOT add login logic in test files!**

This project uses **global authentication setup** configured in \`playwright.config.ts\`.

❌ **WRONG - Don't do this:**
\`\`\`typescript
test.beforeEach(async ({ page }) => {
  const loginPage = new LoginPage(page);
  await loginPage.login(process.env.APP_USERNAME!, process.env.APP_PASSWORD!);
});
\`\`\`

✅ **CORRECT - Authentication happens automatically:**
\`\`\`typescript
test.describe('${storyId} - Test Suite', () => {
  
  // No beforeEach for login needed!
  // Authentication handled by global setup
  
  test('TC-001 - Test Name', async ({ page }) => {
    // Page is already authenticated
    // Start testing directly from the feature page
    await page.goto('/your-feature-path');
    // ... your test steps
  });
});
\`\`\`

**How it works:**
1. Before tests run, you set: \`$env:ENV="qa"\`
2. Playwright reads credentials from \`.env.qa\`
3. Global setup authenticates once
4. All tests reuse the authenticated state
5. Tests start already logged in

**Your responsibility:**
- ✅ Set environment: \`$env:ENV="qa"\` before running tests
- ✅ Navigate to the feature page you want to test
- ✅ Write test steps assuming user is already logged in
- ❌ DO NOT add login code in test files

---

## 🎨 Code Generation Strategy for Cascade

### Phase 1: Analysis (FOR REFERENCE ONLY)
1. ✅ Scan existing code to **understand the style**
2. ✅ Identify existing utilities you can **import and use**
3. ✅ Review naming conventions to **match them**
4. ✅ Find reusable base classes you can **extend**

⚠️ **These existing files are READ-ONLY - for reference only**

---

### Phase 2: Planning (NEW FILES ONLY)
1. ✅ Plan **NEW** Page Objects in \`src/services/${storyId}/\`
2. ✅ Plan **NEW** test file in \`src/tests/${storyId}/\`
3. ✅ Decide which existing utilities to **import** (not modify)
4. ✅ Plan which existing Page Objects to **import and use**

⚠️ **All generated code must be in NEW files only**

---

### Phase 3: File Creation (ISOLATED CODE)

Create the following **NEW** files in isolated directories:

\`\`\`
src/tests/
└── ${storyId}.spec.ts         ← NEW test file

src/services/
└── ${storyId}.ts     ← NEW Page Object files
\`\`\`

---

## 📚 Test Cases to Implement

`;

    // Add the test cases
    selectedTestCases.forEach((tc, index) => {
      prompt += `
### Test Case ${index + 1}: ${tc.id}

**Name:** ${tc.name}
**Priority:** ${tc.priority}
**Status:** ${tc.status}
**Category:** ${tc.category}

`;

      if (tc.description) {
        prompt += `**Description:**\n${tc.description}\n\n`;
      }

      if (tc.preconditions && tc.preconditions !== "None") {
        prompt += `**Preconditions:**\n${tc.preconditions}\n\n`;
      }

      prompt += `---\n`;
    });

    // Add the remaining instructions
    prompt += `
---

## 📂 Required File Structure - NEW FILES ONLY

### File 1: Test Specification (REQUIRED - NEW FILE)
**Path:** \`tests/${storyId}/${storyId}.spec.ts\`
**Action:** **CREATE NEW FILE**

\`\`\`typescript
import { test, expect } from '@playwright/test';

// Import NEW Page Objects from THIS story
import { [NewPage]Page } from '../../src/pages/${storyId}/[NewPage].page';

/**
 * Test Suite for ${storyId}
 * 
 * ⚠️ Authentication: Handled globally by playwright.config.ts
 * Make sure to set: $env:ENV="qa" before running tests
 * Tests will start with user already authenticated
 */
test.describe('${storyId} - Test Suite', () => {
  
  // ⚠️ NO beforeEach for login - authentication is global!
  
  test('TC-001 - [Test Name]', async ({ page }) => {
    // Arrange
    // Page is already authenticated - navigate directly to feature
    const featurePage = new [NewPage]Page(page);
    await featurePage.navigate();
    
    // Act
    await featurePage.performAction();
    
    // Assert
    await expect(page.getByText('Success')).toBeVisible();
  });

  test('TC-002 - [Test Name]', async ({ page }) => {
    // User is already logged in
    // Start testing your feature directly
    const featurePage = new [NewPage]Page(page);
    await featurePage.navigate();
    
    // ... test steps
  });
});
\`\`\`

**Key Points:**
- ✅ No login imports needed (\`LoginPage\` not imported)
- ✅ No \`beforeEach\` for authentication
- ✅ Tests assume user is already authenticated
- ✅ Just navigate to your feature and test
- ⚠️ Remember: Set \`$env:ENV="qa"\` before running!

---


### File 2: Page Objects (NEW FILES in NEW DIRECTORY)
**Directory:** \`src/services/${storyId}/\`
**Action:** **CREATE NEW DIRECTORY and FILES**

\`\`\`typescript
import { Page, Locator } from '@playwright/test';
import { BasePage } from '../Base.page';

export class [FeatureName]Page extends BasePage {
  readonly element: Locator;

  constructor(page: Page) {
    super(page);
    this.element = page.getByRole('button', { name: 'Submit' });
  }

  async performAction(): Promise<void> {
    await this.element.click();
  }
}
\`\`\`

---

## 🎯 Locator Strategy

1. **\`page.getByRole()\`** ← Preferred
2. **\`page.getByLabel()\`** ← For forms
3. **\`page.getByText()\`** ← For text
4. **\`page.getByTestId()\`** ← data-testid
5. CSS Selectors ← Last resort
6. ❌ Avoid XPath

---

## ✅ Quality Checklist

- [ ] All NEW files in isolated directories
- [ ] NO existing files modified
- [ ] Existing code only imported
- [ ] Used semantic locators
- [ ] Auto-retry assertions
- [ ] Tests are independent

---

## 🚨 FINAL REMINDER

### ✅ YOU MUST:
1. Create ALL code in NEW files only
2. Put test in: \`src/tests/${storyId}.spec.ts\`
3. Put Page Objects in: \`src/services/${storyId}.ts\`

### ❌ YOU MUST NOT:
1. Modify any existing file
2. Edit existing Page Objects
3. Update code outside \`${storyId}/\` directories

---

---

## 🔧 Environment Setup & Execution

### Environment Variables
**IMPORTANT:** This project uses environment-specific configuration files.

- **Location:** \`.env\`, \`.env.qa\`, \`.env.uat\`, \`.env.prod\`
- **Usage:** The tests read credentials and URLs from these files
- **DO NOT hardcode:** Never put credentials directly in test files

**In your test code, use:**
\`\`\`typescript
process.env.BASE_URL      // Application URL
process.env.APP_USERNAME  // Test username
process.env.APP_PASSWORD  // Test password
\`\`\`

---

### Running the Generated Tests

**⚠️ CRITICAL STEP - Set Environment First:**

The environment variable \`ENV\` tells Playwright which \`.env\` file to use for credentials.

**Before running ANY tests, you MUST set:**

#### PowerShell (Windows):
\`\`\`powershell
# ⚠️ REQUIRED - Set environment to QA
$env:ENV="qa"

# Now run tests (authentication happens automatically)
npx playwright test tests/${storyId}/${storyId}.spec.ts

# Or run all tests
npx playwright test

# Run in headed mode
npx playwright test --headed

# Run in debug mode
npx playwright test --debug
\`\`\`

#### Bash/Zsh (Mac/Linux):
\`\`\`bash
# ⚠️ REQUIRED - Set environment to QA
export ENV="qa"

# Run tests
npx playwright test tests/${storyId}/${storyId}.spec.ts
\`\`\`

**What happens when you set \`$env:ENV="qa"\`:**
1. Playwright loads \`.env.qa\` file
2. Reads \`APP_USERNAME\` and \`APP_PASSWORD\`
3. Global setup performs authentication
4. Saves authentication state
5. All tests start already logged in

**You DO NOT need to:**
- ❌ Add login code in test files
- ❌ Import LoginPage in tests
- ❌ Call \`loginPage.login()\` in beforeEach

**You just need to:**
- ✅ Set \`$env:ENV="qa"\` before running
- ✅ Write tests assuming user is authenticated
- ✅ Navigate to your feature pages directly

---

### Test Execution Checklist

Before running generated tests:

1. ✅ Set environment: \`$env:ENV="qa"\` (PowerShell) or \`export ENV="qa"\` (Bash)
2. ✅ Verify \`.env.qa\` file exists with correct credentials
3. ✅ Install dependencies: \`npm install\` (if needed)
4. ✅ Install Playwright browsers: \`npx playwright install\` (if needed)
5. ✅ Run tests: \`npx playwright test tests/${storyId}.spec.ts\`

---

### Expected Test Output

\`\`\`
Running 3 tests using 3 workers

  ✓ [chromium] › ${storyId}.spec.ts:15:3 › ${storyId} - Test Suite › TC-001 - Test Name (5.2s)
  ✓ [chromium] › ${storyId}.spec.ts:28:3 › ${storyId} - Test Suite › TC-002 - Test Name (3.8s)
  ✓ [chromium] › ${storyId}.spec.ts:41:3 › ${storyId} - Test Suite › TC-003 - Test Name (4.1s)

  3 passed (13.5s)
\`\`\`

---

## 📝 Post-Generation Instructions for Cascade

After generating all files:

1. **Review the code** - Make sure all imports are correct
2. **Check environment variables** - Verify .env files exist
3. **Set environment** - Run: \`$env:ENV="qa"\`
4. **Test the code** - Run: \`npx playwright test tests/${storyId}.spec.ts\`
5. **Fix any issues** - If tests fail, debug and adjust

---

**Optimized for Cascade AI in Windsurf**
**Remember: Set \`$env:ENV="qa"\` before running tests!**
`;

    fs.writeFileSync(filepath, prompt, "utf-8");
    console.log(`✅ Prompt file generated: ${filepath}`);

    res.json({
      success: true,
      promptFile: filepath,
      testCasesCount: selectedTestCases.length,
    });
  } catch (error: any) {
    console.error("Error in /api/generate-prompt:", error);
    res.status(500).json({
      error: "Internal server error",
      message: error.message,
    });
  }
});

// ============================================
// Helper Functions
// ============================================

/**
 * Analyze project structure
 */
async function analyzeProjectStructure(projectPath: string): Promise<string> {
  let context = "";

  try {
    const pageObjectsDir = path.join(projectPath, "src", "services");
    const testsDir = path.join(projectPath, "src", "tests");

    context += `### Project Structure Analysis\n\n`;
    context += `**Project Path:** \`${projectPath}\`\n\n`;

    // Page Objects
    if (fs.existsSync(pageObjectsDir)) {
      const pageFiles = fs
        .readdirSync(pageObjectsDir)
        .filter(
          (file) => file.endsWith(".page.ts") || file.endsWith(".page.js")
        );

      context += `#### Existing Page Objects\n`;
      pageFiles.forEach((file) => {
        context += `- \`${file
          .replace(".page.ts", "")
          .replace(".page.js", "")}Page\` → \`src/services/${file}\`\n`;
      });
      context += `\n`;

      if (pageFiles.length > 0) {
        const exampleFile = path.join(pageObjectsDir, pageFiles[0]);
        const exampleContent = fs.readFileSync(exampleFile, "utf-8");
        const lines = exampleContent.split("\n").slice(0, 50).join("\n");

        context += `#### Example Page Object\n\n\`\`\`typescript\n${lines}\n...\n\`\`\`\n\n`;
      }
    }

    // Tests
    if (fs.existsSync(testsDir)) {
      const testFiles = getAllFilesRecursive(testsDir).filter(
        (file) => file.endsWith(".spec.ts") || file.endsWith(".test.ts")
      );

      if (testFiles.length > 0) {
        context += `#### Found ${testFiles.length} test files\n\n`;

        const exampleTest = fs.readFileSync(testFiles[0], "utf-8");
        const testLines = exampleTest.split("\n").slice(0, 40).join("\n");

        context += `#### Example Test\n\n\`\`\`typescript\n${testLines}\n...\n\`\`\`\n\n`;
      }
    }

    context += `---\n\n`;
  } catch (error: any) {
    console.warn(`⚠️ Could not analyze project: ${error.message}`);
    context = `⚠️ Project analysis unavailable\n\n---\n\n`;
  }

  return context;
}

/**
 * Get all files recursively
 */
function getAllFilesRecursive(dirPath: string, files: string[] = []): string[] {
  const items = fs.readdirSync(dirPath);

  items.forEach((item) => {
    const fullPath = path.join(dirPath, item);
    if (fs.statSync(fullPath).isDirectory()) {
      getAllFilesRecursive(fullPath, files);
    } else {
      files.push(fullPath);
    }
  });

  return files;
}

// ============================================
// Endpoint For clipboard copy
// ============================================

app.get("/api/get-prompt-content", (req, res) => {
  try {
    const filePath = req.query.file as string;

    if (!filePath || !fs.existsSync(filePath)) {
      return res.status(404).send("Prompt file not found");
    }

    const content = fs.readFileSync(filePath, "utf-8");
    res.type("text/plain").send(content);
  } catch (error: any) {
    console.error("Error reading prompt file:", error);
    res.status(500).send("Error reading file");
  }
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: "Endpoint not found" });
});

// Start server
const server = app.listen(PORT, () => {
  console.log("\n============================================================");
  console.log(`🚀 Server running on: http://localhost:${PORT}`);
  console.log(`🌐 Dashboard: http://localhost:${PORT}`);
  console.log(`📊 API Info: http://localhost:${PORT}/api/info`);
  console.log(`❤️  Health: http://localhost:${PORT}/health`);
  console.log("============================================================\n");
});

server.on("error", (error: any) => {
  if (error.code === "EADDRINUSE") {
    console.error(`❌ Port ${PORT} is already in use`);
  } else {
    console.error("❌ Server error:", error);
  }
  process.exit(1);
});
