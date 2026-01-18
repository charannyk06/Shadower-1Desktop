import { BackgroundPaths } from "ui/background-paths";
import { Card, CardHeader } from "ui/card";
import { Skeleton } from "ui/skeleton";

export default function AgentsLoading() {
  return (
    <div className="w-full flex flex-col gap-4 p-8">
      <div className="flex justify-between items-center">
        <Skeleton className="h-8 w-24" />
        <Skeleton className="h-10 w-32" />
      </div>

      {/* My Agents Section */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <Skeleton className="h-6 w-28" />
          <div className="flex-1 h-px bg-border" />
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {/* Create new agent card */}
          <Card className="relative bg-secondary overflow-hidden h-[196px]">
            <div className="absolute inset-0 w-full h-full opacity-50">
              <BackgroundPaths />
            </div>
            <CardHeader>
              <Skeleton className="h-6 w-32" />
              <Skeleton className="h-4 w-48 mt-2" />
              <div className="mt-auto ml-auto flex-1">
                <Skeleton className="h-10 w-20" />
              </div>
            </CardHeader>
          </Card>

          {/* Agent cards */}
          {Array(5)
            .fill(null)
            .map((_, i) => (
              <Skeleton key={i} className="min-h-[196px]" />
            ))}
        </div>
      </div>

      {/* Shared Agents Section */}
      <div className="flex flex-col gap-4 mt-8">
        <div className="flex items-center gap-2">
          <Skeleton className="h-6 w-32" />
          <div className="flex-1 h-px bg-border" />
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {Array(6)
            .fill(null)
            .map((_, i) => (
              <Skeleton key={i} className="min-h-[196px]" />
            ))}
        </div>
      </div>
    </div>
  );
}
