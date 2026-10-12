import { AskSection } from "@/components/marketing/ask-section";
import { Hero } from "@/components/marketing/hero";
import { Faq } from "@/components/marketing/faq";
import { Platform } from "@/components/marketing/platform";
import { AreaSection, ConnectorsBand, CtaBand, SafetyBand, SelfHealSection, SiteFooter, ToolsBand } from "@/components/marketing/sections";
import { Showcase } from "@/components/marketing/showcase";
import { SiteNav } from "@/components/marketing/site-nav";

export default function MarketingPage() {
  return (
    <div>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[60] focus:rounded-full focus:bg-mk-fg focus:px-4 focus:py-2 focus:text-sm focus:text-mk-on-fg"
      >
        Skip to content
      </a>
      <SiteNav />
      <main id="main">
        <Hero />
        <ToolsBand />
        <Platform />
        <Showcase />
        <SelfHealSection />
        <AreaSection />
        <ConnectorsBand />
        <SafetyBand />
        <AskSection />
        <Faq />
        <CtaBand />
      </main>
      <SiteFooter />
    </div>
  );
}
