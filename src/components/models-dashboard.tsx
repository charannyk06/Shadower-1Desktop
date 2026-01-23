"use client";

import { modelsFetcher, modelsApi } from "@/lib/electron/models-api";
import { mutate } from "swr";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ModelProviderIcon } from "@/components/ui/model-provider-icon";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "lib/utils";
import { Progress } from "@/components/ui/progress";
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Cloud,
  Cpu,
  Download,
  Eye,
  EyeOff,
  HardDrive,
  Key,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  Server,
  Box,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import useSWR from "swr";
import { LocalModelSetupWizard } from "@/components/local-model-setup-wizard";
import {
  findCuratedModel,
  getTopFastModels,
  getFastModels,
  getRecommendedSLMs,
} from "@/lib/ai/curated-local-models";
import { ModelFamilyIcon } from "@/components/ui/model-family-icon";

const LightRays = lazy(() => import("@/components/ui/light-rays"));

// Types
interface ApiKeyInfo {
  providerId: string;
  hasKey: boolean;
  isValid: boolean;
  lastValidatedAt?: string;
}

interface LocalModel {
  id: string;
  name: string;
  displayName: string;
  providerId: string;
  size?: number;
  quantization?: string;
  family?: string;
  status: "available" | "downloading" | "validating" | "error" | "disabled";
  downloadProgress?: number;
}

interface ProviderInfo {
  id: string;
  name: string;
  description: string;
  type: "cloud" | "local";
  authType: "api-key" | "oauth" | "none";
  defaultBaseUrl?: string;
  features?: string[];
}

// Provider Registry (static info)
const PROVIDER_REGISTRY: Record<string, ProviderInfo> = {
  openai: {
    id: "openai",
    name: "OpenAI",
    description: "GPT-4o, GPT-4.1, o3, o4 models",
    type: "cloud",
    authType: "api-key",
    defaultBaseUrl: "https://api.openai.com/v1",
    features: ["Tool calling", "Vision", "Reasoning models"],
  },
  anthropic: {
    id: "anthropic",
    name: "Anthropic",
    description: "Claude Sonnet, Claude Opus, Claude Haiku",
    type: "cloud",
    authType: "api-key",
    defaultBaseUrl: "https://api.anthropic.com",
    features: ["Tool calling", "Vision", "Extended thinking"],
  },
  google: {
    id: "google",
    name: "Google",
    description: "Gemini 3 Pro, Gemini 3 Flash, Gemini 2.5",
    type: "cloud",
    authType: "api-key",
    defaultBaseUrl: "https://generativelanguage.googleapis.com",
    features: ["Tool calling", "Vision", "Thinking modes"],
  },
  xai: {
    id: "xai",
    name: "xAI",
    description: "Grok 4, Grok 3 models",
    type: "cloud",
    authType: "api-key",
    features: ["Tool calling", "Vision", "Real-time data"],
  },
  groq: {
    id: "groq",
    name: "Groq",
    description: "Fast inference for Llama, Qwen, and other models",
    type: "cloud",
    authType: "api-key",
    defaultBaseUrl: "https://api.groq.com/openai/v1",
    features: ["Ultra-fast inference", "Tool calling"],
  },
  openRouter: {
    id: "openRouter",
    name: "OpenRouter",
    description: "Access to multiple providers with free tier models",
    type: "cloud",
    authType: "api-key",
    defaultBaseUrl: "https://openrouter.ai/api/v1",
    features: ["Multiple providers", "Free tier", "Fallback routing"],
  },
  cerebras: {
    id: "cerebras",
    name: "Cerebras",
    description: "High-speed inference for Llama and Qwen models",
    type: "cloud",
    authType: "api-key",
    features: ["Ultra-fast inference", "Tool calling"],
  },
  ollama: {
    id: "ollama",
    name: "Ollama",
    description: "Local model hosting and inference",
    type: "local",
    authType: "none",
    defaultBaseUrl: "http://localhost:11434",
    features: ["Local inference", "Model library", "Easy setup"],
  },
  lmstudio: {
    id: "lmstudio",
    name: "LM Studio",
    description: "Local model hosting with GUI",
    type: "local",
    authType: "none",
    defaultBaseUrl: "http://localhost:1234/v1",
    features: ["Local inference", "Model library", "GUI"],
  },
};

// Types for Ollama health
interface OllamaHealth {
  installed: boolean;
  running: boolean;
  version?: string;
  error?: string;
}

export default function ModelsDashboard() {
  const [activeTab, setActiveTab] = useState("api-keys");
  const [apiKeyDialogOpen, setApiKeyDialogOpen] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);

  // Ollama-specific state
  const [ollamaHealth, setOllamaHealth] = useState<OllamaHealth | null>(null);
  const [checkingHealth, setCheckingHealth] = useState(false);
  const [startingOllama, setStartingOllama] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [modelToDelete, setModelToDelete] = useState<LocalModel | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<Map<string, number>>(
    new Map(),
  );

  // Fetch data using SWR
  const {
    data: apiKeysData,
    mutate: mutateApiKeys,
    isLoading: isLoadingApiKeys,
  } = useSWR("/api/models/keys", modelsFetcher, {
    refreshInterval: 30000,
    revalidateOnFocus: true,
  });

  const {
    data: localModelsData,
    mutate: mutateLocalModels,
    isLoading: isLoadingLocalModels,
  } = useSWR("/api/models/local", modelsFetcher, {
    refreshInterval: 10000,
    revalidateOnFocus: true,
  });

  // Derived data
  const apiKeys: ApiKeyInfo[] = useMemo(() => {
    if (!apiKeysData?.keys) return [];
    return apiKeysData.keys;
  }, [apiKeysData]);

  const localModels: LocalModel[] = useMemo(() => {
    if (!localModelsData?.models) return [];
    return localModelsData.models;
  }, [localModelsData]);

  // Handlers
  const handleOpenApiKeyDialog = useCallback((providerId: string) => {
    setSelectedProvider(providerId);
    setApiKeyInput("");
    setShowApiKey(false);
    setTestResult(null);
    setApiKeyDialogOpen(true);
  }, []);

  const handleTestApiKey = useCallback(async () => {
    if (!selectedProvider || !apiKeyInput) return;

    setIsTesting(true);
    setTestResult(null);

    try {
      const result = await modelsApi.testApiKey({
        providerId: selectedProvider,
        apiKey: apiKeyInput,
      });

      if (result.success) {
        setTestResult({ success: true, message: "API key is valid!" });
      } else {
        setTestResult({
          success: false,
          message: result.error || "API key validation failed",
        });
      }
    } catch (_error) {
      setTestResult({ success: false, message: "Failed to test API key" });
    } finally {
      setIsTesting(false);
    }
  }, [selectedProvider, apiKeyInput]);

  const handleSaveApiKey = useCallback(async () => {
    if (!selectedProvider || !apiKeyInput) return;

    setIsSaving(true);

    try {
      const result = await modelsApi.saveKey({
        providerId: selectedProvider,
        apiKey: apiKeyInput,
      });

      if (result.success) {
        toast.success(
          `API key saved for ${PROVIDER_REGISTRY[selectedProvider]?.name}`,
        );
        setApiKeyDialogOpen(false);
        mutateApiKeys();
        // Invalidate models cache to refresh available providers immediately
        await mutate("/api/chat/models");
      } else {
        toast.error(result.error || "Failed to save API key");
      }
    } catch (_error) {
      toast.error("Failed to save API key");
    } finally {
      setIsSaving(false);
    }
  }, [selectedProvider, apiKeyInput, mutateApiKeys]);

  const handleDeleteApiKey = useCallback(
    async (providerId: string) => {
      try {
        const result = await modelsApi.deleteKey(providerId);

        if (result.success) {
          toast.success(
            `API key removed for ${PROVIDER_REGISTRY[providerId]?.name}`,
          );
          mutateApiKeys();
          // Invalidate models cache to remove provider from model dropdown immediately
          await mutate("/api/chat/models");
        } else {
          toast.error("Failed to remove API key");
        }
      } catch (_error) {
        toast.error("Failed to remove API key");
      }
    },
    [mutateApiKeys],
  );

  const handleRefreshLocalModels = useCallback(
    async (providerId: string) => {
      try {
        const result = await modelsApi.refreshLocalModels(providerId);

        if (result.success) {
          toast.success(
            `Refreshed models from ${PROVIDER_REGISTRY[providerId]?.name}`,
          );
          mutateLocalModels();
        } else {
          toast.error(result.error || "Failed to refresh models");
        }
      } catch (_error) {
        toast.error("Failed to refresh models");
      }
    },
    [mutateLocalModels],
  );

  // Check Ollama health
  const checkOllamaHealth = useCallback(async () => {
    setCheckingHealth(true);
    try {
      const result = await modelsApi.ollamaCheckHealth?.();
      if (result) {
        setOllamaHealth(result);
      }
    } catch (error) {
      console.error("Failed to check Ollama health:", error);
    } finally {
      setCheckingHealth(false);
    }
  }, []);

  // Check health on mount and tab change
  useEffect(() => {
    if (activeTab === "local-models") {
      checkOllamaHealth();
    }
  }, [activeTab, checkOllamaHealth]);

  // Start Ollama service
  const handleStartOllama = useCallback(async () => {
    setStartingOllama(true);
    try {
      const result = await modelsApi.ollamaTryStart?.();
      if (result?.success) {
        toast.success("Ollama started successfully");
        // Re-check health after starting
        await checkOllamaHealth();
        // Refresh models
        mutateLocalModels();
      } else {
        toast.error(result?.message || "Failed to start Ollama");
      }
    } catch (error: any) {
      toast.error(error.message || "Failed to start Ollama");
    } finally {
      setStartingOllama(false);
    }
  }, [checkOllamaHealth, mutateLocalModels]);

  // Delete a local model
  const handleDeleteModel = useCallback(
    async (model: LocalModel) => {
      try {
        const result = await modelsApi.deleteLocalModel({
          id: model.id,
          modelName: model.name,
          providerId: model.providerId,
          deleteFromProvider: true,
        });

        if (result.success) {
          toast.success(`Deleted ${model.displayName || model.name}`);
          mutateLocalModels();
        } else {
          toast.error(result.error || "Failed to delete model");
        }
      } catch (error: any) {
        toast.error(error.message || "Failed to delete model");
      } finally {
        setModelToDelete(null);
      }
    },
    [mutateLocalModels],
  );

  // Download a curated model
  const handleDownloadCuratedModel = useCallback(
    async (modelName: string) => {
      try {
        const result = await modelsApi.downloadModel?.({
          modelName,
        });

        if (result?.success) {
          toast.success(`Started downloading ${modelName}`);
          mutateLocalModels();
        } else {
          toast.error(result?.error || "Failed to start download");
        }
      } catch (error: any) {
        toast.error(error.message || "Failed to start download");
      }
    },
    [mutateLocalModels],
  );

  // Restore download progress state from database on mount/data change
  // This fixes the issue where download progress is lost on refresh
  useEffect(() => {
    if (localModelsData?.models) {
      const downloadingModels = localModelsData.models.filter(
        (m: LocalModel) => m.status === "downloading"
      );
      if (downloadingModels.length > 0) {
        setDownloadProgress((prev) => {
          const next = new Map(prev);
          for (const model of downloadingModels) {
            // Only set if not already tracked (to avoid overwriting live progress)
            if (!next.has(model.name)) {
              next.set(model.name, model.downloadProgress || 0);
            }
          }
          return next;
        });
      }
    }
  }, [localModelsData]);

  // Listen for download progress events via IPC
  useEffect(() => {
    // Set up IPC listeners for download events
    const unsubProgress = modelsApi.onDownloadProgress?.((data) => {
      const { modelName, progress } = data;
      setDownloadProgress((prev) => {
        const next = new Map(prev);
        next.set(modelName, progress);
        return next;
      });
    });

    const unsubComplete = modelsApi.onDownloadComplete?.((data) => {
      const { modelName } = data;
      setDownloadProgress((prev) => {
        const next = new Map(prev);
        next.delete(modelName);
        return next;
      });
      mutateLocalModels();
      toast.success(`Downloaded ${modelName} successfully`);
    });

    const unsubError = modelsApi.onDownloadError?.((data) => {
      const { modelName, error } = data;
      setDownloadProgress((prev) => {
        const next = new Map(prev);
        next.delete(modelName);
        return next;
      });
      toast.error(`Failed to download ${modelName}: ${error}`);
    });

    return () => {
      unsubProgress?.();
      unsubComplete?.();
      unsubError?.();
    };
  }, [mutateLocalModels]);

  // Check if provider has API key
  const hasApiKey = useCallback(
    (providerId: string) => {
      return apiKeys.some((k) => k.providerId === providerId && k.hasKey);
    },
    [apiKeys],
  );

  // Get API key status
  const getApiKeyStatus = useCallback(
    (providerId: string) => {
      const key = apiKeys.find((k) => k.providerId === providerId);
      if (!key || !key.hasKey) return "missing";
      return key.isValid ? "valid" : "invalid";
    },
    [apiKeys],
  );

  // Cloud providers
  const cloudProviders = useMemo(() => {
    return Object.values(PROVIDER_REGISTRY).filter((p) => p.type === "cloud");
  }, []);

  // Local providers
  const localProviders = useMemo(() => {
    return Object.values(PROVIDER_REGISTRY).filter((p) => p.type === "local");
  }, []);

  // Particle effects
  const particles = useMemo(() => {
    return (
      <>
        <div className="absolute opacity-30 pointer-events-none top-0 left-0 w-full h-full z-10 fade-in animate-in duration-5000">
          <Suspense fallback={null}>
            <LightRays className="bg-transparent" />
          </Suspense>
        </div>
        <div className="absolute pointer-events-none top-0 left-0 w-full h-full z-10 fade-in animate-in duration-5000">
          <div className="w-full h-full bg-gradient-to-t from-background to-50% to-transparent z-20" />
        </div>
        <div className="absolute pointer-events-none top-0 left-0 w-full h-full z-10 fade-in animate-in duration-5000">
          <div className="w-full h-full bg-gradient-to-l from-background to-20% to-transparent z-20" />
        </div>
        <div className="absolute pointer-events-none top-0 left-0 w-full h-full z-10 fade-in animate-in duration-5000">
          <div className="w-full h-full bg-gradient-to-r from-background to-20% to-transparent z-20" />
        </div>
      </>
    );
  }, []);

  return (
    <>
      {particles}
      <ScrollArea className="h-full w-full z-40">
        <div className="pt-8 flex-1 relative flex flex-col gap-6 px-8 max-w-4xl h-full mx-auto pb-8">
          {/* Header */}
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <Box className="size-6 text-primary" />
              </div>
              <div>
                <h1 className="text-2xl font-bold">Models</h1>
                <p className="text-muted-foreground text-sm">
                  Configure AI providers and manage local models
                </p>
              </div>
            </div>
          </div>

          {/* Tabs */}
          <Tabs
            value={activeTab}
            onValueChange={setActiveTab}
            className="w-full"
          >
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="api-keys" className="gap-2">
                <Key className="size-4" />
                API Keys
              </TabsTrigger>
              <TabsTrigger value="local-models" className="gap-2">
                <HardDrive className="size-4" />
                Local Models
              </TabsTrigger>
              <TabsTrigger value="cloud-providers" className="gap-2">
                <Cloud className="size-4" />
                Cloud Providers
              </TabsTrigger>
            </TabsList>

            {/* API Keys Tab */}
            <TabsContent value="api-keys" className="space-y-4 mt-4">
              <div className="text-sm text-muted-foreground mb-4">
                Add API keys to enable cloud providers. Keys are encrypted and
                stored securely.
              </div>

              {isLoadingApiKeys ? (
                <div className="space-y-3">
                  {[1, 2, 3, 4].map((i) => (
                    <Skeleton key={i} className="h-20 w-full" />
                  ))}
                </div>
              ) : (
                <div className="grid gap-3">
                  {cloudProviders.map((provider) => {
                    const status = getApiKeyStatus(provider.id);
                    return (
                      <Card
                        key={provider.id}
                        className={cn(
                          "transition-all",
                          status === "valid" &&
                            "border-green-500/30 bg-green-500/5",
                        )}
                      >
                        <CardContent className="p-4">
                          <div className="flex items-center gap-4">
                            <div className="p-2 rounded-lg bg-muted">
                              <ModelProviderIcon
                                provider={provider.id}
                                className="size-6"
                              />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <h3 className="font-semibold">
                                  {provider.name}
                                </h3>
                                {status === "valid" && (
                                  <Badge
                                    variant="outline"
                                    className="text-green-600 border-green-600/30"
                                  >
                                    <CheckCircle2 className="size-3 mr-1" />
                                    Connected
                                  </Badge>
                                )}
                                {status === "invalid" && (
                                  <Badge variant="destructive">
                                    <AlertCircle className="size-3 mr-1" />
                                    Invalid
                                  </Badge>
                                )}
                              </div>
                              <p className="text-sm text-muted-foreground truncate">
                                {provider.description}
                              </p>
                            </div>
                            <div className="flex items-center gap-2">
                              {hasApiKey(provider.id) ? (
                                <>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() =>
                                      handleOpenApiKeyDialog(provider.id)
                                    }
                                  >
                                    Update Key
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="text-destructive hover:text-destructive"
                                    onClick={() =>
                                      handleDeleteApiKey(provider.id)
                                    }
                                  >
                                    <Trash2 className="size-4" />
                                  </Button>
                                </>
                              ) : (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() =>
                                    handleOpenApiKeyDialog(provider.id)
                                  }
                                >
                                  <Plus className="size-4 mr-1" />
                                  Add Key
                                </Button>
                              )}
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )}
            </TabsContent>

            {/* Local Models Tab */}
            <TabsContent value="local-models" className="space-y-4 mt-4">
              <div className="text-sm text-muted-foreground mb-4">
                Manage models from local providers like Ollama and LM Studio.
              </div>

              {/* Ollama Status Card */}
              <Card
                className={cn(
                  "transition-all",
                  ollamaHealth?.running &&
                    "border-green-500/30 bg-green-500/5",
                )}
              >
                <CardContent className="p-4">
                  <div className="flex items-center gap-4">
                    <div className="p-2 rounded-lg bg-muted">
                      <ModelProviderIcon provider="ollama" className="size-6" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold">Ollama</h3>
                        {ollamaHealth?.running ? (
                          <Badge
                            variant="outline"
                            className="text-green-600 border-green-600/30"
                          >
                            <CheckCircle2 className="size-3 mr-1" />
                            Running
                          </Badge>
                        ) : ollamaHealth?.installed ? (
                          <Badge
                            variant="outline"
                            className="text-muted-foreground"
                          >
                            Not Running
                          </Badge>
                        ) : (
                          <Badge variant="destructive">
                            <AlertCircle className="size-3 mr-1" />
                            Not Installed
                          </Badge>
                        )}
                        {ollamaHealth?.version && (
                          <Badge variant="secondary" className="text-xs">
                            v{ollamaHealth.version}
                          </Badge>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground truncate">
                        {ollamaHealth?.running
                          ? "Local model hosting and inference"
                          : ollamaHealth?.installed
                            ? "Click Start to run Ollama"
                            : "Click Setup to install Ollama"}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {!ollamaHealth?.installed && (
                        <Button size="sm" onClick={() => setWizardOpen(true)}>
                          Setup
                        </Button>
                      )}
                      {ollamaHealth?.installed && !ollamaHealth?.running && (
                        <Button
                          size="sm"
                          onClick={handleStartOllama}
                          disabled={startingOllama}
                        >
                          {startingOllama ? (
                            <Loader2 className="size-4 animate-spin" />
                          ) : (
                            <>
                              <Play className="size-4 mr-1" />
                              Start
                            </>
                          )}
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={checkOllamaHealth}
                        disabled={checkingHealth}
                      >
                        {checkingHealth ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <RefreshCw className="size-4" />
                        )}
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Compact Models (SLMs) */}
              {ollamaHealth?.running && (
                <Card>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <div>
                        <CardTitle className="text-lg flex items-center gap-2">
                          <Zap className="size-5 text-muted-foreground" />
                          Compact Models
                        </CardTitle>
                        <CardDescription>
                          Lightweight models optimized for speed. Ideal for quick tasks with lower resource usage.
                        </CardDescription>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {getRecommendedSLMs().map((curatedModel) => {
                        const isInstalled = localModels.some(
                          (m) =>
                            (m.name === curatedModel.name ||
                             m.name === curatedModel.name.split(":")[0] ||
                             m.name.startsWith(curatedModel.name + ":")) &&
                            m.providerId === "ollama",
                        );
                        const isDownloading = downloadProgress.has(
                          curatedModel.name,
                        );
                        const progress =
                          downloadProgress.get(curatedModel.name) || 0;

                        return (
                          <div
                            key={curatedModel.name}
                            className={cn(
                              "flex items-center justify-between p-3 rounded-lg",
                              isInstalled
                                ? "bg-green-500/10 border border-green-500/30"
                                : "bg-muted/50"
                            )}
                          >
                            <div className="flex items-center gap-3 flex-1 min-w-0">
                              <div className="p-1.5 rounded-md bg-muted shrink-0">
                                <ModelFamilyIcon family={curatedModel.family} className="size-4" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <p className="font-medium">
                                    {curatedModel.displayName}
                                  </p>
                                  <Badge variant="secondary" className="text-xs">
                                    {curatedModel.size}
                                  </Badge>
                                  {curatedModel.toolCalling && (
                                    <Badge
                                      variant="outline"
                                      className="text-xs"
                                    >
                                      Tools
                                    </Badge>
                                  )}
                                </div>
                                <p className="text-xs text-muted-foreground truncate">
                                  {curatedModel.description}
                                </p>
                                {isDownloading && (
                                  <div className="mt-2">
                                    <Progress value={progress} className="h-1.5" />
                                    <p className="text-xs text-muted-foreground mt-1">
                                      Downloading... {progress}%
                                    </p>
                                  </div>
                                )}
                              </div>
                            </div>
                            <div className="flex items-center gap-2 shrink-0 ml-2">
                              {isInstalled ? (
                                <Badge
                                  variant="outline"
                                  className="text-green-600 border-green-600/30"
                                >
                                  <CheckCircle2 className="size-3 mr-1" />
                                  Installed
                                </Badge>
                              ) : isDownloading ? (
                                <Badge variant="secondary">{progress}%</Badge>
                              ) : (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() =>
                                    handleDownloadCuratedModel(curatedModel.name)
                                  }
                                >
                                  <Download className="size-4 mr-1" />
                                  Download
                                </Button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Recommended Models */}
              {ollamaHealth?.running && (
                <Card>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <div>
                        <CardTitle className="text-lg flex items-center gap-2">
                          <Cpu className="size-5 text-muted-foreground" />
                          Recommended Models
                        </CardTitle>
                        <CardDescription>
                          Balanced models with good quality and performance. Requires 8GB+ RAM.
                        </CardDescription>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {getTopFastModels().filter(m => !m.isSLM).slice(0, 4).map((curatedModel) => {
                        const isInstalled = localModels.some(
                          (m) =>
                            (m.name === curatedModel.name ||
                             m.name === curatedModel.name.split(":")[0] ||
                             m.name.startsWith(curatedModel.name + ":")) &&
                            m.providerId === "ollama",
                        );
                        const isDownloading = downloadProgress.has(
                          curatedModel.name,
                        );
                        const progress =
                          downloadProgress.get(curatedModel.name) || 0;

                        return (
                          <div
                            key={curatedModel.name}
                            className={cn(
                              "flex items-center justify-between p-3 rounded-lg",
                              isInstalled
                                ? "bg-green-500/10 border border-green-500/30"
                                : "bg-muted/50"
                            )}
                          >
                            <div className="flex items-center gap-3 flex-1 min-w-0">
                              <div className="p-1.5 rounded-md bg-muted shrink-0">
                                <ModelFamilyIcon family={curatedModel.family} className="size-4" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <p className="font-medium">
                                    {curatedModel.displayName}
                                  </p>
                                  <Badge variant="secondary" className="text-xs">
                                    {curatedModel.size}
                                  </Badge>
                                  {curatedModel.toolCalling && (
                                    <Badge
                                      variant="outline"
                                      className="text-xs"
                                    >
                                      Tools
                                    </Badge>
                                  )}
                                </div>
                                <p className="text-xs text-muted-foreground truncate">
                                  {curatedModel.description}
                                </p>
                                {isDownloading && (
                                  <div className="mt-2">
                                    <Progress value={progress} className="h-1.5" />
                                    <p className="text-xs text-muted-foreground mt-1">
                                      Downloading... {progress}%
                                    </p>
                                  </div>
                                )}
                              </div>
                            </div>
                            <div className="flex items-center gap-2 shrink-0 ml-2">
                              {isInstalled ? (
                                <Badge
                                  variant="outline"
                                  className="text-green-600 border-green-600/30"
                                >
                                  <CheckCircle2 className="size-3 mr-1" />
                                  Installed
                                </Badge>
                              ) : isDownloading ? (
                                <Badge variant="secondary">{progress}%</Badge>
                              ) : (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() =>
                                    handleDownloadCuratedModel(curatedModel.name)
                                  }
                                >
                                  <Download className="size-4 mr-1" />
                                  Download
                                </Button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* More Models */}
              {ollamaHealth?.running && (
                <Card>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <div>
                        <CardTitle className="text-lg flex items-center gap-2">
                          <Server className="size-5 text-muted-foreground" />
                          More Models
                        </CardTitle>
                        <CardDescription>
                          Additional models with tool support
                        </CardDescription>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {getFastModels()
                        .filter((m) => !m.recommended)
                        .slice(0, 6)
                        .map((curatedModel) => {
                          const isInstalled = localModels.some(
                            (m) =>
                              (m.name === curatedModel.name ||
                               m.name === curatedModel.name.split(":")[0] ||
                               m.name.startsWith(curatedModel.name + ":")) &&
                              m.providerId === "ollama",
                          );
                          const isDownloading = downloadProgress.has(
                            curatedModel.name,
                          );
                          const progress =
                            downloadProgress.get(curatedModel.name) || 0;

                          return (
                            <div
                              key={curatedModel.name}
                              className={cn(
                                "flex items-center justify-between p-3 rounded-lg",
                                isInstalled
                                  ? "bg-green-500/10 border border-green-500/30"
                                  : "bg-muted/50"
                              )}
                            >
                              <div className="flex items-center gap-3 flex-1 min-w-0">
                                <div className="p-1.5 rounded-md bg-muted shrink-0">
                                  <ModelFamilyIcon family={curatedModel.family} className="size-4" />
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <p className="font-medium">
                                      {curatedModel.displayName}
                                    </p>
                                    <Badge variant="secondary" className="text-xs">
                                      {curatedModel.size}
                                    </Badge>
                                    {curatedModel.toolCalling && (
                                      <Badge
                                        variant="outline"
                                        className="text-xs"
                                      >
                                        Tools
                                      </Badge>
                                    )}
                                  </div>
                                  <p className="text-xs text-muted-foreground truncate">
                                    {curatedModel.description}
                                  </p>
                                  {isDownloading && (
                                    <div className="mt-2">
                                      <Progress
                                        value={progress}
                                        className="h-1.5"
                                      />
                                      <p className="text-xs text-muted-foreground mt-1">
                                        Downloading... {progress}%
                                      </p>
                                    </div>
                                  )}
                                </div>
                              </div>
                              <div className="flex items-center gap-2 shrink-0 ml-2">
                                {isInstalled ? (
                                  <Badge
                                    variant="outline"
                                    className="text-green-600 border-green-600/30"
                                  >
                                    <CheckCircle2 className="size-3 mr-1" />
                                    Installed
                                  </Badge>
                                ) : isDownloading ? (
                                  <Badge variant="secondary">{progress}%</Badge>
                                ) : (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() =>
                                      handleDownloadCuratedModel(curatedModel.name)
                                    }
                                  >
                                    <Download className="size-4 mr-1" />
                                    Download
                                  </Button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Installed Local Models */}
              <div className="space-y-4">
                {localProviders.map((provider) => {
                  const providerModels = localModels.filter(
                    (m) => m.providerId === provider.id,
                  );

                  return (
                    <Card key={provider.id}>
                      <CardHeader className="pb-2">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className="p-2 rounded-lg bg-muted">
                              <ModelProviderIcon
                                provider={provider.id}
                                className="size-5"
                              />
                            </div>
                            <div>
                              <CardTitle className="text-lg">
                                {provider.name} Models
                              </CardTitle>
                              <CardDescription>
                                {providerModels.length} model
                                {providerModels.length !== 1 ? "s" : ""}{" "}
                                installed
                              </CardDescription>
                            </div>
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              handleRefreshLocalModels(provider.id)
                            }
                          >
                            <RefreshCw className="size-4 mr-1" />
                            Refresh
                          </Button>
                        </div>
                      </CardHeader>
                      <CardContent>
                        {isLoadingLocalModels ? (
                          <div className="space-y-2">
                            <Skeleton className="h-12 w-full" />
                            <Skeleton className="h-12 w-full" />
                          </div>
                        ) : (
                          <div className="space-y-2">
                            {providerModels.map((model) => {
                              const curatedInfo = findCuratedModel(model.name);
                              const isDownloading =
                                model.status === "downloading" ||
                                downloadProgress.has(model.name);
                              const progress =
                                downloadProgress.get(model.name) ||
                                model.downloadProgress ||
                                0;

                              return (
                                <div
                                  key={model.id}
                                  className="flex items-center justify-between p-3 rounded-lg bg-muted/50"
                                >
                                  <div className="flex items-center gap-3 flex-1 min-w-0">
                                    <div className="p-1.5 rounded-md bg-background shrink-0">
                                      {model.family ? (
                                        <ModelFamilyIcon family={model.family} className="size-4" />
                                      ) : curatedInfo?.family ? (
                                        <ModelFamilyIcon family={curatedInfo.family} className="size-4" />
                                      ) : (
                                        <Server className="size-4 text-muted-foreground" />
                                      )}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                      <p className="font-medium">
                                        {model.displayName || model.name}
                                      </p>
                                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                        {model.size && (
                                          <span>
                                            {(
                                              model.size /
                                              1024 /
                                              1024 /
                                              1024
                                            ).toFixed(1)}{" "}
                                            GB
                                          </span>
                                        )}
                                        {model.quantization && (
                                          <Badge
                                            variant="secondary"
                                            className="text-xs"
                                          >
                                            {model.quantization}
                                          </Badge>
                                        )}
                                        {curatedInfo?.toolCalling && (
                                          <Badge
                                            variant="outline"
                                            className="text-xs"
                                          >
                                            Tools
                                          </Badge>
                                        )}
                                      </div>
                                      {isDownloading && (
                                        <div className="mt-2">
                                          <Progress
                                            value={progress}
                                            className="h-1.5"
                                          />
                                          <p className="text-xs text-muted-foreground mt-1">
                                            Downloading... {progress}%
                                          </p>
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-2 shrink-0 ml-2">
                                    {model.status === "available" && (
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        className="text-destructive hover:text-destructive"
                                        onClick={() => setModelToDelete(model)}
                                      >
                                        <Trash2 className="size-4" />
                                      </Button>
                                    )}
                                    <Badge
                                      variant={
                                        model.status === "available"
                                          ? "default"
                                          : model.status === "downloading"
                                            ? "secondary"
                                            : "destructive"
                                      }
                                    >
                                      {isDownloading
                                        ? `${progress}%`
                                        : model.status}
                                    </Badge>
                                  </div>
                                </div>
                              );
                            })}
                            {providerModels.length === 0 && (
                              <p className="text-sm text-muted-foreground text-center py-4">
                                No models found. Click Refresh to scan for
                                available models.
                              </p>
                            )}
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </TabsContent>

            {/* Cloud Providers Tab */}
            <TabsContent value="cloud-providers" className="space-y-4 mt-4">
              <div className="text-sm text-muted-foreground mb-4">
                View and manage cloud provider configurations.
              </div>

              <div className="grid gap-3">
                {cloudProviders.map((provider) => {
                  const status = getApiKeyStatus(provider.id);
                  return (
                    <Card key={provider.id}>
                      <CardContent className="p-4">
                        <div className="flex items-start gap-4">
                          <div className="p-2 rounded-lg bg-muted">
                            <ModelProviderIcon
                              provider={provider.id}
                              className="size-6"
                            />
                          </div>
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <h3 className="font-semibold">{provider.name}</h3>
                              <Badge
                                variant={
                                  status === "valid" ? "default" : "secondary"
                                }
                              >
                                {status === "valid"
                                  ? "Configured"
                                  : status === "invalid"
                                    ? "Invalid Key"
                                    : "Not Configured"}
                              </Badge>
                            </div>
                            <p className="text-sm text-muted-foreground mb-2">
                              {provider.description}
                            </p>
                            {provider.features && (
                              <div className="flex flex-wrap gap-1">
                                {provider.features.map((feature) => (
                                  <Badge
                                    key={feature}
                                    variant="outline"
                                    className="text-xs"
                                  >
                                    {feature}
                                  </Badge>
                                ))}
                              </div>
                            )}
                          </div>
                          <Switch
                            checked={status === "valid"}
                            disabled={
                              status !== "valid" && status !== "missing"
                            }
                          />
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </ScrollArea>

      {/* API Key Dialog */}
      <Dialog open={apiKeyDialogOpen} onOpenChange={setApiKeyDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {selectedProvider && (
                <ModelProviderIcon
                  provider={selectedProvider}
                  className="size-5"
                />
              )}
              {selectedProvider
                ? `${PROVIDER_REGISTRY[selectedProvider]?.name} API Key`
                : "Add API Key"}
            </DialogTitle>
            <DialogDescription>
              Enter your API key to connect to this provider. Your key will be
              encrypted and stored securely.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="api-key">API Key</Label>
              <div className="relative">
                <Input
                  id="api-key"
                  type={showApiKey ? "text" : "password"}
                  value={apiKeyInput}
                  onChange={(e) => setApiKeyInput(e.target.value)}
                  placeholder="sk-..."
                  className="pr-10"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-0 top-0 h-full"
                  onClick={() => setShowApiKey(!showApiKey)}
                >
                  {showApiKey ? (
                    <EyeOff className="size-4" />
                  ) : (
                    <Eye className="size-4" />
                  )}
                </Button>
              </div>
            </div>

            {testResult && (
              <div
                className={cn(
                  "p-3 rounded-lg text-sm flex items-center gap-2",
                  testResult.success
                    ? "bg-green-500/10 text-green-600"
                    : "bg-destructive/10 text-destructive",
                )}
              >
                {testResult.success ? (
                  <Check className="size-4" />
                ) : (
                  <X className="size-4" />
                )}
                {testResult.message}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={handleTestApiKey}
              disabled={!apiKeyInput || isTesting}
            >
              {isTesting ? (
                <>
                  <Loader2 className="size-4 mr-2 animate-spin" />
                  Testing...
                </>
              ) : (
                "Test Key"
              )}
            </Button>
            <Button
              onClick={handleSaveApiKey}
              disabled={!apiKeyInput || isSaving}
            >
              {isSaving ? (
                <>
                  <Loader2 className="size-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                "Save Key"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={!!modelToDelete}
        onOpenChange={(open) => !open && setModelToDelete(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Trash2 className="size-5 text-destructive" />
              Delete {modelToDelete?.displayName || modelToDelete?.name}?
            </DialogTitle>
            <DialogDescription>
              This will permanently delete the model from your computer
              {modelToDelete?.size &&
                ` and free up ${(modelToDelete.size / 1024 / 1024 / 1024).toFixed(1)} GB`}
              . This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setModelToDelete(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => modelToDelete && handleDeleteModel(modelToDelete)}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Local Model Setup Wizard */}
      <LocalModelSetupWizard
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        onComplete={() => {
          mutateLocalModels();
          checkOllamaHealth();
        }}
        skipOllamaInstall={ollamaHealth?.installed || false}
      />
    </>
  );
}
