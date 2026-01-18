import Link from "next/link";
import { AlertCircle, Home, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function FragmentNotFound() {
  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4">
      <div className="max-w-md text-center space-y-6">
        <div className="flex justify-center">
          <div className="w-20 h-20 rounded-full bg-muted flex items-center justify-center">
            <AlertCircle className="h-10 w-10 text-muted-foreground" />
          </div>
        </div>

        <div className="space-y-2">
          <h1 className="text-2xl font-bold">Fragment Not Found</h1>
          <p className="text-muted-foreground">
            This fragment may have expired, been removed, or the link is
            incorrect. Fragments are temporary and may be deleted after their
            expiration time.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Button asChild variant="outline">
            <Link href="/" className="flex items-center gap-2">
              <Home className="h-4 w-4" />
              Go Home
            </Link>
          </Button>
          <Button asChild>
            <Link href="/chat" className="flex items-center gap-2">
              <Sparkles className="h-4 w-4" />
              Create Your Own
            </Link>
          </Button>
        </div>

        <p className="text-xs text-muted-foreground">
          Powered by{" "}
          <a
            href="https://shadower.ai"
            className="underline hover:text-foreground transition-colors"
          >
            Shadower AI
          </a>
        </p>
      </div>
    </div>
  );
}
