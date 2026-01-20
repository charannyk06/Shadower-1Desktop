import { exportApi } from "@/lib/electron/export-api";
import { Download, FileJson, FileText, Loader } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { safe } from "ts-safe";
import { Button } from "ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "ui/dialog";

type Props = {
  threadId: string;
  onExport?: () => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children?: React.ReactNode;
};

export function ChatExportPopup(props: Props) {
  const { t } = useTranslation();
  const [isExporting, setIsExporting] = useState(false);
  const [exportFormat, setExportFormat] = useState<"json" | "markdown" | null>(
    null,
  );

  const handleExport = useCallback(
    (format: "json" | "markdown") => {
      setIsExporting(true);
      setExportFormat(format);
      safe(() => exportApi.exportChatToFile(props.threadId, format))
        .watch(() => {
          setIsExporting(false);
          setExportFormat(null);
        })
        .ifOk(() => {
          toast.success(t("Chat.Thread.exportSuccess"));
          props.onExport?.();
          props.onOpenChange?.(false);
        })
        .ifFail((error) => {
          toast.error(error.message || "Failed to export chat");
        })
        .unwrap();
    },
    [props.threadId, props.onExport, props.onOpenChange, t],
  );

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogTrigger asChild>{props.children}</DialogTrigger>
      <DialogContent className="flex flex-col gap-4">
        <DialogHeader className="mb-4">
          <DialogTitle>{t("Chat.Thread.exportChat")}</DialogTitle>
          <DialogDescription>
            {t("Chat.Thread.exportChatDescription")}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <Button
            variant="outline"
            className="w-full justify-start gap-3 h-14"
            onClick={() => handleExport("json")}
            disabled={isExporting}
          >
            {isExporting && exportFormat === "json" ? (
              <Loader className="size-5 animate-spin" />
            ) : (
              <FileJson className="size-5" />
            )}
            <div className="flex flex-col items-start">
              <span className="font-medium">JSON</span>
              <span className="text-xs text-muted-foreground">
                Full data export
              </span>
            </div>
          </Button>
          <Button
            variant="outline"
            className="w-full justify-start gap-3 h-14"
            onClick={() => handleExport("markdown")}
            disabled={isExporting}
          >
            {isExporting && exportFormat === "markdown" ? (
              <Loader className="size-5 animate-spin" />
            ) : (
              <FileText className="size-5" />
            )}
            <div className="flex flex-col items-start">
              <span className="font-medium">Markdown</span>
              <span className="text-xs text-muted-foreground">
                Readable format
              </span>
            </div>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
