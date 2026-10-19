// Public storefront API shapes (mirrors server/src/modules/storefront/*). Money is a decimal string in BDT.

export interface PublicVariant {
  id: string;
  sku: string;
  name: string;
  color: string | null;
  size: string | null;
  price: string;
  imageUrl: string | null;
  inStock: boolean;
  lowStock: boolean;
}

export interface PublicProduct {
  id: string;
  name: string;
  slug: string;
  shortDescription: string | null;
  category: { name: string; slug: string } | null;
  price: string;
  compareAtPrice: string | null;
  onSale: boolean;
  priceRange: { min: string; max: string };
  imageUrl: string | null;
  images: { url: string; alt: string | null }[];
  isFeatured: boolean;
  freeShipping: boolean;
  inStock: boolean;
  lowStock: boolean;
  variants: PublicVariant[];
}

export interface PublicProductDetail extends PublicProduct {
  description: string | null;
  fabric: string | null;
  design: string | null;
  embroidery: string | null;
  careInstructions: string | null;
  shippingNote: string | null;
  weightGrams: number | null;
  seo: { title: string; description: string | null; ogImageUrl: string | null };
}

export interface CollectionInfo {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  imageUrl: string | null;
}

export interface Banner {
  id: string;
  title: string | null;
  subtitle: string | null;
  imageUrl: string;
  mobileImageUrl: string | null;
  linkUrl: string | null;
  ctaLabel: string | null;
  placement: string;
  sortOrder: number;
}

export interface Testimonial {
  id: string;
  name: string;
  location: string | null;
  /** may be empty when the review is a screenshot */
  quote: string;
  /** null = the customer gave no star rating */
  rating: number | null;
  /** customer's photo (avatar) */
  imageUrl: string | null;
  /** screenshot / photo of the review itself */
  reviewImageUrl?: string | null;
}

export interface Faq {
  id: string;
  question: string;
  answer: string;
  category: string | null;
}

export interface StoreInfo {
  name: string;
  tagline: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  logoUrl: string | null;
  currency: string;
}

export interface FooterInfo {
  about: string;
  facebookUrl: string;
  instagramUrl: string;
  whatsapp: string;
}

export interface AnnouncementBar {
  enabled: boolean;
  text: string;
  textBn: string;
  link: string;
}

export interface HomeData {
  /** product sold on the homepage landing page (null when nothing can be sold) */
  landing?: { productSlug: string | null };
  banners: Banner[];
  featuredCollections: { collection: CollectionInfo; products: PublicProduct[] }[];
  featuredProducts: PublicProduct[];
  testimonials: Testimonial[];
  announcementBar: AnnouncementBar | null;
  store: StoreInfo;
  footer: FooterInfo;
  meta: { pixelId: string | null };
}

export interface CategoryNode {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  imageUrl: string | null;
  parentId: string | null;
  children: CategoryNode[];
}

export interface CollectionListItem extends CollectionInfo {
  isFeatured: boolean;
  productCount: number;
}

// ───────────── CMS page sections ─────────────
export type Section =
  | { type: "hero"; id?: string | null; title: string; subtitle?: string | null; imageUrl?: string | null; ctaLabel?: string | null; ctaUrl?: string | null }
  | { type: "rich_text"; id?: string | null; html?: string | null; markdown?: string | null }
  | { type: "product_grid"; id?: string | null; title?: string | null; collectionSlug?: string | null; products: PublicProduct[]; collection?: CollectionInfo | null }
  | { type: "image_banner"; id?: string | null; imageUrl: string; mobileImageUrl?: string | null; alt?: string | null; linkUrl?: string | null; title?: string | null }
  | { type: "testimonials"; id?: string | null; title?: string | null; testimonials: Testimonial[] }
  | { type: "faq"; id?: string | null; title?: string | null; faqs: Faq[] }
  | { type: "countdown"; id?: string | null; title: string; endsAt: string }
  | { type: "order_form"; id?: string | null; title?: string | null; productId: string; product: PublicProductDetail | null }
  | { type: "features"; id?: string | null; title?: string | null; items: { icon?: string | null; title: string; text?: string | null }[] }
  | { type: "video"; id?: string | null; title?: string | null; youtubeId: string };

export interface CmsPage {
  id: string;
  slug: string;
  title: string;
  type: string;
  publishedAt: string | null;
  seo: { title: string; description: string | null; ogImageUrl: string | null };
  sections: Section[];
}

// ───────────── shipping / checkout / orders ─────────────
export interface LocArea {
  id: string;
  name: string;
  nameBn: string | null;
  zone: { code: string } | null;
}
export interface LocDistrict extends LocArea {
  areas: LocArea[];
}
export interface LocDivision {
  id: string;
  name: string;
  nameBn: string | null;
  districts: LocDistrict[];
}

export interface ShippingQuote {
  zone: string | null;
  district: string | null;
  area: string | null;
  deliveryCharge: string;
}

export type DeliveryOptionCode = "INSIDE_DHAKA" | "OUTSIDE_DHAKA";

/** GET /storefront/delivery-options – charges configured by the admin (Settings → Delivery charges). */
export interface DeliveryOptionInfo {
  code: DeliveryOptionCode;
  label: string;
  labelBn: string;
  charge: string;
  isDefault: boolean;
}

export interface CheckoutResult {
  orderNumber: string;
  status: string;
  subtotal: string;
  deliveryCharge: string;
  deliveryOption: DeliveryOptionCode | null;
  total: string;
  paymentMethod: string;
  paymentRequired: boolean;
  metaEventId: string;
  /** one-time Purchase payload for the Pixel (null on replays and for not-yet-paid online orders) */
  metaPurchase: { eventName: "Purchase"; eventId: string; data: Record<string, unknown> } | null;
  duplicate: boolean;
}

export interface OrderLookup {
  orderNumber: string;
  status: string;
  statusLabel: { en: string; bn: string };
  createdAt: string;
  confirmedAt: string | null;
  shippedAt: string | null;
  deliveredAt: string | null;
  cancelledAt: string | null;
  items: {
    productName: string;
    variantName: string | null;
    color: string | null;
    size: string | null;
    imageUrl: string | null;
    quantity: number;
    unitPrice: string;
    discount: string;
    lineTotal: string;
  }[];
  totals: {
    subtotal: string; discount: string; deliveryCharge: string; total: string; paid: string; due: string;
    deliveryOption?: DeliveryOptionCode | null; deliveryOptionLabel?: { label: string; labelBn: string } | null;
  };
  payment: { method: string; status: string };
  shipment: { courier: string; trackingCode: string | null; status: string } | null;
}

export interface OnlineOptions {
  gateways: { code: "sslcommerz" | "sandbox"; name: string; sandbox: boolean }[];
}
