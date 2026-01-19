export const dynamic = "force-dynamic";

export default async function SubscriptionsPage() {
  // All authenticated users have access (roles/permissions removed)
  return (
    <div className="container mx-auto py-10 px-4">
      <h1 className="text-3xl font-bold mb-8">Subscriptions</h1>

      <div className="bg-muted/50 rounded-lg p-8 text-center">
        <h2 className="text-xl font-semibold mb-2">Local-First Mode</h2>
        <p className="text-muted-foreground">
          Subscription management is not available in the local desktop version.
        </p>
      </div>
    </div>
  );
}
