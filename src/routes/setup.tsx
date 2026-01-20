// Re-export the existing setup page component
// The setup page is already client-only and only needs router updates

import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Loader2,
  Check,
  X,
  ExternalLink,
  Copy,
  ChevronRight,
  ChevronLeft,
  Sparkles,
  Key,
  Chrome,
  Rocket,
} from "lucide-react";
import { cn } from "@/lib/utils";

// Type for Electron Setup API (extends the global electronAPI)
interface SetupAPI {
  isRequired: () => Promise<boolean>;
  getSettings: () => Promise<any>;
  complete: (config: any) => Promise<{ success: boolean }>;
  checkOllama: () => Promise<{
    installed: boolean;
    running: boolean;
    version?: string;
    models?: Array<{ name: string; size: string; modified: string }>;
    error?: string;
  }>;
  downloadModel: (
    modelName: string,
  ) => Promise<{ success: boolean; output?: string; error?: string }>;
  validateApiKey: (
    provider: string,
    apiKey: string,
  ) => Promise<{
    valid: boolean;
    provider: string;
    error?: string;
  }>;
  checkChrome: (port?: number) => Promise<{
    connected: boolean;
    port: number;
    version?: string;
    error?: string;
  }>;
  getChromeLaunchCommand: (port?: number) => Promise<{
    command: string;
    description: string;
  }>;
}

// Helper to get setup API from window.electronAPI
function getSetupAPI(): SetupAPI | undefined {
  const electronAPI = (window as any).electronAPI;
  return electronAPI?.setup;
}

// Setup wizard steps
type Step = "welcome" | "ollama" | "apiKeys" | "chrome" | "complete";

const STEPS: Step[] = ["welcome", "ollama", "apiKeys", "chrome", "complete"];

// Popular Ollama models
const RECOMMENDED_MODELS = [
  {
    name: "llama3.2",
    description: "Meta's latest LLM, great for general tasks",
    size: "2.0GB",
  },
  {
    name: "mistral",
    description: "Fast and capable, good for coding",
    size: "4.1GB",
  },
  {
    name: "codellama",
    description: "Specialized for code generation",
    size: "3.8GB",
  },
  {
    name: "phi3",
    description: "Microsoft's efficient small model",
    size: "2.3GB",
  },
];

// API providers
const API_PROVIDERS = [
  {
    id: "openai",
    name: "OpenAI",
    placeholder: "sk-...",
    url: "https://platform.openai.com/api-keys",
  },
  {
    id: "anthropic",
    name: "Anthropic",
    placeholder: "sk-ant-...",
    url: "https://console.anthropic.com/settings/keys",
  },
  {
    id: "google",
    name: "Google AI",
    placeholder: "AIza...",
    url: "https://makersuite.google.com/app/apikey",
  },
  {
    id: "groq",
    name: "Groq",
    placeholder: "gsk_...",
    url: "https://console.groq.com/keys",
  },
];

export default function SetupPage() {
  const navigate = useNavigate();
  const [currentStep, setCurrentStep] = useState<Step>("welcome");
  const [isElectron, setIsElectron] = useState(false);

  // Ollama state
  const [ollamaStatus, setOllamaStatus] = useState<{
    installed: boolean;
    running: boolean;
    version?: string;
    models?: Array<{ name: string; size: string; modified: string }>;
    error?: string;
  } | null>(null);
  const [checkingOllama, setCheckingOllama] = useState(false);
  const [downloadingModel, setDownloadingModel] = useState<string | null>(null);

  // API keys state
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({});
  const [validatedKeys, setValidatedKeys] = useState<Record<string, boolean>>(
    {},
  );
  const [validatingKey, setValidatingKey] = useState<string | null>(null);

  // Chrome state
  const [chromeStatus, setChromeStatus] = useState<{
    connected: boolean;
    port: number;
    version?: string;
    error?: string;
  } | null>(null);
  const [checkingChrome, setCheckingChrome] = useState(false);
  const [chromeLaunchCommand, setChromeLaunchCommand] = useState<string>("");
  const [chromePort, setChromePort] = useState(9222);

  // Check if running in Electron
  useEffect(() => {
    setIsElectron(!!getSetupAPI());
  }, []);

  // Check Ollama status
  const checkOllama = useCallback(async () => {
    const setupAPI = getSetupAPI();
    if (!setupAPI) return;
    setCheckingOllama(true);
    try {
      const status = await setupAPI.checkOllama();
      setOllamaStatus(status);
    } catch (error) {
      console.error("Failed to check Ollama:", error);
    } finally {
      setCheckingOllama(false);
    }
  }, []);

  // Download model
  const downloadModel = async (modelName: string) => {
    const setupAPI = getSetupAPI();
    if (!setupAPI) return;
    setDownloadingModel(modelName);
    try {
      const result = await setupAPI.downloadModel(modelName);
      if (result.success) {
        // Refresh Ollama status to see new model
        await checkOllama();
      }
    } catch (error) {
      console.error("Failed to download model:", error);
    } finally {
      setDownloadingModel(null);
    }
  };

  // Validate API key
  const validateApiKey = async (provider: string, key: string) => {
    const setupAPI = getSetupAPI();
    if (!setupAPI || !key) return;
    setValidatingKey(provider);
    try {
      const result = await setupAPI.validateApiKey(provider, key);
      setValidatedKeys((prev) => ({ ...prev, [provider]: result.valid }));
    } catch (error) {
      console.error("Failed to validate API key:", error);
      setValidatedKeys((prev) => ({ ...prev, [provider]: false }));
    } finally {
      setValidatingKey(null);
    }
  };

  // Check Chrome DevTools
  const checkChrome = useCallback(async () => {
    const setupAPI = getSetupAPI();
    if (!setupAPI) return;
    setCheckingChrome(true);
    try {
      const [status, launchCmd] = await Promise.all([
        setupAPI.checkChrome(chromePort),
        setupAPI.getChromeLaunchCommand(chromePort),
      ]);
      setChromeStatus(status);
      setChromeLaunchCommand(launchCmd.command);
    } catch (error) {
      console.error("Failed to check Chrome:", error);
    } finally {
      setCheckingChrome(false);
    }
  }, [chromePort]);

  // Complete setup
  const completeSetup = async () => {
    const setupAPI = getSetupAPI();
    if (!setupAPI) {
      navigate({ to: "/" });
      return;
    }

    try {
      const config = {
        ollama: {
          enabled: ollamaStatus?.running || false,
          baseUrl: "http://localhost:11434",
          models: ollamaStatus?.models?.map((m) => m.name) || [],
        },
        apiKeys,
        chrome: {
          enabled: chromeStatus?.connected || false,
          port: chromePort,
          autoConnect: false,
        },
        preferences: {
          theme: "dark" as const,
          autoUpdate: true,
          telemetry: false,
          language: "en",
        },
      };

      await setupAPI.complete(config);
      navigate({ to: "/" });
    } catch (error) {
      console.error("Failed to complete setup:", error);
    }
  };

  // Navigate steps
  const nextStep = () => {
    const idx = STEPS.indexOf(currentStep);
    if (idx < STEPS.length - 1) setCurrentStep(STEPS[idx + 1]);
  };
  const prevStep = () => {
    const idx = STEPS.indexOf(currentStep);
    if (idx > 0) setCurrentStep(STEPS[idx - 1]);
  };

  // Copy to clipboard
  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  // Render step indicator
  const StepIndicator = () => (
    <div className="flex items-center justify-center gap-2 mb-8">
      {STEPS.map((step, idx) => (
        <div key={step} className="flex items-center">
          <div
            className={cn(
              "w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-colors",
              STEPS.indexOf(currentStep) >= idx
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground",
            )}
          >
            {STEPS.indexOf(currentStep) > idx ? (
              <Check className="w-4 h-4" />
            ) : (
              idx + 1
            )}
          </div>
          {idx < STEPS.length - 1 && (
            <div
              className={cn(
                "w-12 h-0.5 mx-1",
                STEPS.indexOf(currentStep) > idx ? "bg-primary" : "bg-muted",
              )}
            />
          )}
        </div>
      ))}
    </div>
  );

  // Welcome step
  const WelcomeStep = () => (
    <div className="text-center space-y-6">
      <div className="w-20 h-20 mx-auto bg-gradient-to-br from-purple-500 to-pink-500 rounded-2xl flex items-center justify-center">
        <Sparkles className="w-10 h-10 text-white" />
      </div>
      <div>
        <h1 className="text-3xl font-bold mb-2">Welcome to Shadower</h1>
        <p className="text-muted-foreground text-lg">
          Privacy-focused AI orchestration on your desktop
        </p>
      </div>
      <div className="grid gap-4 text-left max-w-md mx-auto">
        <div className="flex gap-3 items-start">
          <div className="w-8 h-8 rounded-lg bg-green-500/10 flex items-center justify-center flex-shrink-0">
            <Check className="w-4 h-4 text-green-500" />
          </div>
          <div>
            <p className="font-medium">100% Local-First</p>
            <p className="text-sm text-muted-foreground">
              Your data stays on your machine
            </p>
          </div>
        </div>
        <div className="flex gap-3 items-start">
          <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center flex-shrink-0">
            <Check className="w-4 h-4 text-blue-500" />
          </div>
          <div>
            <p className="font-medium">Use Local or Cloud AI</p>
            <p className="text-sm text-muted-foreground">
              Ollama, OpenAI, Anthropic, and more
            </p>
          </div>
        </div>
        <div className="flex gap-3 items-start">
          <div className="w-8 h-8 rounded-lg bg-purple-500/10 flex items-center justify-center flex-shrink-0">
            <Check className="w-4 h-4 text-purple-500" />
          </div>
          <div>
            <p className="font-medium">Powerful Automations</p>
            <p className="text-sm text-muted-foreground">
              Agents, workflows, and browser control
            </p>
          </div>
        </div>
      </div>
      <Button size="lg" onClick={nextStep} className="gap-2">
        Get Started <ChevronRight className="w-4 h-4" />
      </Button>
    </div>
  );

  // Ollama step
  const OllamaStep = () => (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="text-2xl font-bold mb-2">Local AI with Ollama</h2>
        <p className="text-muted-foreground">
          Run AI models locally for maximum privacy (optional)
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            Ollama Status
            <Button
              variant="outline"
              size="sm"
              onClick={checkOllama}
              disabled={checkingOllama}
            >
              {checkingOllama ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                "Check"
              )}
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {ollamaStatus === null ? (
            <p className="text-muted-foreground">
              Click "Check" to detect Ollama
            </p>
          ) : ollamaStatus.installed ? (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Badge variant={ollamaStatus.running ? "default" : "secondary"}>
                  {ollamaStatus.running ? "Running" : "Not Running"}
                </Badge>
                {ollamaStatus.version && (
                  <span className="text-sm text-muted-foreground">
                    {ollamaStatus.version}
                  </span>
                )}
              </div>

              {ollamaStatus.running &&
                ollamaStatus.models &&
                ollamaStatus.models.length > 0 && (
                  <div>
                    <p className="text-sm font-medium mb-2">
                      Installed Models:
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {ollamaStatus.models.map((model) => (
                        <Badge key={model.name} variant="outline">
                          {model.name}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

              {!ollamaStatus.running && (
                <p className="text-sm text-amber-500">
                  Start Ollama to use local models: <code>ollama serve</code>
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-amber-500">
                <X className="w-4 h-4" />
                <span>Ollama not installed</span>
              </div>
              <Button variant="outline" asChild>
                <a
                  href="https://ollama.ai"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="gap-2"
                >
                  Download Ollama <ExternalLink className="w-4 h-4" />
                </a>
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {ollamaStatus?.running && (
        <Card>
          <CardHeader>
            <CardTitle>Recommended Models</CardTitle>
            <CardDescription>
              Download models to use with Shadower
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3">
              {RECOMMENDED_MODELS.map((model) => {
                const isInstalled = ollamaStatus.models?.some(
                  (m) => m.name === model.name,
                );
                return (
                  <div
                    key={model.name}
                    className="flex items-center justify-between p-3 rounded-lg border"
                  >
                    <div>
                      <p className="font-medium">{model.name}</p>
                      <p className="text-sm text-muted-foreground">
                        {model.description}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {model.size}
                      </p>
                    </div>
                    {isInstalled ? (
                      <Badge variant="secondary">
                        <Check className="w-3 h-3 mr-1" /> Installed
                      </Badge>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => downloadModel(model.name)}
                        disabled={downloadingModel !== null}
                      >
                        {downloadingModel === model.name ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          "Download"
                        )}
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex justify-between">
        <Button variant="outline" onClick={prevStep} className="gap-2">
          <ChevronLeft className="w-4 h-4" /> Back
        </Button>
        <Button onClick={nextStep} className="gap-2">
          {ollamaStatus?.running ? "Continue" : "Skip"}{" "}
          <ChevronRight className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );

  // API Keys step
  const ApiKeysStep = () => (
    <div className="space-y-6">
      <div className="text-center">
        <div className="w-12 h-12 mx-auto bg-amber-500/10 rounded-xl flex items-center justify-center mb-3">
          <Key className="w-6 h-6 text-amber-500" />
        </div>
        <h2 className="text-2xl font-bold mb-2">Cloud AI Providers</h2>
        <p className="text-muted-foreground">
          Add API keys for cloud models (optional)
        </p>
      </div>

      <div className="grid gap-4">
        {API_PROVIDERS.map((provider) => (
          <Card key={provider.id}>
            <CardContent className="pt-4">
              <div className="flex items-center justify-between mb-3">
                <span className="font-medium">{provider.name}</span>
                <Button variant="ghost" size="sm" asChild>
                  <a
                    href={provider.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="gap-1 text-xs"
                  >
                    Get Key <ExternalLink className="w-3 h-3" />
                  </a>
                </Button>
              </div>
              <div className="flex gap-2">
                <Input
                  type="password"
                  placeholder={provider.placeholder}
                  value={apiKeys[provider.id] || ""}
                  onChange={(e) =>
                    setApiKeys((prev) => ({
                      ...prev,
                      [provider.id]: e.target.value,
                    }))
                  }
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    validateApiKey(provider.id, apiKeys[provider.id])
                  }
                  disabled={
                    !apiKeys[provider.id] || validatingKey === provider.id
                  }
                >
                  {validatingKey === provider.id ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : validatedKeys[provider.id] === true ? (
                    <Check className="w-4 h-4 text-green-500" />
                  ) : validatedKeys[provider.id] === false ? (
                    <X className="w-4 h-4 text-red-500" />
                  ) : (
                    "Test"
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex justify-between">
        <Button variant="outline" onClick={prevStep} className="gap-2">
          <ChevronLeft className="w-4 h-4" /> Back
        </Button>
        <Button onClick={nextStep} className="gap-2">
          {Object.values(apiKeys).some((k) => k) ? "Continue" : "Skip"}{" "}
          <ChevronRight className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );

  // Chrome step
  const ChromeStep = () => (
    <div className="space-y-6">
      <div className="text-center">
        <div className="w-12 h-12 mx-auto bg-blue-500/10 rounded-xl flex items-center justify-center mb-3">
          <Chrome className="w-6 h-6 text-blue-500" />
        </div>
        <h2 className="text-2xl font-bold mb-2">Browser Automation</h2>
        <p className="text-muted-foreground">
          Connect to Chrome for web automation (optional)
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            Chrome DevTools
            <Button
              variant="outline"
              size="sm"
              onClick={checkChrome}
              disabled={checkingChrome}
            >
              {checkingChrome ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                "Check Connection"
              )}
            </Button>
          </CardTitle>
          <CardDescription>
            Launch Chrome with remote debugging to enable browser control
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2 items-center">
            <span className="text-sm">Debug Port:</span>
            <Input
              type="number"
              value={chromePort}
              onChange={(e) => setChromePort(parseInt(e.target.value) || 9222)}
              className="w-24"
            />
          </div>

          {chromeStatus && (
            <div className="flex items-center gap-2">
              {chromeStatus.connected ? (
                <>
                  <Badge variant="default">
                    <Check className="w-3 h-3 mr-1" /> Connected
                  </Badge>
                  {chromeStatus.version && (
                    <span className="text-sm text-muted-foreground">
                      {chromeStatus.version}
                    </span>
                  )}
                </>
              ) : (
                <Badge variant="secondary">
                  <X className="w-3 h-3 mr-1" /> Not Connected
                </Badge>
              )}
            </div>
          )}

          {chromeLaunchCommand && (
            <div className="space-y-2">
              <p className="text-sm font-medium">
                Launch Chrome with debugging:
              </p>
              <div className="flex gap-2">
                <code className="flex-1 p-2 bg-muted rounded text-xs overflow-x-auto">
                  {chromeLaunchCommand}
                </code>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => copyToClipboard(chromeLaunchCommand)}
                >
                  <Copy className="w-4 h-4" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex justify-between">
        <Button variant="outline" onClick={prevStep} className="gap-2">
          <ChevronLeft className="w-4 h-4" /> Back
        </Button>
        <Button onClick={nextStep} className="gap-2">
          {chromeStatus?.connected ? "Continue" : "Skip"}{" "}
          <ChevronRight className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );

  // Complete step
  const CompleteStep = () => (
    <div className="text-center space-y-6">
      <div className="w-20 h-20 mx-auto bg-gradient-to-br from-green-500 to-emerald-500 rounded-2xl flex items-center justify-center">
        <Rocket className="w-10 h-10 text-white" />
      </div>
      <div>
        <h2 className="text-2xl font-bold mb-2">You're All Set!</h2>
        <p className="text-muted-foreground">
          Shadower is configured and ready to use
        </p>
      </div>

      <Card className="text-left">
        <CardHeader>
          <CardTitle>Configuration Summary</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between">
            <span>Local AI (Ollama)</span>
            <Badge variant={ollamaStatus?.running ? "default" : "secondary"}>
              {ollamaStatus?.running ? "Enabled" : "Not configured"}
            </Badge>
          </div>
          <div className="flex items-center justify-between">
            <span>Cloud AI Keys</span>
            <Badge
              variant={
                Object.keys(apiKeys).filter((k) => apiKeys[k]).length > 0
                  ? "default"
                  : "secondary"
              }
            >
              {Object.keys(apiKeys).filter((k) => apiKeys[k]).length} configured
            </Badge>
          </div>
          <div className="flex items-center justify-between">
            <span>Browser Automation</span>
            <Badge variant={chromeStatus?.connected ? "default" : "secondary"}>
              {chromeStatus?.connected ? "Connected" : "Not configured"}
            </Badge>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-center gap-4">
        <Button variant="outline" onClick={prevStep} className="gap-2">
          <ChevronLeft className="w-4 h-4" /> Back
        </Button>
        <Button size="lg" onClick={completeSetup} className="gap-2">
          Start Using Shadower <ChevronRight className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );

  // Render current step
  const renderStep = () => {
    switch (currentStep) {
      case "welcome":
        return <WelcomeStep />;
      case "ollama":
        return <OllamaStep />;
      case "apiKeys":
        return <ApiKeysStep />;
      case "chrome":
        return <ChromeStep />;
      case "complete":
        return <CompleteStep />;
      default:
        return <WelcomeStep />;
    }
  };

  // Show loading for non-Electron environments
  if (!isElectron && typeof window !== "undefined") {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-4">
          <Loader2 className="w-8 h-8 animate-spin mx-auto text-muted-foreground" />
          <p className="text-muted-foreground">Loading setup wizard...</p>
          <Button variant="outline" onClick={() => navigate({ to: "/" })}>
            Skip Setup
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-2xl">
        <StepIndicator />
        {renderStep()}
      </div>
    </div>
  );
}
