"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ModelProviderIcon } from "@/components/ui/model-provider-icon";
import { Progress } from "@/components/ui/progress";
import { cn } from "lib/utils";
import {
  AlertCircle,
  CheckCircle2,
  Download,
  HardDrive,
  Loader2,
  Server,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
  CURATED_LOCAL_MODELS,
  CuratedModel,
  getBestModelForRam,
} from "@/lib/ai/curated-local-models";
import { modelsApi } from "@/lib/electron/models-api";

type WizardStep =
  | "welcome"
  | "installing-ollama"
  | "choose-model"
  | "downloading-model"
  | "complete"
  | "error";

interface LocalModelSetupWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete?: () => void;
  /** Skip Ollama installation (already installed) */
  skipOllamaInstall?: boolean;
}

export function LocalModelSetupWizard({
  open,
  onOpenChange,
  onComplete,
  skipOllamaInstall = false,
}: LocalModelSetupWizardProps) {
  const [step, setStep] = useState<WizardStep>("welcome");
  const [installProgress, setInstallProgress] = useState(0);
  const [installMessage, setInstallMessage] = useState("");
  const [selectedModel, setSelectedModel] = useState<CuratedModel | null>(null);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloadMessage, setDownloadMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [availableRam, setAvailableRam] = useState(16); // Default 16GB

  // Detect available RAM on mount
  useEffect(() => {
    const detectRam = async () => {
      try {
        // Use navigator.deviceMemory if available (gives approximate RAM in GB)
        const deviceMemory = (navigator as any).deviceMemory;
        if (deviceMemory) {
          setAvailableRam(deviceMemory);
        }
      } catch {
        // Default to 16GB if can't detect
      }
    };
    detectRam();
  }, []);

  // Pre-select best model for available RAM
  useEffect(() => {
    if (!selectedModel) {
      const bestModel = getBestModelForRam(availableRam);
      if (bestModel) {
        setSelectedModel(bestModel);
      }
    }
  }, [availableRam, selectedModel]);

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setStep(skipOllamaInstall ? "choose-model" : "welcome");
      setInstallProgress(0);
      setInstallMessage("");
      setDownloadProgress(0);
      setDownloadMessage("");
      setErrorMessage("");
    }
  }, [open, skipOllamaInstall]);

  // Listen for download progress events via IPC
  useEffect(() => {
    if (step !== "downloading-model") return;

    // Set up IPC listeners for download events
    const unsubProgress = modelsApi.onDownloadProgress?.((data) => {
      const { progress, status, completed, total } = data;
      setDownloadProgress(progress || 0);

      if (completed && total) {
        const downloadedGB = (completed / 1024 / 1024 / 1024).toFixed(1);
        const totalGB = (total / 1024 / 1024 / 1024).toFixed(1);
        setDownloadMessage(`${downloadedGB} GB / ${totalGB} GB`);
      } else if (status) {
        setDownloadMessage(status);
      }
    });

    const unsubComplete = modelsApi.onDownloadComplete?.(() => {
      setStep("complete");
    });

    const unsubError = modelsApi.onDownloadError?.((data) => {
      setErrorMessage(data?.error || "Download failed");
      setStep("error");
    });

    return () => {
      unsubProgress?.();
      unsubComplete?.();
      unsubError?.();
    };
  }, [step]);

  const handleStartInstall = useCallback(async () => {
    setStep("installing-ollama");
    setInstallProgress(0);
    setInstallMessage("Starting installation...");

    try {
      // Call the Ollama install API
      const result = await modelsApi.ollamaInstall?.();

      if (result?.success) {
        setInstallProgress(100);
        setInstallMessage("Installation complete!");
        // Move to model selection
        setTimeout(() => setStep("choose-model"), 1000);
      } else {
        setErrorMessage(result?.message || "Installation failed");
        setStep("error");
      }
    } catch (error: any) {
      setErrorMessage(error.message || "Installation failed");
      setStep("error");
    }
  }, []);

  const handleSkipToModels = useCallback(() => {
    setStep("choose-model");
  }, []);

  const handleStartDownload = useCallback(async () => {
    if (!selectedModel) return;

    setStep("downloading-model");
    setDownloadProgress(0);
    setDownloadMessage("Starting download...");

    try {
      const result = await modelsApi.downloadModel?.({
        modelName: selectedModel.name,
      });

      if (!result?.success && result?.error) {
        setErrorMessage(result.error);
        setStep("error");
      }
      // If successful, the progress events will handle the rest
    } catch (error: any) {
      setErrorMessage(error.message || "Download failed");
      setStep("error");
    }
  }, [selectedModel]);

  const handleComplete = useCallback(() => {
    onOpenChange(false);
    onComplete?.();
  }, [onOpenChange, onComplete]);

  const handleRetry = useCallback(() => {
    setErrorMessage("");
    setStep("welcome");
  }, []);

  // Filter models that can run on this system
  const compatibleModels = CURATED_LOCAL_MODELS.filter(
    (model) => model.minRamGB <= availableRam,
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ModelProviderIcon provider="ollama" className="size-5" />
            Local AI Setup
          </DialogTitle>
          <DialogDescription>
            Run AI models locally for complete data privacy.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Welcome Step */}
          {step === "welcome" && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">This will:</p>
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm">
                  <CheckCircle2 className="size-4 text-green-600" />
                  <span>Install Ollama (local AI engine)</span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <CheckCircle2 className="size-4 text-green-600" />
                  <span>Download a recommended AI model</span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <CheckCircle2 className="size-4 text-green-600" />
                  <span>Configure everything automatically</span>
                </div>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground mt-4">
                <HardDrive className="size-3" />
                <span>Requires ~15GB disk space and 16GB+ RAM</span>
              </div>
            </div>
          )}

          {/* Installing Ollama Step */}
          {step === "installing-ollama" && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Loader2 className="size-4 animate-spin text-blue-500" />
                <span className="text-sm">Installing Ollama...</span>
              </div>
              <Progress value={installProgress} className="h-2" />
              <p className="text-xs text-muted-foreground">{installMessage}</p>
            </div>
          )}

          {/* Choose Model Step */}
          {step === "choose-model" && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Select a model to download. Models marked as recommended work
                best for most tasks.
              </p>
              <div className="space-y-2 max-h-64 overflow-y-auto pr-2">
                {compatibleModels.map((model) => (
                  <div
                    key={model.name}
                    className={cn(
                      "flex items-center justify-between p-3 rounded-lg cursor-pointer transition-all",
                      selectedModel?.name === model.name
                        ? "border-green-500/30 bg-green-500/5 border"
                        : "bg-muted/50 hover:bg-muted",
                    )}
                    onClick={() => setSelectedModel(model)}
                  >
                    <div className="flex items-center gap-3">
                      <Server className="size-4 text-muted-foreground" />
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="font-medium text-sm">
                            {model.displayName}
                          </p>
                          {model.recommended && (
                            <Badge variant="secondary" className="text-xs">
                              Recommended
                            </Badge>
                          )}
                          {model.isReasoning && (
                            <Badge variant="outline" className="text-xs">
                              Reasoning
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {model.size} &bull; {(model.contextWindow / 1000).toFixed(0)}K
                          context &bull; Tool calling
                        </p>
                      </div>
                    </div>
                    {selectedModel?.name === model.name && (
                      <CheckCircle2 className="size-4 text-green-600" />
                    )}
                  </div>
                ))}
                {compatibleModels.length === 0 && (
                  <div className="text-center py-4">
                    <AlertCircle className="size-8 text-muted-foreground mx-auto mb-2" />
                    <p className="text-sm text-muted-foreground">
                      No compatible models found for your system.
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Detected RAM: ~{availableRam}GB
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Downloading Model Step */}
          {step === "downloading-model" && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Loader2 className="size-4 animate-spin text-blue-500" />
                <span className="text-sm">
                  Downloading {selectedModel?.displayName}...
                </span>
              </div>
              <Progress value={downloadProgress} className="h-2" />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>{downloadMessage}</span>
                <span>{downloadProgress}%</span>
              </div>
            </div>
          )}

          {/* Complete Step */}
          {step === "complete" && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="size-5 text-green-600" />
                <span className="font-medium">Setup Complete!</span>
              </div>
              <div className="text-sm text-muted-foreground space-y-1">
                <p>Successfully installed:</p>
                <p>&bull; Ollama (local AI engine)</p>
                <p>&bull; {selectedModel?.displayName}</p>
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                You can now use local AI models in your conversations.
              </p>
            </div>
          )}

          {/* Error Step */}
          {step === "error" && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <AlertCircle className="size-5 text-destructive" />
                <span className="font-medium">Setup Failed</span>
              </div>
              <p className="text-sm text-muted-foreground">{errorMessage}</p>
            </div>
          )}
        </div>

        <DialogFooter>
          {step === "welcome" && (
            <div className="flex w-full gap-2">
              <Button variant="outline" onClick={handleSkipToModels}>
                I have Ollama
              </Button>
              <Button onClick={handleStartInstall} className="flex-1">
                <Download className="size-4 mr-1" />
                Get Started
              </Button>
            </div>
          )}

          {step === "installing-ollama" && (
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
          )}

          {step === "choose-model" && (
            <Button
              onClick={handleStartDownload}
              disabled={!selectedModel}
              className="w-full"
            >
              <Download className="size-4 mr-1" />
              Download {selectedModel?.displayName || "Model"}
            </Button>
          )}

          {step === "downloading-model" && (
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
          )}

          {step === "complete" && (
            <Button onClick={handleComplete} className="w-full">
              Start Using Local AI
            </Button>
          )}

          {step === "error" && (
            <div className="flex w-full gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Close
              </Button>
              <Button onClick={handleRetry} className="flex-1">
                Try Again
              </Button>
            </div>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
