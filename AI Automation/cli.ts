#!/usr/bin/env node

import * as readline from "readline";
import * as fs from "fs";
import * as path from "path";
import { JiraToPlaywrightOrchestrator } from "./src/orchestrator";
import dotenv from "dotenv";

// Load env variables
dotenv.config();

// Create readline interface
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

// Colors for console output
const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
};

// Helper function to print colored messages
function print(
  message: string,
  color: "red" | "green" | "yellow" | "blue" | "cyan" = "reset"
) {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

// Initialize orchestrator
const orchestrator = new JiraToPlaywrightOrchestrator(
  {
    baseUrl: process.env.JIRA_BASE_URL || "",
    email: process.env.JIRA_EMAIL || "",
    apiToken: process.env.JIRA_API_TOKEN || "",
  },
  process.env.OPENAI_API_KEY || "",
  {
    baseUrl: process.env.BASE_URL || "",
    username: process.env.APP_USERNAME || "",
    password: process.env.APP_PASSWORD || "",
    headless: process.env.PLAYWRIGHT_HEADLESS === "true",
    slowMo: parseInt(process.env.PLAYWRIGHT_SLOW_MO || "1000"),
  }
);

async function askQuestion(question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer.trim());
    });
  });
}

async function displayMenu() {
  console.clear();
  print("\n╔════════════════════════════════════════════════╗", "cyan");
  print("║  JIRA Test Automation CLI                    ║", "cyan");
  print("╚════════════════════════════════════════════════╝\n", "cyan");

  print("\n📋 Choose an operation:", "bright");
  print("\n1. Generate tests for a single Story");
  print("2. Generate tests for multiple Stories");
  print("3. View generated tests");
  print("4. Run tests");
  print("5. Delete a test");
  print("6. Exit\n");
}

async function generateSingleTest() {
  const storyId = await askQuestion("Enter Story number (e.g. SE2-69114): ");

  if (!storyId) {
    print("❌ Story number is required", "red");
    return;
  }

  try {
    print("\n⏳ Processing...", "yellow");
    const result = await orchestrator.generateTestsForStory(storyId);

    print("\n✅ Completed successfully!", "green");
    print(`📝 Story: ${result.storyId}`, "green");
    print(`📊 Number of Test Cases: ${result.testCaseCount}`, "green");
    print(`📁 File: ${result.generatedFilePath}`, "green");

    print("\n🧪 Test Cases:", "bright");
    result.testCases.forEach((tc) => {
      print(`  • ${tc.id}: ${tc.name}`);
    });
  } catch (error: any) {
    print(`\n❌ Error: ${error.message}`, "red");
  }

  await askQuestion("\nPress Enter to continue...");
}

async function generateBatchTests() {
  const input = await askQuestion(
    "Enter Story numbers separated by commas (e.g. SE2-69114, SE2-69115, SE2-69116): "
  );

  if (!input) {
    print("❌ No Stories provided", "red");
    return;
  }

  const storyIds = input.split(",").map((s) => s.trim());

  try {
    print(`\n⏳ Processing ${storyIds.length} Stories...`, "yellow");

    for (const storyId of storyIds) {
      try {
        print(`\n📥 Processing ${storyId}...`, "blue");
        await orchestrator.generateTestsForStory(storyId);
        print(`✅ Completed ${storyId}`, "green");
      } catch (error: any) {
        print(`⚠️  Error in ${storyId}: ${error.message}`, "yellow");
      }
    }

    print("\n✅ Processing completed!", "green");
  } catch (error: any) {
    print(`\n❌ Error: ${error.message}`, "red");
  }

  await askQuestion("\nPress Enter to continue...");
}

async function listGeneratedTests() {
  try {
    const testsDir = "./tests/generated";

    if (!fs.existsSync(testsDir)) {
      print("No generated tests found yet", "yellow");
      await askQuestion("\nPress Enter to continue...");
      return;
    }

    const files = fs
      .readdirSync(testsDir)
      .filter((f) => f.endsWith(".spec.ts"));

    if (files.length === 0) {
      print("No generated tests found yet", "yellow");
      await askQuestion("\nPress Enter to continue...");
      return;
    }

    print(`\n📋 Generated tests (${files.length}):\n`, "bright");

    files.forEach((file, index) => {
      const filePath = path.join(testsDir, file);
      const stats = fs.statSync(filePath);
      print(
        `${index + 1}. ${file} (${(stats.size / 1024).toFixed(
          2
        )} KB) - ${stats.birthtime.toLocaleDateString("en-US")}`
      );
    });

    print("\n" + "─".repeat(50));
    const showContent = await askQuestion(
      "\nDo you want to view the content of any test? (Enter number or None): "
    );

    if (
      showContent &&
      showContent !== "None" &&
      showContent !== "None".toLowerCase()
    ) {
      const index = parseInt(showContent) - 1;
      if (index >= 0 && index < files.length) {
        const content = fs.readFileSync(
          path.join(testsDir, files[index]),
          "utf-8"
        );
        print("\n" + "─".repeat(50), "blue");
        print(content);
        print("─".repeat(50) + "\n", "blue");
      }
    }
  } catch (error: any) {
    print(`❌ Error: ${error.message}`, "red");
  }

  await askQuestion("\nPress Enter to continue...");
}

async function runTests() {
  try {
    const testsDir = "./tests/generated";

    if (!fs.existsSync(testsDir)) {
      print("No generated tests available", "yellow");
      await askQuestion("\nPress Enter to continue...");
      return;
    }

    const files = fs
      .readdirSync(testsDir)
      .filter((f) => f.endsWith(".spec.ts"))
      .map((f) => f.replace(".spec.ts", ""));

    if (files.length === 0) {
      print("No generated tests available", "yellow");
      await askQuestion("\nPress Enter to continue...");
      return;
    }

    print(`\n🧪 Available tests:\n`, "bright");
    files.forEach((file, index) => {
      print(`${index + 1}. ${file}`);
    });
    print(`${files.length + 1}. Run all tests`);

    const choice = await askQuestion("\nSelect test number: ");
    const index = parseInt(choice) - 1;

    if (index === files.length) {
      // Run all tests
      print("\n⏳ Running all tests...", "yellow");
      print("Running: npx playwright test tests/generated/", "cyan");
      print("(Run this command manually)", "yellow");
    } else if (index >= 0 && index < files.length) {
      const testFile = files[index];
      print(`\n⏳ Running ${testFile}...`, "yellow");
      print(
        `Running: npx playwright test tests/generated/${testFile}.spec.ts`,
        "cyan"
      );
      print("(Run this command manually)", "yellow");
    }
  } catch (error: any) {
    print(`❌ Error: ${error.message}`, "red");
  }

  await askQuestion("\nPress Enter to continue...");
}

async function deleteTest() {
  try {
    const testsDir = "./tests/generated";

    if (!fs.existsSync(testsDir)) {
      print("No generated tests available", "yellow");
      await askQuestion("\nPress Enter to continue...");
      return;
    }

    const files = fs
      .readdirSync(testsDir)
      .filter((f) => f.endsWith(".spec.ts"));

    if (files.length === 0) {
      print("No generated tests available", "yellow");
      await askQuestion("\nPress Enter to continue...");
      return;
    }

    print(`\n🗑️  Delete test:\n`, "bright");
    files.forEach((file, index) => {
      print(`${index + 1}. ${file}`);
    });

    const choice = await askQuestion("\nSelect test number to delete: ");
    const index = parseInt(choice) - 1;

    if (index >= 0 && index < files.length) {
      const fileToDelete = files[index];
      const confirm = await askQuestion(
        `⚠️  Are you sure you want to delete ${fileToDelete}? (yes/no): `
      );

      if (confirm.toLowerCase() === "yes") {
        fs.unlinkSync(path.join(testsDir, fileToDelete));
        print(`✅ Deleted ${fileToDelete}`, "green");
      } else {
        print("Cancelled", "yellow");
      }
    }
  } catch (error: any) {
    print(`❌ Error: ${error.message}`, "red");
  }

  await askQuestion("\nPress Enter to continue...");
}

async function main() {
  while (true) {
    await displayMenu();
    const choice = await askQuestion("Enter your choice (1-6): ");

    switch (choice) {
      case "1":
        await generateSingleTest();
        break;
      case "2":
        await generateBatchTests();
        break;
      case "3":
        await listGeneratedTests();
        break;
      case "4":
        await runTests();
        break;
      case "5":
        await deleteTest();
        break;
      case "6":
        print("\n👋 Goodbye!", "cyan");
        rl.close();
        process.exit(0);
      default:
        print("❌ Invalid choice", "red");
    }
  }
}

// Run main
main().catch(console.error);
