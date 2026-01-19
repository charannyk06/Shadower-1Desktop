import Workflow from "@/components/workflow/workflow";
import { getSession } from "auth/server";
import { redirect } from "next/navigation";

export default async function WorkflowPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await getSession();

  if (!session) {
    redirect("/sign-in");
  }

  // In Electron mode, database access is handled via IPC in the client component
  // Don't fetch workflow data on the server - let the client component handle it via API route
  // This avoids the SQLite database access error in Electron dev mode
  // The Workflow component uses SWR to fetch from /api/workflow/${id} which handles Electron mode gracefully
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
