"use client";

import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  FileTextIcon,
  TrashIcon,
  UploadIcon,
  ArrowLeftIcon,
  CheckCircleIcon,
  XCircleIcon,
  Loader2Icon,
  ClockIcon,
  FileIcon,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "ui/card";
import { Button } from "ui/button";
import { Skeleton } from "ui/skeleton";
import { Badge } from "ui/badge";
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
import { formatDistanceToNow } from "date-fns";
import { knowledgeApi } from "@/lib/electron/knowledge-api";

interface KnowledgeBaseDetailPageProps {
  userId: string;
  knowledgeBaseId: string;
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

interface Document {
  id: string;
  knowledgeBaseId: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  chunkCount: number;
  status: "pending" | "processing" | "indexed" | "failed";
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
}

const statusConfig: Record<
  string,
  {
    icon: React.ComponentType<any>;
    label: string;
    variant: "default" | "secondary" | "destructive" | "outline";
  }
> = {
  pending: { icon: ClockIcon, label: "Pending", variant: "secondary" },
  processing: { icon: Loader2Icon, label: "Processing", variant: "outline" },
  indexed: { icon: CheckCircleIcon, label: "Indexed", variant: "default" },
  failed: { icon: XCircleIcon, label: "Failed", variant: "destructive" },
};

function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

export function KnowledgeBaseDetailPage({
  userId: _userId,
  knowledgeBaseId,
}: KnowledgeBaseDetailPageProps) {
  const navigate = useNavigate();

  // State
  const [knowledgeBase, setKnowledgeBase] = useState<KnowledgeBase | null>(
    null,
  );
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingDocumentId, setDeletingDocumentId] = useState<string | null>(
    null,
  );
  const [isDeleting, setIsDeleting] = useState(false);

  // Load knowledge base and documents
  const loadData = useCallback(async () => {
    try {
      setLoading(true);

      const [kb, docs] = await Promise.all([
        knowledgeApi.getKnowledgeBase(knowledgeBaseId),
        knowledgeApi.getDocuments(knowledgeBaseId),
      ]);

      if (!kb) {
        toast.error("Knowledge base not found");
        navigate({ to: "/knowledge" });
        return;
      }

      setKnowledgeBase(kb);
      setDocuments(docs);
    } catch (error: any) {
      toast.error("Failed to load knowledge base", {
        description: error.message,
      });
    } finally {
      setLoading(false);
    }
  }, [knowledgeBaseId, navigate]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Refresh documents periodically if any are processing
  useEffect(() => {
    const hasProcessing = documents.some(
      (d) => d.status === "processing" || d.status === "pending",
    );
    if (!hasProcessing) return;

    const interval = setInterval(async () => {
      const docs = await knowledgeApi.getDocuments(knowledgeBaseId);
      setDocuments(docs);

      // Also refresh knowledge base to get updated counts
      const kb = await knowledgeApi.getKnowledgeBase(knowledgeBaseId);
      if (kb) setKnowledgeBase(kb);
    }, 3000);

    return () => clearInterval(interval);
  }, [documents, knowledgeBaseId]);

  // Handle file upload
  const handleUpload = async () => {
    try {
      // Open file selection dialog
      const file = await knowledgeApi.selectFile();
      if (!file) return;

      setUploading(true);
      toast.info(`Uploading ${file.fileName}...`);

      const result = await knowledgeApi.uploadDocument(
        knowledgeBaseId,
        file.filePath,
        file.fileName,
      );

      if (result) {
        toast.success(`${file.fileName} uploaded successfully`);
        await loadData();
      } else {
        toast.error("Failed to upload document");
      }
    } catch (error: any) {
      toast.error("Failed to upload document", {
        description: error.message,
      });
    } finally {
      setUploading(false);
    }
  };

  // Handle document delete
  const handleDeleteClick = (documentId: string) => {
    setDeletingDocumentId(documentId);
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!deletingDocumentId) return;

    setIsDeleting(true);
    try {
      const result = await knowledgeApi.deleteDocument(deletingDocumentId);

      if (result.success) {
        toast.success("Document deleted successfully");
        setDeleteDialogOpen(false);
        setDeletingDocumentId(null);
        await loadData();
      } else {
        toast.error("Failed to delete document");
      }
    } catch (error: any) {
      toast.error(error.message || "Failed to delete document");
    } finally {
      setIsDeleting(false);
    }
  };

  if (loading) {
    return (
      <div className="container max-w-4xl mx-auto py-6 space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32 w-full" />
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      </div>
    );
  }

  if (!knowledgeBase) {
    return null;
  }

  return (
    <div className="container max-w-4xl mx-auto py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => navigate({ to: "/knowledge" })}
        >
          <ArrowLeftIcon className="size-5" />
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">{knowledgeBase.name}</h1>
          {knowledgeBase.description && (
            <p className="text-muted-foreground">{knowledgeBase.description}</p>
          )}
        </div>
        <Button onClick={handleUpload} disabled={uploading}>
          {uploading ? (
            <Loader2Icon className="size-4 mr-2 animate-spin" />
          ) : (
            <UploadIcon className="size-4 mr-2" />
          )}
          Upload Document
        </Button>
      </div>

      {/* Stats */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center gap-8">
            <div>
              <div className="text-2xl font-bold">
                {knowledgeBase.documentCount}
              </div>
              <div className="text-sm text-muted-foreground">Documents</div>
            </div>
            <div>
              <div className="text-2xl font-bold">
                {knowledgeBase.totalChunks}
              </div>
              <div className="text-sm text-muted-foreground">
                Indexed Chunks
              </div>
            </div>
            <div className="ml-auto text-right text-sm text-muted-foreground">
              <div>
                Created{" "}
                {formatDistanceToNow(new Date(knowledgeBase.createdAt), {
                  addSuffix: true,
                })}
              </div>
              <div>
                Updated{" "}
                {formatDistanceToNow(new Date(knowledgeBase.updatedAt), {
                  addSuffix: true,
                })}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Documents List */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileTextIcon className="size-5" />
            Documents
          </CardTitle>
          <CardDescription>
            Upload documents to index them for RAG retrieval. Supported formats:
            TXT, MD, JSON, CSV, DOCX
          </CardDescription>
        </CardHeader>
        <CardContent>
          {documents.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <FileIcon className="size-12 mb-4" />
              <p className="text-lg">No documents yet</p>
              <p className="text-sm mt-1">Upload a document to get started</p>
              <Button
                className="mt-4"
                onClick={handleUpload}
                disabled={uploading}
              >
                {uploading ? (
                  <Loader2Icon className="size-4 mr-2 animate-spin" />
                ) : (
                  <UploadIcon className="size-4 mr-2" />
                )}
                Upload Document
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              {documents.map((doc) => {
                const status = statusConfig[doc.status];
                const StatusIcon = status.icon;

                return (
                  <div
                    key={doc.id}
                    className="flex items-center gap-4 p-4 rounded-lg border bg-card"
                  >
                    <FileTextIcon className="size-8 text-muted-foreground" />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{doc.fileName}</div>
                      <div className="text-sm text-muted-foreground flex items-center gap-3">
                        <span>{doc.fileType.toUpperCase()}</span>
                        <span>{formatFileSize(doc.fileSize)}</span>
                        {doc.status === "indexed" && (
                          <span>{doc.chunkCount} chunks</span>
                        )}
                        <span>
                          {formatDistanceToNow(new Date(doc.createdAt), {
                            addSuffix: true,
                          })}
                        </span>
                      </div>
                      {doc.errorMessage && (
                        <div className="text-sm text-destructive mt-1">
                          {doc.errorMessage}
                        </div>
                      )}
                    </div>
                    <Badge variant={status.variant}>
                      <StatusIcon
                        className={`size-3 mr-1 ${
                          doc.status === "processing" ? "animate-spin" : ""
                        }`}
                      />
                      {status.label}
                    </Badge>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleDeleteClick(doc.id)}
                      disabled={
                        (isDeleting && deletingDocumentId === doc.id) ||
                        doc.status === "processing"
                      }
                    >
                      <TrashIcon className="size-4" />
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Document?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the document and remove all its
              indexed content from the knowledge base.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
