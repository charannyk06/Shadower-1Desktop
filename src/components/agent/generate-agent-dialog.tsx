"use client";

import { appStore } from "@/app/store";
import { SelectModel } from "@/components/select-model";
import { aiApi } from "@/lib/electron/ai-api";
import { ChatModel } from "app-types/chat";
import { buildAgentGenerationPrompt } from "lib/ai/prompts";
import { CommandIcon, CornerRightUpIcon } from "lucide-react";
import { useCallback, useState } from "react";
import { Button } from "ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "ui/dialog";
import { MessageLoading } from "ui/message-loading";
import { handleErrorWithToast } from "ui/shared-toast";
import { Textarea } from "ui/textarea";

// JSON Schema matching AgentGenerateSchema from app-types/agent
// Manually defined to avoid Zod 4 compatibility issues with zod-to-json-schema
const agentGenerateJsonSchema = {
  type: "object",
  properties: {
    name: {
      type: "string",
      description: "Agent name",
    },
    description: {
      type: "string",
      description: "Agent description",
    },
    instructions: {
      type: "string",
      description: "Agent instructions",
    },
    role: {
      type: "string",
      description: "Agent role",
    },
    tools: {
      type: "array",
      items: { type: "string" },
      description: "Agent allowed tools name",
      default: [],
    },
  },
  required: ["name", "description", "instructions", "role"],
};

interface GenerateAgentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAgentChange: (data: any) => void;
  onToolsGenerated?: (tools: string[]) => void;
  availableToolNames: string[];
}

export function GenerateAgentDialog({
  open,
  onOpenChange,
  onAgentChange,
  onToolsGenerated,
  availableToolNames,
}: GenerateAgentDialogProps) {
  const [generateModel, setGenerateModel] = useState<ChatModel | undefined>(
    appStore.getState().chatModel,
  );
  const [generateAgentPrompt, setGenerateAgentPrompt] = useState("");
  const [submittedPrompt, setSubmittedPrompt] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const submitGenerateAgent = useCallback(async () => {
    if (!generateModel) {
      handleErrorWithToast(new Error("Please select a model"));
      return;
    }

    const prompt = generateAgentPrompt.trim();
    if (!prompt) return;

    setSubmittedPrompt(prompt);
    setGenerateAgentPrompt(""); // Clear textarea immediately after submit
    setIsLoading(true);

    try {
      // Build system prompt with available tool names
      const systemPrompt = buildAgentGenerationPrompt(availableToolNames);

      // Call AI API via Electron IPC
      const result = await aiApi.generateObject({
        model: generateModel,
        prompt: {
          system: systemPrompt,
          user: prompt,
        },
        schema: agentGenerateJsonSchema,
      });

      // Pass generated data to parent
      onAgentChange(result);

      // Handle tools if generated
      if (result.tools && onToolsGenerated) {
        onToolsGenerated(result.tools);
      }

      // Close dialog after generation completes
      onOpenChange(false);
      setSubmittedPrompt("");
      // Reset to current global default model
      setGenerateModel(appStore.getState().chatModel);
    } catch (error) {
      handleErrorWithToast(error as Error);
    } finally {
      setIsLoading(false);
    }
  }, [
    generateModel,
    generateAgentPrompt,
    availableToolNames,
    onAgentChange,
    onToolsGenerated,
    onOpenChange,
  ]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="xl:max-w-[40vw] w-full max-w-full">
        <DialogHeader>
          <DialogTitle>Generate Agent</DialogTitle>
          <DialogDescription className="sr-only">
            Generate Agent
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-6 w-full">
          <div className="px-4">
            <p className="bg-secondary rounded-lg max-w-2/3 p-4">
              Describe the agent you want to create, including its role,
              personality, and what it should help with.
            </p>
          </div>

          <div className="flex justify-end px-4">
            <p className="text-sm bg-primary text-primary-foreground py-4 px-6 rounded-lg">
              {isLoading && submittedPrompt ? (
                submittedPrompt
              ) : (
                <MessageLoading className="size-4" />
              )}
            </p>
          </div>

          <div className="relative flex flex-col border rounded-lg p-4">
            <Textarea
              value={generateAgentPrompt}
              autoFocus
              placeholder="input prompt here..."
              disabled={isLoading}
              onChange={(e) => setGenerateAgentPrompt(e.target.value)}
              data-testid="agent-generate-agent-prompt-textarea"
              onKeyDown={(e) => {
                if (e.key === "Enter" && e.metaKey && !isLoading) {
                  e.preventDefault();
                  submitGenerateAgent();
                }
              }}
              className="w-full break-all pb-6 border-none! ring-0! resize-none min-h-24 max-h-48 overflow-y-auto placeholder:text-xs transition-colors"
            />
            <div className="flex justify-end items-center gap-2">
              <SelectModel
                showProvider
                onSelect={(model) => setGenerateModel(model)}
              />
              <Button
                disabled={!generateAgentPrompt.trim() || isLoading}
                size="sm"
                data-testid="agent-generate-agent-prompt-submit-button"
                onClick={submitGenerateAgent}
                className="text-xs"
              >
                <span className="mr-1">
                  {isLoading ? "Generating..." : "Send"}
                </span>
                {isLoading ? (
                  <div className="size-3 border border-current border-t-transparent rounded-full animate-spin" />
                ) : (
                  <>
                    <CommandIcon className="size-3" />
                    <CornerRightUpIcon className="size-3" />
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
