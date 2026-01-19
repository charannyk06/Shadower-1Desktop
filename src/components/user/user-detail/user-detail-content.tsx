"use client";

import { useEffect, useState } from "react";
import { authClient } from "@/lib/auth/client";
import { userApi } from "@/lib/electron/user-api";
import { Loader2 } from "lucide-react";
import { UserDetail } from "./user-detail";
import { UserStatisticsCard } from "./user-statistics-card";
import { UserStatsCardLoaderSkeleton } from "./user-stats-card-loader";

/**
 * Client-side UserDetailContent
 * Loads user data via IPC for Electron desktop app
 */
export function UserDetailContent({
  userId,
  view = "admin",
}: {
  userId?: string;
  view?: "admin" | "user";
}) {
  const { data: session } = authClient.useSession();
  const [user, setUser] = useState<any>(null);
  const [stats, setStats] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [statsLoading, setStatsLoading] = useState(true);

  const currentUserId = session?.user?.id || "";
  const resolvedUserId = userId || currentUserId;

  useEffect(() => {
    if (!currentUserId) return;

    const loadUserData = async () => {
      setIsLoading(true);
      try {
        // Get user details
        const userData = await userApi.getDetails(resolvedUserId);
        if (userData) {
          setUser(userData);
        } else {
          // Fallback to session user
          setUser({
            id: session?.user?.id,
            name: session?.user?.name,
            email: session?.user?.email,
            image: session?.user?.image,
            emailVerified: session?.user?.emailVerified,
            createdAt: new Date(),
            updatedAt: new Date(),
            lastLogin: null,
            banned: false,
            banReason: null,
            banExpires: null,
          });
        }
      } catch (error) {
        console.error("[UserDetailContent] Error loading user:", error);
        // Fallback to session user
        if (session?.user) {
          setUser({
            id: session.user.id,
            name: session.user.name,
            email: session.user.email,
            image: session.user.image,
            emailVerified: session.user.emailVerified,
            createdAt: new Date(),
            updatedAt: new Date(),
            lastLogin: null,
            banned: false,
            banReason: null,
            banExpires: null,
          });
        }
      }
      setIsLoading(false);
    };

    loadUserData();
  }, [currentUserId, resolvedUserId, session?.user]);

  // Load stats separately
  useEffect(() => {
    if (!currentUserId) return;

    const loadStats = async () => {
      setStatsLoading(true);
      try {
        const userStats = await userApi.getStats(resolvedUserId);
        setStats(userStats);
      } catch (error) {
        console.error("[UserDetailContent] Error loading stats:", error);
        setStats({
          threadCount: 0,
          messageCount: 0,
          modelStats: [],
          totalTokens: 0,
          period: "Last 30 Days",
        });
      }
      setStatsLoading(false);
    };

    loadStats();
  }, [currentUserId, resolvedUserId]);

  if (!session?.user?.id) {
    return null;
  }

  if (isLoading || !user) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <UserDetail
      view={view}
      user={user}
      currentUserId={currentUserId}
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
            stats={{ ...stats, period: "Last 30 Days" }}
            view={view}
          />
        )
      }
    />
  );
}
