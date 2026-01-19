import { requireAdminPermission } from "auth/permissions";
import { unauthorized } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function AdminBillingPage() {
  try {
    await requireAdminPermission();
  } catch (_error) {
    unauthorized();
  }

  return (
    <div className="container mx-auto py-10 px-4">
      <h1 className="text-3xl font-bold mb-8">Billing Dashboard</h1>

      <div className="bg-muted/50 rounded-lg p-8 text-center">
        <h2 className="text-xl font-semibold mb-2">Local-First Mode</h2>
        <p className="text-muted-foreground">
          Billing features are not available in the local desktop version.
        </p>
        <p className="text-muted-foreground mt-2">
          This app runs entirely on your machine without any subscription
          requirements.
        </p>
      </div>
    </div>
  );
}
