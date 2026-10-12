import { existsSync } from "node:fs";
import { join } from "node:path";
import Image from "next/image";

import { HeroArt } from "./hero-art";

/**
 * Photo for the cinematic bands (hero, closing CTA, sign-in panel). If `public/marketing/hero.jpg`
 * is missing, the generated city (HeroArt) is shown instead; the liquid cursor warps either.
 *
 * Current photo: "Night sky radio towers", Wikimedia Commons, CC0 (public domain dedication), via
 * nicepik.com. https://commons.wikimedia.org/wiki/File:Night_sky_radio_towers.jpg
 * Replacement guide: about 2400×1500 or larger, dark, subject right of centre, calm left third.
 */
const HERO_PHOTO = "/marketing/hero.jpg";

/** Checked per render so a newly added photo shows up without restarting the dev server. */
export function hasHeroPhoto() {
  return existsSync(join(process.cwd(), "public", HERO_PHOTO));
}

type HeroBackdropProps = {
  uid: string;
  className?: string;
  priority?: boolean;
  /** Passed to next/image; boxes wider than the screen (the mobile hero) should say so. */
  sizes?: string;
};

export function HeroBackdrop({ uid, className, priority = false, sizes = "100vw" }: HeroBackdropProps) {
  if (hasHeroPhoto()) {
    return <Image src={HERO_PHOTO} alt="" fill priority={priority} sizes={sizes} className={`object-cover object-[70%_38%] ${className ?? ""}`} />;
  }
  return <HeroArt uid={uid} className={className} />;
}
