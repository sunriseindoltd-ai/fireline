import type { Lang } from "@/lib/copy";

/**
 * Public copy for the Earthline Trace umbrella page (/) and the SoyTrace
 * landing (/soy). PalmTrace's landing keeps its own copy (site-copy.ts).
 * Same rules as site-copy: no client names, no portfolio figures, and no
 * claim a product doesn't deliver yet (SoyTrace: statistics and maps today).
 */
const en = {
  // navigation
  navProducts: "Products",
  navAllProducts: "All products",
  navSoyWhat: "What you see",
  live: "Live",
  soon: "Coming soon",
  openProduct: "Open {name}",
  footerProducts: "Products",
  footerTagline: "Geospatial due diligence for commodity supply chains, by Earthline.",

  // umbrella home
  uTitleMeta: "Earthline Trace — geospatial due diligence for commodity supply chains",
  uDescMeta:
    "Earthline Trace maps commodity supply chains down to the plot and the field: PalmTrace for palm oil, SoyTrace for soybeans, more to come.",
  uEyebrow: "Earthline Trace",
  uTitle: "Know the land behind every commodity.",
  uSub: "Earthline Trace maps supply chains down to the plot and the field — who sources from where, what grows there and what changed — with one product per commodity, run by Earthline's geospatial team.",
  uPrimary: "See the products",
  uSecondary: "Talk to us",
  productsEyebrow: "Products",
  productsTitle: "One product per commodity.",
  palmTag: "Palm oil · Indonesia",
  palmBody:
    "Mills, their supply base and every plot behind them, checked against the EUDR cutoff of 31 December 2020 — with deforestation monitoring and studies such as POME and oleochemicals.",
  soyTag: "Soybeans · United States",
  soyBody:
    "Crushing plants, their sourcing areas and every soybean field inside — field boundaries, eight seasons of crop history and the transport network around them.",
  coffeeTag: "Coffee",
  coffeeBody: "Farms, washing stations and exporters. In preparation.",
  servicesEyebrow: "What we do",
  servicesTitle: "The same geospatial work, shaped to each chain.",
  sv1Title: "EUDR and NDPE due diligence",
  sv1Body:
    "Plot-level checks against deforestation cutoffs, protected areas and forest estate, with the evidence kept for your buyers.",
  sv2Title: "Sourcing-area analytics",
  sv2Body:
    "Who sources from where: facilities, their catchments and the land inside, summarised as statistics and maps.",
  sv3Title: "Monitoring",
  sv3Body:
    "Periodic satellite checks of the supply base, reported on a map and in regular reports.",
  sv4Title: "Special studies",
  sv4Body:
    "Deeper spatial work on a single question — mill effluent, downstream processing, a region or a supplier group.",
  howEyebrow: "How we work",
  howTitle: "Set up by people, not self-serve.",
  how1Title: "You share your chain",
  how1Body: "Facility lists, supplier data or areas of interest — in whatever form you have them.",
  how2Title: "We build the picture",
  how2Body:
    "Earthline's team prepares the geometry, runs the analysis and reviews it before anything is published.",
  how3Title: "You get a workspace",
  how3Body: "One sign-in, a workspace per product, and access only to your own chains.",
  closeTitle: "Tell us about your supply chain.",
  closeBody: "Every workspace is set up by invitation. Start with a conversation.",

  // SoyTrace landing
  sTitleMeta: "SoyTrace by Earthline — every soybean field around every crushing plant",
  sDescMeta:
    "SoyTrace maps the soybean fields inside each crushing plant's sourcing area, with eight seasons of crop history, field statistics and the transport network around them.",
  sEyebrow: "SoyTrace by Earthline",
  sTitle: "Every soybean field around every crushing plant.",
  sSub: "SoyTrace draws each plant's sourcing area and maps the soybean fields inside it — field by field, with eight seasons of crop history — so you can see what supplies each facility.",
  sSecondary: "What you see",
  sShowEyebrow: "A look inside",
  sShowTitle: "The SoyTrace workspace.",
  sShow1Title: "Every sourcing area",
  sShow1Body: "Each plant's sourcing area on one map, with its fields and headline figures.",
  sShow2Title: "Field by field",
  sShow2Body: "Every field shaded by seasons in soybeans; click one for its crop history.",
  sShow3Title: "Rotation and statistics",
  sShow3Body: "What the fields grew each year, how often they grow soybeans, field sizes and counties.",
  sShow4Title: "In context",
  sShow4Body: "Rail, rivers, roads, elevators and flagged fields on the same map.",
  sShowNote: "Screens from the SoyTrace workspace, with names, places and figures changed.",
  sSplitEyebrow: "In context",
  sSplitTitle: "From the field to the elevator.",
  sSplitBody:
    "Grain elevators, rail lines, rivers and roads sit on the same map as the fields, so you can follow how soybeans move from each sourcing area towards the plant — and spot the points whose locations need checking.",
  sSplitAlt: "A concrete grain elevator beside a green soybean field",
  sSplitCaption: "Grain elevator beside a soybean field — stock photograph.",
  palmCardAlt: "Sentinel-2 image of oil palm plots with their outlines",
  soyCardAlt: "A grain elevator beside a soybean field",
  sProof1: "Field boundaries",
  sProof1b: "USDA Crop Sequence Boundaries",
  sProof2: "8 seasons",
  sProof2b: "Crop history per field, 2018–2025",
  sProof3: "Per facility",
  sProof3b: "Sourcing area around each plant",
  sProof4: "In context",
  sProof4b: "Rail, rivers, roads and elevators",
  sFeatEyebrow: "What you see",
  sFeatTitle: "A sourcing area, measured field by field.",
  sf1Title: "Sourcing areas on a map",
  sf1Body:
    "Each crushing plant with its sourcing radius and the soybean fields inside, over current imagery.",
  sf2Title: "Crop history per field",
  sf2Body:
    "What every field grew in each of the last eight seasons — rotation, continuous soybeans, recent conversions.",
  sf3Title: "Statistics you can compare",
  sf3Body:
    "Field counts, soybean area, field sizes, top counties and states — per plant and across all plants.",
  sHowEyebrow: "How it works",
  sHowTitle: "From a facility list to a workspace.",
  sh1Title: "Your facilities",
  sh1Body: "Share the plants in scope and how far each sources from.",
  sh2Title: "Fields and history",
  sh2Body:
    "We assemble public field boundaries and yearly crop maps for every sourcing area, plus the points and layers you add.",
  sh3Title: "Workspace and reports",
  sh3Body: "Maps and statistics in one workspace, with periodic reports as the analysis grows.",
  sCloseTitle: "Map your soybean sourcing areas.",
  sCloseBody: "SoyTrace is invitation-only. Tell us which facilities to start with.",
};

export type BrandCopy = typeof en;

const id: BrandCopy = {
  navProducts: "Produk",
  navAllProducts: "Semua produk",
  navSoyWhat: "Yang Anda lihat",
  live: "Tersedia",
  soon: "Segera hadir",
  openProduct: "Buka {name}",
  footerProducts: "Produk",
  footerTagline: "Uji tuntas geospasial untuk rantai pasok komoditas, oleh Earthline.",

  uTitleMeta: "Earthline Trace — uji tuntas geospasial untuk rantai pasok komoditas",
  uDescMeta:
    "Earthline Trace memetakan rantai pasok komoditas sampai ke petak dan ladang: PalmTrace untuk sawit, SoyTrace untuk kedelai, dan menyusul komoditas lain.",
  uEyebrow: "Earthline Trace",
  uTitle: "Kenali lahan di balik setiap komoditas.",
  uSub: "Earthline Trace memetakan rantai pasok sampai ke petak dan ladang — siapa memasok dari mana, apa yang tumbuh di sana, dan apa yang berubah — dengan satu produk untuk tiap komoditas, dijalankan tim geospasial Earthline.",
  uPrimary: "Lihat produk",
  uSecondary: "Hubungi kami",
  productsEyebrow: "Produk",
  productsTitle: "Satu produk untuk tiap komoditas.",
  palmTag: "Kelapa sawit · Indonesia",
  palmBody:
    "PKS, basis pasoknya, dan setiap petak di belakangnya, diperiksa terhadap cutoff EUDR 31 Desember 2020 — lengkap dengan monitoring deforestasi serta studi seperti POME dan oleokimia.",
  soyTag: "Kedelai · Amerika Serikat",
  soyBody:
    "Pabrik crushing, wilayah pasokannya, dan setiap ladang kedelai di dalamnya — batas ladang, riwayat tanaman delapan musim, dan jaringan transportasi di sekitarnya.",
  coffeeTag: "Kopi",
  coffeeBody: "Kebun, stasiun pencucian, dan eksportir. Sedang disiapkan.",
  servicesEyebrow: "Yang kami kerjakan",
  servicesTitle: "Kerja geospasial yang sama, disesuaikan untuk tiap rantai.",
  sv1Title: "Uji tuntas EUDR dan NDPE",
  sv1Body:
    "Pemeriksaan per petak terhadap cutoff deforestasi, kawasan lindung, dan kawasan hutan, dengan bukti yang tersimpan untuk pembeli Anda.",
  sv2Title: "Analisis wilayah pasokan",
  sv2Body:
    "Siapa memasok dari mana: fasilitas, wilayah pasokannya, dan lahan di dalamnya, dirangkum sebagai statistik dan peta.",
  sv3Title: "Monitoring",
  sv3Body:
    "Pemeriksaan satelit berkala atas basis pasok, disajikan di peta dan dalam laporan rutin.",
  sv4Title: "Studi khusus",
  sv4Body:
    "Kajian spasial mendalam untuk satu pertanyaan — limbah pabrik, pengolahan hilir, satu wilayah, atau satu grup pemasok.",
  howEyebrow: "Cara kami bekerja",
  howTitle: "Disiapkan oleh orang, bukan swalayan.",
  how1Title: "Anda berbagi rantai pasok",
  how1Body:
    "Daftar fasilitas, data pemasok, atau wilayah yang ingin dilihat — dalam bentuk apa pun yang Anda punya.",
  how2Title: "Kami menyusun gambarannya",
  how2Body:
    "Tim Earthline menyiapkan geometri, menjalankan analisis, dan meninjaunya sebelum apa pun ditampilkan.",
  how3Title: "Anda mendapat ruang kerja",
  how3Body:
    "Satu login, satu ruang kerja per produk, dan akses hanya ke rantai pasok Anda sendiri.",
  closeTitle: "Ceritakan rantai pasok Anda.",
  closeBody: "Setiap ruang kerja disiapkan lewat undangan. Mulai dengan percakapan.",

  sTitleMeta: "SoyTrace oleh Earthline — setiap ladang kedelai di sekitar setiap pabrik crushing",
  sDescMeta:
    "SoyTrace memetakan ladang kedelai di dalam wilayah pasokan tiap pabrik crushing, dengan riwayat tanaman delapan musim, statistik ladang, dan jaringan transportasi di sekitarnya.",
  sEyebrow: "SoyTrace oleh Earthline",
  sTitle: "Setiap ladang kedelai di sekitar setiap pabrik crushing.",
  sSub: "SoyTrace menggambar wilayah pasokan tiap pabrik dan memetakan ladang kedelai di dalamnya — ladang demi ladang, dengan riwayat tanaman delapan musim — supaya terlihat apa yang memasok tiap fasilitas.",
  sSecondary: "Yang Anda lihat",
  sShowEyebrow: "Sekilas ke dalam",
  sShowTitle: "Ruang kerja SoyTrace.",
  sShow1Title: "Setiap wilayah pasokan",
  sShow1Body: "Wilayah pasokan tiap pabrik di satu peta, lengkap dengan ladang dan angka utamanya.",
  sShow2Title: "Ladang demi ladang",
  sShow2Body: "Setiap ladang diwarnai menurut musim tanam kedelai; klik satu untuk riwayat tanamannya.",
  sShow3Title: "Rotasi dan statistik",
  sShow3Body: "Tanaman tiap tahun, seberapa sering ladang ditanami kedelai, ukuran ladang, dan county.",
  sShow4Title: "Dalam konteks",
  sShow4Body: "Rel, sungai, jalan, elevator, dan ladang yang ditandai di peta yang sama.",
  sShowNote: "Tampilan dari ruang kerja SoyTrace, dengan nama, tempat, dan angka yang diganti.",
  sSplitEyebrow: "Dalam konteks",
  sSplitTitle: "Dari ladang ke elevator.",
  sSplitBody:
    "Elevator gandum, jalur rel, sungai, dan jalan ada di peta yang sama dengan ladangnya, jadi terlihat bagaimana kedelai bergerak dari tiap wilayah pasokan menuju pabrik — sekaligus titik mana yang lokasinya perlu dicek.",
  sSplitAlt: "Elevator gandum beton di samping ladang kedelai hijau",
  sSplitCaption: "Elevator gandum di samping ladang kedelai — foto stok.",
  palmCardAlt: "Citra Sentinel-2 petak sawit beserta batasnya",
  soyCardAlt: "Elevator gandum di samping ladang kedelai",
  sProof1: "Batas ladang",
  sProof1b: "USDA Crop Sequence Boundaries",
  sProof2: "8 musim",
  sProof2b: "Riwayat tanaman per ladang, 2018–2025",
  sProof3: "Per fasilitas",
  sProof3b: "Wilayah pasokan di sekitar tiap pabrik",
  sProof4: "Dalam konteks",
  sProof4b: "Rel, sungai, jalan, dan elevator",
  sFeatEyebrow: "Yang Anda lihat",
  sFeatTitle: "Wilayah pasokan, diukur ladang demi ladang.",
  sf1Title: "Wilayah pasokan di peta",
  sf1Body:
    "Setiap pabrik crushing dengan radius pasokannya dan ladang kedelai di dalamnya, di atas citra terkini.",
  sf2Title: "Riwayat tanaman per ladang",
  sf2Body:
    "Apa yang ditanam tiap ladang di delapan musim terakhir — rotasi, kedelai terus-menerus, konversi baru.",
  sf3Title: "Statistik yang bisa dibandingkan",
  sf3Body:
    "Jumlah ladang, luas kedelai, ukuran ladang, county dan negara bagian teratas — per pabrik dan untuk semua pabrik.",
  sHowEyebrow: "Cara kerja",
  sHowTitle: "Dari daftar fasilitas ke ruang kerja.",
  sh1Title: "Fasilitas Anda",
  sh1Body: "Bagikan pabrik yang dicakup dan seberapa jauh masing-masing memasok.",
  sh2Title: "Ladang dan riwayatnya",
  sh2Body:
    "Kami menyusun batas ladang publik dan peta tanaman tahunan untuk tiap wilayah pasokan, ditambah titik dan layer yang Anda berikan.",
  sh3Title: "Ruang kerja dan laporan",
  sh3Body:
    "Peta dan statistik dalam satu ruang kerja, dengan laporan berkala seiring analisis berkembang.",
  sCloseTitle: "Petakan wilayah pasokan kedelai Anda.",
  sCloseBody: "SoyTrace hanya lewat undangan. Beri tahu kami fasilitas mana yang ingin dimulai.",
};

export const brandCopy: Record<Lang, BrandCopy> = { en, id };
