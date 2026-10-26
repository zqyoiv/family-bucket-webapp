import { useEffect } from "react";

const APPLE_METAS = [
  { name: "apple-mobile-web-app-capable", content: "yes" },
  { name: "mobile-web-app-capable", content: "yes" },
  // No status-bar-style meta on purpose: "black-translucent" adds an iOS 26.1+ gradient
  // scrim over the status bar that cannot be removed from the page.
];

function upsertMeta(name, content) {
  let el = document.querySelector(`meta[name="${name}"]`);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute("name", name);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
  return el;
}

/**
 * Standalone / Guided Access home-screen setup for /vrbo-ip1|2|3.
 * Points each route at its own manifest so Add to Home Screen opens the right guest.
 */
export default function useVrboIphoneWebApp({ routeKey, title = "Interactive Experience" }) {
  useEffect(() => {
    if (!routeKey) return undefined;

    for (const { name, content } of APPLE_METAS) {
      upsertMeta(name, content);
    }
    upsertMeta("apple-mobile-web-app-title", title);
    upsertMeta("theme-color", "#0f51ec");

    let manifest = document.querySelector('link[rel="manifest"][data-vrbo-iphone]');
    if (!manifest) {
      manifest = document.createElement("link");
      manifest.setAttribute("rel", "manifest");
      manifest.setAttribute("data-vrbo-iphone", "1");
      document.head.appendChild(manifest);
    }
    manifest.setAttribute("href", `/manifest-vrbo-${routeKey}.json`);

    const previousTitle = document.title;
    document.title = title;

    return () => {
      document.title = previousTitle || "Expedia Interaction Demo";
      upsertMeta("theme-color", "#1b1f3a");
    };
  }, [routeKey, title]);
}
