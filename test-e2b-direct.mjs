// Direct E2B SDK test - bypasses all app logic
import { Sandbox } from "@e2b/code-interpreter";
import dotenv from "dotenv";

// Load environment variables
dotenv.config();

const apiKey = process.env.E2B_API_KEY;
const templateId = process.env.E2B_TEMPLATE_ID;

console.log("=== E2B Direct SDK Test ===");
console.log(`API Key: ${apiKey ? apiKey.slice(0, 10) + "..." : "NOT SET"}`);
console.log(`Template ID: ${templateId || "NOT SET (using default)"}`);
console.log("");

async function testSandboxCreation(name, createFn) {
  console.log(`\n--- Test: ${name} ---`);
  const startTime = Date.now();

  try {
    const sandbox = await createFn();
    const duration = Date.now() - startTime;
    console.log(
      `✅ SUCCESS: Created sandbox ${sandbox.sandboxId} in ${duration}ms`,
    );

    // Cleanup
    try {
      await sandbox.kill();
      console.log(`   Cleaned up sandbox`);
    } catch (e) {
      console.log(`   Warning: Failed to cleanup: ${e.message}`);
    }

    return true;
  } catch (error) {
    const duration = Date.now() - startTime;
    console.log(`❌ FAILED after ${duration}ms`);
    console.log(`   Error: ${error.message}`);
    console.log(`   Error Type: ${error.constructor.name}`);
    if (error.code) console.log(`   Code: ${error.code}`);
    if (error.status) console.log(`   Status: ${error.status}`);
    if (error.response)
      console.log(`   Response: ${JSON.stringify(error.response)}`);
    return false;
  }
}

async function main() {
  if (!apiKey) {
    console.error("ERROR: E2B_API_KEY not set in environment");
    process.exit(1);
  }

  // Test 1: Default template (no template specified)
  await testSandboxCreation("Default template (empty)", async () => {
    return await Sandbox.create({ apiKey, timeoutMs: 30000 });
  });

  // Test 2: Explicit nextjs-developer template
  await testSandboxCreation("nextjs-developer template", async () => {
    return await Sandbox.create("nextjs-developer", {
      apiKey,
      timeoutMs: 30000,
    });
  });

  // Test 3: With E2B_TEMPLATE_ID if set
  if (templateId) {
    await testSandboxCreation(`Custom template (${templateId})`, async () => {
      return await Sandbox.create(templateId, { apiKey, timeoutMs: 30000 });
    });
  }

  // Test 4: base template
  await testSandboxCreation("base template", async () => {
    return await Sandbox.create("base", { apiKey, timeoutMs: 30000 });
  });

  console.log("\n=== Tests Complete ===");
}

main().catch(console.error);
