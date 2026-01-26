import MCPEditor from "@/components/mcp-editor";
import { ArrowLeft } from "lucide-react";
import { Link, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";

export default function McpCreatePage() {
  // Get search params from URL
  const searchParams = useSearch({ strict: false }) as {
    name?: string;
    config?: string;
  };

  const [initialConfig, setInitialConfig] = useState<any>();
  const [initialName, setInitialName] = useState<string>();

  useEffect(() => {
    const name = searchParams?.name;
    const config = searchParams?.config;

    if (name && config) {
      try {
        setInitialConfig(JSON.parse(config));
        setInitialName(name);
      } catch (e) {
        console.error("Failed to parse config from URL params", e);
      }
    }
  }, [searchParams]);

  return (
    <div className="container max-w-3xl mx-0 px-4 sm:mx-4 md:mx-auto py-8">
      <div className="flex flex-col gap-2">
        <Link
          to="/mcp"
          className="flex items-center gap-2 text-muted-foreground text-sm hover:text-foreground transition-colors mb-8"
        >
          <ArrowLeft className="size-3" />
          Back
        </Link>
        <header className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <h2 className="text-3xl font-semibold my-2">MCP Configuration</h2>
            <p className="text text-muted-foreground">
              Configure your MCP server connection settings
            </p>
          </div>
        </header>

        <main className="my-8">
          <MCPEditor
            key={`${initialName}-${JSON.stringify(initialConfig)}`}
            initialConfig={initialConfig}
            name={initialName}
          />
        </main>
      </div>
    </div>
  );
}
