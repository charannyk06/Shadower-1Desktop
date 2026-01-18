"use client";

import { useComposioTools } from "@/hooks/queries/use-composio";
import { ArrowLeft, Loader, Play, PlugIcon } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useState } from "react";
import { Badge } from "ui/badge";
import { Button } from "ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "ui/card";
import JsonView from "ui/json-view";
import { Label } from "ui/label";
import { ScrollArea } from "ui/scroll-area";
import { Skeleton } from "ui/skeleton";
import { Textarea } from "ui/textarea";

export default function ComposioTestPage() {
  const params = useParams();
  const appName = params.appName as string;

  const { data, isLoading } = useComposioTools(appName);
  const tools = data?.items || [];

  const [selectedTool, setSelectedTool] = useState<string | null>(null);
  const [input, setInput] = useState("{}");
  const [output, setOutput] = useState<any>(null);
  const [isExecuting, setIsExecuting] = useState(false);

  const selectedToolInfo = tools.find((t) => t.name === selectedTool);

  const handleExecute = useCallback(async () => {
    if (!selectedTool) return;

    setIsExecuting(true);
    setOutput(null);

    try {
      const parsedInput = JSON.parse(input);
      const response = await fetch("/api/composio/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actionName: selectedTool,
          params: parsedInput,
        }),
      });

      const result = await response.json();
      setOutput(result);
    } catch (error: any) {
      setOutput({ error: error.message || "Failed to execute tool" });
    } finally {
      setIsExecuting(false);
    }
  }, [input, selectedTool]);

  return (
    <div className="container mx-auto max-w-6xl py-8 px-4">
      <div className="flex items-center gap-4 mb-6">
        <Link href="/integrations">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="size-4" />
          </Button>
        </Link>
        <div className="flex items-center gap-2">
          <PlugIcon className="size-5" />
          <h1 className="text-2xl font-bold capitalize">{appName} Tools</h1>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Available Tools</CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[500px]">
              {isLoading && (
                <div className="space-y-2">
                  {Array.from({ length: 5 }, (_, i) => (
                    <Skeleton key={`skeleton-${i}`} className="h-16 w-full" />
                  ))}
                </div>
              )}
              {!isLoading && tools.length === 0 && (
                <p className="text-muted-foreground text-center py-8">
                  No tools available for this app
                </p>
              )}
              {!isLoading && tools.length > 0 && (
                <div className="space-y-2">
                  {tools.map((tool) => (
                    <button
                      key={tool.name}
                      type="button"
                      onClick={() => {
                        setSelectedTool(tool.name);
                        setOutput(null);
                        setInput("{}");
                      }}
                      className={`w-full text-left p-3 rounded-md cursor-pointer transition-colors ${
                        selectedTool === tool.name
                          ? "bg-primary text-primary-foreground"
                          : "bg-secondary hover:bg-secondary/80"
                      }`}
                    >
                      <p className="font-medium text-sm truncate">
                        {tool.displayName || tool.name}
                      </p>
                      <p
                        className={`text-xs line-clamp-2 ${
                          selectedTool === tool.name
                            ? "text-primary-foreground/70"
                            : "text-muted-foreground"
                        }`}
                      >
                        {tool.description}
                      </p>
                    </button>
                  ))}
                </div>
              )}
            </ScrollArea>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              Test Tool
              {selectedToolInfo && (
                <Badge variant="outline">
                  {selectedToolInfo.displayName || selectedToolInfo.name}
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {selectedTool ? (
              <div className="space-y-4">
                {selectedToolInfo?.description && (
                  <p className="text-sm text-muted-foreground">
                    {selectedToolInfo.description}
                  </p>
                )}

                {selectedToolInfo?.parameters?.properties && (
                  <div>
                    <Label className="text-muted-foreground text-xs">
                      Parameters
                    </Label>
                    <div className="mt-1 space-y-1">
                      {Object.entries(
                        selectedToolInfo.parameters.properties,
                      ).map(([key, value]: [string, any]) => (
                        <div
                          key={key}
                          className="text-xs bg-secondary/50 rounded px-2 py-1"
                        >
                          <span className="font-mono">{key}</span>
                          <span className="text-muted-foreground ml-2">
                            ({value?.type || "any"})
                          </span>
                          {selectedToolInfo.parameters?.required?.includes(
                            key,
                          ) && (
                            <Badge
                              variant="destructive"
                              className="ml-2 text-[10px] px-1 py-0"
                            >
                              required
                            </Badge>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div>
                  <Label htmlFor="input">Input (JSON)</Label>
                  <Textarea
                    id="input"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    className="font-mono text-sm mt-1 min-h-[120px]"
                    placeholder='{"param": "value"}'
                  />
                </div>

                <Button
                  onClick={handleExecute}
                  disabled={isExecuting}
                  className="w-full"
                >
                  {isExecuting ? (
                    <>
                      <Loader className="size-4 animate-spin mr-2" />
                      Executing...
                    </>
                  ) : (
                    <>
                      <Play className="size-4 mr-2" />
                      Execute
                    </>
                  )}
                </Button>

                {output && (
                  <div>
                    <Label className="text-muted-foreground text-xs">
                      Output
                    </Label>
                    <div className="mt-1 bg-secondary rounded-md p-3 max-h-[200px] overflow-auto">
                      <JsonView data={output} initialExpandDepth={3} />
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex items-center justify-center h-[300px] text-muted-foreground">
                Select a tool from the list to test it
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
