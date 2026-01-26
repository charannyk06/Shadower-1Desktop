"use client";
import { useObjectState } from "@/hooks/use-object-state";
import { userApi, userFetcher } from "@/lib/electron/user-api";
import { UserPreferences } from "app-types/user";
import { authClient } from "auth/client";
import { AlertCircle, ArrowLeft, Loader } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import useSWR from "swr";
import { safe } from "ts-safe";

import { useMcpList } from "@/hooks/queries/use-mcp-list";
import { MCPServerInfo } from "app-types/mcp";
import { Button } from "ui/button";
import { ExamplePlaceholder } from "ui/example-placeholder";
import { Input } from "ui/input";
import { Label } from "ui/label";
import { Skeleton } from "ui/skeleton";
import { Textarea } from "ui/textarea";
import { McpServerCustomizationContent } from "./mcp-customization-popup";

export function UserInstructionsContent() {
  const responseStyleExamples = useMemo(
    () => [
      "Keep responses concise and to the point",
      "Use bullet points for lists",
      "Include code examples when relevant",
      "Explain technical concepts simply",
    ],
    [],
  );

  const professionExamples = useMemo(
    () => [
      "Software Engineer",
      "Data Scientist",
      "Product Manager",
      "Designer",
      "Student",
    ],
    [],
  );

  const { data: session } = authClient.useSession();

  const [preferences, setPreferences] = useObjectState<UserPreferences>({
    displayName: "",
    responseStyleExample: "",
    profession: "",
    botName: "",
  });

  const {
    data,
    mutate: fetchPreferences,
    isLoading,
    isValidating,
  } = useSWR<UserPreferences>("/api/user/preferences", userFetcher, {
    fallback: {},
    dedupingInterval: 0,
    onSuccess: (data) => {
      setPreferences(data);
    },
  });

  const [isSaving, setIsSaving] = useState(false);

  const savePreferences = async () => {
    safe(() => setIsSaving(true))
      .ifOk(() => userApi.updatePreferences(preferences))
      .ifOk(() => fetchPreferences())
      .watch((result) => {
        if (result.isOk) toast.success("Preferences saved");
        else toast.error("Failed to save preferences");
      })
      .watch(() => setIsSaving(false));
  };

  const isDiff = useMemo(() => {
    if ((data?.displayName || "") !== (preferences.displayName || ""))
      return true;
    if ((data?.profession || "") !== (preferences.profession || ""))
      return true;
    if (
      (data?.responseStyleExample || "") !==
      (preferences.responseStyleExample || "")
    )
      return true;
    if ((data?.botName || "") !== (preferences.botName || "")) return true;
    return false;
  }, [preferences, data]);

  return (
    <div className="flex flex-col">
      <h3 className="text-xl font-semibold">User Instructions</h3>
      <p className="text-sm text-muted-foreground py-2 pb-6">
        Customize how the AI responds to you
      </p>

      <div className="flex flex-col gap-6 w-full">
        <div className="flex flex-col gap-2">
          <Label>What should we call you?</Label>
          {isLoading ? (
            <Skeleton className="h-9" />
          ) : (
            <Input
              placeholder={session?.user.name || ""}
              value={preferences.displayName}
              onChange={(e) => {
                setPreferences({
                  displayName: e.target.value,
                });
              }}
            />
          )}
        </div>

        <div className="flex flex-col gap-2">
          <Label>Bot Name</Label>
          {isLoading ? (
            <Skeleton className="h-9" />
          ) : (
            <Input
              placeholder="Shadower"
              value={preferences.botName}
              onChange={(e) => {
                setPreferences({
                  botName: e.target.value,
                });
              }}
            />
          )}
        </div>

        <div className="flex flex-col gap-2 text-foreground flex-1">
          <Label>What best describes your work?</Label>
          <div className="relative w-full">
            {isLoading ? (
              <Skeleton className="h-9" />
            ) : (
              <>
                <Input
                  value={preferences.profession}
                  onChange={(e) => {
                    setPreferences({
                      profession: e.target.value,
                    });
                  }}
                />
                {(preferences.profession?.length ?? 0) === 0 && (
                  <div className="absolute left-0 top-0 w-full h-full py-2 px-4 pointer-events-none">
                    <ExamplePlaceholder placeholder={professionExamples} />
                  </div>
                )}
              </>
            )}
          </div>
        </div>
        <div className="flex flex-col gap-2 text-foreground">
          <Label>
            What personal preferences should be taken into account in responses?
          </Label>
          <span className="text-xs text-muted-foreground"></span>
          <div className="relative w-full">
            {isLoading ? (
              <Skeleton className="h-60" />
            ) : (
              <>
                <Textarea
                  className="h-60 resize-none"
                  value={preferences.responseStyleExample}
                  onChange={(e) => {
                    setPreferences({
                      responseStyleExample: e.target.value,
                    });
                  }}
                />
                {(preferences.responseStyleExample?.length ?? 0) === 0 && (
                  <div className="absolute left-0 top-0 w-full h-full py-2 px-4 pointer-events-none">
                    <ExamplePlaceholder placeholder={responseStyleExamples} />
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
      {isDiff && !isValidating && (
        <div className="flex pt-4 items-center justify-end fade-in animate-in duration-300">
          <Button variant="ghost">Cancel</Button>
          <Button disabled={isSaving || isLoading} onClick={savePreferences}>
            Save
            {isSaving && <Loader className="size-4 ml-2 animate-spin" />}
          </Button>
        </div>
      )}
    </div>
  );
}

export function MCPInstructionsContent() {
  const [search, setSearch] = useState("");
  const [mcpServer, setMcpServer] = useState<
    (MCPServerInfo & { id: string }) | null
  >(null);

  const { isLoading, data: mcpList } = useMcpList();

  if (mcpServer) {
    return (
      <McpServerCustomizationContent
        title={
          <div className="flex flex-col">
            <button
              onClick={() => setMcpServer(null)}
              className="flex items-center gap-2 text-muted-foreground text-sm hover:text-foreground transition-colors mb-8"
            >
              <ArrowLeft className="size-3" />
              Back
            </button>
            {mcpServer.name}
          </div>
        }
        mcpServerInfo={mcpServer}
      />
    );
  }

  return (
    <div className="flex flex-col">
      <h3 className="text-xl font-semibold">MCP Instructions</h3>
      <p className="text-sm text-muted-foreground py-2 pb-6">
        Configure instructions for MCP servers
      </p>

      <div className="flex flex-col gap-6 w-full">
        <div className="flex flex-col gap-2 text-foreground flex-1">
          <Input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
            }}
            placeholder="Search..."
          />
        </div>
        <div className="flex flex-col gap-2 text-foreground flex-1">
          {isLoading ? (
            Array.from({ length: 10 }).map((_, index) => (
              <Skeleton key={index} className="h-14" />
            ))
          ) : mcpList?.length === 0 ? (
            <div className="flex flex-col gap-2 text-foreground flex-1">
              <p className="text-center py-8 text-muted-foreground">
                Configure your MCP server connection settings
              </p>
            </div>
          ) : (
            <div className="flex gap-2">
              {mcpList?.map((mcp) => (
                <Button
                  onClick={() => setMcpServer({ ...mcp, id: mcp.id })}
                  variant={"outline"}
                  size={"lg"}
                  key={mcp.id}
                >
                  <p>{mcp.name}</p>
                  {mcp.error ? (
                    <AlertCircle className="size-3.5 text-destructive" />
                  ) : mcp.status == "loading" ? (
                    <Loader className="size-3.5 animate-spin" />
                  ) : null}
                </Button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
