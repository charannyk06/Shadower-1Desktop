import Workflow from "@/components/workflow/workflow";
import { useParams, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

/**
 * Workflow Detail Page
 * Auth is handled by AuthGuard in the layout.
 */
export default function WorkflowEditorPage() {
  const params = useParams({ strict: false });
  const navigate = useNavigate();
  const id = params.workflowId;

  // Ensure id is valid
  useEffect(() => {
    if (!id || id === "undefined") {
      navigate({ to: "/workflow" });
    }
  }, [id, navigate]);

  if (!id || id === "undefined") {
    return null;
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
