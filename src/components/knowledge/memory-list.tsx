"use client";

import { useState, useEffect, useCallback, useRef, useTransition } from "react";
import { useNavigate, useSearch, useLocation } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { MessageSquareIcon, Search, X } from "lucide-react";
import { Button } from "ui/button";
import { Input } from "ui/input";
import { Skeleton } from "ui/skeleton";
import { Checkbox } from "ui/checkbox";
import { MemoryCard } from "./memory-card";
import { EditMemoryDialog } from "./edit-memory-dialog";
import { BulkActionToolbar } from "./bulk-action-toolbar";
import { TablePagination } from "ui/table-pagination";
import { toast } from "sonner";
import { useDebounce } from "@/hooks/use-debounce";
// Using native form - Next.js Form not needed in Vite
import { cn } from "lib/utils";
import { motion, LayoutGroup } from "framer-motion";
import { knowledgeApi } from "@/lib/electron/knowledge-api";

interface Memory {
  id: string;
  content: string;
  role?: "user" | "assistant";
  source?: "messages" | "knowledge" | "documents";
  threadId?: string;
  messageId?: string;
  createdAt?: string;
  // Knowledge base specific
  knowledgeBaseId?: string;
  knowledgeBaseName?: string;
  fileName?: string;
  // Document specific
  documentType?: string;
  title?: string;
}

interface MemoryListProps {
  userId: string;
}

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;

export function MemoryList({ userId: _userId }: MemoryListProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const pathname = location.pathname;
  const searchParams = useSearch({ strict: false }) as Record<string, string>;
  const [_, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  // Get URL params
  const page = parseInt(searchParams?.page || String(DEFAULT_PAGE), 10);
  const searchQuery = searchParams?.search || "";
  const roleFilter = (searchParams?.role as "user" | "assistant") || undefined;
  const sourceFilter = (searchParams?.source || "all") as
    | "all"
    | "messages"
    | "knowledge"
    | "documents";

  // State
  const [memories, setMemories] = useState<Memory[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingMemory, setEditingMemory] = useState<Memory | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [pagination, setPagination] = useState<{
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasMore: boolean;
  }>({
    page: DEFAULT_PAGE,
    limit: DEFAULT_LIMIT,
    total: 0,
    totalPages: 0,
    hasMore: false,
  });

  // Build URL helper
  const buildUrl = useCallback(
    (
      params: {
        page?: number;
        search?: string;
        role?: "user" | "assistant" | null;
        source?: "all" | "messages" | "knowledge" | "documents" | null;
      } = {},
    ) => {
      const newParams = new URLSearchParams();

      const finalPage = params.page ?? page;
      const finalSearch = params.search ?? searchQuery;
      // If role is explicitly provided (including null), use it; otherwise use current roleFilter
      const finalRole = params.role !== undefined ? params.role : roleFilter;
      const finalSource =
        params.source !== undefined ? params.source : sourceFilter;

      if (finalPage && finalPage !== DEFAULT_PAGE) {
        newParams.set("page", finalPage.toString());
      }
      if (finalSearch) {
        newParams.set("search", finalSearch);
      }
      // Only add role param if it's not null/undefined
      if (finalRole) {
        newParams.set("role", finalRole);
      }
      // Only add source param if it's not "all" or null
      if (finalSource && finalSource !== "all") {
        newParams.set("source", finalSource);
      } else if (finalSource === null) {
        // Remove source param if explicitly set to null
        // (handled by not setting it)
      }

      const queryString = newParams.toString();
      return queryString ? `${pathname}?${queryString}` : pathname;
    },
    [pathname, page, searchQuery, roleFilter, sourceFilter],
  );

  // Debounced search submit
  const submitForm = useCallback(() => {
    formRef.current?.requestSubmit();
  }, []);

  const debouncedSetUrlQuery = useDebounce(submitForm, 300);

  // Load memories
  const loadMemories = useCallback(async () => {
    try {
      setLoading(true);
      const data = await knowledgeApi.getMemories({
        page,
        limit: DEFAULT_LIMIT,
        search: searchQuery || undefined,
        role: roleFilter,
        source: sourceFilter,
      });

      setMemories(data.memories || []);
      setPagination(
        data.pagination || {
          page: DEFAULT_PAGE,
          limit: DEFAULT_LIMIT,
          total: 0,
          totalPages: 0,
          hasMore: false,
        },
      );
    } catch (error: any) {
      toast.error(t("Knowledge.failedToLoadMemories"));
      console.error("Failed to load memories:", error);
    } finally {
      setLoading(false);
    }
  }, [page, searchQuery, roleFilter, sourceFilter, t]);

  useEffect(() => {
    loadMemories();
    // Clear selection when filters change
    setSelectedIds(new Set());
  }, [loadMemories]);

  // Handle search input change
  const handleSearchChange = () => {
    debouncedSetUrlQuery();
  };

  // Handle role filter change
  const handleRoleFilterChange = (role: "user" | "assistant" | null) => {
    startTransition(() => {
      navigate({ to: buildUrl({ role, page: 1 }) });
    });
  };

  // Selection handlers
  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedIds(new Set(memories.map((m) => m.id)));
    } else {
      setSelectedIds(new Set());
    }
  };

  const handleSelectMemory = (id: string, selected: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (selected) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  };

  const allSelected =
    memories.length > 0 && memories.every((m) => selectedIds.has(m.id));
  const someSelected =
    memories.some((m) => selectedIds.has(m.id)) && !allSelected;

  // Delete handlers
  const handleDelete = async (id: string) => {
    if (!confirm(t("Knowledge.confirmDeleteMemory"))) return;

    try {
      const result = await knowledgeApi.deleteMemory(id);
      if (!result.success) throw new Error("Failed to delete memory");

      setMemories((prev) => prev.filter((m) => m.id !== id));
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      toast.success(t("Knowledge.memoryDeleted"));
      // Reload to refresh pagination
      loadMemories();
    } catch (error: any) {
      toast.error(t("Knowledge.failedToDeleteMemory"));
      console.error("Failed to delete memory:", error);
    }
  };

  // Bulk delete handlers
  const handleBulkDelete = async (ids: string[]) => {
    try {
      const result = await knowledgeApi.bulkDeleteMemories(ids);

      if (!result.success) {
        throw new Error("Failed to delete memories");
      }

      // Reload memories
      await loadMemories();
      setSelectedIds(new Set());
    } catch (error: any) {
      throw error;
    }
  };

  const handleBulkDeleteByRole = async (
    role: "user" | "assistant",
    ids: string[],
  ) => {
    try {
      const result = await knowledgeApi.bulkDeleteMemories(ids, role);

      if (!result.success) {
        throw new Error("Failed to delete memories");
      }

      // Reload memories
      await loadMemories();
      setSelectedIds(new Set());
    } catch (error: any) {
      throw error;
    }
  };

  // Edit handlers
  const handleEdit = (memory: Memory) => {
    setEditingMemory(memory);
  };

  const handleSave = async (id: string, content: string) => {
    try {
      const result = await knowledgeApi.updateMemory(id, content);
      if (!result.success) throw new Error("Failed to update memory");

      setMemories((prev) =>
        prev.map((m) => (m.id === id ? { ...m, content: result.content || content } : m)),
      );
      setEditingMemory(null);
      toast.success(t("Knowledge.memoryUpdated"));
    } catch (error: any) {
      toast.error(t("Knowledge.failedToUpdateMemory"));
      console.error("Failed to update memory:", error);
    }
  };

  // Get selected memories with roles
  const selectedMemories = memories.filter((m) => selectedIds.has(m.id));

  if (loading && memories.length === 0) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-32 w-full" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Search and Filters */}
      <div className="flex flex-col gap-4">
        {/* Search Bar */}
        <div className="relative flex-1 max-w-sm">
          <form action={pathname} ref={formRef}>
            {page !== DEFAULT_PAGE && (
              <input type="hidden" name="page" value={DEFAULT_PAGE} />
            )}
            {roleFilter && (
              <input type="hidden" name="role" value={roleFilter} />
            )}
            {sourceFilter && sourceFilter !== "all" && (
              <input type="hidden" name="source" value={sourceFilter} />
            )}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input
                name="search"
                placeholder={t("Knowledge.searchMemories")}
                defaultValue={searchQuery}
                onChange={handleSearchChange}
                className="pl-9 pr-9"
              />
              {searchQuery && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7"
                  onClick={() => {
                    startTransition(() => {
                      navigate({ to: buildUrl({ search: "", page: 1 }) });
                    });
                  }}
                >
                  <X className="size-4" />
                </Button>
              )}
            </div>
          </form>
        </div>

        {/* Source and Role Filters */}
        <div className="flex flex-col gap-3">
          {/* Source Filter Toggle Group */}
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-foreground">
              Show vectors from:
            </span>
            <LayoutGroup>
              <div className="relative inline-flex h-9 items-center justify-center rounded-lg bg-muted/50 p-1 border border-border/50">
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    startTransition(() => {
                      navigate({ to: buildUrl({ source: "all", page: 1 }) });
                    });
                  }}
                  className={cn(
                    "relative z-10 inline-flex h-7 items-center justify-center rounded-md px-3 text-sm font-medium transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                    "disabled:pointer-events-none disabled:opacity-50",
                    sourceFilter === "all"
                      ? "text-foreground"
                      : "text-muted-foreground hover:text-foreground/80",
                  )}
                >
                  {sourceFilter === "all" && (
                    <motion.div
                      layoutId="activeSourceFilterIndicator"
                      className="absolute inset-0 rounded-md bg-background shadow-sm border border-border/50"
                      style={{ zIndex: -1 }}
                      transition={{
                        type: "spring",
                        stiffness: 400,
                        damping: 30,
                      }}
                    />
                  )}
                  All Sources
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    startTransition(() => {
                      navigate({
                        to: buildUrl({ source: "messages", page: 1 }),
                      });
                    });
                  }}
                  className={cn(
                    "relative z-10 inline-flex h-7 items-center justify-center rounded-md px-3 text-sm font-medium transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                    "disabled:pointer-events-none disabled:opacity-50",
                    sourceFilter === "messages"
                      ? "text-foreground"
                      : "text-muted-foreground hover:text-foreground/80",
                  )}
                >
                  {sourceFilter === "messages" && (
                    <motion.div
                      layoutId="activeSourceFilterIndicator"
                      className="absolute inset-0 rounded-md bg-background shadow-sm border border-border/50"
                      style={{ zIndex: -1 }}
                      transition={{
                        type: "spring",
                        stiffness: 400,
                        damping: 30,
                      }}
                    />
                  )}
                  Memories
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    startTransition(() => {
                      // Clear role filter when switching to knowledge (role doesn't apply)
                      navigate({
                        to: buildUrl({ source: "knowledge", page: 1, role: null }),
                      });
                    });
                  }}
                  className={cn(
                    "relative z-10 inline-flex h-7 items-center justify-center rounded-md px-3 text-sm font-medium transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                    "disabled:pointer-events-none disabled:opacity-50",
                    sourceFilter === "knowledge"
                      ? "text-foreground"
                      : "text-muted-foreground hover:text-foreground/80",
                  )}
                >
                  {sourceFilter === "knowledge" && (
                    <motion.div
                      layoutId="activeSourceFilterIndicator"
                      className="absolute inset-0 rounded-md bg-background shadow-sm border border-border/50"
                      style={{ zIndex: -1 }}
                      transition={{
                        type: "spring",
                        stiffness: 400,
                        damping: 30,
                      }}
                    />
                  )}
                  Knowledge Base
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    startTransition(() => {
                      // Clear role filter when switching to documents (role doesn't apply)
                      navigate({
                        to: buildUrl({ source: "documents", page: 1, role: null }),
                      });
                    });
                  }}
                  className={cn(
                    "relative z-10 inline-flex h-7 items-center justify-center rounded-md px-3 text-sm font-medium transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                    "disabled:pointer-events-none disabled:opacity-50",
                    sourceFilter === "documents"
                      ? "text-foreground"
                      : "text-muted-foreground hover:text-foreground/80",
                  )}
                >
                  {sourceFilter === "documents" && (
                    <motion.div
                      layoutId="activeSourceFilterIndicator"
                      className="absolute inset-0 rounded-md bg-background shadow-sm border border-border/50"
                      style={{ zIndex: -1 }}
                      transition={{
                        type: "spring",
                        stiffness: 400,
                        damping: 30,
                      }}
                    />
                  )}
                  Auto Documents
                </button>
              </div>
            </LayoutGroup>
          </div>

          {/* Role Filter Toggle Group (only show for messages) */}
          {sourceFilter === "all" || sourceFilter === "messages" ? (
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium text-foreground">
                Filter by role:
              </span>
              <LayoutGroup>
                <div className="relative inline-flex h-9 items-center justify-center rounded-lg bg-muted/50 p-1 border border-border/50">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      handleRoleFilterChange(null);
                    }}
                    className={cn(
                      "relative z-10 inline-flex h-7 items-center justify-center rounded-md px-3 text-sm font-medium transition-colors",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                      "disabled:pointer-events-none disabled:opacity-50",
                      !roleFilter
                        ? "text-foreground"
                        : "text-muted-foreground hover:text-foreground/80",
                    )}
                  >
                    {!roleFilter && (
                      <motion.div
                        layoutId="activeFilterIndicator"
                        className="absolute inset-0 rounded-md bg-background shadow-sm border border-border/50"
                        style={{ zIndex: -1 }}
                        transition={{
                          type: "spring",
                          stiffness: 400,
                          damping: 30,
                        }}
                      />
                    )}
                    All
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      handleRoleFilterChange("user");
                    }}
                    className={cn(
                      "relative z-10 inline-flex h-7 items-center justify-center rounded-md px-3 text-sm font-medium transition-colors",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                      "disabled:pointer-events-none disabled:opacity-50",
                      roleFilter === "user"
                        ? "text-foreground"
                        : "text-muted-foreground hover:text-foreground/80",
                    )}
                  >
                    {roleFilter === "user" && (
                      <motion.div
                        layoutId="activeFilterIndicator"
                        className="absolute inset-0 rounded-md bg-background shadow-sm border border-border/50"
                        style={{ zIndex: -1 }}
                        transition={{
                          type: "spring",
                          stiffness: 400,
                          damping: 30,
                        }}
                      />
                    )}
                    User
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      handleRoleFilterChange("assistant");
                    }}
                    className={cn(
                      "relative z-10 inline-flex h-7 items-center justify-center rounded-md px-3 text-sm font-medium transition-colors",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                      "disabled:pointer-events-none disabled:opacity-50",
                      roleFilter === "assistant"
                        ? "text-foreground"
                        : "text-muted-foreground hover:text-foreground/80",
                    )}
                  >
                    {roleFilter === "assistant" && (
                      <motion.div
                        layoutId="activeFilterIndicator"
                        className="absolute inset-0 rounded-md bg-background shadow-sm border border-border/50"
                        style={{ zIndex: -1 }}
                        transition={{
                          type: "spring",
                          stiffness: 400,
                          damping: 30,
                        }}
                      />
                    )}
                    Assistant
                  </button>
                </div>
              </LayoutGroup>
            </div>
          ) : null}
        </div>
      </div>

      {/* Select All Checkbox */}
      {memories.length > 0 && (
        <div className="flex items-center gap-2 pb-2 border-b">
          <Checkbox
            checked={someSelected ? "indeterminate" : allSelected}
            onCheckedChange={handleSelectAll}
          />
          <span className="text-sm text-muted-foreground">
            Select all ({memories.length})
          </span>
        </div>
      )}

      {/* Memory List */}
      {memories.length === 0 ? (
        <div className="text-center py-12 animate-in fade-in duration-300">
          <MessageSquareIcon className="size-12 mx-auto text-muted-foreground mb-4" />
          <p className="text-muted-foreground">
            {searchQuery || roleFilter
              ? t("Knowledge.noMemoriesFound")
              : t("Knowledge.noMemories")}
          </p>
        </div>
      ) : (
        <div className="grid gap-4 animate-in fade-in duration-300">
          {memories.map((memory) => (
            <MemoryCard
              key={memory.id}
              memory={memory}
              onEdit={() => handleEdit(memory)}
              onDelete={() => handleDelete(memory.id)}
              selected={selectedIds.has(memory.id)}
              onSelect={(selected) => handleSelectMemory(memory.id, selected)}
              showCheckbox={true}
            />
          ))}
        </div>
      )}

      {/* Pagination */}
      {pagination.totalPages > 1 && (
        <TablePagination
          currentPage={pagination.page}
          totalPages={pagination.totalPages}
          buildUrl={({ page }) => buildUrl({ page })}
        />
      )}

      {/* Bulk Action Toolbar */}
      <BulkActionToolbar
        selectedIds={selectedIds}
        selectedMemories={selectedMemories}
        onDelete={handleBulkDelete}
        onDeleteByRole={handleBulkDeleteByRole}
        onClearSelection={() => setSelectedIds(new Set())}
      />

      {/* Edit Dialog */}
      {editingMemory && (
        <EditMemoryDialog
          memory={editingMemory}
          open={!!editingMemory}
          onOpenChange={(open) => !open && setEditingMemory(null)}
          onSave={handleSave}
        />
      )}
    </div>
  );
}
