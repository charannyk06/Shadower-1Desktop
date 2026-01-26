"use client";

import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { SocialAuthenticationProvider } from "app-types/authentication";
import { authClient } from "auth/client";
import { cn } from "lib/utils";
import { Mail } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import SocialProviders from "./social-providers";

export default function SignUpPage({
  emailAndPasswordEnabled,
  socialAuthenticationProviders,
}: {
  emailAndPasswordEnabled: boolean;
  socialAuthenticationProviders: SocialAuthenticationProvider[];
  isFirstUser?: boolean;
}) {
  const handleSocialSignIn = async (provider: SocialAuthenticationProvider) => {
    try {
      await authClient.signIn.social({
        provider,
        callbackURL: "/", // Redirect to home after successful OAuth
        errorCallbackURL: "/sign-up", // Redirect back to sign-up on error
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "OAuth sign-up failed");
    }
  };
  return (
    <Card className="w-full md:max-w-md bg-background border-none mx-auto shadow-none">
      <CardHeader>
        <CardTitle className="text-2xl text-center ">
          Create an account
        </CardTitle>
        <CardDescription className="text-center">
          Start your journey with us
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {emailAndPasswordEnabled && (
          <Link
            to="/sign-up/email"
            data-testid="email-signup-button"
            className={cn(buttonVariants({ variant: "default" }), "w-full")}
          >
            <Mail className="size-4" />
            Email
          </Link>
        )}
        {socialAuthenticationProviders.length > 0 && (
          <>
            {emailAndPasswordEnabled && (
              <div className="flex items-center my-4">
                <div className="flex-1 h-px bg-accent"></div>
                <span className="px-4 text-sm text-muted-foreground">
                  OR CONTINUE WITH
                </span>
                <div className="flex-1 h-px bg-accent"></div>
              </div>
            )}
            <SocialProviders
              socialAuthenticationProviders={socialAuthenticationProviders}
              onSocialProviderClick={handleSocialSignIn}
            />
          </>
        )}
      </CardContent>
    </Card>
  );
}
