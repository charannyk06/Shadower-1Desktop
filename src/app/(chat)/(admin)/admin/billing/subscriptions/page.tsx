import { SubscriptionsTable } from "@/components/admin/subscriptions-table";
import { requireAdminPermission } from "auth/permissions";
import { getSession } from "lib/auth/server";
import { subscriptionRepository, userRepository } from "lib/db/repository";
import { redirect, unauthorized } from "next/navigation";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{
    page?: string;
    limit?: string;
    tier?: string;
    status?: string;
    query?: string;
  }>;
}

async function getSubscriptions(params: {
  page: number;
  limit: number;
  tier?: string;
  status?: string;
  query?: string;
}) {
  // Get all subscriptions
  const allSubscriptions = await subscriptionRepository.getAllActive();

  // Get user details for each subscription
  const subscriptionsWithUsers = await Promise.all(
    allSubscriptions.map(async (sub) => {
      const user = await userRepository.getUserById(sub.userId);
      return {
        ...sub,
        userEmail: user?.email || "Unknown",
        userName: user?.name || "Unknown",
      };
    }),
  );

  // Apply filters
  let filtered = subscriptionsWithUsers;

  if (params.tier && params.tier !== "all") {
    filtered = filtered.filter((s) => s.tier === params.tier);
  }

  if (params.status && params.status !== "all") {
    filtered = filtered.filter((s) => s.status === params.status);
  }

  if (params.query) {
    const q = params.query.toLowerCase();
    filtered = filtered.filter(
      (s) =>
        s.userEmail.toLowerCase().includes(q) ||
        s.userName.toLowerCase().includes(q) ||
        s.userId.toLowerCase().includes(q),
    );
  }

  // Sort by created date (most recent first)
  filtered.sort((a, b) => {
    const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return dateB - dateA;
  });

  // Paginate
  const total = filtered.length;
  const start = (params.page - 1) * params.limit;
  const end = start + params.limit;
  const subscriptions = filtered.slice(start, end);

  return {
    subscriptions,
    total,
    page: params.page,
    limit: params.limit,
    totalPages: Math.ceil(total / params.limit),
  };
}

export default async function SubscriptionsPage({ searchParams }: PageProps) {
  try {
    await requireAdminPermission();
  } catch (_error) {
    unauthorized();
  }

  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  const params = await searchParams;
  const page = Number.parseInt(params.page ?? "1", 10);
  const limit = Number.parseInt(params.limit ?? "20", 10);

  const data = await getSubscriptions({
    page,
    limit,
    tier: params.tier,
    status: params.status,
    query: params.query,
  });

  return (
    <SubscriptionsTable
      subscriptions={data.subscriptions}
      total={data.total}
      page={data.page}
      limit={data.limit}
      totalPages={data.totalPages}
      currentTier={params.tier}
      currentStatus={params.status}
      query={params.query}
    />
  );
}
