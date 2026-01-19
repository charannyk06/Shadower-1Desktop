"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { UserDetail } from "@/components/user/user-detail/user-detail";
import { UserStatsCardLoaderSkeleton } from "@/components/user/user-detail/user-stats-card-loader";
import { UserStatisticsCard } from "@/components/user/user-detail/user-statistics-card";
import { authClient } from "@/lib/auth/client";
import { userApi } from "@/lib/electron/user-api";
import { Loader2 } from "lucide-react";

/**
 * User Detail Page (Admin)
 * Auth is handled by AuthGuard in the layout.
 */
export default function UserDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  const { data: session } = authClient.useSession();

  const [user, setUser] = useState<any>(null);
  const [stats, setStats] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [statsLoading, setStatsLoading] = useState(true);

  useEffect(() => {
    if (!session?.user?.id || !id) return;

    const loadUser = async () => {
      setIsLoading(true);
      try {
        const userData = await userApi.getById(id);
        if (!userData) {
          router.replace("/admin/users");
          return;
        }
        setUser(userData);
      } catch (error) {
        console.error("[UserDetailPage] Error loading user:", error);
        router.replace("/admin/users");
      }
      setIsLoading(false);
    };

    loadUser();
  }, [id, session?.user?.id, router]);

  // Load stats separately
  useEffect(() => {
    if (!session?.user?.id || !id) return;

    const loadStats = async () => {
      setStatsLoading(true);
      try {
        const userStats = await userApi.getStats(id);
        setStats(userStats);
      } catch (error) {
        console.error("[UserDetailPage] Error loading stats:", error);
        setStats({
          threadCount: 0,
          messageCount: 0,
          modelStats: [],
          totalTokens: 0,
          period: "All Time",
        });
      }
      setStatsLoading(false);
    };

    loadStats();
  }, [id, session?.user?.id]);

  if (!session?.user?.id) {
    return null; // AuthGuard will handle redirect
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <UserDetail
      user={user}
      currentUserId={session.user.id}
      userAccountInfo={{
        hasPassword: false,
        oauthProviders: [],
        accounts: [],
      }}
      userStatsSlot={
        statsLoading ? (
          <UserStatsCardLoaderSkeleton />
        ) : (
          <UserStatisticsCard
            stats={{ ...stats, period: "All Time" }}
            view="admin"
          />
        )
      }
      view="admin"
    />
  );
}
