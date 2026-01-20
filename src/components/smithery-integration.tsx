"use client";

import { MCPServerConfig } from "app-types/mcp";
import { isMaybeMCPServerConfig } from "lib/ai/mcp/is-mcp-config";
import { safeJSONParse } from "lib/utils";
import { Check, Copy, ExternalLink } from "lucide-react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";

interface SmitheryIntegrationProps {
  children?: React.ReactNode;
}

export function SmitheryIntegration({ children }: SmitheryIntegrationProps) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [configJson, setConfigJson] = useState("");
  const [serverName, setServerName] = useState("");
  const [copied, setCopied] = useState(false);
  const [smitheryUrl, setSmitheryUrl] = useState("");
  const [importMode, setImportMode] = useState<"url" | "json">("url");

  const handleQuickImport = () => {
    if (!smitheryUrl.trim()) {
      toast.error("Please enter the Smithery connection URL");
      return;
    }

    // Extract server name from URL if possible
    const urlMatch = smitheryUrl.match(/smithery\.ai\/(?:server\/)?([^\/\?]+)/);
    const extractedName = urlMatch ? urlMatch[1] : "smithery-server";

    // Convert Smithery URL to MCP config
    const config: MCPServerConfig = {
      url: smitheryUrl.startsWith("http")
        ? smitheryUrl
        : `https://${smitheryUrl}`,
    };

    const name = serverName.trim() || extractedName;
    const params = new URLSearchParams();
    params.set("name", name);
    params.set("config", JSON.stringify(config));

    setOpen(false);
    navigate({ to: `/mcp/create?${params.toString()}` });
  };

  const handleImport = () => {
    if (!configJson.trim()) {
      toast.error("Please paste the MCP server configuration JSON");
      return;
    }

    const parsed = safeJSONParse(configJson);
    if (!parsed || !isMaybeMCPServerConfig(parsed)) {
      toast.error(
        "Invalid MCP server configuration. Please check the JSON format.",
      );
      return;
    }

    const name = serverName.trim() || "smithery-server";
    const params = new URLSearchParams();
    params.set("name", name);
    params.set("config", JSON.stringify(parsed));

    setOpen(false);
    navigate({ to: `/mcp/create?${params.toString()}` });
  };

  const copyExampleConfig = () => {
    const example = {
      url: "https://server.smithery.ai/googlecalendar",
    };
    navigator.clipboard.writeText(JSON.stringify(example, null, 2));
    setCopied(true);
    toast.success("Example configuration copied!");
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {children || (
          <Button className="font-semibold" variant={"ghost"}>
            Marketplace
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span>Import from Smithery</span>
            <a
              href="https://smithery.ai/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline flex items-center gap-1"
            >
              <span className="text-sm">Visit Smithery</span>
              <ExternalLink className="size-4" />
            </a>
          </DialogTitle>
          <DialogDescription>
            Browse MCP servers on Smithery and import them into your app. Copy
            the connection URL from Smithery's "Connect" section.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-4">
          <div className="bg-muted/50 p-4 rounded-lg space-y-3">
            <h4 className="font-semibold text-sm">
              How to import from Smithery:
            </h4>
            <ol className="list-decimal list-inside space-y-2 text-sm text-muted-foreground">
              <li>
                Click{" "}
                <a
                  href="https://smithery.ai/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline inline-flex items-center gap-1"
                >
                  Visit Smithery <ExternalLink className="size-3" />
                </a>{" "}
                to browse available MCP servers
              </li>
              <li>
                Click on a server (e.g., Google Calendar, Gmail, etc.) to view
                its details
              </li>
              <li>
                In the <strong>"Connect"</strong> section on the right, find{" "}
                <strong>"Get connection URL"</strong>
              </li>
              <li>
                Copy the URL (e.g.,{" "}
                <code className="bg-muted px-1 rounded text-xs">
                  https://server.smithery.ai/googlecalendar
                </code>
                )
              </li>
              <li>Paste it in the "Quick Import" field below</li>
            </ol>
            <div className="mt-3 p-3 bg-background/50 rounded border border-border/50">
              <p className="text-xs font-medium mb-1">Quick Tip:</p>
              <p className="text-xs text-muted-foreground">
                Look for the <strong>"Get connection URL"</strong> field in the{" "}
                <strong>"Connect"</strong> section on the Smithery server page.
                It will look like:{" "}
                <code className="bg-muted px-1 rounded">
                  https://server.smithery.ai/[server-name]
                </code>
              </p>
            </div>
          </div>

          <div className="flex gap-2 border-b pb-4">
            <Button
              variant={importMode === "url" ? "default" : "ghost"}
              size="sm"
              onClick={() => setImportMode("url")}
              className="flex-1"
            >
              Quick Import (URL)
            </Button>
            <Button
              variant={importMode === "json" ? "default" : "ghost"}
              size="sm"
              onClick={() => setImportMode("json")}
              className="flex-1"
            >
              Advanced (JSON)
            </Button>
          </div>

          {importMode === "url" ? (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="smithery-url">
                  Smithery Connection URL{" "}
                  <span className="text-muted-foreground text-xs font-normal">
                    (from "Get connection URL" field)
                  </span>
                </Label>
                <Input
                  id="smithery-url"
                  type="text"
                  placeholder="https://server.smithery.ai/googlecalendar"
                  value={smitheryUrl}
                  onChange={(e) => setSmitheryUrl(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Paste the connection URL from Smithery's "Connect" section.
                  Example:{" "}
                  <code className="bg-muted px-1 rounded">
                    https://server.smithery.ai/googlecalendar
                  </code>
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="server-name-url">Server Name (optional)</Label>
                <Input
                  id="server-name-url"
                  type="text"
                  placeholder="Auto-detected from URL"
                  value={serverName}
                  onChange={(e) => setServerName(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Leave empty to auto-detect from URL, or enter a custom name
                </p>
              </div>

              <div className="flex gap-2 justify-end pt-2">
                <Button variant="outline" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button
                  onClick={handleQuickImport}
                  disabled={!smitheryUrl.trim()}
                >
                  Import Server
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="server-name">Server Name (optional)</Label>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={copyExampleConfig}
                    className="h-7 text-xs"
                  >
                    {copied ? (
                      <>
                        <Check className="size-3 mr-1" />
                        Copied!
                      </>
                    ) : (
                      <>
                        <Copy className="size-3 mr-1" />
                        Copy Example
                      </>
                    )}
                  </Button>
                </div>
                <Input
                  id="server-name"
                  type="text"
                  placeholder="e.g., gmail, notion, linear"
                  value={serverName}
                  onChange={(e) => setServerName(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="config-json">
                  MCP Server Configuration (JSON)
                </Label>
                <Textarea
                  id="config-json"
                  placeholder='Paste configuration JSON here, e.g., {"url": "https://server.smithery.ai/googlecalendar"}'
                  value={configJson}
                  onChange={(e) => setConfigJson(e.target.value)}
                  className="font-mono text-sm min-h-[200px]"
                />
                <p className="text-xs text-muted-foreground">
                  Configuration should be a JSON object with either a{" "}
                  <code className="bg-muted px-1 rounded">url</code> (for remote
                  servers) or{" "}
                  <code className="bg-muted px-1 rounded">command</code> (for
                  stdio servers).
                </p>
              </div>

              <div className="flex gap-2 justify-end pt-2">
                <Button variant="outline" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={handleImport} disabled={!configJson.trim()}>
                  Import Server
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
