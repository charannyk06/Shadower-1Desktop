"use client";
import { threadApi } from "@/lib/electron/thread-api";
import { cleanupThreadState } from "@/app/store";
import { appStore } from "@/app/store";
import { useToRef } from "@/hooks/use-latest";
import { Loader, PencilLine, Trash } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { type PropsWithChildren, useState } from "react";
import { toast } from "sonner";
import { mutate } from "swr";
import { safe } from "ts-safe";
import { Button } from "ui/button";
import {
  Command,
  CommandGroup,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "ui/command";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "ui/dialog";
import { Input } from "ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "ui/popover";

type Props = PropsWithChildren<{
  threadId: string;
  beforeTitle?: string;
  onDeleted?: () => void;
  side?: "top" | "bottom" | "left" | "right";
  align?: "start" | "end" | "center";
}>;

export function ThreadDropdown({
  threadId,
  children,
  beforeTitle,
  onDeleted,
  side,
  align,
}: Props) {
  const navigate = useNavigate();
  const push = useToRef((path: string) => navigate({ to: path }));

  const currentThreadId = appStore((state) => state.currentThreadId);

  const [open, setOpen] = useState(false);

  const [isDeleting, setIsDeleting] = useState(false);

  const handleUpdate = async (title: string) => {
    safe()
      .ifOk(() => {
        if (!title) {
          throw new Error("Title is required");
        }
      })
      .ifOk(() => threadApi.update(threadId, { title }))
      .ifOk(() => mutate("/api/thread"))
      .watch(({ isOk, error }) => {
        if (isOk) {
          toast.success("Thread updated");
        } else {
          toast.error(error.message || "Failed to update thread");
        }
      });
  };

  const handleDelete = async (_e: React.MouseEvent) => {
    safe()
      .watch(() => setIsDeleting(true))
      .ifOk(() => threadApi.delete(threadId))
      .watch(() => setIsDeleting(false))
      .watch(() => setOpen(false))
      .watch(({ isOk, error }) => {
        if (isOk) {
          toast.success("Thread deleted");
        } else {
          toast.error(error.message || "Failed to delete thread");
        }
      })
      .ifOk(() => onDeleted?.())
      .ifOk(() => {
        // Clean up thread-related state (context usage, plans, files, mentions)
        cleanupThreadState(threadId);
        if (currentThreadId === threadId) {
          push.current("/");
        }
        mutate("/api/thread");
      })
      .unwrap();
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="p-0 w-[220px]" side={side} align={align}>
        <Command>
          <div className="flex items-center gap-2 px-2 py-1 text-xs pt-2 text-muted-foreground ml-1">
            Chat
          </div>

          <CommandList>
            <CommandGroup>
              <CommandItem className="cursor-pointer p-0">
                <UpdateThreadNameDialog
                  initialTitle={beforeTitle ?? ""}
                  onUpdated={(title) => handleUpdate(title)}
                >
                  <div className="flex items-center gap-2 w-full px-2 py-1 rounded">
                    <PencilLine className="text-foreground" />
                    <span className="mr-4">Rename</span>
                  </div>
                </UpdateThreadNameDialog>
              </CommandItem>
            </CommandGroup>
            <CommandSeparator />
            <CommandGroup>
              <CommandItem disabled={isDeleting} className="cursor-pointer p-0">
                <div
                  className="flex items-center gap-2 w-full px-2 py-1 rounded"
                  onClick={handleDelete}
                >
                  <Trash className="text-destructive" />
                  <span className="text-destructive">Delete Chat</span>
                  {isDeleting && (
                    <Loader className="ml-auto h-4 w-4 animate-spin" />
                  )}
                </div>
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function UpdateThreadNameDialog({
  initialTitle,
  children,
  onUpdated,
}: PropsWithChildren<{
  initialTitle: string;
  onUpdated: (title: string) => void;
}>) {
  const [title, setTitle] = useState(initialTitle);
  return (
    <Dialog>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent hideClose>
        <DialogHeader>
          <DialogTitle>Rename Chat</DialogTitle>
        </DialogHeader>
        <DialogDescription>
          <Input
            type="text"
            value={title}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                onUpdated(title);
              }
            }}
            onInput={(e) => {
              setTitle(e.currentTarget.value);
            }}
          />
        </DialogDescription>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="secondary">Cancel</Button>
          </DialogClose>
          <DialogClose asChild>
            <Button variant="outline" onClick={() => onUpdated(title)}>
              Update
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
