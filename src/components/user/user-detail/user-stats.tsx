import { getUserStats } from "lib/user/server";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "ui/card";
import { Label } from "ui/label";
import { ModelProviderIcon } from "ui/model-provider-icon";
import { Progress } from "ui/progress";

interface UserStatsProps {
  userId?: string;
  view?: "admin" | "user";
}

function formatNumber(num: number): string {
  if (num >= 1_000_000) {
    return `${(num / 1_000_000).toFixed(1)}M`;
  }
  if (num >= 1_000) {
    return `${(num / 1_000).toFixed(1)}K`;
  }
  return num.toLocaleString();
}

export async function UserStats({ userId }: UserStatsProps) {
  const stats = await getUserStats(userId);

  // Calculate percentage for progress bars (relative to highest model)
  const maxTokens =
    stats.modelStats.length > 0
      ? Math.max(...stats.modelStats.map((s) => s.totalTokens))
      : 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Usage Statistics</CardTitle>
        <CardDescription>Your usage over the last 30 days</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Summary Stats */}
        <div className="grid gap-4 md:grid-cols-3">
          <div className="space-y-2">
            <Label className="text-muted-foreground text-xs uppercase tracking-wide">
              Chat Threads
            </Label>
            <p className="text-2xl font-bold">{stats.threadCount}</p>
          </div>

          <div className="space-y-2">
            <Label className="text-muted-foreground text-xs uppercase tracking-wide">
              Messages Sent
            </Label>
            <p className="text-2xl font-bold">{stats.messageCount}</p>
          </div>

          <div className="space-y-2">
            <Label className="text-muted-foreground text-xs uppercase tracking-wide">
              Total Tokens
            </Label>
            <p className="text-2xl font-bold">
              {formatNumber(stats.totalTokens)}
            </p>
          </div>
        </div>

        {/* Model Breakdown */}
        {stats.modelStats.length > 0 && (
          <div className="space-y-4">
            <Label className="text-muted-foreground text-xs uppercase tracking-wide">
              Token Usage by Model
            </Label>
            <div className="space-y-3">
              {stats.modelStats.map((model) => (
                <div key={model.model} className="space-y-1.5">
                  <div className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <ModelProviderIcon
                        provider={model.provider as any}
                        className="size-4"
                      />
                      <span className="font-medium truncate max-w-[200px]">
                        {model.model}
                      </span>
                    </div>
                    <span className="text-muted-foreground">
                      {formatNumber(model.totalTokens)} tokens
                    </span>
                  </div>
                  <Progress
                    value={
                      maxTokens > 0 ? (model.totalTokens / maxTokens) * 100 : 0
                    }
                    className="h-2"
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        {stats.modelStats.length === 0 && (
          <div className="text-center py-4 text-muted-foreground">
            <p>No usage data yet. Start chatting to see your statistics!</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
