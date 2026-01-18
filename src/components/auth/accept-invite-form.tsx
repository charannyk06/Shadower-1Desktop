"use client";

import { Check, Loader2, Lock, Mail, User, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "ui/badge";
import { Button } from "ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "ui/card";
import { Input } from "ui/input";
import { Label } from "ui/label";

interface AcceptInviteFormProps {
  token: string;
  email: string;
  role: string;
  inviterName: string;
}

export function AcceptInviteForm({
  token,
  email,
  role,
  inviterName,
}: AcceptInviteFormProps) {
  const t = useTranslations("Auth.AcceptInvite");
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    password: "",
  });

  const passwordValidation = {
    hasMinLength:
      formData.password.length >= 8 && formData.password.length <= 20,
    hasLetter: /[a-zA-Z]/.test(formData.password),
    hasNumber: /[0-9]/.test(formData.password),
  };

  const isPasswordValid =
    passwordValidation.hasMinLength &&
    passwordValidation.hasLetter &&
    passwordValidation.hasNumber;

  const isFormValid = formData.name.trim().length > 0 && isPasswordValid;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!isFormValid) return;

    setIsLoading(true);

    try {
      const response = await fetch("/api/auth/accept-invitation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          name: formData.name.trim(),
          password: formData.password,
        }),
      });

      const result = await response.json();

      if (response.ok && result.success) {
        toast.success(t("acceptSuccess"));
        // Redirect to sign-in page
        router.push("/sign-in");
      } else {
        toast.error(result.error || "Failed to create account");
      }
    } catch {
      toast.error("An error occurred. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Card className="w-full md:max-w-md bg-background border-none mx-auto gap-0 shadow-none animate-in fade-in duration-1000">
      <CardHeader className="text-center">
        <CardTitle className="text-2xl">{t("title")}</CardTitle>
        <p className="text-muted-foreground mt-2">
          {t("description", { inviterName, role })}
        </p>
        <Badge variant="secondary" className="mx-auto mt-4">
          {role}
        </Badge>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-6">
          {/* Email - Read only */}
          <div className="flex flex-col gap-2">
            <Label htmlFor="email" className="flex items-center gap-2">
              <Mail className="h-4 w-4" />
              {t("email")}
            </Label>
            <Input
              id="email"
              type="email"
              value={email}
              disabled
              className="bg-muted"
              data-testid="accept-invite-email"
            />
          </div>

          {/* Name */}
          <div className="flex flex-col gap-2">
            <Label htmlFor="name" className="flex items-center gap-2">
              <User className="h-4 w-4" />
              {t("fullName")}
            </Label>
            <Input
              id="name"
              type="text"
              placeholder={t("namePlaceholder")}
              value={formData.name}
              onChange={(e) =>
                setFormData({ ...formData, name: e.target.value })
              }
              disabled={isLoading}
              autoFocus
              required
              data-testid="accept-invite-name"
            />
          </div>

          {/* Password */}
          <div className="flex flex-col gap-2">
            <Label htmlFor="password" className="flex items-center gap-2">
              <Lock className="h-4 w-4" />
              {t("password")}
            </Label>
            <Input
              id="password"
              type="password"
              placeholder="••••••••"
              value={formData.password}
              onChange={(e) =>
                setFormData({ ...formData, password: e.target.value })
              }
              disabled={isLoading}
              required
              data-testid="accept-invite-password"
            />
            {formData.password && (
              <div className="space-y-1 mt-2">
                <div className="flex items-center gap-2 text-xs">
                  {passwordValidation.hasMinLength ? (
                    <Check className="size-3 text-primary" />
                  ) : (
                    <X className="size-3 text-destructive" />
                  )}
                  <span
                    className={
                      passwordValidation.hasMinLength
                        ? "text-primary"
                        : "text-muted-foreground"
                    }
                  >
                    8-20 characters
                  </span>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  {passwordValidation.hasLetter ? (
                    <Check className="size-3 text-primary" />
                  ) : (
                    <X className="size-3 text-destructive" />
                  )}
                  <span
                    className={
                      passwordValidation.hasLetter
                        ? "text-primary"
                        : "text-muted-foreground"
                    }
                  >
                    At least one letter
                  </span>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  {passwordValidation.hasNumber ? (
                    <Check className="size-3 text-primary" />
                  ) : (
                    <X className="size-3 text-destructive" />
                  )}
                  <span
                    className={
                      passwordValidation.hasNumber
                        ? "text-primary"
                        : "text-muted-foreground"
                    }
                  >
                    At least one number
                  </span>
                </div>
              </div>
            )}
          </div>

          <Button
            type="submit"
            disabled={isLoading || !isFormValid}
            className="w-full"
            data-testid="accept-invite-submit"
          >
            {isLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {isLoading ? t("creatingAccount") : t("acceptInvitation")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
