"use client";

import { Sparkles } from "lucide-react";
import { Button } from "ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "ui/dialog";

interface GenerateAvatarDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onGenerate: (imageUrl: string) => void;
}

export function GenerateAvatarDialog({
  open,
  onOpenChange,
}: GenerateAvatarDialogProps) {
  const handleClose = () => {
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-5 text-primary" />
            Generate Avatar with AI
          </DialogTitle>
          <DialogDescription>Create a unique avatar using AI</DialogDescription>
        </DialogHeader>

        <div className="py-8 text-center text-muted-foreground">
          <Sparkles className="size-12 mx-auto mb-4 opacity-50" />
          <p>AI avatar generation is not available in desktop mode.</p>
          <p className="text-sm mt-2">
            Please upload an image or choose an emoji instead.
          </p>
        </div>

        <div className="flex justify-end">
          <Button variant="outline" onClick={handleClose}>
            Cancel
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
