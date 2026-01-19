import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Setup - Shadower",
  description: "Configure Shadower for first use",
};

export default function SetupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-background/95">
      {children}
    </div>
  );
}
