import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, staff, unique, type Client } from "./helpers.js";
import { makeProduct } from "./fixtures.js";
import { prisma } from "../src/lib/prisma.js";
import { sanitizeHtml } from "../src/modules/cms/sections.js";
import { clearSettingsCache } from "../src/lib/settings.js";

let marketer: Client; // has cms.manage
let agent: Client; // no cms.manage
let cmsBefore: unknown;
let storeBefore: unknown;

beforeAll(async () => {
  marketer = await staff(["marketing_manager"]);
  agent = await staff(["confirmation_agent"]);
  cmsBefore = (await prisma.setting.findUnique({ where: { key: "cms" } }))?.value ?? null;
  storeBefore = (await prisma.setting.findUnique({ where: { key: "store" } }))?.value ?? null;
});

afterAll(async () => {
  // test files share one database – put content settings back
  for (const [key, value] of [["cms", cmsBefore], ["store", storeBefore]] as const) {
    if (value === null) await prisma.setting.deleteMany({ where: { key } });
    else await prisma.setting.update({ where: { key }, data: { value: value as object } });
  }
  clearSettingsCache();
});

const DIRTY = `<p onclick="steal()">Hello <b>world</b></p><script>alert(1)</script><a href="javascript:alert(2)">x</a><img src=x onerror=alert(3)><a href="JaVa&#115;cript:alert(4)">y</a><a href="/ok">ok</a>`;

describe("sanitiser", () => {
  it("strips scripts, event handlers and javascript: urls", () => {
    const out = sanitizeHtml(DIRTY);
    expect(out).not.toMatch(/<script/i);
    expect(out).not.toMatch(/onclick|onerror/i);
    expect(out).not.toMatch(/javascript/i);
    expect(out).toContain("<b>world</b>");
    expect(out).toContain('href="/ok"');
    expect(sanitizeHtml("<scr<script>ipt>alert(1)</script>")).not.toMatch(/<script/i);
    const md = sanitizeHtml("[click](javascript:alert(1)) and [ok](https://bentbound.com)");
    expect(md).not.toMatch(/javascript/i);
    expect(md).toContain("[click](#)");
    expect(md).toContain("[ok](https://bentbound.com)");
  });
});

describe("pages", () => {
  it("requires cms.manage", async () => {
    expect((await agent.get("/api/v1/cms/pages")).status).toBe(403);
    expect((await agent.post("/api/v1/cms/pages", { title: "Nope" })).status).toBe(403);
    expect((await api.get("/api/v1/cms/pages")).status).toBe(401);
  });

  it("validates typed section blocks", async () => {
    const bad = await marketer.post("/api/v1/cms/pages", { title: "Bad", sections: [{ type: "carousel" }] });
    expect(bad.status).toBe(422);
    const badUrl = await marketer.post("/api/v1/cms/pages", { title: "Bad URL", sections: [{ type: "hero", title: "Hi", ctaUrl: "javascript:alert(1)" }] });
    expect(badUrl.status).toBe(422);
    const badVideo = await marketer.post("/api/v1/cms/pages", { title: "Bad video", sections: [{ type: "video", youtubeId: "<script>" }] });
    expect(badVideo.status).toBe(422);
    const emptyGrid = await marketer.post("/api/v1/cms/pages", { title: "Empty grid", sections: [{ type: "product_grid", title: "x" }] });
    expect(emptyGrid.status).toBe(422);
  });

  it("sanitises rich text on output, hides drafts publicly and enforces unique slugs", async () => {
    const slug = `eid-collection-${unique()}`;
    const res = await marketer.post("/api/v1/cms/pages", {
      title: "Eid Collection",
      slug,
      type: "LANDING",
      sections: [
        { type: "hero", title: "Eid Mubarak", subtitle: "New embroidered orna", ctaLabel: "Shop now", ctaUrl: "/collections/eid" },
        { type: "rich_text", html: DIRTY },
        { type: "countdown", title: "Offer ends", endsAt: "2026-12-31T18:00:00.000Z" },
        { type: "features", items: [{ icon: "truck", title: "Cash on delivery", text: "All over Bangladesh" }] },
        { type: "video", youtubeId: "dQw4w9WgXcQ" },
      ],
      seoTitle: "Eid Collection | Bent & Bound",
    });
    expect(res.status).toBe(201);
    const page = res.body.data;
    expect(page.status).toBe("DRAFT");
    expect(page.slug).toBe(slug);
    expect(page.sections[1].html).not.toMatch(/<script|onclick|javascript/i);

    // raw content kept (sanitised on output)
    const stored = await prisma.page.findUniqueOrThrow({ where: { id: page.id } });
    expect(JSON.stringify(stored.sections)).toContain("<script>");

    const admin = await marketer.get(`/api/v1/cms/pages/${page.id}`);
    expect(admin.body.data.sections[1].html).not.toMatch(/<script/i);

    // draft is invisible on the storefront
    expect((await api.get(`/api/v1/storefront/pages/${slug}`)).status).toBe(404);

    const dup = await marketer.post("/api/v1/cms/pages", { title: "Other", slug });
    expect(dup.status).toBe(409);

    const pub = await marketer.put(`/api/v1/cms/pages/${page.id}`, { status: "PUBLISHED" });
    expect(pub.status).toBe(200);
    expect(pub.body.data.publishedAt).toBeTruthy();
    expect(pub.body.data.sections).toHaveLength(5); // partial update keeps sections

    const pubRes = await api.get(`/api/v1/storefront/pages/${slug}`);
    expect(pubRes.status).toBe(200);
    expect(pubRes.body.data.sections.map((s: { type: string }) => s.type)).toEqual(["hero", "rich_text", "countdown", "features", "video"]);
    const body = JSON.stringify(pubRes.body.data);
    expect(body).not.toMatch(/<script|onclick|onerror|javascript:/i);
    expect(pubRes.body.data.seo.title).toBe("Eid Collection | Bent & Bound");

    const back = await marketer.put(`/api/v1/cms/pages/${page.id}`, { status: "DRAFT" });
    expect(back.status).toBe(200);
    expect((await api.get(`/api/v1/storefront/pages/${slug}`)).status).toBe(404);

    expect(await prisma.auditLog.count({ where: { entityId: page.id, action: { startsWith: "page." } } })).toBe(3);
    expect((await marketer.delete(`/api/v1/cms/pages/${page.id}`)).status).toBe(200);
  });
});

describe("banners, testimonials, faqs", () => {
  it("serves only banners inside their schedule", async () => {
    const day = 24 * 3600_000;
    const tag = unique();
    const mk = (title: string, extra: object) => marketer.post("/api/v1/cms/banners", { title, imageUrl: "/uploads/banner.jpg", mobileImageUrl: "/uploads/banner-m.jpg", ...extra });
    expect((await mk(`Live ${tag}`, { startsAt: new Date(Date.now() - day).toISOString(), endsAt: new Date(Date.now() + day).toISOString() })).status).toBe(201);
    expect((await mk(`Future ${tag}`, { startsAt: new Date(Date.now() + day).toISOString() })).status).toBe(201);
    expect((await mk(`Expired ${tag}`, { endsAt: new Date(Date.now() - day).toISOString() })).status).toBe(201);
    expect((await mk(`Off ${tag}`, { isActive: false })).status).toBe(201);
    expect((await mk(`Bad ${tag}`, { startsAt: new Date(Date.now() + day).toISOString(), endsAt: new Date().toISOString() })).status).toBe(400);
    expect((await mk(`Js ${tag}`, { linkUrl: "javascript:alert(1)" })).status).toBe(422);

    const home = await api.get("/api/v1/storefront/home");
    expect(home.status).toBe(200);
    const titles = home.body.data.banners.map((b: { title: string }) => b.title);
    expect(titles).toContain(`Live ${tag}`);
    expect(titles).not.toContain(`Future ${tag}`);
    expect(titles).not.toContain(`Expired ${tag}`);
    expect(titles).not.toContain(`Off ${tag}`);
  });

  it("CRUDs testimonials and FAQs; partial updates do not reset other fields", async () => {
    const t = await marketer.post("/api/v1/cms/testimonials", { name: "Nusrat", location: "Dhaka", quote: "Beautiful embroidery!", rating: 5, isActive: false });
    expect(t.status).toBe(201);
    const t2 = await marketer.put(`/api/v1/cms/testimonials/${t.body.data.id}`, { quote: "Beautiful embroidery, fast delivery!" });
    expect(t2.body.data.isActive).toBe(false);
    expect(t2.body.data.rating).toBe(5);

    const cat = `shipping-${unique()}`;
    const f1 = await marketer.post("/api/v1/cms/faqs", { question: "How long is delivery?", answer: "1–3 days inside Dhaka", category: cat });
    const f2 = await marketer.post("/api/v1/cms/faqs", { question: "Hidden?", answer: "Yes", category: cat, isActive: false });
    expect(f1.status).toBe(201);
    const pub = await api.get(`/api/v1/storefront/faqs?category=${cat}`);
    expect(pub.body.data.map((f: { id: string }) => f.id)).toEqual([f1.body.data.id]);
    expect((await marketer.delete(`/api/v1/cms/faqs/${f2.body.data.id}`)).status).toBe(200);
    expect((await marketer.get(`/api/v1/cms/faqs/${f2.body.data.id}`)).status).toBe(404);
    expect(await prisma.auditLog.count({ where: { entityId: t.body.data.id, action: { startsWith: "testimonial." } } })).toBe(2);
  });

  it("accepts screenshot reviews without inventing a rating, and rejects empty reviews", async () => {
    const shot = await marketer.post("/api/v1/cms/testimonials", { reviewImageUrl: "/uploads/test/review-1.jpg", sortOrder: -9999 });
    expect(shot.status).toBe(201);
    expect(shot.body.data).toMatchObject({ name: "", quote: "", rating: null, reviewImageUrl: "/uploads/test/review-1.jpg" });
    try {
      const home = await api.get("/api/v1/storefront/home");
      const pub = home.body.data.testimonials.find((x: { id: string }) => x.id === shot.body.data.id);
      expect(pub).toMatchObject({ rating: null, reviewImageUrl: "/uploads/test/review-1.jpg" });

      // nothing to show
      expect((await marketer.post("/api/v1/cms/testimonials", { name: "Rumana" })).status).toBe(400);
      // a written quote needs the customer's name
      expect((await marketer.post("/api/v1/cms/testimonials", { quote: "Lovely work" })).status).toBe(400);
      // removing the screenshot from a screenshot-only review would leave it empty
      expect((await marketer.put(`/api/v1/cms/testimonials/${shot.body.data.id}`, { reviewImageUrl: null })).status).toBe(400);
      expect((await marketer.post("/api/v1/cms/testimonials", { reviewImageUrl: "javascript:alert(1)" })).status).toBe(422);
    } finally {
      await marketer.delete(`/api/v1/cms/testimonials/${shot.body.data.id}`);
    }
  });
});

describe("content settings", () => {
  it("updates announcement bar, footer and contact info", async () => {
    expect((await agent.put("/api/v1/cms/settings", { announcementBar: { enabled: true } })).status).toBe(403);
    const bad = await marketer.put("/api/v1/cms/settings", { footer: { facebookUrl: "javascript:alert(1)" } });
    expect(bad.status).toBe(422);

    const res = await marketer.put("/api/v1/cms/settings", {
      announcementBar: { enabled: true, text: "Free delivery over ৳3000", textBn: "৳৩০০০+ অর্ডারে ফ্রি ডেলিভারি" },
      footer: { facebookUrl: "https://facebook.com/bentandbound" },
      contact: { phone: "01700000000", email: "hello@bentbound.test" },
    });
    expect(res.status).toBe(200);
    expect(res.body.data.announcementBar.enabled).toBe(true);
    expect(res.body.data.contact.phone).toBe("01700000000");

    const home = await api.get("/api/v1/storefront/home");
    expect(home.body.data.announcementBar.textBn).toBe("৳৩০০০+ অর্ডারে ফ্রি ডেলিভারি");
    expect(home.body.data.store.email).toBe("hello@bentbound.test");
    expect(await prisma.auditLog.count({ where: { action: "settings.updated", entityId: { in: ["cms", "store"] }, userId: marketer.user.id } })).toBe(2);
  });

  it("chooses the product sold on the homepage landing page", async () => {
    const admin = await staff(["admin"]);
    await makeProduct(admin, { stock: [2] }); // something to fall back to
    const chosen = await makeProduct(admin, { stock: [3] });
    const chosenSlug = (await prisma.product.findUniqueOrThrow({ where: { id: chosen.id } })).slug;
    const landingSlug = async () => (await api.get("/api/v1/storefront/home")).body.data.landing.productSlug as string | null;

    // automatic: a public product
    await marketer.put("/api/v1/cms/settings", { homepage: { landingProductSlug: "" } });
    const auto = await landingSlug();
    expect(auto).toBeTruthy();
    expect((await api.get(`/api/v1/storefront/products/${auto}`)).status).toBe(200);

    const set = await marketer.put("/api/v1/cms/settings", { homepage: { landingProductSlug: chosenSlug } });
    expect(set.status).toBe(200);
    expect(set.body.data.homepage.landingProductSlug).toBe(chosenSlug);
    expect(await landingSlug()).toBe(chosenSlug);

    // an unpublished choice is never served – the homepage falls back to the automatic pick
    await prisma.product.update({ where: { id: chosen.id }, data: { isPublished: false } });
    expect(await landingSlug()).not.toBe(chosenSlug);
    expect(await landingSlug()).toBeTruthy();

    expect((await marketer.put("/api/v1/cms/settings", { homepage: { landingProductSlug: "Bad slug!" } })).status).toBe(422);
    expect((await agent.put("/api/v1/cms/settings", { homepage: { landingProductSlug: chosenSlug } })).status).toBe(403);
  });
});
