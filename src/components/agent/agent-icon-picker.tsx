"use client";

import { AgentIcon } from "app-types/agent";
import EmojiPicker, { Theme } from "emoji-picker-react";
import { BACKGROUND_COLORS } from "lib/const";
import { cn, createDebounce } from "lib/utils";
import { useTheme } from "next-themes";
import { useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "ui/avatar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "ui/dialog";

const colorUpdateDebounce = createDebounce();

interface AgentIconPickerProps {
  icon?: AgentIcon;
  disabled?: boolean;
  onChange: (icon: AgentIcon) => void;
}

export function AgentIconPicker({
  icon,
  disabled = false,
  onChange,
}: AgentIconPickerProps) {
  const { theme } = useTheme();
  const [open, setOpen] = useState(false);

  const handleColorChange = (color: string) => {
    onChange({
      ...icon!,
      style: { backgroundColor: color },
    });
  };

  const handleEmojiSelect = (emoji: any) => {
    onChange({
      ...icon!,
      value: emoji.imageUrl,
      type: "emoji",
    });
    // Close dialog after selection with slight delay for feedback
    setTimeout(() => {
      setOpen(false);
    }, 150);
  };

  return (
    <>
      {/* Trigger Button */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen(true)}
        style={{
          backgroundColor: icon?.style?.backgroundColor,
        }}
        className={cn(
          "transition-colors group items-center justify-center flex w-16 h-16 rounded-lg ring ring-background",
          !disabled && "hover:brightness-90 cursor-pointer hover:ring-ring",
          disabled && "opacity-50 cursor-not-allowed",
        )}
      >
        <Avatar className="size-10">
          <AvatarImage
            src={icon?.value}
            className="group-hover:scale-110 transition-transform"
          />
          <AvatarFallback />
        </Avatar>
      </button>

      {/* Icon Picker Dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Choose Agent Icon</DialogTitle>
            <DialogDescription>
              Select a background color and emoji for your agent
            </DialogDescription>
          </DialogHeader>

          {/* Color Picker Section */}
          <div className="py-2">
            <p className="text-sm font-medium mb-3">Background Color</p>
            <div className="flex flex-wrap items-center gap-2">
              {BACKGROUND_COLORS.map((color, index) => (
                <button
                  key={index}
                  type="button"
                  className={cn(
                    "w-9 h-9 rounded-lg cursor-pointer transition-all hover:scale-110",
                    icon?.style?.backgroundColor === color
                      ? "ring-2 ring-ring ring-offset-2 ring-offset-background"
                      : "hover:ring-2 hover:ring-ring/50 hover:ring-offset-1",
                  )}
                  onClick={() => handleColorChange(color)}
                  style={{ backgroundColor: color }}
                  aria-label={`Select color ${index + 1}`}
                />
              ))}
              {/* Custom color picker */}
              <div className="relative">
                <input
                  type="color"
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  value={icon?.style?.backgroundColor || "#888888"}
                  onChange={(e) => {
                    colorUpdateDebounce(() => {
                      handleColorChange(e.target.value);
                    }, 100);
                  }}
                  aria-label="Pick custom color"
                />
                <div className="w-9 h-9 rounded-lg cursor-pointer border-2 border-dashed border-muted-foreground/40 flex items-center justify-center hover:border-muted-foreground transition-colors">
                  <div
                    className="w-5 h-5 rounded-full"
                    style={{
                      background:
                        "conic-gradient(red, yellow, lime, aqua, blue, magenta, red)",
                    }}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Preview */}
          <div className="flex justify-center py-2">
            <div
              className="w-20 h-20 rounded-xl flex items-center justify-center ring-2 ring-border"
              style={{ backgroundColor: icon?.style?.backgroundColor }}
            >
              <Avatar className="size-12">
                <AvatarImage src={icon?.value} />
                <AvatarFallback />
              </Avatar>
            </div>
          </div>

          {/* Emoji Picker */}
          <div className="flex justify-center">
            <EmojiPicker
              lazyLoadEmojis
              open={open}
              theme={theme === "dark" ? Theme.DARK : Theme.LIGHT}
              onEmojiClick={handleEmojiSelect}
              width="100%"
              height={350}
            />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
