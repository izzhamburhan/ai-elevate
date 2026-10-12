import type { Metadata } from "next";

import { AuthForm } from "@/components/marketing/auth/auth-form";
import { AuthShell } from "@/components/marketing/auth/auth-shell";

export const metadata: Metadata = {
  title: "Create your account — Elevate",
};

export default function SignUpPage() {
  return (
    <AuthShell
      tagline="Ask your network anything."
      caption="A live map and an AI assistant across 23 domain connectors. A human approves every risky step."
      title="Create your account"
      subtitle="It takes a minute. No card needed."
    >
      <AuthForm mode="sign-up" />
    </AuthShell>
  );
}
