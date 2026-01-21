"use client";

import { useState, useEffect, useCallback, useRef, useTransition } from "react";
import { useNavigate, useSearch, useLocation } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { FileTextIcon, TrashIcon, Search, X } from "lucide-react";
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
import { toast } from "sonner";
import { useDebounce } from "@/hooks/use-debounce";
// Using native form - Next.js Form not needed in Vite
import { formatDistanceToNow } from "date-fns";
import { knowledgeApi } from "@/lib/electron/knowledge-api";

interface KnowledgeBaseListProps {
  userId: string;
}

interface KnowledgeBase {
  id: string;
  name: string;
  description?: string;
  files: Array<{
    fileName: string;
    chunks: number;
    fileUrl?: string;
    storageKey?: string;
  }>;
  totalChunks: number;
  createdAt: string;
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

      // Desktop mode: Knowledge bases feature is limited
      // Return empty data for now
      const knowledgeBases = await knowledgeApi.getKnowledgeBases();

      setData({
        knowledgeBases: knowledgeBases.map((kb: any) => ({
          ...kb,
          files: kb.files || [],
          totalChunks: kb.totalChunks || 0,
        })),
        pagination: {
          page,
          limit: DEFAULT_LIMIT,
          total: knowledgeBases.length,
          totalPages: Math.ceil(knowledgeBases.length / DEFAULT_LIMIT),
          hasMore: false,
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

  // Handle delete
  const handleDeleteClick = (knowledgeBaseId: string) => {
    setDeletingKnowledgeBaseId(knowledgeBaseId);
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!deletingKnowledgeBaseId) return;

    setIsDeleting(true);
    try {
      // Desktop mode: Knowledge bases deletion not fully supported yet
      toast.info("Knowledge base deletion is coming soon to desktop mode");

      setDeleteDialogOpen(false);
      setDeletingKnowledgeBaseId(null);

      // Reload knowledge bases list
      await loadKnowledgeBases();
    } catch (error: any) {
      toast.error(error.message || t("Knowledge.failedToDeleteKnowledgeBase"));
      console.error("Failed to delete knowledge base:", error);
    } finally {
      setIsDeleting(false);
    }
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

  if (error || !data || data.knowledgeBases.length === 0) {
    return (
      <div className="space-y-4">
        {/* Search Bar */}
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

        <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
          <FileTextIcon className="size-12 mb-4" />
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
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Search Bar */}
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

      {/* Knowledge Bases List */}
      <div className="flex flex-col gap-4">
        {data.knowledgeBases.map((kb) => (
          <Card key={kb.id}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileTextIcon className="size-5" />
                {kb.name}
              </CardTitle>
              {kb.description && (
                <CardDescription>{kb.description}</CardDescription>
              )}
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <div className="text-sm text-muted-foreground">
                  <span className="font-medium">{kb.files.length}</span>{" "}
                  {kb.files.length === 1 ? "file" : "files"} •{" "}
                  <span className="font-medium">{kb.totalChunks}</span>{" "}
                  {kb.totalChunks === 1 ? "chunk" : "chunks"}
                </div>
                <div className="flex flex-col gap-1">
                  {kb.files.map((file, idx) => (
                    <div
                      key={idx}
                      className="text-xs text-muted-foreground flex items-center gap-2"
                    >
                      <FileTextIcon className="size-3" />
                      <span>{file.fileName}</span>
                      <span className="text-[10px]">
                        ({file.chunks} {file.chunks === 1 ? "chunk" : "chunks"})
                      </span>
                    </div>
                  ))}
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
                onClick={() => handleDeleteClick(kb.id)}
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

      {/* Pagination */}
      {data.pagination.totalPages > 1 && (
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
