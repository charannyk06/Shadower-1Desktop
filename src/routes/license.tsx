/**
 * Cloud License Activation Page
 *
 * Allows users to sign in with their Shadower cloud account
 * to activate the desktop application.
 */

import { useState, useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Monitor, Cloud, Loader2, AlertCircle, CheckCircle2, LogOut } from "lucide-react";
import { Button } from "ui/button";
import { Input } from "ui/input";
import { Label } from "ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "ui/card";
import { Alert, AlertDescription } from "ui/alert";

interface LicenseState {
  isAuthenticated: boolean;
  isLicensed: boolean;
  user?: { id: string; name: string; email: string };
  activatedAt?: string;
  error?: string;
}

export default function LicensePage() {
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(true);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [licenseState, setLicenseState] = useState<LicenseState | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [cloudUrl, setCloudUrl] = useState<string>("");
  const [machineId, setMachineId] = useState<string>("");

  // Initialize and check license state on mount
  useEffect(() => {
    const initLicense = async () => {
      try {
        if (!window.electronAPI?.cloudLicense) {
          console.warn("[License] Cloud license API not available");
          setIsLoading(false);
          return;
        }

        const state = await window.electronAPI.cloudLicense.initialize();
        setLicenseState(state);

        const url = await window.electronAPI.cloudLicense.getCloudUrl();
        setCloudUrl(url);

        const mid = await window.electronAPI.cloudLicense.getMachineId();
        setMachineId(mid);
      } catch (err: any) {
        console.error("[License] Init error:", err);
        setError(err.message || "Failed to initialize license service");
      } finally {
        setIsLoading(false);
      }
    };

    initLicense();
  }, []);

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSigningIn(true);
    setError(null);

    try {
      const result = await window.electronAPI.cloudLicense.signIn({
        email,
        password,
      });

      if (result.success && result.state) {
        setLicenseState(result.state);
        if (result.state.isLicensed) {
          // Licensed! Navigate to home after a short delay
          setTimeout(() => {
            navigate({ to: "/" });
          }, 1500);
        }
      } else {
        setError(result.error || "Sign in failed");
      }
    } catch (err: any) {
      setError(err.message || "Sign in failed");
    } finally {
      setIsSigningIn(false);
    }
  };

  const handleSignOut = async () => {
    try {
      await window.electronAPI.cloudLicense.signOut();
      setLicenseState({
        isAuthenticated: false,
        isLicensed: false,
      });
      setEmail("");
      setPassword("");
    } catch (err: any) {
      setError(err.message || "Sign out failed");
    }
  };

  const handleDeactivate = async () => {
    try {
      const result = await window.electronAPI.cloudLicense.deactivate();
      if (result.success) {
        setLicenseState({
          isAuthenticated: false,
          isLicensed: false,
        });
        setEmail("");
        setPassword("");
      } else {
        setError(result.error || "Deactivation failed");
      }
    } catch (err: any) {
      setError(err.message || "Deactivation failed");
    }
  };

  const handleContinueOffline = () => {
    // Allow offline usage without cloud license
    navigate({ to: "/" });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-muted-foreground">Checking license...</p>
        </div>
      </div>
    );
  }

  // Already licensed - show success state
  if (licenseState?.isLicensed) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 h-16 w-16 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
              <CheckCircle2 className="h-8 w-8 text-green-600 dark:text-green-400" />
            </div>
            <CardTitle className="text-2xl">Desktop Activated</CardTitle>
            <CardDescription>
              Your desktop app is licensed and ready to use
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-lg border p-4 space-y-2 bg-muted/30">
              <div className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">Account:</span>
                <span className="font-medium">{licenseState.user?.email}</span>
              </div>
              {licenseState.activatedAt && (
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-muted-foreground">Activated:</span>
                  <span className="font-medium">
                    {new Date(licenseState.activatedAt).toLocaleDateString()}
                  </span>
                </div>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <Button onClick={() => navigate({ to: "/" })} className="w-full">
                Continue to App
              </Button>
              <Button
                variant="outline"
                onClick={handleDeactivate}
                className="w-full"
              >
                <LogOut className="w-4 h-4 mr-2" />
                Deactivate & Sign Out
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Authenticated but not licensed
  if (licenseState?.isAuthenticated && !licenseState?.isLicensed) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 h-16 w-16 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
              <AlertCircle className="h-8 w-8 text-amber-600 dark:text-amber-400" />
            </div>
            <CardTitle className="text-2xl">License Not Enabled</CardTitle>
            <CardDescription>
              Desktop access is not enabled for your account
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                {licenseState.error ||
                  "Please contact your administrator to enable desktop access for your account."}
              </AlertDescription>
            </Alert>

            <div className="rounded-lg border p-4 space-y-2 bg-muted/30">
              <div className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">Signed in as:</span>
                <span className="font-medium">{licenseState.user?.email}</span>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <Button variant="outline" onClick={handleSignOut} className="w-full">
                <LogOut className="w-4 h-4 mr-2" />
                Sign Out
              </Button>
              <Button variant="ghost" onClick={handleContinueOffline} className="w-full">
                Continue in Offline Mode
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Not authenticated - show sign in form
  return (
    <div className="flex items-center justify-center min-h-screen bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center">
            <Monitor className="h-8 w-8 text-primary" />
          </div>
          <CardTitle className="text-2xl">Activate Desktop</CardTitle>
          <CardDescription>
            Sign in with your Shadower cloud account to activate the desktop app
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <form onSubmit={handleSignIn} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="your@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={isSigningIn}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                disabled={isSigningIn}
              />
            </div>
            <Button type="submit" className="w-full" disabled={isSigningIn}>
              {isSigningIn ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Signing in...
                </>
              ) : (
                <>
                  <Cloud className="w-4 h-4 mr-2" />
                  Sign In & Activate
                </>
              )}
            </Button>
          </form>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-background px-2 text-muted-foreground">Or</span>
            </div>
          </div>

          <Button
            variant="ghost"
            onClick={handleContinueOffline}
            className="w-full"
          >
            Continue in Offline Mode
          </Button>

          {cloudUrl && (
            <p className="text-xs text-center text-muted-foreground">
              Don't have an account?{" "}
              <a
                href={`${cloudUrl}/sign-up`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                Sign up at shadower.ai
              </a>
            </p>
          )}

          {machineId && (
            <p className="text-[10px] text-center text-muted-foreground/50 font-mono">
              Machine: {machineId.substring(0, 16)}...
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
