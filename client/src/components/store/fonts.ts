import { Anek_Bangla, Cormorant_Garamond, Noto_Serif_Bengali } from "next/font/google";

/** Serif display face for headings / wordmark. Exposed as --font-display (used by .font-display in store.css). */
export const displayFont = Cormorant_Garamond({ subsets: ["latin"], weight: ["500", "600", "700"], variable: "--font-display", display: "swap" });

/** Classes for the store wrapper and any portalled store content (sheets render outside the wrapper). */
export const storeThemeClass = `bb-store ${displayFont.variable}`;

// Homepage landing typography (same as the brand's sales pages): Anek Bangla for text, Georgia for
// headings with Noto Serif Bengali for the Bengali glyphs Georgia does not have.
const landingSans = Anek_Bangla({ subsets: ["bengali", "latin"], weight: ["300", "400", "500", "600", "700"], variable: "--font-landing", display: "swap" });
const landingSerifBn = Noto_Serif_Bengali({ subsets: ["bengali"], weight: ["400", "500", "600"], variable: "--font-landing-serif-bn", display: "swap" });

export const landingThemeClass = `bb-landing ${landingSans.variable} ${landingSerifBn.variable}`;
