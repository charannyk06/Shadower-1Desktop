import { ChevronRight, Search } from "lucide-react";
import { Avatar, AvatarFallback } from "ui/avatar";
import { Input } from "ui/input";
import { Skeleton } from "ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "ui/table";

function getNameWidth(index: number): string {
  const remainder = index % 3;
  if (remainder === 0) return "w-32";
  if (remainder === 1) return "w-48";
  return "w-40";
}

function getEmailWidth(index: number): string {
  const remainder = index % 4;
  if (remainder === 0) return "w-56";
  if (remainder === 1) return "w-72";
  if (remainder === 2) return "w-64";
  return "w-60";
}

function getRoleWidth(index: number): string {
  const remainder = index % 4;
  if (remainder === 0) return "w-16";
  if (remainder === 1) return "w-20";
  if (remainder === 2) return "w-16";
  return "w-20";
}

function getStatusWidth(index: number): string {
  const remainder = index % 3;
  if (remainder === 0) return "w-18";
  if (remainder === 1) return "w-14";
  return "w-16";
}

export function UsersTableSkeleton() {
  // Generate reasonable number of skeleton rows
  const skeletonRows = Array.from({ length: 8 }, (_, i) => i);

  return (
    <div className="space-y-4 w-full">
      {/* Search Bar Section */}
      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search by name or email..."
            className="pl-9"
            disabled
          />
        </div>
        {/* Total count skeleton */}
        <div className="text-sm text-muted-foreground">
          <Skeleton className="h-4 w-16" />
        </div>
      </div>

      {/* Table Section */}
      <div className="rounded-lg border bg-card w-full overflow-x-auto">
        <Table data-testid="users-table-skeleton" className="w-full">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="font-semibold w-1/2">User</TableHead>
              <TableHead className="font-semibold w-32">Role</TableHead>
              <TableHead className="font-semibold w-24">Status</TableHead>
              <TableHead className="font-semibold w-32">Joined</TableHead>
              <TableHead className="w-[50px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {skeletonRows.map((index) => (
              <TableRow key={index}>
                {/* User Column */}
                <TableCell>
                  <div className="flex items-center gap-3">
                    <Avatar className="h-10 w-10 shrink-0">
                      <AvatarFallback>
                        <Skeleton className="h-full w-full rounded-full" />
                      </AvatarFallback>
                    </Avatar>
                    <div className="space-y-1 min-w-0 flex-1">
                      <Skeleton className={`h-4 ${getNameWidth(index)}`} />
                      <Skeleton className={`h-3 ${getEmailWidth(index)}`} />
                    </div>
                  </div>
                </TableCell>

                {/* Role Column */}
                <TableCell>
                  <div className="flex gap-1">
                    <Skeleton
                      className={`h-5 rounded-full ${getRoleWidth(index)}`}
                    />
                    {/* Sometimes show a second role badge */}
                    {index % 3 === 0 && (
                      <Skeleton className="h-5 w-14 rounded-full" />
                    )}
                  </div>
                </TableCell>

                {/* Status Column */}
                <TableCell>
                  <Skeleton
                    className={`h-5 rounded-full ${getStatusWidth(index)}`}
                  />
                </TableCell>

                {/* Joined Column */}
                <TableCell>
                  <Skeleton
                    className={`h-4 ${index % 2 === 0 ? "w-28" : "w-32"}`}
                  />
                </TableCell>

                {/* Arrow Column */}
                <TableCell>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Pagination Section */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <Skeleton className="h-9 w-20" />
          <Skeleton className="h-9 w-9" />
          <Skeleton className="h-9 w-9" />
          <Skeleton className="h-9 w-9" />
          <Skeleton className="h-9 w-20" />
        </div>
        <div className="text-sm text-muted-foreground">
          <Skeleton className="h-4 w-32" />
        </div>
      </div>
    </div>
  );
}
