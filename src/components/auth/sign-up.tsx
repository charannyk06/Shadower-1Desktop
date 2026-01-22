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
import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation();
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
          {t("Auth.SignUp.title")}
        </CardTitle>
        <CardDescription className="text-center">
          {t("Auth.SignUp.signUpDescription")}
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
            {t("Auth.SignUp.email")}
          </Link>
        )}
        {socialAuthenticationProviders.length > 0 && (
          <>
            {emailAndPasswordEnabled && (
              <div className="flex items-center my-4">
                <div className="flex-1 h-px bg-accent"></div>
                <span className="px-4 text-sm text-muted-foreground">
                  {t("Auth.SignIn.orContinueWith")}
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
