import type { Metadata, Viewport } from "next";
import { CartDrawer } from "@/components/store/cart-drawer";
import { storeThemeClass } from "@/components/store/fonts";
import { Announcement, StoreFooter } from "@/components/store/footer";
import { StoreHeader } from "@/components/store/header";
import { StoreTracking } from "@/components/store/pixel";
import { getHome } from "@/components/store/server-api";
import { absoluteUrl } from "@/components/store/server-api";
import "./store.css";

export const metadata: Metadata = {
  metadataBase: new URL(absoluteUrl("/")!),
  title: { default: "Bent & Bound – Premium embroidered orna", template: "%s · Bent & Bound" },
  description: "Premium embroidered orna (dupatta) from Bangladesh. Cash on delivery all over Bangladesh. ক্যাশ অন ডেলিভারি।",
  openGraph: { siteName: "Bent & Bound", type: "website", locale: "en_BD" },
};

export const viewport: Viewport = { themeColor: "#8a1c2b", width: "device-width", initialScale: 1 };

const FALLBACK_STORE = { name: "Bent & Bound", tagline: "Premium embroidered orna", phone: null, email: null, address: null, logoUrl: null, currency: "BDT" };

export default async function StoreLayout({ children }: { children: React.ReactNode }) {
  const home = await getHome();
  const store = home?.store ?? FALLBACK_STORE;
  const pixelId = process.env.NEXT_PUBLIC_META_PIXEL_ID || home?.meta.pixelId || null;
  const collections = (home?.featuredCollections ?? []).map((c) => ({ name: c.collection.name, slug: c.collection.slug }));
  return (
    <div className={`${storeThemeClass} flex min-h-screen flex-col`}>
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-card focus:px-3 focus:py-2">
        Skip to content
      </a>
      <Announcement bar={home?.announcementBar ?? null} />
      <StoreHeader storeName={store.name || "Bent & Bound"} logoUrl={store.logoUrl} collections={collections} />
      <main id="main" className="flex-1">
        {children}
      </main>
      <StoreFooter store={{ ...store, name: store.name || "Bent & Bound" }} footer={home?.footer ?? null} />
      <CartDrawer />
      <StoreTracking pixelId={pixelId} />
    </div>
  );
}
