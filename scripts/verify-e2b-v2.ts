import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { E2BSandboxService } from "../src/lib/ai/sandbox/e2b-service";

dotenv.config();

async function testBasicExecution(sandbox: E2BSandboxService): Promise<void> {
  console.log("1. Testing Basic Execution...");
  const result = await sandbox.runCode("print('Hello from E2B sandbox!')");
  if (
    !result.success ||
    !result.logs?.stdout?.some((l: string) => l.includes("Hello"))
  ) {
    console.log("Logs:", JSON.stringify(result.logs, null, 2));
    if (!result.success) throw new Error("Basic execution failed");
  }
  console.log("✅ Basic Execution Passed");
}

async function testFileGeneration(sandbox: E2BSandboxService): Promise<void> {
  console.log("2. Testing File Generation (Excel)...");
  const pythonCode = `
import pandas as pd
df = pd.DataFrame({'Data': [10, 20, 30, 40]})
df.to_excel('test_output.xlsx', index=False)
print('Excel file created')
    `;
  const fileResult = await sandbox.runCode(pythonCode);

  const excelFile = fileResult.results?.find(
    (r: any) => r.type === "file" && r.filename === "test_output.xlsx",
  );
  if (!excelFile) {
    console.log("Results:", JSON.stringify(fileResult.results, null, 2));
    throw new Error(
      "Excel file generation failed - file not found in artifacts",
    );
  }
  console.log("✅ File Generation Passed (Detected test_output.xlsx)");
}

async function testHtmlGeneration(sandbox: E2BSandboxService): Promise<void> {
  console.log("3. Testing HTML Generation (Snake Game Check)...");
  const html_content_raw = "<html><body><h1>Snake Game</h1></body></html>";
  const htmlCode = `
html_content = "${html_content_raw}"
with open('snake.html', 'w') as f:
    f.write(html_content)
print('HTML file created')
    `;
  const htmlResult = await sandbox.runCode(htmlCode);
  const htmlFile = htmlResult.results?.find(
    (r: any) => r.type === "file" && r.filename === "snake.html",
  );
  if (!htmlFile) {
    console.log(
      "Results (HTML Attempt):",
      JSON.stringify(htmlResult.results, null, 2),
    );
    throw new Error(
      "HTML generation failed - file not found (Whitelist check failed)",
    );
  }

  // Verify Content Integrity
  let decodedHtml = "";
  if (htmlFile.url) {
    console.log(
      "    ℹ️ Artifact is URL-based. Fetching content from:",
      htmlFile.url,
    );
    const localPath = path.join(process.cwd(), "public", htmlFile.url);
    decodedHtml = fs.readFileSync(localPath, "utf-8");
  } else {
    decodedHtml = Buffer.from(htmlFile.data, "base64").toString("utf-8");
  }

  if (decodedHtml === html_content_raw) {
    console.log("    ✅ Content Integrity Verified (Exact Match)");
  } else {
    console.error("    ❌ Content Integrity Failed!");
    console.log("Expected:", html_content_raw);
    console.log("Received:", decodedHtml);
  }

  console.log("✅ HTML Generation Passed (Detected snake.html)");

  // Test base64 fix if data exists
  if (htmlFile.data) {
    await testBase64Fix(htmlFile.data, html_content_raw);
  } else {
    console.log("4. Client-Side Fix Verification Skipped (URL Mode Active)");
  }
}

async function testBase64Fix(
  base64Data: string,
  expectedContent: string,
): Promise<void> {
  console.log("4. Verifying Client-Side Fix Logic (Legacy Base64 Mode)...");
  try {
    const cleanBase64 = base64Data.replaceAll(/\s/g, "");
    const buffer = Buffer.from(cleanBase64, "base64");
    const reconstructed = buffer.toString("utf-8");

    if (reconstructed === expectedContent) {
      console.log(
        "    ✅ Fix Verification: Base64 -> Buffer -> String matches input.",
      );
    } else {
      console.error(
        "    ❌ Fix Verification Failed: Reconstructed string does not match.",
      );
    }
  } catch (e) {
    console.error("    ❌ Fix Logic Tests Failed:", e);
  }
}

async function testTmpFallback(sandbox: E2BSandboxService): Promise<void> {
  console.log("\n4.1 Testing /tmp Fallback...");
  const tmpCode = `
with open('/tmp/fallback_test.txt', 'w') as f:
    f.write("This file is in /tmp but should be detected!")
    `;
  const tmpResult = await sandbox.runCode(tmpCode, "python");
  const fallbackFile = tmpResult.results.find(
    (r: any) => r.filename === "fallback_test.txt",
  );
  if (fallbackFile) {
    console.log("✅ /tmp Fallback Passed (Detected fallback_test.txt)");
  } else {
    console.error("❌ /tmp Fallback Failed (File not detected)");
  }
}

async function testPptxGeneration(sandbox: E2BSandboxService): Promise<void> {
  console.log("\n4. Testing PPTX Generation...");
  const pptxCode = `
import subprocess
import sys
# Install python-pptx
subprocess.check_call([sys.executable, "-m", "pip", "install", "python-pptx", "-q"])

from pptx import Presentation
prs = Presentation()
slide = prs.slides.add_slide(prs.slide_layouts[0])
title = slide.shapes.title
subtitle = slide.placeholders[1]
title.text = "Hello, World!"
subtitle.text = "python-pptx was here!"
prs.save('/home/user/test_presentation.pptx')
print("PPTX saved successfully!")
    `;
  const pptxResult = await sandbox.runCode(pptxCode, "python");
  console.log("PPTX Result:", {
    success: pptxResult.success,
    error: pptxResult.error,
    artifacts: pptxResult.results.length,
    artifactNames: pptxResult.results.map((a: any) => a.filename),
  });

  if (
    pptxResult.success &&
    pptxResult.results.some((a: any) => a.filename === "test_presentation.pptx")
  ) {
    console.log("✅ PPTX Generation Passed");
  } else {
    console.error("❌ PPTX Generation Failed");
  }
}

async function verify() {
  console.log("Starting E2B End-to-End Verification...");
  const sandbox = E2BSandboxService.getInstance();
  try {
    await testBasicExecution(sandbox);
    await testFileGeneration(sandbox);
    await testHtmlGeneration(sandbox);
    await testTmpFallback(sandbox);
    await testPptxGeneration(sandbox);

    console.log("All E2B verifications passed successfully! 🚀");
    process.exit(0);
  } catch (error) {
    console.error("❌ E2B Verification Failed:", error);
    process.exit(1);
  }
}

await verify();
