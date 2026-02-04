import axios from "axios";
import * as fs from "fs";
import * as path from "path";

interface JiraConfig {
  baseUrl: string;
  email: string;
  apiToken: string;
}

interface TestCase {
  id: string;
  name: string;
  description: string;
  priority: string;
  status: string;
  preconditions: string;
  testData: string;
  category: string;
  steps: Array<{ step: string; data: string; expectedResult: string }>;
}

export class JiraToPlaywrightOrchestrator {
  private jiraConfig: JiraConfig;
  private outputDir: string;

  constructor(jiraConfig: JiraConfig, outputDir = "./output") {
    this.jiraConfig = jiraConfig;
    this.outputDir = outputDir;

    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }
  }

  /**
   * Main entry point: Fetch test cases for a story and generate prompt
   */
  async fetchAndGeneratePrompt(
    storyId: string,
    projectPath?: string
  ): Promise<{ testCases: TestCase[]; promptPath: string; success: boolean }> {
    console.log("=".repeat(50));
    console.log(`🔍 FETCH: Getting Test Cases for Story: ${storyId}`);
    if (projectPath) {
      console.log(`📂 Project path: ${projectPath}`);
    }
    console.log("=".repeat(50));

    try {
      const testCases = await this.getTestCasesForStory(storyId);

      if (testCases.length === 0) {
        console.log("❌ No test cases found");
        return { testCases: [], promptPath: "", success: false };
      }

      console.log(`✅ Found ${testCases.length} test cases`);

      // Pass projectPath to generatePromptFile
      const promptPath = await this.generatePromptFile(
        storyId,
        testCases,
        projectPath
      );

      return { testCases, promptPath, success: true };
    } catch (error: any) {
      console.error("❌ Error:", error.message);
      return { testCases: [], promptPath: "", success: false };
    }
  }
  /**
   * Get all test cases linked to a story (via issue links or subtasks)
   */
  private async getTestCasesForStory(storyId: string): Promise<TestCase[]> {
    console.log(`🔍 Step 1: Fetching Story ${storyId}...`);
    const storyData = await this.fetchJiraIssue(storyId);

    const testCaseIds: string[] = [];

    // Check direct issue links
    console.log("🔍 Step 2: Checking direct issue links...");
    const issueLinks = storyData.fields?.issuelinks || [];
    for (const link of issueLinks) {
      const linkedIssue = link.outwardIssue || link.inwardIssue;
      if (linkedIssue && linkedIssue.fields?.issuetype?.name === "Test") {
        testCaseIds.push(linkedIssue.key);
      }
    }

    // Check subtasks
    console.log("🔍 Step 3: Checking subtasks...");
    const subtasks = storyData.fields?.subtasks || [];
    for (const subtask of subtasks) {
      if (subtask.fields?.issuetype?.name === "Test") {
        testCaseIds.push(subtask.key);
      }
    }

    // Fetch details for each test case (without Zephyr steps)
    const testCases: TestCase[] = [];
    for (const id of testCaseIds) {
      const tc = await this.fetchTestCaseDetails(id);
      if (tc) {
        testCases.push(tc);
        console.log(`  ✅ Found test case: ${id}`);
      }
    }

    return testCases;
  }

  /**
   * Fetch basic JIRA issue data
   */
  private async fetchJiraIssue(issueKey: string): Promise<any> {
    const auth = Buffer.from(
      `${this.jiraConfig.email}:${this.jiraConfig.apiToken}`
    ).toString("base64");

    const url = `${this.jiraConfig.baseUrl}/rest/api/3/issue/${issueKey}`;

    const response = await axios.get(url, {
      headers: { Authorization: `Basic ${auth}` },
    });

    return response.data;
  }

  /**
   * Fetch test case details from JIRA (no Zephyr steps)
   */
  private async fetchTestCaseDetails(
    testCaseId: string
  ): Promise<TestCase | null> {
    try {
      const data = await this.fetchJiraIssue(testCaseId);
      const fields = data.fields || {};

      const testCase: TestCase = {
        id: testCaseId,
        name: fields.summary || testCaseId,
        description: this.extractPlainText(fields.description) || "",
        priority: fields.priority?.name || "Medium",
        status: fields.status?.name || "Draft",
        preconditions: fields.customfield_15164
          ? this.extractPlainText(fields.customfield_15164)
          : "None",
        testData: "None",
        category: fields.components?.[0]?.name || "Functional",
        steps: [], // No Zephyr steps - will be added manually in prompt
      };

      return testCase;
    } catch (error: any) {
      console.warn(`    ⚠️ Could not fetch ${testCaseId}: ${error.message}`);
      return null;
    }
  }

  /**
   * Extract plain text from JIRA rich text (ADF format)
   */
  private extractPlainText(adfContent: any): string {
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

  /**
   * Generate prompt file for LLM
   */
  private async generatePromptFile(
    storyId: string,
    testCases: TestCase[],
    projectPath?: string
  ): Promise<string> {
    const timestamp = new Date().toISOString().replace(/:/g, "-");
    const filename = `${storyId}_${timestamp}.prompt.md`;
    const filepath = path.join(this.outputDir, filename);

    // Read the project context if available
    let projectContext = "";
    if (projectPath && fs.existsSync(projectPath)) {
      projectContext = await this.analyzeProjectStructure(projectPath);
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
**Test Cases Count:** ${testCases.length}

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

----------

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
  └── ${storyId}/                    ← NEW directory
      └── ${storyId}.spec.ts         ← NEW test file

src/services/
      └── ${storyId}/                ← NEW directory
          └── [PageName].ts     ← NEW Page Object files
\`\`\`

**Strategy:**
- Each story gets its **own directory**
- New Page Objects are **isolated** from existing ones
- You can **import** existing code, but **never modify** it

---

## 📚 Test Cases to Implement

`;

    // Add all test cases
    testCases.forEach((tc, index) => {
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

      if (tc.testData && tc.testData !== "None") {
        prompt += `**Test Data:**\n${tc.testData}\n\n`;
      }

      if (tc.steps && tc.steps.length > 0) {
        prompt += `**Test Steps:**\n`;
        tc.steps.forEach((s, i) => {
          prompt += `${i + 1}. ${s.step}\n`;
          if (s.data) prompt += `   - Data: ${s.data}\n`;
          if (s.expectedResult)
            prompt += `   - Expected Result: ${s.expectedResult}\n`;
        });
        prompt += `\n`;
      } else {
        prompt += `**Test Steps:** ⚠️ Steps not available - please refer to Zephyr or test description\n\n`;
      }

      prompt += `---\n`;
    });

    // Add the instructions for Cascade
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

  // Additional test cases...
});
\`\`\`

**Rules:**
- ✅ This is a **NEW** files
- ✅ Can **import** existing Page Objects (LoginPage, BasePage, etc.)
- ❌ Do **NOT** modify any imported files
- ✅ Use **NEW** Page Objects created in \`src/services/${storyId}/\`

---

### File 2: Page Objects (NEW FILES in NEW DIRECTORY)
**Directory:** \`src/services/${storyId}/\`
**Action:** **CREATE NEW FILES**

#### Example: \`src/services/${storyId}.ts\`

\`\`\`typescript
import { Page, Locator } from '@playwright/test';
// Can import and extend existing BasePage (but don't modify it)
import { BasePage } from '../Base.page';

/**
 * Page Object for [Feature Name]
 * Created for story: ${storyId}
 */
export class [FeatureName]Page extends BasePage {
  // Locators
  readonly searchInput: Locator;
  readonly searchButton: Locator;
  readonly resultsContainer: Locator;

  constructor(page: Page) {
    super(page); // Extend existing BasePage
    
    // Define locators using semantic selectors
    this.searchInput = page.getByRole('searchbox', { name: 'Search' });
    this.searchButton = page.getByRole('button', { name: 'Search' });
    this.resultsContainer = page.getByTestId('search-results');
  }

  async navigate(): Promise<void> {
    await this.page.goto('/feature-path');
    await this.page.waitForLoadState('networkidle');
  }

  async search(keyword: string): Promise<void> {
    await this.searchInput.fill(keyword);
    await this.searchButton.click();
    await this.page.waitForLoadState('networkidle');
  }

  async getResultCount(): Promise<number> {
    const results = this.resultsContainer.locator('[data-testid="result-item"]');
    return await results.count();
  }
}
\`\`\`

---

## 🎯 Locator Strategy (Priority Order)

1. **\`page.getByRole()\`** ← Best choice
2. **\`page.getByLabel()\`** ← For form inputs
3. **\`page.getByText()\`** ← For visible text
4. **\`page.getByTestId()\`** ← For data-testid attributes
5. **CSS Selectors** ← Last resort
6. **❌ AVOID XPath** ← Too brittle

---

## ✅ Quality Checklist - Before Completion

### File Organization
- [ ] ✅ All NEW files are in isolated directories:
  - [ ] Test file in \`src/tests/${storyId}/\`
  - [ ] Page Objects in \`src/services/${storyId}/\`
- [ ] ❌ **NO existing files were modified**
- [ ] ✅ Existing code is only **imported**, never **edited**

### Code Quality
- [ ] ✅ Used semantic locators (getByRole, getByLabel, getByText)
- [ ] ✅ Auto-retrying assertions with \`expect()\`
- [ ] ✅ Smart waits (no hard timeouts)
- [ ] ✅ Tests are independent
- [ ] ✅ Proper TypeScript types
- [ ] ✅ No TODO comments

---

## 🚨 FINAL REMINDER - ABSOLUTE RULES

### ✅ YOU MUST:
1. Create **ALL** code in **NEW** files only
2. Put test file in: \`src/tests/${storyId}.spec.ts\`
3. Put Page Objects in: \`src/services/${storyId}.page.ts\`
4. **Import** existing code when needed
5. **Extend** existing base classes

### ❌ YOU MUST NOT:
1. Modify any existing file
2. Edit existing Page Objects
3. Change existing test files
4. Update any code outside \`${storyId}/\` directories

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
**Remember: CREATE new files only - NEVER modify existing ones!**
`;

    fs.writeFileSync(filepath, prompt, "utf-8");
    console.log(`✅ Prompt file generated: ${filepath}`);
    return filepath;
  }

  // ============================================
  // Helper function: analyzeProjectStructure
  // ============================================

  /**
   * Analyze the structure of the existing project
   */
  private async analyzeProjectStructure(projectPath: string): Promise<string> {
    let context = "";

    try {
      const pageObjectsDir = path.join(projectPath, "src", "pages");
      const testsDir = path.join(projectPath, "tests");

      context += `### Project Structure Analysis\n\n`;
      context += `**Project Path:** \`${projectPath}\`\n\n`;

      // Analyze the Page Objects
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
            .replace(".page.js", "")}Page\` → \`src/pages/${file}\`\n`;
        });
        context += `\n`;

        // Read an example from an existing Page Object
        if (pageFiles.length > 0) {
          const exampleFile = path.join(pageObjectsDir, pageFiles[0]);
          const exampleContent = fs.readFileSync(exampleFile, "utf-8");
          const lines = exampleContent.split("\n").slice(0, 50).join("\n");

          context += `#### Example Page Object from Your Project\n\n`;
          context += `\`\`\`typescript\n${lines}\n...\n\`\`\`\n\n`;
        }
      } else {
        context += `⚠️ Page Objects directory not found at \`src/pages/\`\n\n`;
      }

      // Analyze the Tests
      if (fs.existsSync(testsDir)) {
        context += `#### Tests Directory Structure\n`;
        const testFiles = this.getAllFiles(testsDir).filter(
          (file) => file.endsWith(".spec.ts") || file.endsWith(".test.ts")
        );

        if (testFiles.length > 0) {
          context += `Found ${testFiles.length} test files\n\n`;

          const exampleTestContent = fs.readFileSync(testFiles[0], "utf-8");
          const testLines = exampleTestContent
            .split("\n")
            .slice(0, 40)
            .join("\n");

          context += `#### Example Test from Your Project\n\n`;
          context += `\`\`\`typescript\n${testLines}\n...\n\`\`\`\n\n`;
        }
      }

      context += `---\n\n`;
    } catch (error: any) {
      console.warn(`⚠️ Could not analyze project structure: ${error.message}`);
      context = `⚠️ Could not read project structure. Proceeding with standard template.\n\n---\n\n`;
    }

    return context;
  }

  /**
   * Helper: Get all files from a directory recursively
   */
  private getAllFiles(dirPath: string, arrayOfFiles: string[] = []): string[] {
    const files = fs.readdirSync(dirPath);

    files.forEach((file) => {
      const filePath = path.join(dirPath, file);
      if (fs.statSync(filePath).isDirectory()) {
        arrayOfFiles = this.getAllFiles(filePath, arrayOfFiles);
      } else {
        arrayOfFiles.push(filePath);
      }
    });

    return arrayOfFiles;
  }
}
