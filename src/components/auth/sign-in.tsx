"use client";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useObjectState } from "@/hooks/use-object-state";
import { Link } from "@tanstack/react-router";
import { useState } from "react";

import { SocialAuthenticationProvider } from "app-types/authentication";
import { authClient } from "auth/client";
import { Loader } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { safe } from "ts-safe";
import { GithubIcon } from "ui/github-icon";
import { GoogleIcon } from "ui/google-icon";
import { MicrosoftIcon } from "ui/microsoft-icon";
import { TextShimmer } from "ui/text-shimmer";

export default function SignIn({
  emailAndPasswordEnabled,
  signUpEnabled,
  socialAuthenticationProviders,
}: {
  emailAndPasswordEnabled: boolean;
  signUpEnabled: boolean;
  socialAuthenticationProviders: SocialAuthenticationProvider[];
}) {
  const { t } = useTranslation();

  const [loading, setLoading] = useState(false);

  const [formData, setFormData] = useObjectState({
    email: "",
    password: "",
  });

  const emailAndPasswordSignIn = () => {
    setLoading(true);
    safe(() =>
      authClient.signIn.email(
        {
          email: formData.email,
          password: formData.password,
          callbackURL: "/",
        },
        {
          onError(ctx) {
            toast.error(ctx.error.message || ctx.error.statusText);
          },
        },
      ),
    )
      .watch(() => setLoading(false))
      .unwrap();
  };

  const handleSocialSignIn = (provider: SocialAuthenticationProvider) => {
    authClient.signIn
      .social({
        provider,
        callbackURL: "/", // Redirect to home after successful OAuth
        errorCallbackURL: "/sign-in", // Redirect back to sign-in on error
      })
      .catch((e) => {
        toast.error(e?.error?.message || e?.message || "OAuth sign-in failed");
      });
  };
  return (
    <div className="w-full h-full flex flex-col p-4 md:p-8 justify-center">
      <Card className="w-full md:max-w-md bg-background border-none mx-auto shadow-none animate-in fade-in duration-1000">
        <CardHeader className="my-4">
          <CardTitle className="text-2xl text-center my-1">
            <TextShimmer className="text-2xl font-semibold">
              {t("Auth.SignIn.title")}
            </TextShimmer>
          </CardTitle>
          <CardDescription className="text-center text-muted-foreground">
            {t("Auth.SignIn.description")}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col">
          {emailAndPasswordEnabled && (
            <div className="flex flex-col gap-6">
              <div className="grid gap-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  autoFocus
                  disabled={loading}
                  value={formData.email}
                  onChange={(e) => setFormData({ email: e.target.value })}
                  type="email"
                  placeholder="user@example.com"
                  required
                />
              </div>
              <div className="grid gap-2">
                <div className="flex items-center">
                  <Label htmlFor="password">Password</Label>
                </div>
                <Input
                  id="password"
                  disabled={loading}
                  value={formData.password}
                  placeholder="********"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      emailAndPasswordSignIn();
                    }
                  }}
                  onChange={(e) => setFormData({ password: e.target.value })}
                  type="password"
                  required
                />
              </div>
              <Button
                className="w-full"
                onClick={emailAndPasswordSignIn}
                disabled={loading}
                data-testid="signin-submit-button"
              >
                {loading ? (
                  <Loader className="size-4 animate-spin ml-1" />
                ) : (
                  t("Auth.SignIn.signIn")
                )}
              </Button>
            </div>
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
              <div className="flex flex-col gap-2 w-full">
                {socialAuthenticationProviders.includes("google") && (
                  <Button
                    variant="outline"
                    onClick={() => handleSocialSignIn("google")}
                    className="flex-1 w-full"
                  >
                    <GoogleIcon className="size-4 fill-foreground" />
                    Google
                  </Button>
                )}
                {socialAuthenticationProviders.includes("github") && (
                  <Button
                    variant="outline"
                    onClick={() => handleSocialSignIn("github")}
                    className="flex-1 w-full"
                  >
                    <GithubIcon className="size-4 fill-foreground" />
                    GitHub
                  </Button>
                )}
                {socialAuthenticationProviders.includes("microsoft") && (
                  <Button
                    variant="outline"
                    onClick={() => handleSocialSignIn("microsoft")}
                    className="flex-1 w-full"
                  >
                    <MicrosoftIcon className="size-4 fill-foreground" />
                    Microsoft
                  </Button>
                )}
              </div>
            </>
          )}
          {signUpEnabled && (
            <div className="my-8 text-center text-sm text-muted-foreground">
              {t("Auth.SignIn.noAccount")}
              <Link to="/sign-up" className="underline-offset-4 text-primary">
                {t("Auth.SignIn.signUp")}
              </Link>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
