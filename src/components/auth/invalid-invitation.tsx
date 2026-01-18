"use client";

import { AlertCircle, CheckCircle, Clock, XCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { Button } from "ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "ui/card";

interface InvalidInvitationProps {
  reason: "notFound" | "expired" | "revoked" | "accepted";
}

export function InvalidInvitation({ reason }: InvalidInvitationProps) {
  const t = useTranslations("Auth.AcceptInvite");

  const config = {
    notFound: {
      icon: AlertCircle,
      title: t("invalidToken"),
      color: "text-destructive",
    },
    expired: {
      icon: Clock,
      title: t("expiredToken"),
      color: "text-amber-500",
    },
    revoked: {
      icon: XCircle,
      title: t("revokedToken"),
      color: "text-destructive",
    },
    accepted: {
      icon: CheckCircle,
      title: t("alreadyAccepted"),
      color: "text-green-500",
    },
  };

  const { icon: Icon, title, color } = config[reason];

  return (
    <Card className="w-full md:max-w-md bg-background border-none mx-auto gap-0 shadow-none animate-in fade-in duration-1000">
      <CardHeader className="text-center">
        <div className="mx-auto mb-4">
          <Icon className={`h-16 w-16 ${color}`} />
        </div>
        <CardTitle className="text-2xl">{title}</CardTitle>
      </CardHeader>
      <CardContent className="text-center">
        <p className="text-muted-foreground mb-6">
          {reason === "accepted"
            ? "You can sign in to access your account."
            : "Please contact your administrator for a new invitation."}
        </p>
        <Link href="/sign-in">
          <Button className="w-full" data-testid="sign-in-instead-button">
            {t("signInInstead")}
          </Button>
        </Link>
      </CardContent>
    </Card>
  );
}
