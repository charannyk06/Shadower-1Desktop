"use client";

import { memo, useCallback, useState } from "react";

import { Separator } from "@/components/ui/separator";

import { NodeKind, UINode } from "lib/ai/workflow/workflow.interface";

import {
  AlignHorizontalSpaceAround,
  Loader,
  PlayIcon,
  Sparkles,
} from "lucide-react";
import { Button } from "ui/button";

import equal from "lib/equal";

import { ShareableActions } from "@/components/shareable-actions";
import { Avatar, AvatarFallback, AvatarImage } from "ui/avatar";
import { Tooltip, TooltipContent, TooltipTrigger } from "ui/tooltip";

import { DBWorkflow } from "app-types/workflow";

import { Edge, useReactFlow } from "@xyflow/react";
import { arrangeNodes } from "lib/ai/workflow/arrange-nodes";
import { allNodeValidate } from "lib/ai/workflow/node-validate";
import { workflowApi } from "lib/electron/workflow-api";
import { generateUUID } from "lib/utils";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { mutate } from "swr";
import { safe } from "ts-safe";
import { handleErrorWithToast } from "ui/shared-toast";
import { EditWorkflowPopup } from "./edit-workflow-popup";
import { ExecuteTab } from "./node-config/execute-tab";
import { SelectedNodeConfigTab } from "./selected-node-config-tab";
import { WorkflowBuilderChat } from "./workflow-builder-chat";

/**
 * Converts a string to TipTap document format.
 */
function stringToTipTapDoc(text: string): {
  type: "doc";
  content: Array<{
    type: "paragraph";
    content: Array<{ type: "text"; text: string }>;
  }>;
} {
  return {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text }],
      },
    ],
  };
}

/**
 * Creates a default empty TipTap document.
 */
function createEmptyTipTapDoc(): { type: "doc"; content: [] } {
  return { type: "doc", content: [] };
}

/**
 * Creates a default branch structure for condition nodes.
 */
function createDefaultBranch() {
  return {
    id: generateUUID(),
    type: "if" as const,
    logicalOperator: "AND" as const,
    conditions: [],
  };
}

/**
 * Creates a default else branch structure for condition nodes.
 */
function createDefaultElseBranch() {
  return {
    id: generateUUID(),
    type: "else" as const,
    logicalOperator: "AND" as const,
    conditions: [],
  };
}

/**
 * Validates and ensures all required fields exist on a node based on its kind.
 * This is a safety net for AI-generated nodes that might be missing fields.
 */
function ensureNodeFields(node: any): UINode {
  const kind = node.data?.kind;
  const validatedData = { ...node.data };

  // Ensure basic fields
  validatedData.id = validatedData.id || node.id;
  validatedData.name = validatedData.name || `${kind} Node`;
  validatedData.description = validatedData.description || "";

  // Initialize outputSchema if missing
  if (!validatedData.outputSchema) {
    validatedData.outputSchema = { type: "object", properties: {} };
  }

  switch (kind) {
    case "input":
    case NodeKind.Input:
      // Input nodes need outputSchema with properties
      if (!validatedData.outputSchema.properties) {
        validatedData.outputSchema.properties = {};
      }
      break;

    case "output":
    case NodeKind.Output:
      // Output nodes need outputData array
      if (!Array.isArray(validatedData.outputData)) {
        validatedData.outputData = [];
      }
      // Ensure each outputData item has required structure
      validatedData.outputData = validatedData.outputData.map((item: any) => ({
        key: item.key || "result",
        source: item.source || undefined,
      }));
      break;

    case "llm":
    case NodeKind.LLM:
      // LLM nodes need model and messages
      validatedData.model = validatedData.model || "gemini-3-flash-preview";
      if (!Array.isArray(validatedData.messages)) {
        validatedData.messages = [
          {
            role: "user",
            content: createEmptyTipTapDoc(),
          },
        ];
      }
      // Ensure each message has content
      validatedData.messages = validatedData.messages.map((msg: any) => {
        const processedMsg: any = {
          role: msg.role || "user",
        };
        if (!msg.content) {
          processedMsg.content = createEmptyTipTapDoc();
        } else if (typeof msg.content === "string") {
          // Convert string to TipTap format
          processedMsg.content = stringToTipTapDoc(msg.content);
        } else {
          processedMsg.content = msg.content;
        }
        return processedMsg;
      });
      // Set default output schema for LLM
      if (!validatedData.outputSchema.properties?.answer) {
        validatedData.outputSchema = {
          type: "object",
          properties: {
            answer: { type: "string" },
            totalTokens: { type: "number" },
          },
        };
      }
      break;

    case "tool":
    case NodeKind.Tool:
      // Tool nodes need tool config, model, and message
      validatedData.model = validatedData.model || "gemini-3-flash-preview";
      // Ensure message is in TipTap format
      if (!validatedData.message) {
        validatedData.message = stringToTipTapDoc("Execute tool");
      } else if (typeof validatedData.message === "string") {
        validatedData.message = stringToTipTapDoc(validatedData.message);
      }
      // Set default output schema for tool
      if (!validatedData.outputSchema.properties?.tool_result) {
        validatedData.outputSchema = {
          type: "object",
          properties: {
            tool_result: { type: "object" },
          },
        };
      }
      break;

    case "condition":
    case NodeKind.Condition:
      // Condition nodes need branches structure
      if (!validatedData.branches) {
        validatedData.branches = {
          if: createDefaultBranch(),
          elseIf: [],
          else: createDefaultElseBranch(),
        };
      } else {
        // Ensure branches have required fields
        if (!validatedData.branches.if) {
          validatedData.branches.if = createDefaultBranch();
        }
        if (!validatedData.branches.if.id) {
          validatedData.branches.if.id = generateUUID();
        }
        if (!Array.isArray(validatedData.branches.elseIf)) {
          validatedData.branches.elseIf = [];
        }
        if (!validatedData.branches.else) {
          validatedData.branches.else = createDefaultElseBranch();
        }
        if (!validatedData.branches.else.id) {
          validatedData.branches.else.id = generateUUID();
        }
      }
      break;

    case "http":
    case NodeKind.Http:
      // HTTP nodes need method, headers, query arrays
      validatedData.method = validatedData.method || "GET";
      validatedData.headers = Array.isArray(validatedData.headers)
        ? validatedData.headers
        : [];
      validatedData.query = Array.isArray(validatedData.query)
        ? validatedData.query
        : [];
      validatedData.timeout = validatedData.timeout || 30000;
      break;

    case "template":
    case NodeKind.Template:
      // Template nodes need template structure
      if (!validatedData.template) {
        validatedData.template = {
          type: "tiptap",
          tiptap: createEmptyTipTapDoc(),
        };
      } else if (typeof validatedData.template === "string") {
        validatedData.template = {
          type: "tiptap",
          tiptap: stringToTipTapDoc(validatedData.template),
        };
      }
      break;

    case "note":
    case NodeKind.Note:
      // Note nodes are simple - just need description
      break;
  }

  return {
    ...node,
    id: node.id,
    type: node.type || "default",
    position: node.position || { x: 100, y: 200 },
    data: validatedData,
    // Remove any AI-generated style to prevent unwanted backgrounds
    style: undefined,
  } as UINode;
}

export const WorkflowPanel = memo(
  function WorkflowPanel({
    selectedNode,
    isProcessing,
    onSave,
    workflow,
    addProcess,
    hasEditAccess,
    setNodes,
    setEdges,
    skipAutoSaveRef,
    snapshotRef,
  }: {
    selectedNode?: UINode;
    onSave: () => Promise<void>;
    isProcessing: boolean;
    workflow: DBWorkflow;
    addProcess: () => () => void;
    hasEditAccess?: boolean;
    setNodes: (nodes: UINode[] | ((nds: UINode[]) => UINode[])) => void;
    setEdges: (edges: Edge[] | ((eds: Edge[]) => Edge[])) => void;
    skipAutoSaveRef?: React.MutableRefObject<boolean>;
    snapshotRef?: React.MutableRefObject<{ nodes: UINode[]; edges: Edge[] }>;
  }) {
    const { getNodes, getEdges } = useReactFlow();
    const [showExecutePanel, setShowExecutePanel] = useState(false);
    const [showBuilderChat, setShowBuilderChat] = useState(false);
    const [isEditing, setIsEditing] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const { t } = useTranslation();

    const handleArrangeNodes = useCallback(() => {
      const nodes = getNodes() as UINode[];
      const edges = getEdges();

      const { nodes: arrangedNodes } = arrangeNodes(nodes, edges);

      setNodes(arrangedNodes);
      toast.success(t("Workflow.nodesArranged"));
    }, [getNodes, getEdges, setNodes, t]);

    const updateVisibility = useCallback(
      (visibility: DBWorkflow["visibility"]) => {
        setIsSaving(true);
        const close = addProcess();
        safe(() => workflowApi.update(workflow.id, { visibility }))
          .ifOk(() => mutate(`/api/workflow/${workflow.id}`))
          .ifFail((e) => handleErrorWithToast(e))
          .watch(() => {
            setIsSaving(false);
            close();
          });
      },
      [workflow, addProcess],
    );

    const updatePublished = useCallback(
      (isPublished: boolean) => {
        if (isPublished) {
          const validateResult = allNodeValidate({
            nodes: getNodes() as UINode[],
            edges: getEdges(),
          });

          if (validateResult !== true) {
            if (validateResult.node) {
              setNodes((nds) => {
                return nds.map((node) => {
                  if (node.id === validateResult.node?.id) {
                    return { ...node, selected: true };
                  }
                  if (node.selected) {
                    return { ...node, selected: false };
                  }
                  return node;
                });
              });
            }
            return toast.warning(validateResult.errorMessage);
          }
        }

        const close = addProcess();
        safe(() => onSave())
          .ifOk(() => workflowApi.update(workflow.id, { isPublished }))
          .ifOk(() => mutate(`/api/workflow/${workflow.id}`))
          .ifFail((e) => handleErrorWithToast(e))
          .watch(close);
      },
      [workflow, getNodes, getEdges, setNodes, addProcess, onSave],
    );

    const handleWorkflowMasterSave = useCallback((workflow: DBWorkflow) => {
      mutate(`/api/workflow/${workflow.id}`);
      setIsEditing(false);
    }, []);

    /**
     * Handles applying AI-generated workflow nodes and edges to the canvas.
     * Validates all nodes and ensures they have required fields before applying.
     */
    const handleApplyWorkflow = useCallback(
      (
        nodes: UINode[],
        edges: Edge[],
        action: "replace" | "append" | "update",
      ) => {
        try {
          // Validate and ensure all nodes have required fields
          const validatedNodes = nodes.map((node) => ensureNodeFields(node));

          // Process edges - ensure they have valid IDs
          const validatedEdges = edges.map((edge) => ({
            ...edge,
            id: edge.id || generateUUID(),
            source: edge.source,
            target: edge.target,
            sourceHandle: edge.sourceHandle || null,
            targetHandle: edge.targetHandle || null,
          }));

          // Skip auto-save - we'll handle save manually
          if (skipAutoSaveRef) {
            skipAutoSaveRef.current = true;
          }

          if (action === "replace") {
            // Replace entire workflow
            setNodes(validatedNodes);
            setEdges(validatedEdges);

            // Update snapshot immediately to prevent stale diff calculations
            if (snapshotRef) {
              snapshotRef.current = {
                nodes: validatedNodes,
                edges: validatedEdges,
              };
            }
            // Save after state update
            setTimeout(() => {
              onSave()
                .then(() => {
                  toast.success("Workflow replaced and saved successfully");
                })
                .catch((err) => {
                  console.error("[WorkflowPanel] Save error:", err);
                  toast.error("Workflow applied but save failed");
                });
            }, 100);
          } else if (action === "append") {
            // Add new nodes and edges
            if (validatedNodes.length > 0) {
              setNodes((prev) => [...prev, ...validatedNodes]);
            }
            if (validatedEdges.length > 0) {
              setEdges((prev) => [...prev, ...validatedEdges]);
            }
            setTimeout(() => {
              onSave().catch((err) => {
                console.error("[WorkflowPanel] Save error:", err);
              });
            }, 100);
            toast.success("Nodes added to workflow");
          } else if (action === "update") {
            // Update existing nodes, add new ones
            // Uses ID matching first, then falls back to name+kind matching
            if (validatedNodes.length > 0) {
              setNodes((prev) => {
                const existingIds = new Set(prev.map((n) => n.id));

                // Process updates - map validated nodes to existing ones
                const updatedNodes = prev.map((existingNode) => {
                  // Find an update that matches this existing node
                  const update = validatedNodes.find((u) => {
                    // Exact ID match
                    if (u.id === existingNode.id) return true;
                    // Fallback: name + kind match (only if ID not already matched elsewhere)
                    if (
                      u.data?.name === existingNode.data?.name &&
                      u.data?.kind === existingNode.data?.kind &&
                      !existingIds.has(u.id)
                    ) {
                      return true;
                    }
                    return false;
                  });

                  if (update) {
                    return {
                      ...existingNode,
                      ...update,
                      id: existingNode.id, // Always preserve existing ID
                      data: {
                        ...existingNode.data,
                        ...update.data,
                        id: existingNode.id, // Ensure data.id matches
                      },
                    };
                  }
                  return existingNode;
                });

                // Filter truly new nodes (not matched to any existing node)
                const newNodes = validatedNodes.filter((n) => {
                  // If ID exists in canvas, it was updated (not new)
                  if (existingIds.has(n.id)) return false;
                  // If matched by name+kind, it was updated (not new)
                  const matchedByNameKind = prev.some(
                    (existing) =>
                      existing.data?.name === n.data?.name &&
                      existing.data?.kind === n.data?.kind,
                  );
                  return !matchedByNameKind;
                });

                return [...updatedNodes, ...newNodes];
              });
            }
            if (validatedEdges.length > 0) {
              setEdges((prev) => {
                const existingIds = new Set(prev.map((e) => e.id));
                const newEdges = validatedEdges.filter(
                  (e) => !existingIds.has(e.id),
                );
                return [...prev, ...newEdges];
              });
            }
            setTimeout(() => {
              onSave().catch((err) => {
                console.error("[WorkflowPanel] Save error:", err);
              });
            }, 100);
            toast.success("Workflow updated");
          }
        } catch (error) {
          console.error("[WorkflowPanel] Error applying workflow:", error);
          toast.error("Failed to apply workflow: " + String(error));
        }
      },
      [setNodes, setEdges, onSave],
    );

    return (
      <div className="min-h-0 flex flex-col items-end">
        <div className="flex items-center gap-2 mb-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <div
                style={{
                  backgroundColor: workflow.icon?.style?.backgroundColor,
                }}
                onClick={() => setIsEditing(true)}
                className="border transition-colors hover:bg-secondary! group items-center justify-center flex w-8 h-8 rounded-md ring ring-background hover:ring-ring"
              >
                <Avatar className="size-6">
                  <AvatarImage
                    src={workflow.icon?.value}
                    className="group-hover:scale-110  transition-transform"
                  />
                  <AvatarFallback></AvatarFallback>
                </Avatar>
              </div>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p>{workflow?.name}</p>
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="secondary"
                size="icon"
                disabled={isProcessing || !hasEditAccess}
                onClick={handleArrangeNodes}
              >
                <AlignHorizontalSpaceAround className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p>{t("Workflow.arrangeNodes")}</p>
            </TooltipContent>
          </Tooltip>
          <div className="h-6">
            <Separator orientation="vertical" />
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={showBuilderChat ? "default" : "secondary"}
                className={
                  showBuilderChat
                    ? "bg-primary text-primary-foreground hover:bg-primary/90"
                    : ""
                }
                disabled={
                  isProcessing || !hasEditAccess || workflow.isPublished
                }
                onClick={() => setShowBuilderChat(!showBuilderChat)}
              >
                <Sparkles className="size-4 mr-2" />
                {t("Common.build")}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p>AI Workflow Builder</p>
            </TooltipContent>
          </Tooltip>
          <div className="h-6">
            <Separator orientation="vertical" />
          </div>
          <Button
            variant="secondary"
            disabled={isProcessing}
            onClick={() => {
              setNodes((nds) => {
                return nds.map((node) => {
                  if (node.selected) {
                    return { ...node, selected: false };
                  }
                  return node;
                });
              });
              setShowExecutePanel(!showExecutePanel);
            }}
          >
            <PlayIcon />
            {t("Common.run")}
          </Button>

          {!workflow.isPublished && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  disabled={isProcessing || !hasEditAccess}
                  onClick={onSave}
                  variant="default"
                >
                  {isProcessing ? (
                    <Loader className="size-3.5 animate-spin" />
                  ) : (
                    t("Common.save")
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {t("Workflow.autoSaveDescription")}
              </TooltipContent>
            </Tooltip>
          )}
          <div className="h-6">
            <Separator orientation="vertical" />
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={"secondary"}
                disabled={isProcessing || !hasEditAccess}
                onClick={() => updatePublished(!workflow.isPublished)}
                className="w-20"
              >
                {workflow.isPublished
                  ? t("Common.edit")
                  : t("Workflow.publish")}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" align="end" className="w-60 text-sm">
              <p className="whitespace-pre-wrap break-words p-4">
                {workflow.isPublished
                  ? t("Workflow.publishedDescription")
                  : t("Workflow.draftDescription")}
              </p>
            </TooltipContent>
          </Tooltip>
          <ShareableActions
            type="workflow"
            visibility={workflow.visibility}
            isOwner={hasEditAccess || false}
            onVisibilityChange={hasEditAccess ? updateVisibility : undefined}
            isVisibilityChangeLoading={isSaving}
          />
        </div>
        <div className="flex gap-2">
          {selectedNode && <SelectedNodeConfigTab node={selectedNode} />}
          {showExecutePanel && (
            <ExecuteTab
              close={() => {
                if (isProcessing) return;
                setShowExecutePanel(false);
              }}
              onSave={onSave}
            />
          )}
          {showBuilderChat && (
            <WorkflowBuilderChat
              onClose={() => setShowBuilderChat(false)}
              workflowId={workflow.id}
              currentWorkflowState={{
                nodes: getNodes() as UINode[],
                edges: getEdges(),
              }}
              onApply={handleApplyWorkflow}
            />
          )}
        </div>
        <EditWorkflowPopup
          open={isEditing}
          onOpenChange={setIsEditing}
          defaultValue={workflow}
          onSave={handleWorkflowMasterSave}
        />
      </div>
    );
  },
  (prev, next) => {
    if (prev.isProcessing !== next.isProcessing) {
      return false;
    }
    if (Boolean(prev.selectedNode) !== Boolean(next.selectedNode)) {
      return false;
    }
    if (prev.hasEditAccess !== next.hasEditAccess) {
      return false;
    }
    if (!equal(prev.selectedNode?.data, next.selectedNode?.data)) {
      return false;
    }

    if (!equal(prev.workflow, next.workflow)) return false;
    return true;
  },
);
