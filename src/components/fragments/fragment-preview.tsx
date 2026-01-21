"use client";

import { useState } from "react";
import {
  ExternalLink,
  Code,
  Eye,
  Loader2,
  Share2,
  Copy,
  Check,
  Sparkles,
  AlertCircle,
  Monitor,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { CodeBlock } from "@/components/ui/CodeBlock";

interface FragmentPreviewProps {
  fragmentId: string;
  title: string;
  template: string;
  previewUrl?: string;
  code?: string;
  status?: "draft" | "generating" | "ready" | "deployed" | "failed";
  className?: string;
}

const TEMPLATE_INFO: Record<
  string,
  { label: string; color: string; icon: string }
> = {
  "nextjs-developer": { label: "Next.js", color: "bg-black", icon: "⚛️" },
  "vue-developer": { label: "Vue.js", color: "bg-emerald-500", icon: "💚" },
  "streamlit-developer": {
    label: "Streamlit",
    color: "bg-red-500",
    icon: "📊",
  },
  "gradio-developer": { label: "Gradio", color: "bg-orange-500", icon: "🤖" },
  "code-interpreter-v1": { label: "Python", color: "bg-blue-500", icon: "🐍" },
};

/**
 * Get language for syntax highlighting based on template
 */
function getLanguageFromTemplate(template: string): string {
  const langMap: Record<string, string> = {
    "nextjs-developer": "tsx",
    "vue-developer": "vue",
    "streamlit-developer": "python",
    "gradio-developer": "python",
    "code-interpreter-v1": "python",
  };
  return langMap[template] || "text";
}

export function FragmentPreview({
  fragmentId,
  title,
  template,
  previewUrl,
  code,
  status = "ready",
  className,
}: FragmentPreviewProps) {
  const [isDeploying, setIsDeploying] = useState(false);
  const [deployedUrl, setDeployedUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showCode, setShowCode] = useState(false);
  const [deployDuration, setDeployDuration] = useState<string>("24h");
  const [iframeError, setIframeError] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [showLiveView, setShowLiveView] = useState(false);
  const [streamUrl, setStreamUrl] = useState<string | null>(null);
  const [isLoadingStream, setIsLoadingStream] = useState(false);

  const templateInfo = TEMPLATE_INFO[template] || {
    label: template,
    color: "bg-gray-500",
    icon: "📦",
  };

  const handleDeploy = async () => {
    setIsDeploying(true);
    try {
      // Use Electron IPC for sandbox deployment if available
      if (window.electronAPI?.sandbox?.deploy) {
        const result = await window.electronAPI.sandbox.deploy(fragmentId, {
          duration: deployDuration,
          code,
          template,
        });

        if (result.success && result.url) {
          setDeployedUrl(result.url);
          toast.success("Fragment deployed locally!", {
            description: "Your fragment is running in a local sandbox.",
          });
        } else {
          toast.error("Deployment failed", {
            description: result.error || "Please try again later.",
          });
        }
      } else {
        // Desktop mode - sandbox deployment not available yet
        toast.info("Sandbox deployment coming soon", {
          description:
            "Fragment deployment to sandbox is being developed for desktop.",
        });
      }
    } catch (error) {
      toast.error("Deployment error", {
        description:
          error instanceof Error ? error.message : "Please try again later.",
      });
    } finally {
      setIsDeploying(false);
    }
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success("Link copied to clipboard!");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Failed to copy", {
        description: "Please copy the link manually.",
      });
    }
  };

  const handleLiveView = async () => {
    if (showLiveView && streamUrl) {
      setShowLiveView(false);
      return;
    }

    setIsLoadingStream(true);
    try {
      // Use Electron IPC for sandbox streaming if available
      if (window.electronAPI?.sandbox?.stream) {
        const result = await window.electronAPI.sandbox.stream(fragmentId);

        if (result.success && result.streamUrl) {
          setStreamUrl(result.streamUrl);
          setShowLiveView(true);
          toast.success("Live view started!");
        } else {
          toast.error("Failed to start live view", {
            description: result.error || "Please try again later.",
          });
        }
      } else {
        // Desktop mode - sandbox streaming not available yet
        toast.info("Live view coming soon", {
          description:
            "Fragment live view is being developed for desktop.",
        });
      }
    } catch (err) {
      toast.error("Live view error", {
        description:
          err instanceof Error ? err.message : "Please try again later.",
      });
    } finally {
      setIsLoadingStream(false);
    }
  };

  return (
    <div
      className={cn(
        "rounded-lg border bg-card overflow-hidden shadow-sm",
        className,
      )}
    >
      {/* Header */}
      <div className="px-4 py-3 border-b bg-muted/30 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-lg">{templateInfo.icon}</span>
          <div>
            <h3 className="font-medium text-sm">{title}</h3>
            <Badge variant="secondary" className="text-xs mt-0.5">
              {templateInfo.label}
            </Badge>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {status === "generating" && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Generating...
            </div>
          )}

          {previewUrl && (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowCode(!showCode)}
              >
                {showCode ? (
                  <Eye className="h-4 w-4 mr-1.5" />
                ) : (
                  <Code className="h-4 w-4 mr-1.5" />
                )}
                {showCode ? "Preview" : "Code"}
              </Button>

              <Button
                variant="ghost"
                size="sm"
                onClick={handleLiveView}
                disabled={isLoadingStream}
              >
                {isLoadingStream ? (
                  <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                ) : (
                  <Monitor className="h-4 w-4 mr-1.5" />
                )}
                {showLiveView ? "Close Live" : "Live View"}
              </Button>

              <Button variant="ghost" size="sm" asChild>
                <a href={previewUrl} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="h-4 w-4 mr-1.5" />
                  Open
                </a>
              </Button>
            </>
          )}

          <Dialog>
            <DialogTrigger asChild>
              <Button variant="default" size="sm">
                <Share2 className="h-4 w-4 mr-1.5" />
                Deploy
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Sparkles className="h-5 w-5" />
                  Deploy "{title}"
                </DialogTitle>
                <DialogDescription>
                  Create a shareable public link for this fragment. Anyone with
                  the link can view it.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4 py-4">
                {!deployedUrl ? (
                  <>
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Duration</label>
                      <Select
                        value={deployDuration}
                        onValueChange={setDeployDuration}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="1h">1 hour</SelectItem>
                          <SelectItem value="6h">6 hours</SelectItem>
                          <SelectItem value="24h">24 hours</SelectItem>
                          <SelectItem value="7d">7 days</SelectItem>
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">
                        The link will expire after this duration.
                      </p>
                    </div>

                    <Button
                      onClick={handleDeploy}
                      disabled={isDeploying}
                      className="w-full"
                    >
                      {isDeploying ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          Deploying...
                        </>
                      ) : (
                        <>
                          <Share2 className="h-4 w-4 mr-2" />
                          Deploy & Get Link
                        </>
                      )}
                    </Button>
                  </>
                ) : (
                  <div className="space-y-3">
                    <div className="p-3 bg-muted rounded-lg flex items-center justify-between">
                      <code className="text-sm truncate flex-1">
                        {deployedUrl}
                      </code>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => copyToClipboard(deployedUrl)}
                      >
                        {copied ? (
                          <Check className="h-4 w-4 text-green-500" />
                        ) : (
                          <Copy className="h-4 w-4" />
                        )}
                      </Button>
                    </div>

                    <div className="flex gap-2">
                      <Button variant="outline" className="flex-1" asChild>
                        <a
                          href={deployedUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <ExternalLink className="h-4 w-4 mr-2" />
                          Open Link
                        </a>
                      </Button>
                      <Button
                        variant="outline"
                        className="flex-1"
                        onClick={() => copyToClipboard(deployedUrl)}
                      >
                        {copied ? (
                          <>
                            <Check className="h-4 w-4 mr-2 text-green-500" />
                            Copied!
                          </>
                        ) : (
                          <>
                            <Copy className="h-4 w-4 mr-2" />
                            Copy Link
                          </>
                        )}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Content */}
      <div className="relative">
        {showCode && code ? (
          <div className="p-4 overflow-auto max-h-[400px] bg-muted/50">
            <CodeBlock
              code={code}
              lang={getLanguageFromTemplate(template)}
              showLineNumbers={true}
              fallback={
                <pre className="p-4 overflow-auto max-h-[400px] bg-muted/50 text-sm">
                  <code>{code}</code>
                </pre>
              }
            />
          </div>
        ) : showLiveView && streamUrl ? (
          <div className="relative w-full h-[400px]">
            <iframe
              src={streamUrl}
              className="w-full h-full border-0"
              title={`Live View - ${title}`}
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
              onLoad={() => setIsLoading(false)}
              onError={() => {
                setIsLoading(false);
                setIframeError(true);
              }}
            />
          </div>
        ) : previewUrl ? (
          <div className="relative w-full h-[400px]">
            {isLoading && (
              <div className="absolute inset-0 flex items-center justify-center bg-muted/50">
                <div className="text-center space-y-2">
                  <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">
                    Loading preview...
                  </p>
                </div>
              </div>
            )}
            {iframeError ? (
              <div className="absolute inset-0 flex items-center justify-center bg-muted/50">
                <div className="text-center space-y-2 p-4">
                  <AlertCircle className="h-8 w-8 mx-auto text-destructive" />
                  <p className="text-sm font-medium">Failed to load preview</p>
                  <p className="text-xs text-muted-foreground">
                    The preview URL may be unavailable or expired.
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setIframeError(false);
                      setIsLoading(true);
                    }}
                  >
                    Retry
                  </Button>
                </div>
              </div>
            ) : (
              <iframe
                src={previewUrl}
                className="w-full h-full border-0"
                title={title}
                sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
                onLoad={() => setIsLoading(false)}
                onError={() => {
                  setIsLoading(false);
                  setIframeError(true);
                }}
              />
            )}
          </div>
        ) : (
          <div className="h-[200px] flex items-center justify-center text-muted-foreground">
            {status === "generating" ? (
              <div className="text-center space-y-2">
                <Loader2 className="h-8 w-8 animate-spin mx-auto" />
                <p className="text-sm">Generating your app...</p>
              </div>
            ) : status === "failed" ? (
              <div className="text-center space-y-2 text-destructive">
                <p className="font-medium">Generation failed</p>
                <p className="text-sm">Please try again</p>
              </div>
            ) : (
              <p>No preview available</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
