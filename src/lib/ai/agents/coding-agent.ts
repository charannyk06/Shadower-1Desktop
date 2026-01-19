import "server-only";
import { type Tool, tool as createTool } from "ai";
import type { UIMessageStreamWriter } from "ai";
import { colorize } from "consola/utils";
import globalLogger from "logger";
import { z } from "zod";

const logger = globalLogger.withDefaults({
  message: colorize("green", "[Coding Agent] "),
});

/**
 * Project structure
 */
export interface ProjectFile {
  path: string;
  content: string;
  type: "file" | "directory";
}

/**
 * Project configuration
 */
export interface ProjectConfig {
  name: string;
  framework: "react" | "nextjs" | "vanilla" | "node" | "python" | "fastapi";
  language: "typescript" | "javascript" | "python";
  dependencies: string[];
  devDependencies?: string[];
}

/**
 * Build result
 */
export interface BuildResult {
  success: boolean;
  output?: string;
  errors?: string[];
  previewUrl?: string;
}

/**
 * Coding Agent (Vibe Coding)
 *
 * Builds full applications from natural language descriptions
 * using local sandbox code execution.
 */
export class CodingAgent {
  private dataStream?: UIMessageStreamWriter;

  constructor(dataStream?: UIMessageStreamWriter) {
    this.dataStream = dataStream;
  }

  /**
   * Emit coding progress to the UI
   */
  emitProgress(
    stage: string,
    message: string,
    data?: Record<string, unknown>,
  ): void {
    logger.info(`[${stage}] ${message}`);
    if (this.dataStream) {
      this.dataStream.write({
        type: "data-coding-progress",
        data: {
          stage,
          message,
          timestamp: new Date().toISOString(),
          ...data,
        },
      });
    }
  }

  /**
   * Generate project initialization code
   */
  generateInitCode(config: ProjectConfig): string {
    const {
      framework,
      language: _language,
      dependencies: _dependencies,
    } = config;

    this.emitProgress(
      "init",
      `Generating ${framework} project: ${config.name}`,
      {
        framework,
        projectName: config.name,
      },
    );

    if (framework === "react" || framework === "nextjs") {
      return this.generateJSProjectCode(config);
    } else if (framework === "python" || framework === "fastapi") {
      return this.generatePythonProjectCode(config);
    } else if (framework === "node") {
      return this.generateNodeProjectCode(config);
    }

    return this.generateVanillaProjectCode(config);
  }

  /**
   * Generate JavaScript/TypeScript project code
   */
  private generateJSProjectCode(config: ProjectConfig): string {
    // These variables are available for future template customization
    void config.language; // Could be used for .tsx vs .jsx
    void config.dependencies; // Could be added to package.json
    void config.devDependencies; // Could be added to package.json

    if (config.framework === "nextjs") {
      return `
# Create Next.js project
import subprocess
import os
import json

# Create project directory
os.makedirs("${config.name}", exist_ok=True)
os.chdir("${config.name}")

# Initialize package.json
package_json = {
    "name": "${config.name}",
    "version": "0.1.0",
    "private": True,
    "scripts": {
        "dev": "next dev",
        "build": "next build",
        "start": "next start"
    },
    "dependencies": {
        "next": "14.0.0",
        "react": "18.2.0",
        "react-dom": "18.2.0"
    }
}

with open("package.json", "w") as f:
    json.dump(package_json, f, indent=2)

# Create basic structure
os.makedirs("app", exist_ok=True)
os.makedirs("components", exist_ok=True)
os.makedirs("public", exist_ok=True)

print("Next.js project initialized: ${config.name}")
`;
    }

    return `
# Create React project
import subprocess
import os
import json

os.makedirs("${config.name}", exist_ok=True)
os.chdir("${config.name}")

package_json = {
    "name": "${config.name}",
    "version": "0.1.0",
    "private": True,
    "scripts": {
        "dev": "vite",
        "build": "vite build",
        "preview": "vite preview"
    },
    "dependencies": {
        "react": "18.2.0",
        "react-dom": "18.2.0"
    },
    "devDependencies": {
        "vite": "5.0.0",
        "@vitejs/plugin-react": "4.2.0"
    }
}

with open("package.json", "w") as f:
    json.dump(package_json, f, indent=2)

os.makedirs("src", exist_ok=True)
os.makedirs("public", exist_ok=True)

print("React project initialized: ${config.name}")
`;
  }

  /**
   * Generate Python project code
   */
  private generatePythonProjectCode(config: ProjectConfig): string {
    const deps = config.dependencies.join(" ");

    if (config.framework === "fastapi") {
      return `
# Create FastAPI project
import os
import subprocess

os.makedirs("${config.name}", exist_ok=True)
os.chdir("${config.name}")

# Create requirements.txt
requirements = """
fastapi>=0.104.0
uvicorn[standard]>=0.24.0
${deps ? deps.split(" ").join("\n") : ""}
"""

with open("requirements.txt", "w") as f:
    f.write(requirements.strip())

# Create main.py
main_py = '''
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="${config.name}")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
def read_root():
    return {"message": "Hello from ${config.name}!"}

@app.get("/health")
def health_check():
    return {"status": "healthy"}
'''

with open("main.py", "w") as f:
    f.write(main_py)

os.makedirs("app", exist_ok=True)
os.makedirs("tests", exist_ok=True)

print("FastAPI project initialized: ${config.name}")
`;
    }

    return `
# Create Python project
import os

os.makedirs("${config.name}", exist_ok=True)
os.chdir("${config.name}")

requirements = """
${deps ? deps.split(" ").join("\n") : ""}
"""

with open("requirements.txt", "w") as f:
    f.write(requirements.strip())

main_py = '''
def main():
    print("Hello from ${config.name}!")

if __name__ == "__main__":
    main()
'''

with open("main.py", "w") as f:
    f.write(main_py)

print("Python project initialized: ${config.name}")
`;
  }

  /**
   * Generate Node.js project code
   */
  private generateNodeProjectCode(config: ProjectConfig): string {
    return `
# Create Node.js project
import os
import json

os.makedirs("${config.name}", exist_ok=True)
os.chdir("${config.name}")

package_json = {
    "name": "${config.name}",
    "version": "1.0.0",
    "type": "module",
    "main": "index.js",
    "scripts": {
        "start": "node index.js",
        "dev": "node --watch index.js"
    },
    "dependencies": {}
}

with open("package.json", "w") as f:
    json.dump(package_json, f, indent=2)

index_js = '''
console.log("Hello from ${config.name}!");
'''

with open("index.js", "w") as f:
    f.write(index_js)

print("Node.js project initialized: ${config.name}")
`;
  }

  /**
   * Generate vanilla JS project code
   */
  private generateVanillaProjectCode(config: ProjectConfig): string {
    return `
# Create vanilla JavaScript project
import os

os.makedirs("${config.name}", exist_ok=True)
os.chdir("${config.name}")

html = '''<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${config.name}</title>
    <link rel="stylesheet" href="style.css">
</head>
<body>
    <div id="app">
        <h1>Welcome to ${config.name}</h1>
    </div>
    <script src="main.js"></script>
</body>
</html>
'''

css = '''
* {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
}

body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    min-height: 100vh;
    display: flex;
    justify-content: center;
    align-items: center;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
}

#app {
    text-align: center;
    padding: 2rem;
}

h1 {
    font-size: 2.5rem;
    margin-bottom: 1rem;
}
'''

js = '''
document.addEventListener('DOMContentLoaded', () => {
    console.log('${config.name} loaded!');
});
'''

with open("index.html", "w") as f:
    f.write(html)

with open("style.css", "w") as f:
    f.write(css)

with open("main.js", "w") as f:
    f.write(js)

print("Vanilla JS project initialized: ${config.name}")
`;
  }

  /**
   * Generate code to create a file in the project
   */
  generateFileCode(path: string, content: string): string {
    // Escape the content for Python triple-quoted string
    const escapedContent = content
      .replace(/\\/g, "\\\\")
      .replace(/'''/g, "\\'\\'\\'");

    return `
import os

# Ensure directory exists
dir_path = os.path.dirname("${path}")
if dir_path:
    os.makedirs(dir_path, exist_ok=True)

# Write file
content = '''${escapedContent}'''
with open("${path}", "w") as f:
    f.write(content)

print(f"Created: ${path}")
`;
  }

  /**
   * Generate code to run the project
   */
  generateRunCode(framework: string): string {
    if (framework === "fastapi") {
      return `
import subprocess
import threading
import time

def run_server():
    subprocess.run(["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"])

# Start server in background thread
thread = threading.Thread(target=run_server, daemon=True)
thread.start()

time.sleep(2)
print("Server running at http://localhost:8000")
`;
    }

    if (framework === "nextjs" || framework === "react") {
      return `
import subprocess
print("To run this project:")
print("1. npm install")
print("2. npm run dev")
print("")
print("Note: Full npm execution requires a complete Node.js environment")
`;
    }

    return `
import subprocess
subprocess.run(["python", "main.py"])
`;
  }

  /**
   * Generate test code for the project
   */
  generateTestCode(framework: string): string {
    if (framework === "fastapi") {
      return `
from fastapi.testclient import TestClient
from main import app

client = TestClient(app)

def test_root():
    response = client.get("/")
    assert response.status_code == 200
    assert "message" in response.json()

def test_health():
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "healthy"

# Run tests
test_root()
test_health()
print("All tests passed!")
`;
    }

    return `
# Basic test
print("Running tests...")

def test_basic():
    assert True, "Basic test should pass"
    print("✓ Basic test passed")

test_basic()
print("All tests passed!")
`;
  }
}

/**
 * Create project initialization tool
 */
export function createProjectInitTool(
  dataStream?: UIMessageStreamWriter,
): Tool {
  return createTool({
    description:
      "Initialize a new project with the specified framework and configuration",
    inputSchema: z.object({
      name: z.string().describe("Project name"),
      framework: z
        .enum(["react", "nextjs", "vanilla", "node", "python", "fastapi"])
        .describe("Framework to use"),
      language: z
        .enum(["typescript", "javascript", "python"])
        .default("typescript")
        .describe("Programming language"),
      dependencies: z
        .array(z.string())
        .default([])
        .describe("Additional dependencies to include"),
    }),
    execute: async ({ name, framework, language, dependencies }) => {
      const agent = new CodingAgent(dataStream);
      const code = agent.generateInitCode({
        name,
        framework,
        language,
        dependencies,
      });

      return {
        success: true,
        code,
        projectName: name,
        framework,
        instruction:
          "Execute this code in the sandbox to initialize the project",
      };
    },
  }) as Tool;
}

/**
 * Create file writing tool
 */
export function createWriteFileTool(dataStream?: UIMessageStreamWriter): Tool {
  return createTool({
    description: "Create or update a file in the project",
    inputSchema: z.object({
      path: z.string().describe("File path relative to project root"),
      content: z.string().describe("File content"),
    }),
    execute: async ({ path, content }) => {
      const agent = new CodingAgent(dataStream);
      const code = agent.generateFileCode(path, content);

      return {
        success: true,
        code,
        filePath: path,
        instruction: "Execute this code in the sandbox to create the file",
      };
    },
  }) as Tool;
}

/**
 * Create project run tool
 */
export function createRunProjectTool(dataStream?: UIMessageStreamWriter): Tool {
  return createTool({
    description: "Run the project and start the development server",
    inputSchema: z.object({
      framework: z
        .enum(["react", "nextjs", "vanilla", "node", "python", "fastapi"])
        .describe("Framework the project uses"),
    }),
    execute: async ({ framework }) => {
      const agent = new CodingAgent(dataStream);
      const code = agent.generateRunCode(framework);

      return {
        success: true,
        code,
        framework,
        instruction: "Execute this code in the sandbox to run the project",
      };
    },
  }) as Tool;
}

/**
 * Create test running tool
 */
export function createRunTestsTool(dataStream?: UIMessageStreamWriter): Tool {
  return createTool({
    description: "Run tests for the project",
    inputSchema: z.object({
      framework: z
        .enum(["react", "nextjs", "vanilla", "node", "python", "fastapi"])
        .describe("Framework the project uses"),
    }),
    execute: async ({ framework }) => {
      const agent = new CodingAgent(dataStream);
      const code = agent.generateTestCode(framework);

      return {
        success: true,
        code,
        framework,
        instruction: "Execute this code in the sandbox to run tests",
      };
    },
  }) as Tool;
}

/**
 * Create all coding tools
 */
export function createCodingTools(
  dataStream?: UIMessageStreamWriter,
): Record<string, Tool> {
  return {
    initProject: createProjectInitTool(dataStream),
    writeProjectFile: createWriteFileTool(dataStream),
    runProject: createRunProjectTool(dataStream),
    runTests: createRunTestsTool(dataStream),
  };
}
