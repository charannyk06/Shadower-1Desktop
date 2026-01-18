"use client";

import { ComposioToolInfo } from "app-types/composio";
import { Check, Copy, Loader, Play } from "lucide-react";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { Badge } from "ui/badge";
import { Button } from "ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "ui/dialog";
import JsonView from "ui/json-view";
import { Label } from "ui/label";
import { ScrollArea } from "ui/scroll-area";
import { Textarea } from "ui/textarea";

interface ComposioToolDetailPopupProps {
  readonly tool: ComposioToolInfo;
  readonly appName: string;
  readonly children: React.ReactNode;
}

export function ComposioToolDetailPopup({
  tool,
  appName,
  children,
}: ComposioToolDetailPopupProps) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("{}");
  const [output, setOutput] = useState<any>(null);
  const [isExecuting, setIsExecuting] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleExecute = useCallback(async () => {
    setIsExecuting(true);
    setOutput(null);

    try {
      const parsedInput = JSON.parse(input);
      const response = await fetch("/api/composio/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actionName: tool.name,
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
  }, [input, tool.name]);

  const handleCopy = useCallback(() => {
    const mentionText = `@composio("${tool.name}")`;
    navigator.clipboard.writeText(mentionText);
    setCopied(true);
    toast.success("Copied to clipboard");
    setTimeout(() => setCopied(false), 2000);
  }, [tool.name]);

  const parameters = tool.parameters?.properties || {};
  const requiredParams = tool.parameters?.required || [];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {tool.displayName || tool.name}
            <Badge variant="outline" className="text-xs">
              {appName}
            </Badge>
          </DialogTitle>
        </DialogHeader>

        <ScrollArea className="flex-1 pr-4">
          <div className="space-y-4">
            {tool.description && (
              <div>
                <Label className="text-muted-foreground">Description</Label>
                <p className="text-sm mt-1">{tool.description}</p>
              </div>
            )}

            {Object.keys(parameters).length > 0 && (
              <div>
                <Label className="text-muted-foreground">Parameters</Label>
                <div className="mt-2 space-y-2">
                  {Object.entries(parameters).map(
                    ([key, value]: [string, any]) => (
                      <div
                        key={key}
                        className="bg-secondary rounded-md p-2 text-sm"
                      >
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-medium">{key}</span>
                          {requiredParams.includes(key) && (
                            <Badge variant="destructive" className="text-xs">
                              required
                            </Badge>
                          )}
                          <span className="text-muted-foreground text-xs">
                            {value?.type || "any"}
                          </span>
                        </div>
                        {value?.description && (
                          <p className="text-xs text-muted-foreground mt-1">
                            {value.description}
                          </p>
                        )}
                      </div>
                    ),
                  )}
                </div>
              </div>
            )}

            <div>
              <Label htmlFor="input">Test Input (JSON)</Label>
              <Textarea
                id="input"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                className="font-mono text-sm mt-1 min-h-[100px]"
                placeholder='{"param": "value"}'
              />
            </div>

            <div className="flex gap-2">
              <Button
                onClick={handleExecute}
                disabled={isExecuting}
                className="flex-1"
              >
                {isExecuting ? (
                  <>
                    <Loader className="size-4 animate-spin mr-2" />
                    Executing...
                  </>
                ) : (
                  <>
                    <Play className="size-4 mr-2" />
                    Execute Tool
                  </>
                )}
              </Button>
              <Button variant="outline" onClick={handleCopy}>
                {copied ? (
                  <Check className="size-4" />
                ) : (
                  <Copy className="size-4" />
                )}
              </Button>
            </div>

            {output && (
              <div>
                <Label className="text-muted-foreground">Output</Label>
                <div className="mt-1 bg-secondary rounded-md p-3 max-h-[200px] overflow-auto">
                  <JsonView data={output} initialExpandDepth={3} />
                </div>
              </div>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
