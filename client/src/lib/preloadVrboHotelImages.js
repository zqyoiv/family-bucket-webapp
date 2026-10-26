import preferences from "../data/vrbo-v2/preferences.json";
import properties from "../data/vrbo-v2/properties.json";
import users from "../data/vrbo-v2/users.json";

const HOTEL_PAGE_IMAGES = [
  ...properties.map((property) => property.image),
  "/images/Vrbo-Images/score.png",
  "/images/Vrbo-Images/final-bg.jpg",
];

/** Keep decoded bitmaps referenced so restart / GC does not drop them. */
const cache = new Map();

function warm(src) {
  let image = cache.get(src);
  if (!image) {
    image = new Image();
    image.decoding = "async";
    cache.set(src, image);
  }
  if (!image.src) image.src = src;
  return image.decode?.().catch(() => undefined);
}

/** Warm hotel-page photos on boot and every demo restart. */
export function preloadVrboHotelImages() {
  if (typeof window === "undefined") return;
  HOTEL_PAGE_IMAGES.forEach((src) => {
    warm(src);
  });
}

/**
 * Guest phone images: the preference chips (the big ones, ~10 MB together), avatars and the
 * small icons. Same in-memory cache as above: the app stays open on each phone, so once these
 * are fetched and decoded they are reused for the life of the page.
 */
const PHONE_IMAGES = [
  // Chips, in on-screen order so the first rows are ready first.
  ...preferences.map((preference) => `/images/Vrbo-Images/mobile/preferences/${preference.id}.webp`),
  ...users.map((user) => user.avatar).filter(Boolean),
  "/images/Vrbo-Images/group-avatar.png",
  "/images/Vrbo-Images/mobile/group.png",
  "/images/Vrbo-Images/mobile/selected-check.svg",
  "/images/Vrbo-Images/mobile/send-arrow.svg",
  "/images/Vrbo-Images/mobile/favorite.svg",
];

/** Warm the phone chip images (idempotent: safe to call on every mount). */
export function preloadVrboPhoneImages() {
  if (typeof window === "undefined") return;
  PHONE_IMAGES.forEach((src) => {
    warm(src);
  });
}
