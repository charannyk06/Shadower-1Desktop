"use client";

import { useState, useEffect, useCallback, useRef, useTransition } from "react";
import { useNavigate, useSearch, useLocation } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { FileTextIcon, TrashIcon, Search, X, PlusIcon, FolderIcon } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "ui/card";
import { Button } from "ui/button";
import { Input } from "ui/input";
import { Skeleton } from "ui/skeleton";
import { TablePagination } from "ui/table-pagination";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "ui/dialog";
import { Label } from "ui/label";
import { Textarea } from "ui/textarea";
import { toast } from "sonner";
import { useDebounce } from "@/hooks/use-debounce";
import { formatDistanceToNow } from "date-fns";
import { knowledgeApi } from "@/lib/electron/knowledge-api";

interface KnowledgeBaseListProps {
  userId: string;
}

interface KnowledgeBase {
  id: string;
  name: string;
  description?: string;
  documentCount: number;
  totalChunks: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface KnowledgeBasesResponse {
  knowledgeBases: KnowledgeBase[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasMore: boolean;
  };
}

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;

export function KnowledgeBaseList({ userId: _userId }: KnowledgeBaseListProps) {
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

  // State
  const [data, setData] = useState<KnowledgeBasesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingKnowledgeBaseId, setDeletingKnowledgeBaseId] = useState<
    string | null
  >(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Create dialog state
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [newKbName, setNewKbName] = useState("");
  const [newKbDescription, setNewKbDescription] = useState("");
  const [isCreating, setIsCreating] = useState(false);

  // Build URL helper
  const buildUrl = useCallback(
    (params: { page?: number; search?: string } = {}) => {
      const newParams = new URLSearchParams();

      const finalPage = params.page ?? page;
      const finalSearch = params.search ?? searchQuery;

      if (finalPage && finalPage !== DEFAULT_PAGE) {
        newParams.set("page", finalPage.toString());
      }
      if (finalSearch) {
        newParams.set("search", finalSearch);
      }

      const queryString = newParams.toString();
      return queryString ? `${pathname}?${queryString}` : pathname;
    },
    [pathname, page, searchQuery],
  );

  // Debounced search submit
  const submitForm = useCallback(() => {
    formRef.current?.requestSubmit();
  }, []);

  const debouncedSetUrlQuery = useDebounce(submitForm, 300);

  // Load knowledge bases
  const loadKnowledgeBases = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const knowledgeBases = await knowledgeApi.getKnowledgeBases();

      // Filter by search query if present
      let filteredBases = knowledgeBases;
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        filteredBases = knowledgeBases.filter(
          (kb) =>
            kb.name.toLowerCase().includes(query) ||
            (kb.description && kb.description.toLowerCase().includes(query))
        );
      }

      // Apply pagination
      const startIdx = (page - 1) * DEFAULT_LIMIT;
      const paginatedBases = filteredBases.slice(startIdx, startIdx + DEFAULT_LIMIT);

      setData({
        knowledgeBases: paginatedBases,
        pagination: {
          page,
          limit: DEFAULT_LIMIT,
          total: filteredBases.length,
          totalPages: Math.ceil(filteredBases.length / DEFAULT_LIMIT),
          hasMore: startIdx + DEFAULT_LIMIT < filteredBases.length,
        },
      });
    } catch (err: any) {
      setError(err);
      toast.error(t("Knowledge.failedToLoadMemories"), {
        description: err.message,
      });
    } finally {
      setLoading(false);
    }
  }, [page, searchQuery, t]);

  useEffect(() => {
    loadKnowledgeBases();
  }, [loadKnowledgeBases]);

  // Handle search input change
  const handleSearchChange = () => {
    debouncedSetUrlQuery();
  };

  // Handle create
  const handleCreateKnowledgeBase = async () => {
    if (!newKbName.trim()) {
      toast.error("Please enter a name for the knowledge base");
      return;
    }

    setIsCreating(true);
    try {
      const result = await knowledgeApi.createKnowledgeBase({
        name: newKbName.trim(),
        description: newKbDescription.trim() || undefined,
      });

      if (result) {
        toast.success(`Knowledge base "${result.name}" created successfully`);
        setCreateDialogOpen(false);
        setNewKbName("");
        setNewKbDescription("");
        await loadKnowledgeBases();
      } else {
        toast.error("Failed to create knowledge base");
      }
    } catch (error: any) {
      toast.error(error.message || "Failed to create knowledge base");
      console.error("Failed to create knowledge base:", error);
    } finally {
      setIsCreating(false);
    }
  };

  // Handle delete
  const handleDeleteClick = (knowledgeBaseId: string) => {
    setDeletingKnowledgeBaseId(knowledgeBaseId);
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!deletingKnowledgeBaseId) return;

    setIsDeleting(true);
    try {
      const result = await knowledgeApi.deleteKnowledgeBase(deletingKnowledgeBaseId);

      if (result.success) {
        toast.success("Knowledge base deleted successfully");
        setDeleteDialogOpen(false);
        setDeletingKnowledgeBaseId(null);
        await loadKnowledgeBases();
      } else {
        toast.error("Failed to delete knowledge base");
      }
    } catch (error: any) {
      toast.error(error.message || t("Knowledge.failedToDeleteKnowledgeBase"));
      console.error("Failed to delete knowledge base:", error);
    } finally {
      setIsDeleting(false);
    }
  };

  // Navigate to knowledge base detail/documents page
  const handleKnowledgeBaseClick = (kbId: string) => {
    navigate({ to: `/knowledge/${kbId}` as any });
  };

  if (loading && !data) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-48 w-full" />
        ))}
      </div>
    );
  }

  const isEmpty = !data || data.knowledgeBases.length === 0;

  return (
    <div className="space-y-4">
      {/* Header with Search and Create Button */}
      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-sm">
          <form action={pathname} ref={formRef}>
            {page !== DEFAULT_PAGE && (
              <input type="hidden" name="page" value={DEFAULT_PAGE} />
            )}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input
                name="search"
                placeholder={t("Knowledge.searchKnowledgeBases")}
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

        <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <PlusIcon className="size-4 mr-2" />
              Create Knowledge Base
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create Knowledge Base</DialogTitle>
              <DialogDescription>
                Create a new knowledge base to organize your documents for RAG retrieval.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  placeholder="My Knowledge Base"
                  value={newKbName}
                  onChange={(e) => setNewKbName(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="description">Description (optional)</Label>
                <Textarea
                  id="description"
                  placeholder="A collection of documents about..."
                  value={newKbDescription}
                  onChange={(e) => setNewKbDescription(e.target.value)}
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setCreateDialogOpen(false)}
                disabled={isCreating}
              >
                Cancel
              </Button>
              <Button onClick={handleCreateKnowledgeBase} disabled={isCreating}>
                {isCreating ? "Creating..." : "Create"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Empty State */}
      {isEmpty && !error && (
        <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
          <FolderIcon className="size-12 mb-4" />
          <p className="text-lg">
            {searchQuery
              ? t("Knowledge.noKnowledgeBasesFound")
              : t("Knowledge.noKnowledgeBases")}
          </p>
          {!searchQuery && (
            <p className="text-sm mt-2">
              {t("Knowledge.createKnowledgeBaseToGetStarted")}
            </p>
          )}
        </div>
      )}

      {/* Error State */}
      {error && (
        <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
          <p className="text-lg text-destructive">Failed to load knowledge bases</p>
          <p className="text-sm mt-2">{error.message}</p>
          <Button variant="outline" className="mt-4" onClick={loadKnowledgeBases}>
            Retry
          </Button>
        </div>
      )}

      {/* Knowledge Bases List */}
      {!isEmpty && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {data.knowledgeBases.map((kb) => (
            <Card
              key={kb.id}
              className="cursor-pointer hover:border-primary/50 transition-colors"
              onClick={() => handleKnowledgeBaseClick(kb.id)}
            >
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FolderIcon className="size-5" />
                  {kb.name}
                </CardTitle>
                {kb.description && (
                  <CardDescription className="line-clamp-2">
                    {kb.description}
                  </CardDescription>
                )}
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-4 text-sm text-muted-foreground">
                  <div className="flex items-center gap-1">
                    <FileTextIcon className="size-4" />
                    <span className="font-medium">{kb.documentCount}</span>{" "}
                    {kb.documentCount === 1 ? "document" : "documents"}
                  </div>
                  <div>
                    <span className="font-medium">{kb.totalChunks}</span>{" "}
                    {kb.totalChunks === 1 ? "chunk" : "chunks"}
                  </div>
                </div>
              </CardContent>
              <CardFooter className="flex justify-between items-center text-xs text-muted-foreground">
                <span>
                  Created{" "}
                  {formatDistanceToNow(new Date(kb.createdAt), {
                    addSuffix: true,
                  })}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeleteClick(kb.id);
                  }}
                  disabled={isDeleting && deletingKnowledgeBaseId === kb.id}
                >
                  <TrashIcon className="size-4 mr-1" />
                  {isDeleting && deletingKnowledgeBaseId === kb.id
                    ? t("Knowledge.deletingKnowledgeBase")
                    : "Delete"}
                </Button>
              </CardFooter>
            </Card>
          ))}
        </div>
      )}

      {/* Pagination */}
      {data && data.pagination.totalPages > 1 && (
        <TablePagination
          currentPage={data.pagination.page}
          totalPages={data.pagination.totalPages}
          buildUrl={({ page }) => buildUrl({ page })}
        />
      )}

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Knowledge Base?</AlertDialogTitle>
            <AlertDialogDescription>
              {t("Knowledge.confirmDeleteKnowledgeBase")}
              This will also delete all documents and their indexed content.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? t("Knowledge.deletingKnowledgeBase") : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
