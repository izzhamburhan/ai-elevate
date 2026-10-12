import type { Metadata } from "next";

import { AuthForm } from "@/components/marketing/auth/auth-form";
import { AuthShell } from "@/components/marketing/auth/auth-shell";

export const metadata: Metadata = {
  title: "Sign in — Elevate",
};

export default function SignInPage() {
  return (
    <AuthShell
      tagline="Welcome back."
      caption="Pick up where the last incident left off: your chats, maps and connectors are where you left them."
      title="Sign in to Elevate"
      subtitle="Use your company SSO or your work email."
    >
      <AuthForm mode="sign-in" />
    </AuthShell>
  );
}
