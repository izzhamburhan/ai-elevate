import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Elevate — AI network operations",
  description: "Ask your network anything. A live map and an AI assistant that finds, explains and fixes network problems, with a human in the loop.",
};

/** Marketing shell: light body, dark cinematic bands. Sets its own tokens; fonts come from the root layout. */
export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return <div className="marketing min-h-svh font-sans antialiased">{children}</div>;
}
