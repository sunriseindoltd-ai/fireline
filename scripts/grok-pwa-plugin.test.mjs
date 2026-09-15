import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  appNameFromHost,
  createHeadInjector,
  DEFAULT_APP_NAME,
  escapeHtml,
  injectGrokPwaHead,
  isDocumentPath,
  isInstallQuery,
  publicAppHost,
  renderWebManifest,
  resolveOgCardAsset,
  snapshotOgIdentity,
  stripInstallParams,
} from "./grok-pwa-shared.mjs";
import { renderInstallPage } from "./grok-pwa-plugin.mjs";

const TEMPLATE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// Isolates tests from this repo's own src/lib/og/site.json and public/og.*
// — without an explicit `cwd`, `injectGrokPwaHead`/`createHeadInjector`
// default to `process.cwd()` and would pick up the real project's OG
// identity, which would collide with tests that pass their own `appName`/
// `site`/document `<title>`.
const EMPTY_CWD = mkdtempSync(join(tmpdir(), "og-isolated-"));

test("injects before </head>", () => {
  const out = injectGrokPwaHead("<html><head><title>x</title></head><body></body></html>", {
    cwd: EMPTY_CWD,
  });
  assert.match(out, /rel="manifest"/);
  assert.match(out, /apple-touch-icon/);
  assert.ok(out.indexOf("manifest") < out.indexOf("</head>"));
});

test("platform chrome overwrites share-card metas and always sets og:title", () => {
  const html =
    '<html><head><title>Hello World</title><meta property="og:title" content="Old"><meta name="twitter:card" content="summary"></head></html>';
  const out = injectGrokPwaHead(html, { appName: "Wild Race", cwd: EMPTY_CWD });
  assert.match(out, /name="twitter:card" content="summary_large_image"/);
  assert.match(out, /property="og:title" content="Hello World"/);
  assert.doesNotMatch(out, /content="Old"/);
  assert.doesNotMatch(out, /content="summary"/);
  assert.equal(out.split('name="twitter:card"').length - 1, 1);
  assert.equal(out.split('property="og:title"').length - 1, 1);
  assert.doesNotMatch(out, /property="og:image"/);
});

test("does not duplicate twitter:card or og:title", () => {
  const ctx = { cwd: EMPTY_CWD };
  const once = injectGrokPwaHead("<html><head><title>Hello World</title></head></html>", ctx);
  const twice = injectGrokPwaHead(once, ctx);
  assert.equal(once, twice);
  assert.equal(twice.split('name="twitter:card"').length - 1, 1);
  assert.equal(twice.split('property="og:title"').length - 1, 1);
});

test("a baked site.image is treated as a custom card", () => {
  const out = injectGrokPwaHead("<html><head></head></html>", {
    host: "example.com",
    cwd: mkdtempSync(join(tmpdir(), "og-image-only-")),
    site: { title: "Wild Race", image: "/og.jpg" },
  });
  assert.match(out, /property="og:image" content="https:\/\/example\.com\/og\.jpg"/);
});

test("baked identity does not need a workspace filesystem", () => {
  const empty = mkdtempSync(join(tmpdir(), "og-empty-"));
  const out = injectGrokPwaHead("<html><head></head></html>", {
    host: "example.com",
    cwd: empty,
    site: { title: "Pixel Nova", type: "x:game", card: "custom" },
  });
  assert.match(out, /property="og:title" content="Pixel Nova"/);
  assert.match(out, /property="og:type" content="x:game"/);
  assert.match(out, /property="og:image" content="https:\/\/example\.com\/og\.jpg"/);
});

test("a public card file wins over a baked site without card=custom", () => {
  // Deploy middleware always passes a baked `site`. If that snapshot missed
  // the file, public/og.jpg must still be picked up.
  const root = mkdtempSync(join(tmpdir(), "og-card-"));
  mkdirSync(join(root, "public"));
  writeFileSync(join(root, "public/og.jpg"), "x");
  const out = injectGrokPwaHead("<html><head></head></html>", {
    host: "example.com",
    cwd: root,
    site: {},
  });
  assert.match(out, /property="og:image" content="https:\/\/example\.com\/og\.jpg"/);
});

test("public/og.png wins when jpg is absent", () => {
  const root = mkdtempSync(join(tmpdir(), "og-png-"));
  mkdirSync(join(root, "public"));
  writeFileSync(join(root, "public/og.png"), "x");
  const out = injectGrokPwaHead("<html><head></head></html>", {
    host: "example.com",
    cwd: root,
    site: { title: "Wild Race" },
  });
  assert.match(out, /property="og:image" content="https:\/\/example\.com\/og\.png"/);
});

test("resolveOgCardAsset: disk file, then bake, then empty (no card)", () => {
  const empty = mkdtempSync(join(tmpdir(), "og-none-"));
  assert.equal(resolveOgCardAsset({}, empty), "");
  assert.equal(resolveOgCardAsset({ title: "X" }, empty), "");

  const baked = resolveOgCardAsset({ card: "custom", image: "/og.jpg" }, empty);
  assert.equal(baked, "/og.jpg");

  const root = mkdtempSync(join(tmpdir(), "og-disk-"));
  mkdirSync(join(root, "public"));
  writeFileSync(join(root, "public/og.jpg"), "x");
  assert.equal(resolveOgCardAsset({}, root), "/og.jpg");
  assert.equal(resolveOgCardAsset({ card: "custom", image: "/other.png" }, root), "/og.jpg");
});

test("snapshotOgIdentity stamps card=custom from a public card file", () => {
  const root = mkdtempSync(join(tmpdir(), "og-snap-"));
  mkdirSync(join(root, "public"));
  writeFileSync(join(root, "public/og.jpg"), "x");
  const { site } = snapshotOgIdentity(root);
  assert.equal(site.card, "custom");
  assert.equal(site.image, "/og.jpg");
  assert.equal(site.banner, undefined);
});

test("snapshotOgIdentity stamps banner from public/x-banner.jpg", () => {
  const root = mkdtempSync(join(tmpdir(), "og-banner-"));
  mkdirSync(join(root, "public"));
  writeFileSync(join(root, "public/x-banner.jpg"), "x");
  const { site } = snapshotOgIdentity(root);
  assert.equal(site.banner, "/x-banner.jpg");
});

test("emits x:game:image for a public host when site.banner is set", () => {
  const html = "<html><head><meta property=\"x:game:image\" content=\"old\"></head></html>";
  const out = injectGrokPwaHead(html, {
    host: "example.com",
    cwd: EMPTY_CWD,
    site: { title: "Wild Race", type: "x:game", card: "custom", banner: "/x-banner.jpg" },
  });
  assert.match(
    out,
    /property="x:game:image" content="https:\/\/example\.com\/x-banner\.jpg"/,
  );
  assert.match(out, /property="x:game:image:width" content="1200"/);
  assert.match(out, /property="x:game:image:height" content="264"/);
  assert.doesNotMatch(out, /content="old"/);
  assert.equal(out.split('property="x:game:image"').length - 1, 1);
});

test("does not emit x:game:image without a public host or banner", () => {
  const noHost = injectGrokPwaHead("<html><head></head></html>", {
    cwd: EMPTY_CWD,
    site: { banner: "/x-banner.jpg" },
  });
  assert.doesNotMatch(noHost, /x:game:image/);
  const noBanner = injectGrokPwaHead("<html><head></head></html>", {
    host: "example.com",
    cwd: EMPTY_CWD,
    site: { type: "x:game", card: "custom" },
  });
  assert.doesNotMatch(noBanner, /x:game:image/);
});

test("an explicit site.json title always wins, even one matching the default app name", () => {
  const out = injectGrokPwaHead("<html><head></head></html>", {
    host: "example.com",
    cwd: EMPTY_CWD,
    site: { title: DEFAULT_APP_NAME },
  });
  assert.match(out, new RegExp(`property="og:title" content="${escapeHtml(DEFAULT_APP_NAME)}"`));
});

test("rejects Vercel system hosts as og:image origins", () => {
  assert.equal(publicAppHost("01a020b6-803a-71a2-bb47-e2bec57eb9a2-662k8x1l1-xai-org.vercel.app"), "");
  assert.equal(publicAppHost("demo.vercel.app:443"), "");
  assert.equal(publicAppHost("vercel.app"), "");
  assert.equal(publicAppHost("example.com"), "example.com");
});

test("published VITE_PUBLIC_HOSTNAME wins over request Host for og:image", () => {
  const prev = process.env.VITE_PUBLIC_HOSTNAME;
  process.env.VITE_PUBLIC_HOSTNAME = "kanopi.example.com";
  try {
    const vercelHost = injectGrokPwaHead("<html><head><title>RACK</title></head></html>", {
      host: "01a020b6-803a-71a2-bb47-e2bec57eb9a2-662k8x1l1-xai-org.vercel.app",
      cwd: EMPTY_CWD,
      site: { title: "RACK", card: "custom" },
    });
    assert.match(
      vercelHost,
      /property="og:image" content="https:\/\/kanopi\.example\.com\/og\.jpg"/,
    );
    assert.doesNotMatch(vercelHost, /vercel\.app/);

    const otherPublicHost = injectGrokPwaHead("<html><head><title>RACK</title></head></html>", {
      host: "custom.example.com",
      cwd: EMPTY_CWD,
      site: { title: "RACK", card: "custom" },
    });
    assert.match(
      otherPublicHost,
      /property="og:image" content="https:\/\/kanopi\.example\.com\/og\.jpg"/,
    );
    assert.doesNotMatch(otherPublicHost, /custom\.example\.com/);
  } finally {
    if (prev === undefined) delete process.env.VITE_PUBLIC_HOSTNAME;
    else process.env.VITE_PUBLIC_HOSTNAME = prev;
  }
});

test("vercel Host without a public hostname emits no og:image", () => {
  const prev = process.env.VITE_PUBLIC_HOSTNAME;
  delete process.env.VITE_PUBLIC_HOSTNAME;
  try {
    const out = injectGrokPwaHead("<html><head><title>RACK</title></head></html>", {
      host: "01a020b6-803a-71a2-bb47-e2bec57eb9a2-662k8x1l1-xai-org.vercel.app",
      cwd: EMPTY_CWD,
      site: { title: "RACK", card: "custom" },
    });
    assert.doesNotMatch(out, /property="og:image"/);
    assert.doesNotMatch(out, /vercel\.app/);
  } finally {
    if (prev === undefined) delete process.env.VITE_PUBLIC_HOSTNAME;
    else process.env.VITE_PUBLIC_HOSTNAME = prev;
  }
});

test("no og:image is emitted for a public host without a custom card", () => {
  const out = injectGrokPwaHead("<html><head></head></html>", {
    appName: "Wild Race",
    host: "example.com",
    cwd: EMPTY_CWD,
    site: { title: "Wild Race" },
  });
  assert.doesNotMatch(out, /property="og:image"/);
});

test("emits og:image for a public host with a custom card", () => {
  const custom = injectGrokPwaHead("<html><head></head></html>", {
    appName: "Wild Race",
    host: "example.com",
    cwd: EMPTY_CWD,
    site: { title: "Wild Race", card: "custom", type: "x:game" },
  });
  assert.match(custom, /property="og:image" content="https:\/\/example\.com\/og\.jpg"/);
  assert.match(custom, /property="og:type" content="x:game"/);
});

test("document title entities are not double-escaped on og:title", () => {
  const out = injectGrokPwaHead(
    "<html><head><title>Cats &amp; Dogs</title></head></html>",
    { cwd: EMPTY_CWD },
  );
  assert.match(out, /property="og:title" content="Cats &amp; Dogs"/);
  assert.doesNotMatch(out, /Cats &amp;amp; Dogs/);
});

test("site.json title always wins over the app-name fallback", () => {
  const out = injectGrokPwaHead("<html><head></head></html>", {
    host: "example.com",
    cwd: EMPTY_CWD,
    site: { title: "Pixel Nova" },
  });
  assert.match(out, /property="og:title" content="Pixel Nova"/);
});

test("injects into documents with no head element", () => {
  const out = injectGrokPwaHead("<html><body>hi</body></html>", {
    appName: "Solo",
    cwd: EMPTY_CWD,
  });
  assert.match(out, /<head>/);
  assert.match(out, /property="og:title" content="Solo"/);
  assert.match(out, /<\/head>/);
});

test("streaming injector matches </HEAD> case-insensitively", () => {
  const injector = createHeadInjector({ appName: "Wild Race", cwd: EMPTY_CWD });
  const chunks = [
    ...injector.push("<html><HEAD><title>x</title></HE"),
    ...injector.push("AD><body>hello</body></html>"),
  ];
  const out = Buffer.concat(chunks).toString("utf8");
  assert.match(out, /property="og:title" content="x"/);
  assert.match(out, /<body>hello<\/body>/);
});

test("is idempotent", () => {
  const ctx = { cwd: EMPTY_CWD };
  const once = injectGrokPwaHead("<html><head></head></html>", ctx);
  const twice = injectGrokPwaHead(once, ctx);
  assert.equal(once, twice);
});

test("uses the app name in the injected title tag", () => {
  const out = injectGrokPwaHead("<html><head></head></html>", {
    appName: "Wild Race",
    cwd: EMPTY_CWD,
  });
  assert.match(out, /apple-mobile-web-app-title" content="Wild Race"/);
});

test("streaming injector handles </head> split across chunks", () => {
  const injector = createHeadInjector({ appName: "Wild Race", cwd: EMPTY_CWD });
  const chunks = [
    ...injector.push("<html><head><title>x</title></he"),
    ...injector.push("ad><body>hello</body></html>"),
  ];
  const out = Buffer.concat(chunks).toString("utf8");
  assert.match(out, /rel="manifest"/);
  assert.ok(out.indexOf("manifest") < out.indexOf("</head>"));
  assert.match(out, /<body>hello<\/body>/);
  assert.deepEqual(injector.flush(), []);
});

test("streaming injector passes post-head chunks through untouched", () => {
  const injector = createHeadInjector({ cwd: EMPTY_CWD });
  injector.push("<html><head></head>");
  const [tail] = injector.push("<body>tail</body>");
  assert.equal(tail.toString("utf8"), "<body>tail</body>");
});

test("streaming injector falls back when no </head> is seen", () => {
  const injector = createHeadInjector({ cwd: EMPTY_CWD });
  assert.deepEqual(injector.push("<html><head>"), []);
  const out = Buffer.concat(injector.flush()).toString("utf8");
  assert.match(out, /rel="manifest"/);
});

test("detects install query", () => {
  assert.equal(isInstallQuery("/?install=1&platform=ios"), true);
  assert.equal(isInstallQuery("/app?foo=1&install=true&platform=ios"), true);
  assert.equal(isInstallQuery("/?install=1"), false);
  assert.equal(isInstallQuery("/?install=1&platform=android"), false);
  assert.equal(isInstallQuery("/?install=0&platform=ios"), false);
  assert.equal(isInstallQuery("/"), false);
});

test("filters non-document paths", () => {
  assert.equal(isDocumentPath("/"), true);
  assert.equal(isDocumentPath("/app"), true);
  assert.equal(isDocumentPath("/api/thing"), false);
  assert.equal(isDocumentPath("/__grok/install/styles.css"), false);
  assert.equal(isDocumentPath("/logo.png"), false);
});

test("strips install params from the app link", () => {
  assert.equal(stripInstallParams("/?install=1&platform=ios"), "/");
  assert.equal(stripInstallParams("/app?install=1&platform=ios&tab=2"), "/app?tab=2");
});

test("appNameFromHost always resolves to the app's own default name", () => {
  assert.equal(appNameFromHost(), DEFAULT_APP_NAME);
  assert.equal(appNameFromHost("localhost:8080"), DEFAULT_APP_NAME);
  assert.equal(appNameFromHost("<script>alert(1)</script>"), DEFAULT_APP_NAME);
});

test("renders install page markup", () => {
  const html = renderInstallPage("/?install=1&platform=ios");
  assert.match(html, new RegExp(`Add ${escapeHtml(DEFAULT_APP_NAME)} to your`));
  assert.match(html, /\/__grok\/install\/styles\.css/);
  assert.match(html, /href="\/"/);
  assert.equal(html.includes("{{APP_NAME}}"), false);
  assert.equal(html.includes("{{APP_URL}}"), false);
});

test("renders the manifest with the app's default name", () => {
  const manifest = JSON.parse(renderWebManifest("example.com"));
  assert.equal(manifest.name, DEFAULT_APP_NAME);
  assert.equal(manifest.short_name, DEFAULT_APP_NAME);
  assert.equal(manifest.icons[0].src, "/__grok/icon-180.png");
});

test("renders the manifest with the site.json title when set", () => {
  const manifest = JSON.parse(renderWebManifest("example.com", { title: "Kanopi — EarthLine" }));
  assert.equal(manifest.name, "Kanopi — EarthLine");
  assert.equal(manifest.short_name, "Kanopi");
});

// Tripwires: the deployed-app path only works if Nitro scans server/ — an
// accidental edit that drops serverDir or the middleware file would otherwise
// fail silently (published apps would just render the app for ?install=1).
test("vite config keeps the nitro serverDir wiring", () => {
  const viteConfig = readFileSync(join(TEMPLATE_ROOT, "vite.config.ts"), "utf8");
  assert.match(viteConfig, /serverDir:\s*"\.\/server"/);
  assert.match(viteConfig, /grokPwaPlugin\(\)/);
});

test("nitro middleware and its bundled assets exist", () => {
  const middleware = readFileSync(join(TEMPLATE_ROOT, "server/middleware/grok-pwa.ts"), "utf8");
  assert.match(middleware, /install-page\.html\?raw/);
  assert.match(middleware, /virtual:grok-og-identity/);
  readFileSync(join(TEMPLATE_ROOT, "scripts/install-page.html"));
  readFileSync(join(TEMPLATE_ROOT, "public/__grok/icon-180.png"));
  readFileSync(join(TEMPLATE_ROOT, "public/__grok/install/styles.css"));
});

test("vite plugin bakes og identity as a virtual module", () => {
  const plugin = readFileSync(join(TEMPLATE_ROOT, "scripts/grok-pwa-plugin.mjs"), "utf8");
  assert.match(plugin, /virtual:grok-og-identity/);
  assert.match(plugin, /snapshotOgIdentity/);
});
