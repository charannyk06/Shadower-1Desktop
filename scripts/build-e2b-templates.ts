/**
 * Build and deploy E2B sandbox templates to your account
 *
 * Run with: npx tsx scripts/build-e2b-templates.ts
 */

import { Template, defaultBuildLogger, waitForPort } from "e2b";
import "dotenv/config";

const E2B_API_KEY = process.env.E2B_API_KEY;

if (!E2B_API_KEY) {
  console.error("❌ E2B_API_KEY not set in environment");
  process.exit(1);
}

console.log("🚀 Building E2B sandbox templates for Shadower...\n");

const PREFIX = "shadower";

interface TemplateConfig {
  alias: string;
  template: ReturnType<typeof Template>;
  cpuCount: number;
  memoryMB: number;
}

// Define templates - simplified versions that work reliably
const templates: TemplateConfig[] = [
  // Streamlit Developer Template (Python - most reliable)
  {
    alias: `${PREFIX}-streamlit`,
    template: Template()
      .fromPythonImage("3.11-slim")
      .aptInstall("curl")
      .pipInstall([
        "streamlit",
        "pandas",
        "numpy",
        "matplotlib",
        "seaborn",
        "plotly",
        "scipy",
        "altair",
      ])
      .setWorkdir("/home/user")
      .runCmd(
        'echo "import streamlit as st" > app.py && echo "st.write(\'Hello\')" >> app.py',
      )
      .setStartCmd(
        "streamlit run app.py --server.address=0.0.0.0 --server.headless=true",
        waitForPort(8501),
      ),
    cpuCount: 2,
    memoryMB: 2048,
  },

  // Gradio Developer Template (Python)
  {
    alias: `${PREFIX}-gradio`,
    template: Template()
      .fromPythonImage("3.11-slim")
      .aptInstall("curl")
      .pipInstall([
        "gradio",
        "pandas",
        "numpy",
        "matplotlib",
        "seaborn",
        "plotly",
      ])
      .setWorkdir("/home/user")
      .runCmd('echo "import gradio as gr" > app.py')
      .runCmd(
        "echo \"demo = gr.Interface(fn=lambda x: x, inputs='text', outputs='text')\" >> app.py",
      )
      .runCmd("echo \"demo.launch(server_name='0.0.0.0')\" >> app.py")
      .setStartCmd("python app.py", waitForPort(7860)),
    cpuCount: 2,
    memoryMB: 2048,
  },
];

async function buildTemplate(config: TemplateConfig): Promise<boolean> {
  console.log(`\n📦 Building template: ${config.alias}`);
  console.log("━".repeat(50));

  try {
    const result = await Template.build(config.template, {
      alias: config.alias,
      cpuCount: config.cpuCount,
      memoryMB: config.memoryMB,
      onBuildLogs: defaultBuildLogger(),
    });

    console.log(`\n✅ Template ${config.alias} built successfully!`);
    console.log(`   Template ID: ${result.templateId}`);
    return true;
  } catch (error: any) {
    if (error.message?.includes("already taken")) {
      console.log(`\n⚠️  Template ${config.alias} already exists`);
      return true;
    }
    console.error(`\n❌ Failed: ${error.message}`);
    return false;
  }
}

async function main() {
  console.log("Building Python templates (fast and reliable):\n");

  for (const config of templates) {
    await buildTemplate(config);
  }

  console.log("\n" + "═".repeat(50));
  console.log("✅ Python templates ready!");
  console.log("\nFor Next.js, use the already-built: shadower-nextjs");
  console.log("\nTemplate mapping for your code:");
  console.log("  nextjs-developer → shadower-nextjs");
  console.log("  streamlit-developer → shadower-streamlit");
  console.log("  gradio-developer → shadower-gradio");
}

main().catch(console.error);
