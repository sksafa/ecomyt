"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import Script from "next/script";
import { captureAttribution, track } from "./tracking";

/**
 * Loads the Meta Pixel (standard fbq snippet) only when a pixel id is configured, fires PageView on
 * first load and on client-side route changes, and captures first/last-touch attribution on landing.
 */
export function StoreTracking({ pixelId }: { pixelId: string | null }) {
  const pathname = usePathname();
  const lastPath = useRef<string | null>(null);
  const enabled = !!pixelId && /^\d{5,20}$/.test(pixelId);

  useEffect(() => {
    captureAttribution();
  }, []);

  // The snippet sends the landing PageView; client-side navigations send one each. Comparing with the last
  // tracked path (instead of a "first run" flag) also keeps React StrictMode's double effects from duplicating it.
  useEffect(() => {
    if (lastPath.current === null) {
      lastPath.current = pathname;
      return;
    }
    if (lastPath.current === pathname) return;
    lastPath.current = pathname;
    track("PageView");
  }, [pathname]);

  if (!enabled) return null;
  return (
    <>
      {/* runs while the HTML is parsed – before any component effect fires an event */}
      <script dangerouslySetInnerHTML={{ __html: "window.__bbPixelOn=true;" }} />
      <Script id="bb-meta-pixel" strategy="afterInteractive">
      {`!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');
fbq('init','${pixelId}');fbq('track','PageView');
(window.__bbPixelQ||[]).forEach(function(a){fbq.apply(null,a)});window.__bbPixelQ=[];`}
      </Script>
    </>
  );
}
