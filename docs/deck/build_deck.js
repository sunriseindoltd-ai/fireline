// FireLine beta deck (EN, for Earthline management). 13 Oct 2026.
const path = require("path");
const pptxgen = require("pptxgenjs");
const { applyTheme } = require(process.env.APPLY_THEME /* pptx skill scripts/apply_theme.js */);

const DIR = __dirname;
const GIF = (n) => path.join(DIR, "gif", `${n}.gif`);
const STILL = process.env.FIRE_STILL;
const OUT = process.env.OUT_PPTX;

const THEME = {
  name: "FireLine",
  headFontFace: "Calibri",
  bodyFontFace: "Calibri",
  colors: {
    dk1: "1D1D1F", lt1: "FFFFFF", dk2: "2C2C30", lt2: "F5F5F7",
    accent1: "E5322D", accent2: "F59E0B", accent3: "237A48", accent4: "8A8F98", accent5: "3E5C4E", accent6: "C2261F",
    hlink: "3E5C4E", folHlink: "6E6E73",
  },
};
const HEX = { ink: "1D1D1F", ember: "E5322D", amber: "F59E0B", grey: "6E6E73", line: "D2D2D7", soft: "F5F5F7", white: "FFFFFF", wa: "D9FDD3" };

const pres = new pptxgen();
pres.layout = "LAYOUT_WIDE"; // 13.333 × 7.5 in
pres.author = "Earthline";
pres.company = "Earthline";
pres.title = "FireLine beta";
pres.theme = { headFontFace: THEME.headFontFace, bodyFontFace: THEME.bodyFontFace };
const C = pres.SchemeColor;

const FOOT = "FireLine beta · Earthline · 13 October 2026";
pres.defineSlideMaster({
  title: "FL_DARK",
  background: { color: C.text1 },
  objects: [],
  placeholders: [],
});
pres.defineSlideMaster({
  title: "FL_CONTENT",
  background: { color: C.background1 },
  objects: [
    { text: { text: FOOT, options: { x: 0.6, y: 7.0, w: 8, h: 0.3, fontSize: 10, color: C.text2, margin: 0, isTextBox: true } } },
  ],
  slideNumber: { x: 12.2, y: 7.0, w: 0.6, h: 0.3, fontSize: 10, color: C.text2, align: "right" },
  placeholders: [],
});
// Title placeholder defined via object options per slide (same spot on every content slide).
const title = (slide, text) =>
  slide.addText(text, { x: 0.6, y: 0.42, w: 12.1, h: 0.8, fontSize: 32, bold: true, color: C.text1, margin: 0, isTextBox: true, objectName: "Title" });
const eyebrow = (slide, text) =>
  slide.addText(text.toUpperCase(), { x: 0.6, y: 0.18, w: 8, h: 0.3, fontSize: 11, bold: true, color: C.accent1, charSpacing: 2, margin: 0, isTextBox: true });


// Fix: a bullet run must be the first run of its paragraph; rebuild paragraphs explicitly.
function bulletList(slide, items, o) {
  const runs = [];
  items.forEach((t, i) => {
    const [head, rest] = Array.isArray(t) ? t : [null, t];
    const last = i === items.length - 1;
    if (head) {
      runs.push({ text: head + " ", options: { bold: true, bullet: { indent: 16 }, paraSpaceAfter: 8 } });
      runs.push({ text: rest, options: { breakLine: !last } });
    } else {
      runs.push({ text: rest, options: { bullet: { indent: 16 }, paraSpaceAfter: 8, breakLine: !last } });
    }
  });
  slide.addText(runs, { fontSize: 15, color: C.text1, valign: "top", margin: 0, isTextBox: true, ...o });
}

function gifFrame(slide, file, x, y, w, h, name) {
  // soft card behind the recording
  slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: x - 0.06, y: y - 0.06, w: w + 0.12, h: h + 0.12, rectRadius: 0.08,
    fill: { color: C.background2 }, line: { color: HEX.line, width: 0.75 }, objectName: name + " frame",
  });
  slide.addImage({ path: file, x, y, w, h, objectName: name, altText: name });
}

// ------------------------------------------------------------------ 1 title
pres.addSection({ title: "Intro" });
{
  const s = pres.addSlide({ masterName: "FL_DARK", sectionTitle: "Intro" });
  s.addImage({ path: STILL, x: 6.9, y: 0, w: 6.433, h: 7.5, sizing: { type: "cover", w: 6.433, h: 7.5 }, objectName: "Fire still", altText: "Sentinel-2 QuickFire view of a fire front under smoke, South Sumatra, 8 Oct 2026" });
  s.addText("Sentinel-2 · 8 Oct 2026 · South Sumatra · QuickFire view", { x: 7.15, y: 6.95, w: 6, h: 0.3, fontSize: 10, color: HEX.white, margin: 0, isTextBox: true });
  s.addText("EARTHLINE · BETA", { x: 0.7, y: 1.7, w: 5.8, h: 0.35, fontSize: 13, bold: true, color: C.accent2, charSpacing: 3, margin: 0, isTextBox: true });
  s.addText("FireLine", { x: 0.7, y: 2.1, w: 5.8, h: 1.2, fontSize: 60, bold: true, color: C.background1, margin: 0, isTextBox: true });
  s.addText("Fire monitoring on supply-chain plots: detect, locate, verify and document every hotspot.", {
    x: 0.7, y: 3.45, w: 5.6, h: 1.2, fontSize: 20, color: "D2D2D7", margin: 0, isTextBox: true, valign: "top",
  });
  s.addText("Product update · 13 October 2026", { x: 0.7, y: 5.9, w: 5.6, h: 0.4, fontSize: 14, color: "A1A1A6", margin: 0, isTextBox: true });
  s.addNotes("FireLine is the beta of the fire monitoring idea from last week: satellite hotspots matched to our company and scheme-smallholder plots, sent to field staff by WhatsApp, and verified on a phone. The picture is a real Sentinel-2 pass from 8 October in South Sumatra, shown in the QuickFire view the platform now uses.");
}

// ------------------------------------------------------------------ 2 what it does
{
  const s = pres.addSlide({ masterName: "FL_CONTENT", sectionTitle: "Intro" });
  eyebrow(s, "What FireLine does");
  title(s, "From satellite hotspot to verified field report");
  const steps = [
    ["Detect", "NASA FIRMS VIIRS hotspots from three satellites, last 7 days, for all of Indonesia."],
    ["Locate", "Each event is matched to the nearest company or scheme plot within 500 m: estate, mill, village."],
    ["Verify", "One tap sends a WhatsApp alert with a signed link; field staff report from their phone."],
    ["Document", "Status, notes, photo and GPS are stored on the event as a time-stamped record."],
  ];
  const cw = 2.85, gap = 0.233, y0 = 1.55;
  steps.forEach(([h, t], i) => {
    const x = 0.6 + i * (cw + gap);
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y: y0, w: cw, h: 2.35, rectRadius: 0.1, fill: { color: C.background2 }, line: { color: C.background2 }, objectName: `Step ${i + 1}` });
    s.addShape(pres.shapes.OVAL, { x: x + 0.25, y: y0 + 0.25, w: 0.5, h: 0.5, fill: { color: C.accent1 }, line: { color: C.accent1 } });
    s.addText(String(i + 1), { x: x + 0.25, y: y0 + 0.25, w: 0.5, h: 0.5, fontSize: 16, bold: true, color: C.background1, align: "center", valign: "middle", margin: 0, isTextBox: true });
    s.addText(h, { x: x + 0.25, y: y0 + 0.88, w: cw - 0.5, h: 0.4, fontSize: 18, bold: true, color: C.text1, margin: 0, isTextBox: true });
    s.addText(t, { x: x + 0.25, y: y0 + 1.3, w: cw - 0.5, h: 0.95, fontSize: 14, color: C.text1, margin: 0, valign: "top", isTextBox: true });
  });
  const stats = [
    ["3,464", "hotspot events, 7 days"],
    ["83", "events in the last 24 hours"],
    ["127", "mills with an event"],
    ["1,156", "plots with an event"],
  ];
  stats.forEach(([v, l], i) => {
    const x = 0.6 + i * (cw + gap);
    s.addText(v, { x, y: 4.35, w: cw, h: 0.9, fontSize: 44, bold: true, color: i === 1 ? C.accent1 : C.text1, margin: 0, isTextBox: true });
    s.addText(l, { x, y: 5.22, w: cw, h: 0.4, fontSize: 14, color: C.text2, margin: 0, isTextBox: true });
  });
  s.addText("Monitored: 744,087 company and scheme-smallholder plots from PalmTrace. NASA FIRMS data as of 13 Oct 2026, 15:30 WIB.", {
    x: 0.6, y: 6.05, w: 12.1, h: 0.4, fontSize: 12, color: C.text2, margin: 0, isTextBox: true,
  });
  s.addNotes("This follows the flow in the brief: detect, locate, verify, document. Numbers are live from today. A hotspot event groups detections of the same fire on the same day, so the counts are fires, not satellite pixels. Most events this week are in Central Kalimantan and South Sumatra, mainly in the SJIM, BNS and KTN supply chains.");
}

// ------------------------------------------------------------------ 3 access
pres.addSection({ title: "Using FireLine" });
{
  const s = pres.addSlide({ masterName: "FL_CONTENT", sectionTitle: "Using FireLine" });
  eyebrow(s, "How to access");
  title(s, "Sign in once, then everything is one tab away");
  const steps = [
    ["Open FireLine in a browser.", "The hosted link follows after review; the beta runs on the review machine today."],
    ["Sign in.", "User ID earthlineadmin. The password is shared separately."],
    ["Start on Overview.", "Tabs: Overview, Map, Events, Method."],
    ["Press Refresh for the latest pass.", "The page never reloads on its own, so nothing moves while you work."],
  ];
  steps.forEach(([h, t], i) => {
    const y = 1.6 + i * 1.05;
    s.addShape(pres.shapes.OVAL, { x: 0.6, y, w: 0.45, h: 0.45, fill: { color: C.accent1 }, line: { color: C.accent1 } });
    s.addText(String(i + 1), { x: 0.6, y, w: 0.45, h: 0.45, fontSize: 14, bold: true, color: C.background1, align: "center", valign: "middle", margin: 0, isTextBox: true });
    s.addText([{ text: h, options: { bold: true, breakLine: true } }, { text: t }], { x: 1.25, y: y - 0.05, w: 3.9, h: 0.95, fontSize: 14, color: C.text1, margin: 0, valign: "top", isTextBox: true });
  });
  s.addText("Field staff need no account: they open the link in the WhatsApp alert.", { x: 0.6, y: 5.9, w: 4.6, h: 0.6, fontSize: 13, italic: true, color: C.text2, margin: 0, isTextBox: true });
  gifFrame(s, GIF("login"), 5.6, 1.6, 7.1, 4.4375, "Sign-in and Overview recording");
  s.addNotes("The beta is a standalone build, separate from PalmTrace and SoyTrace, with one admin login for now. The recording shows sign-in, the five headline numbers, events per day, the map and the table by supply chain.");
}

// ------------------------------------------------------------------ 4 events
{
  const s = pres.addSlide({ masterName: "FL_CONTENT", sectionTitle: "Using FireLine" });
  eyebrow(s, "Events");
  title(s, "Find the fires that need a check");
  gifFrame(s, GIF("events"), 0.6, 1.55, 7.6, 4.75, "Events recording");
  bulletList(s, [
    ["Click a supply chain", "on Overview to open its events."],
    ["Filter", "by mill and status: all, last 24 h, unverified, verified."],
    ["Search", "a mill, company, plot or village."],
    ["Each row shows", "distance to the plot (inside or in metres) and signal strength."],
    ["Act per row:", "WhatsApp alert, copy link, open on the map. Download as CSV."],
  ], { x: 8.65, y: 1.6, w: 4.1, h: 4.8 });
  s.addNotes("The Events tab is the working list. In the recording we open BNS, look at what is still unverified, and search for one estate. The WhatsApp button prepares the alert for that exact plot.");
}

// ------------------------------------------------------------------ 5 imagery
{
  const s = pres.addSlide({ masterName: "FL_CONTENT", sectionTitle: "Using FireLine" });
  eyebrow(s, "Satellite imagery per event");
  title(s, "See the fire, the smoke and the burn scar");
  gifFrame(s, GIF("imagery"), 0.6, 1.55, 7.6, 4.75, "Imagery recording");
  bulletList(s, [
    ["Every Sentinel-2 pass", "is listed with its cloud cover, unfiltered, so smoke on the day is kept."],
    ["QuickFire view:", "flame fronts glow orange-red, even under thin smoke."],
    ["Burn scars and true colour", "views for the same pass."],
    ["Sentinel-1 radar", "sees through cloud and haze."],
    ["Step pass by pass", "to compare before and after."],
  ], { x: 8.65, y: 1.6, w: 4.1, h: 4.6 });
  s.addText("QuickFire script by Pierre Markuse, CC BY 4.0. Copernicus Sentinel data via Microsoft Planetary Computer.", {
    x: 8.65, y: 6.2, w: 4.1, h: 0.55, fontSize: 10, color: C.text2, margin: 0, isTextBox: true, valign: "top",
  });
  s.addNotes("This is the Muara Enim fire in South Sumatra. The 8 October Sentinel-2 pass is 62 percent cloud, so a cloud filter would have dropped it; in the QuickFire view the fire front is clearly visible under the smoke. Radar from Sentinel-1 is the fallback when optical images are covered.");
}

// ------------------------------------------------------------------ 6 verification
{
  const s = pres.addSlide({ masterName: "FL_CONTENT", sectionTitle: "Using FireLine" });
  eyebrow(s, "Field verification");
  title(s, "WhatsApp alert in, field report back");
  // WhatsApp message mock
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 0.6, y: 1.6, w: 5.2, h: 2.1, rectRadius: 0.12, fill: { color: HEX.wa }, line: { color: HEX.wa }, objectName: "WhatsApp message" });
  s.addText(
    [
      { text: "FIRE ALERT (12 Oct 2026 13:57 WIB)", options: { bold: true, breakLine: true } },
      { text: "Mill: GOLDEN OILINDO NUSANTARA", options: { breakLine: true } },
      { text: "Estate: PT. Sumber Enim Alam Lestari", options: { breakLine: true } },
      { text: "Plot: IDN160309-…-0236 (Company), Putak, Muara Enim", options: { breakLine: true } },
      { text: "Hotspot: -3.13099, 104.41833 (inside plot)", options: { breakLine: true } },
      { text: "Map: maps.google.com/?q=-3.13099,104.41833", options: { breakLine: true } },
      { text: "Please check on site and report here: …/fire/verify?…" },
    ],
    { x: 0.85, y: 1.8, w: 4.75, h: 1.75, fontSize: 13, color: C.text1, margin: 0, valign: "top", isTextBox: true },
  );
  bulletList(s, [
    ["Link valid 7 days,", "no login needed."],
    ["Staff choose", "active fire, extinguished or false alarm."],
    ["Add a note, a photo", "(resized on the phone) and the phone's location."],
    ["The report appears on the event", "for everyone in FireLine."],
  ], { x: 0.6, y: 4.1, w: 5.2, h: 2.4 });
  // phone frame + recording
  const px = 8.0, py = 1.35, pw = 2.45, ph = 5.3;
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: px - 0.18, y: py - 0.18, w: pw + 0.36, h: ph + 0.36, rectRadius: 0.3, fill: { color: C.text1 }, line: { color: C.text1 }, objectName: "Phone" });
  s.addImage({ path: GIF("verify"), x: px, y: py, w: pw, h: ph, objectName: "Phone verification recording", altText: "Phone verification recording" });
  s.addText("The recording fills the form only; nothing is sent.", { x: 10.95, y: 6.1, w: 1.8, h: 0.75, fontSize: 10, color: C.text2, margin: 0, valign: "bottom", isTextBox: true });
  s.addNotes("The alert is plain WhatsApp text for now, sent through wa.me, so it costs nothing and works with any group. The link inside is signed and expires after 7 days. A WhatsApp Business API can send these automatically later.");
}

// ------------------------------------------------------------------ 7 refresh + method
{
  const s = pres.addSlide({ masterName: "FL_CONTENT", sectionTitle: "Using FireLine" });
  eyebrow(s, "Data on demand");
  title(s, "Refresh when you need the latest pass");
  gifFrame(s, GIF("refresh"), 0.6, 1.55, 7.6, 4.75, "Refresh and Method recording");
  bulletList(s, [
    ["Header shows", "the time of the data in WIB."],
    ["Refresh fetches FIRMS again;", "only new or grown events are matched to plots."],
    ["If FIRMS is slow,", "the last data stays on screen with a note."],
    ["Method tab", "explains sources, matching and limits."],
  ], { x: 8.65, y: 1.6, w: 4.1, h: 4.6 });
  s.addNotes("Refresh is manual on purpose: an automatic reload would move the list while someone is working on it. VIIRS passes reach FIRMS one to three hours after the satellite flies over, about twice a day per satellite.");
}

// ------------------------------------------------------------------ 8 sources and limits
pres.addSection({ title: "Data and next steps" });
{
  const s = pres.addSlide({ masterName: "FL_CONTENT", sectionTitle: "Data and next steps" });
  eyebrow(s, "Data");
  title(s, "Sources and limits");
  const card = (x, head, items, name) => {
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y: 1.55, w: 5.9, h: 3.75, rectRadius: 0.1, fill: { color: C.background2 }, line: { color: C.background2 }, objectName: name });
    s.addText(head, { x: x + 0.35, y: 1.8, w: 5.2, h: 0.45, fontSize: 18, bold: true, color: C.text1, margin: 0, isTextBox: true });
    bulletList(s, items, { x: x + 0.35, y: 2.4, w: 5.2, h: 2.8 });
  };
  card(0.6, "Sources", [
    ["NASA FIRMS", "VIIRS 375 m from NOAA-21, NOAA-20 and Suomi NPP."],
    ["Copernicus", "Sentinel-2 (optical) and Sentinel-1 (radar), via Microsoft Planetary Computer."],
    ["PalmTrace plots:", "Company and Scheme Smallholder only, 744,087 plots."],
    ["SJIM and AGROJAYA", "use plots within a 20 km mill buffer, marked as an estimated supply base."],
  ], "Sources card");
  card(6.833, "Limits", [
    ["A hotspot is a heat signal,", "not a confirmed fire."],
    ["A VIIRS pixel is 375 m wide:", "read a match as this plot or its neighbours."],
    ["1 to 3 hours delay;", "about two passes per satellite per day."],
    ["Cloud and thick haze hide fires;", "smouldering peat is often missed."],
  ], "Limits card");
  s.addText([
    { text: "1,639 of 3,464 ", options: { bold: true, color: C.accent1 } },
    { text: "events this week fall inside a plot; the rest are within 500 m of one. Both need a field check before anyone calls it a fire." },
  ], { x: 0.6, y: 5.65, w: 12.1, h: 0.7, fontSize: 16, color: C.text1, margin: 0, valign: "top", isTextBox: true });
  s.addNotes("The main limit to say out loud: hotspot does not mean fire. That is exactly why the verification step matters, and why each match is the plot or its neighbours, not a single plot for certain.");
}

// ------------------------------------------------------------------ 9 next steps
{
  const s = pres.addSlide({ masterName: "FL_DARK", sectionTitle: "Data and next steps" });
  s.addText("NEXT STEPS", { x: 0.7, y: 0.6, w: 8, h: 0.35, fontSize: 13, bold: true, color: C.accent2, charSpacing: 3, margin: 0, isTextBox: true });
  s.addText("What it takes to go from beta to pilot", { x: 0.7, y: 1.0, w: 12, h: 0.8, fontSize: 34, bold: true, color: C.background1, margin: 0, isTextBox: true });
  const items = [
    ["Host the beta", "Standalone build is ready (45 files, 3.9 MB). Share the link after review."],
    ["Pick a pilot concession", "Decide who receives the WhatsApp alerts and who verifies."],
    ["Automatic alerts", "WhatsApp Business API and a scheduled check (Cloudflare cron), budget needed."],
    ["More satellites", "Himawari-9 every 10 minutes as early warning; FireSat when its data opens."],
    ["Name check", "Trademark search for “FireLine” before any public launch."],
  ];
  items.forEach(([h, t], i) => {
    const y = 2.2 + i * 0.92;
    s.addShape(pres.shapes.OVAL, { x: 0.7, y: y + 0.03, w: 0.42, h: 0.42, fill: { color: C.accent1 }, line: { color: C.accent1 } });
    s.addText(String(i + 1), { x: 0.7, y: y + 0.03, w: 0.42, h: 0.42, fontSize: 14, bold: true, color: C.background1, align: "center", valign: "middle", margin: 0, isTextBox: true });
    s.addText([{ text: h, options: { bold: true, color: C.background1, breakLine: true } }, { text: t, options: { color: "D2D2D7" } }], {
      x: 1.35, y: y - 0.05, w: 11.2, h: 0.85, fontSize: 15, margin: 0, valign: "top", isTextBox: true,
    });
  });
  s.addNotes("The beta proves the flow end to end. To run a real pilot we need one concession, the people on the alert list, and a small budget for the WhatsApp API and the scheduled checks.");
}

(async () => {
  await pres.writeFile({ fileName: OUT });
  await applyTheme(OUT, THEME);
  console.log("written", OUT);
})();
