"use client";

import Workflow from "@/components/workflow/workflow";
import { useParams, redirect } from "next/navigation";

/**
 * Workflow Detail Page
 * Auth is handled by AuthGuard in the layout.
 */
export default function WorkflowPage() {
  const params = useParams();
  const id = params.id as string;

  // Ensure id is valid
  if (!id || id === "undefined") {
    redirect("/workflow");
  }

  // Database access is handled via IPC in the Workflow component
  return (
    <Workflow
      key={id}
      workflowId={id}
      initialNodes={[]}
      initialEdges={[]}
      hasEditAccess={true}
    />
  );
}
