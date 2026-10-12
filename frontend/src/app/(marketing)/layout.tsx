import type { Metadata } from "next";
import { Inter, Newsreader } from "next/font/google";

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
});

/** Editorial serif for headlines, in the spirit of Ideogram's display type. */
const display = Newsreader({
  variable: "--font-mk-display",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "Elevate — AI network operations",
  description: "Ask your network anything. A live map and an AI assistant that finds, explains and fixes network problems, with a human in the loop.",
};

/** Marketing shell: light body, dark cinematic bands. Sets its own fonts and tokens. */
export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return <div className={`${inter.variable} ${display.variable} marketing min-h-svh font-sans antialiased`}>{children}</div>;
}
