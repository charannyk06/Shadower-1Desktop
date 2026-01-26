"use client";

import { Loader2 } from "lucide-react";
import { ComponentProps, ReactNode } from "react";
import { Button } from "ui/button";

interface SubmitButtonProps extends ComponentProps<typeof Button> {
  children: ReactNode;
  isLoading?: boolean;
}

export function SubmitButton({
  children,
  disabled,
  isLoading = false,
  ...props
}: SubmitButtonProps) {
  return (
    <Button type="submit" disabled={isLoading || disabled} {...props}>
      {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
      {children}
    </Button>
  );
}
