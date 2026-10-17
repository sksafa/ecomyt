import { Cormorant_Garamond } from "next/font/google";

/** Serif display face for headings / wordmark. Exposed as --font-display (used by .font-display in store.css). */
export const displayFont = Cormorant_Garamond({ subsets: ["latin"], weight: ["500", "600", "700"], variable: "--font-display", display: "swap" });

/** Classes for the store wrapper and any portalled store content (sheets render outside the wrapper). */
export const storeThemeClass = `bb-store ${displayFont.variable}`;
