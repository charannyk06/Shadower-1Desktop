"use client";

import { useState } from "react";
import { ExternalLink, Code, Eye, Clock, Users, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { CodeBlock } from "@/components/ui/CodeBlock";

interface FragmentViewerProps {
  fragment: {
    id: string;
    title: string;
    description: string;
    template: string;
    code: string;
    previewUrl?: string;
  };
  share: {
    expiresAt: Date | null;
    viewCount: number;
  };
}

const TEMPLATE_LABELS: Record<string, { label: string; color: string }> = {
  "nextjs-developer": { label: "Next.js", color: "bg-black text-white" },
  "vue-developer": { label: "Vue.js", color: "bg-emerald-500 text-white" },
  "streamlit-developer": { label: "Streamlit", color: "bg-red-500 text-white" },
  "gradio-developer": { label: "Gradio", color: "bg-orange-500 text-white" },
  "code-interpreter-v1": { label: "Python", color: "bg-blue-500 text-white" },
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

export function FragmentViewer({ fragment, share }: FragmentViewerProps) {
  const [activeTab, setActiveTab] = useState<"preview" | "code">("preview");

  const templateInfo = TEMPLATE_LABELS[fragment.template] || {
    label: fragment.template,
    color: "bg-gray-500 text-white",
  };

  const formatExpiresAt = (date: Date | null) => {
    if (!date) return "Never";
    const now = new Date();
    const diff = date.getTime() - now.getTime();
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ${hours % 24}h remaining`;
    if (hours > 0) return `${hours}h remaining`;
    return "Expires soon";
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="border-b bg-card/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              <span className="font-semibold text-lg">Shadower</span>
            </div>
            <div className="h-6 w-px bg-border" />
            <div>
              <h1 className="font-semibold">{fragment.title}</h1>
              {fragment.description && (
                <p className="text-sm text-muted-foreground">
                  {fragment.description}
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Badge className={templateInfo.color}>{templateInfo.label}</Badge>

            <div className="flex items-center gap-4 text-sm text-muted-foreground">
              <div className="flex items-center gap-1.5">
                <Users className="h-4 w-4" />
                <span>{share.viewCount} views</span>
              </div>
              {share.expiresAt && (
                <div className="flex items-center gap-1.5">
                  <Clock className="h-4 w-4" />
                  <span>{formatExpiresAt(share.expiresAt)}</span>
                </div>
              )}
            </div>

            {fragment.previewUrl && (
              <Button variant="outline" size="sm" asChild>
                <a
                  href={fragment.previewUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2"
                >
                  <ExternalLink className="h-4 w-4" />
                  Open in New Tab
                </a>
              </Button>
            )}
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 flex flex-col">
        {fragment.previewUrl ? (
          <>
            {/* Tab Switcher */}
            <div className="border-b bg-card/30">
              <div className="max-w-7xl mx-auto px-4">
                <Tabs
                  value={activeTab}
                  onValueChange={(v) => setActiveTab(v as "preview" | "code")}
                >
                  <TabsList className="bg-transparent h-auto p-0 gap-0">
                    <TabsTrigger
                      value="preview"
                      className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 py-2"
                    >
                      <Eye className="h-4 w-4 mr-2" />
                      Preview
                    </TabsTrigger>
                    <TabsTrigger
                      value="code"
                      className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 py-2"
                    >
                      <Code className="h-4 w-4 mr-2" />
                      Code
                    </TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>
            </div>

            {/* Tab Content */}
            <div className="flex-1">
              {activeTab === "preview" ? (
                <iframe
                  src={fragment.previewUrl}
                  className="w-full h-[calc(100vh-120px)] border-0"
                  title={fragment.title}
                  sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
                />
              ) : (
                <div className="max-w-7xl mx-auto p-4">
                  <CodeBlock
                    code={fragment.code}
                    lang={getLanguageFromTemplate(fragment.template)}
                    showLineNumbers={true}
                    fallback={
                      <pre className="bg-muted rounded-lg p-4 overflow-auto max-h-[calc(100vh-180px)]">
                        <code className="text-sm">{fragment.code}</code>
                      </pre>
                    }
                  />
                </div>
              )}
            </div>
          </>
        ) : (
          /* Code only view for code interpreter fragments */
          <div className="flex-1 p-4">
            <div className="max-w-7xl mx-auto">
              <div className="mb-4 flex items-center gap-2">
                <Code className="h-5 w-5" />
                <h2 className="font-semibold">Code</h2>
              </div>
              <CodeBlock
                code={fragment.code}
                lang={getLanguageFromTemplate(fragment.template)}
                showLineNumbers={true}
                fallback={
                  <pre className="bg-muted rounded-lg p-4 overflow-auto max-h-[calc(100vh-200px)]">
                    <code className="text-sm">{fragment.code}</code>
                  </pre>
                }
              />
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t bg-card/30 py-4">
        <div className="max-w-7xl mx-auto px-4 text-center text-sm text-muted-foreground">
          <p>
            Created with{" "}
            <a
              href="https://shadower.ai"
              className="font-medium text-foreground hover:text-primary transition-colors"
              target="_blank"
              rel="noopener noreferrer"
            >
              Shadower AI
            </a>{" "}
            — Build apps, dashboards, and documents with natural language
          </p>
        </div>
      </footer>
    </div>
  );
}
