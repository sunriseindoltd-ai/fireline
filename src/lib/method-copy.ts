import type { Lang } from "@/lib/copy";
import { MITIGATION_DESCRIPTIONS, MITIGATION_DESCRIPTIONS_ID } from "@/lib/ledger-geo";

/**
 * A–F rows straight from the class text every plot carries in its data
 * (Risk_Mitigation_Class, mirrored in ledger-geo.ts) — "Compliant — High-Risk
 * Area; Approved with Enhanced Monitoring" becomes ["C", "Compliant —
 * High-Risk Area", "Approved with Enhanced Monitoring"]. Not re-worded here:
 * a separate narrative (e.g. C as "on hold") made compliant plots read as
 * non-compliant.
 */
function classRows(desc: Record<string, string>): string[][] {
  return Object.entries(desc).map(([letter, text]) => {
    const [status, outcome = ""] = text.split("; ");
    return [letter, status, outcome.charAt(0).toUpperCase() + outcome.slice(1)];
  });
}

/**
 * Public methodology, based on Earthline's written EUDR due-diligence
 * procedure as summarised in the "EL Response — SRS EUDR Information
 * Requests" note (24 Sep 2026). That note is marked confidential and was
 * written for one client, so this page carries the method only: no client
 * name, no internal document reference, and no numeric weights for the
 * village-risk variables (the note itself calls them indicative, fixed per
 * assignment). Keep it in step with that procedure when it changes.
 */
type Row = string[];
type Table = { head: string[]; rows: Row[] };
export type MethodCopy = {
  title: string;
  lead: string;
  onThisPage: string;
  role: { title: string; body: string };
  verdict: { title: string; body: string; tests: { name: string; body: string }[] };
  risk: { title: string; body: string; variables: string[]; note: string };
  classes: { title: string; body: string; table: Table; note: string };
  baseline: { title: string; body: string; table: Table };
  alerts: { title: string; body: string; table: Table; rules: string[] };
  spatial: { title: string; body: string; table: Table };
  geometry: { title: string; rules: string[] };
  qa: { title: string; table: Table };
  delivery: { title: string; body: string; rules: string[] };
  monitoring: { title: string; body: string; triggers: string[] };
  palmtrace: { title: string; body: string };
  not: { title: string; items: string[] };
  legal: string;
};

const en: MethodCopy = {
  title: "Methodology",
  lead: "How Earthline turns satellite imagery and supply-chain records into auditable, plot-level evidence for EUDR due diligence — and what that evidence is not.",
  onThisPage: "On this page",
  role: {
    title: "Earthline’s role",
    body: "Earthline is a geospatial evidence provider. Legal responsibility for due diligence, for filing the Due Diligence Statement (DDS) and for placing product on the EU market stays with the operator. Every assessment follows a written, versioned procedure with separate roles for mapping, monitoring, risk analysis and an independent QA/QC reviewer; the person who signs off a result is never the analyst who drew the geometry.",
  },
  verdict: {
    title: "The plot verdict",
    body: "Each plot receives a binary verdict — Compliant or Non-compliant. It is cumulative: a plot is compliant only if it passes both tests.",
    tests: [
      {
        name: "Test A — deforestation-free",
        body: "No tree-cover loss strictly after 31 December 2020 (Regulation (EU) 2023/1115; the cutoff is unchanged by the 2025/2650 amendment). Raw alerts are never a verdict on their own.",
      },
      {
        name: "Test B — legality",
        body: "Produced in accordance with the relevant legislation of the country of production (Article 2(40)), including the legal function of the land — Indonesia’s kawasan hutan.",
      },
    ],
  },
  risk: {
    title: "Village risk",
    body: "Separately, the village around each plot is scored Low, Medium or High with a multi-criteria index. The variables are:",
    variables: [
      "Post-2020 deforestation dynamics (validated alerts)",
      "Legal forest function — overlap outside APL",
      "Supply-chain traceability",
      "Cadastral maturity (ATR/BPN)",
      "Customary and social-forestry presence",
      "Agricultural matrix (oil-palm cover)",
      "Jurisdictional governance",
      "Baseline forest cover remaining",
    ],
    note: "Weights are fixed at the start of each assignment. Beneficial-ownership and sanctions screening is a separate flag, not part of the score. Article 10(2) concerns that can’t be scored per village — corruption, grievances, human-rights allegations — are kept as sourced qualitative flags; no flag is not proof of no risk.",
  },
  classes: {
    title: "Mitigation categories A–F",
    body: "The plot verdict is crossed with the village risk tier. Every plot lands in exactly one class:",
    table: {
      head: ["Class", "Plot and village risk", "Outcome"],
      rows: classRows(MITIGATION_DESCRIPTIONS),
    },
    note: "The wording is exactly what each plot carries in its data. A–C are compliant plots, approved for submission with monitoring that grows with village risk; D–F are non-compliant. Mitigation has to be proportionate, documented and effective (Article 11) before residual risk is treated as negligible.",
  },
  baseline: {
    title: "Baseline: what counted as forest in 2020",
    body: "A harmonised existing-forest layer is resampled to a 10 m grid aligned with Sentinel-2. Areas are always computed in an equal-area projection, never Web Mercator.",
    table: {
      head: ["Layer", "Source", "Role"],
      rows: [
        ["Global Forest Cover 2020", "European Commission JRC", "Primary regulatory baseline (FAO forest: > 0.5 ha, trees > 5 m, canopy > 10%). Non-binding."],
        ["SBTN Natural Cover", "Science Based Targets Network", "Wider ecological baseline — non-forest ecosystems, peat, wetland — for NDPE"],
        ["HCSA", "High Carbon Stock Approach", "Separates secondary forest from degraded land"],
        ["Forest cover", "KLHK", "Host-country context for classification differences"],
      ],
    },
  },
  alerts: {
    title: "Detecting and validating loss",
    body: "Alert feeds run continuously and are triaged. Every alert that is used must pass spectral validation that separates permanent clearing from legal replanting.",
    table: {
      head: ["Sensor / product", "Resolution", "Use"],
      rows: [
        ["RADD (Sentinel-1 radar)", "~10 m", "All-weather change; closes cloud and smoke gaps"],
        ["GLAD (Landsat)", "~30 m", "Optical tree-cover loss under clear sky"],
        ["GLAD (Sentinel-2)", "~10 m", "Optical loss on the 10 m analysis grid"],
        ["NDVI / NBR time series", "Sensor-native", "Before / at / after check — clearing vs replanting"],
        ["PlanetScope composites", "~3 m", "Cloud-free dating and boundary support"],
        ["Maxar / Pléiades", "Sub-metre", "Micro-plots and ambiguous boundaries"],
      ],
    },
    rules: [
      "Validated loss is overlaid on the 2020 baseline.",
      "A minimum mapping unit removes slivers and sub-pixel noise.",
      "Legal overlays use a small buffer so cadastral shift can’t create false flags; only core overlap is a hard legal flag.",
    ],
  },
  spatial: {
    title: "The most precise geometry available",
    body: "For each supplier the most precise spatial model the data supports is used — never a mill buffer when plot or estate geometry exists.",
    table: {
      head: ["Preference", "Model", "Used when"],
      rows: [
        ["1 — highest", "Estate polygon", "A surveyed estate, concession or HGU/IUP boundary exists"],
        ["2", "Cadastral parcel", "An ATR/BPN parcel exists, clipped to planted oil palm"],
        ["3", "Village boundary", "Only the village or sub-district is known (typical smallholder)"],
        ["4 — lowest", "Mill catchment buffer", "Only the mill’s location is known — 20 km by default, adjusted for roads and terrain"],
      ],
    },
  },
  geometry: {
    title: "Geometry rules",
    rules: [
      "Plots over 4 ha are submitted as a polygon of the actual production area; smaller plots may be a point, but a polygon is preferred.",
      "One feature is one plot. No overlapping, floating or self-intersecting polygons; rings are closed.",
      "Mixed estates are segmented first (roads, canals, cadastral limits, planting cohort), and each segment is assessed on its own.",
      "Every split keeps its lineage — parent, segment, reason and snapshot date — so it can be audited back to the source.",
    ],
  },
  qa: {
    title: "Accuracy checks",
    table: {
      head: ["Control", "What it does"],
      rows: [
        ["Rubber-sheeting", "Aligns legacy cadastral boundaries to a WGS 84 orthomosaic"],
        ["Buffer on legal overlays", "Keeps boundary noise from creating legality flags"],
        ["Minimum mapping unit", "Removes sliver and sub-pixel artefacts"],
        ["Projection discipline", "Geometry in WGS 84; areas in an equal-area projection"],
        ["Precision", "Latitude and longitude to at least six decimal places"],
        ["Independent review", "Sample geometry signed off by someone who didn’t draw it"],
        ["Viewer test", "Files must open correctly in a GIS before they count as ready"],
      ],
    },
  },
  delivery: {
    title: "Delivery formats",
    body: "The supply-base geolocation layer is delivered in standard formats:",
    rules: [
      "For the EU Information System: GeoJSON, WGS 84 (EPSG:4326), [longitude, latitude], at least six decimals; Point, Polygon or MultiPolygon; at most 25 MB per file.",
      "For GIS and risk-system integration: Shapefile, KML or KMZ on request.",
      "Maps are built per assignment from the operator’s own sourcing records. There is no public all-client map.",
    ],
  },
  monitoring: {
    title: "Monitoring and re-assessment",
    body: "Monitoring follows the A–F class. A plot is re-assessed — against a newly frozen, versioned data snapshot — when:",
    triggers: [
      "new post-2020 loss is validated;",
      "the EU’s country benchmarking changes;",
      "a gazette or boundary is revised, or a legality instrument expires;",
      "the supply base changes;",
      "a substantiated concern is raised (Article 31).",
    ],
  },
  palmtrace: {
    title: "What you see in PalmTrace",
    body: "The workspace shows the result of this procedure: each plot’s verdict, risk, category and the reason for any non-compliance, alongside JRC 2020 forest cover (version {version}) and dated Sentinel-2 imagery from 2020 and 2026 as context layers. Context layers are shown next to the verdict, never blended into it.",
  },
  not: {
    title: "What this is not",
    items: [
      "It is not legal advice, and it does not replace the operator’s decision or a competent authority’s.",
      "It does not claim every chain has polygons for every mill — coverage is shown next to every figure.",
      "It does not publish client data. Nothing on this page comes from a client’s supply chain.",
    ],
  },
  legal:
    "Regulatory basis: Regulation (EU) 2023/1115 as amended by Regulation (EU) 2025/2650. Cutoff 31 December 2020. Indonesia is currently treated as standard risk under Article 29, so full due diligence applies. Application dates, benchmarking and Information System requirements are checked at the start of each assignment.",
};

const id: MethodCopy = {
  title: "Metodologi",
  lead: "Bagaimana Earthline mengubah citra satelit dan catatan rantai pasok menjadi bukti setingkat plot yang bisa diaudit untuk uji tuntas EUDR — dan apa yang bukan merupakan bukti itu.",
  onThisPage: "Di halaman ini",
  role: {
    title: "Peran Earthline",
    body: "Earthline adalah penyedia bukti geospasial. Tanggung jawab hukum atas uji tuntas, pengajuan Due Diligence Statement (DDS), dan penempatan produk di pasar UE tetap ada pada operator. Setiap penilaian mengikuti prosedur tertulis yang berversi, dengan peran terpisah untuk pemetaan, pemantauan, analisis risiko, dan peninjau QA/QC independen; yang menandatangani hasil tidak pernah analis yang menggambar geometrinya.",
  },
  verdict: {
    title: "Putusan plot",
    body: "Setiap plot mendapat putusan biner — Patuh atau Tidak patuh. Sifatnya kumulatif: plot patuh hanya jika lolos kedua uji.",
    tests: [
      {
        name: "Uji A — bebas deforestasi",
        body: "Tidak ada kehilangan tutupan pohon setelah 31 Desember 2020 (Regulasi (UE) 2023/1115; cutoff tidak berubah oleh amandemen 2025/2650). Alert mentah tidak pernah menjadi putusan dengan sendirinya.",
      },
      {
        name: "Uji B — legalitas",
        body: "Diproduksi sesuai peraturan yang berlaku di negara produksi (Pasal 2(40)), termasuk fungsi legal lahan — kawasan hutan Indonesia.",
      },
    ],
  },
  risk: {
    title: "Risiko desa",
    body: "Secara terpisah, desa di sekitar setiap plot dinilai Rendah, Sedang, atau Tinggi dengan indeks multikriteria. Variabelnya:",
    variables: [
      "Dinamika deforestasi setelah 2020 (alert tervalidasi)",
      "Fungsi hutan legal — tumpang tindih di luar APL",
      "Ketertelusuran rantai pasok",
      "Kematangan kadaster (ATR/BPN)",
      "Keberadaan hutan adat dan perhutanan sosial",
      "Matriks pertanian (tutupan sawit)",
      "Tata kelola wilayah",
      "Sisa tutupan hutan baseline",
    ],
    note: "Bobot dikunci di awal setiap penugasan. Penapisan beneficial ownership dan sanksi adalah penanda terpisah, bukan bagian dari skor. Hal-hal Pasal 10(2) yang tidak bisa dinilai per desa — korupsi, keluhan, tuduhan pelanggaran HAM — dicatat sebagai penanda kualitatif bersumber; tidak adanya penanda bukan bukti tidak adanya risiko.",
  },
  classes: {
    title: "Kategori mitigasi A–F",
    body: "Putusan plot disilangkan dengan tingkat risiko desa. Setiap plot masuk tepat ke satu kelas:",
    table: {
      head: ["Kelas", "Plot dan risiko desa", "Hasil"],
      rows: classRows(MITIGATION_DESCRIPTIONS_ID),
    },
    note: "Kalimatnya sama persis dengan yang tercatat di data setiap plot. A–C adalah plot patuh, disetujui untuk pengajuan dengan pemantauan yang makin ketat seiring risiko desa; D–F adalah plot tidak patuh. Mitigasi harus proporsional, terdokumentasi, dan efektif (Pasal 11) sebelum risiko sisa dianggap dapat diabaikan.",
  },
  baseline: {
    title: "Baseline: apa yang dihitung sebagai hutan pada 2020",
    body: "Layer hutan eksisting yang diharmonisasi diresampel ke grid 10 m yang selaras dengan Sentinel-2. Luas selalu dihitung dalam proyeksi sama-luas, tidak pernah Web Mercator.",
    table: {
      head: ["Layer", "Sumber", "Peran"],
      rows: [
        ["Global Forest Cover 2020", "JRC Komisi Eropa", "Baseline regulasi utama (hutan FAO: > 0,5 ha, pohon > 5 m, tajuk > 10%). Tidak mengikat."],
        ["SBTN Natural Cover", "Science Based Targets Network", "Baseline ekologis lebih luas — ekosistem non-hutan, gambut, lahan basah — untuk NDPE"],
        ["HCSA", "High Carbon Stock Approach", "Membedakan hutan sekunder dari lahan terdegradasi"],
        ["Tutupan hutan", "KLHK", "Konteks negara produsen untuk perbedaan klasifikasi"],
      ],
    },
  },
  alerts: {
    title: "Mendeteksi dan memvalidasi kehilangan tutupan",
    body: "Feed alert berjalan terus dan ditriase. Setiap alert yang dipakai harus lolos validasi spektral yang membedakan pembukaan permanen dari peremajaan yang sah.",
    table: {
      head: ["Sensor / produk", "Resolusi", "Kegunaan"],
      rows: [
        ["RADD (radar Sentinel-1)", "~10 m", "Perubahan segala cuaca; menutup celah awan dan asap"],
        ["GLAD (Landsat)", "~30 m", "Kehilangan tutupan optik saat langit cerah"],
        ["GLAD (Sentinel-2)", "~10 m", "Kehilangan optik pada grid analisis 10 m"],
        ["Deret waktu NDVI / NBR", "Sesuai sensor", "Cek sebelum / saat / sesudah — pembukaan vs peremajaan"],
        ["Komposit PlanetScope", "~3 m", "Penanggalan bebas awan dan pendukung batas"],
        ["Maxar / Pléiades", "Sub-meter", "Plot mikro dan batas yang ambigu"],
      ],
    },
    rules: [
      "Kehilangan yang tervalidasi ditumpangkan pada baseline 2020.",
      "Satuan pemetaan minimum membuang serpihan dan derau sub-piksel.",
      "Tumpang tindih legal memakai buffer kecil agar pergeseran kadaster tidak menimbulkan penanda palsu; hanya tumpang tindih inti yang menjadi penanda legal keras.",
    ],
  },
  spatial: {
    title: "Geometri paling presisi yang tersedia",
    body: "Untuk setiap pemasok dipakai model spasial paling presisi yang didukung data — tidak pernah buffer PKS bila geometri plot atau kebun tersedia.",
    table: {
      head: ["Prioritas", "Model", "Dipakai bila"],
      rows: [
        ["1 — tertinggi", "Poligon kebun", "Ada batas kebun, konsesi, atau HGU/IUP hasil survei"],
        ["2", "Bidang kadaster", "Ada bidang ATR/BPN, dipotong ke area sawit yang tertanam"],
        ["3", "Batas desa", "Hanya desa atau kecamatan yang diketahui (umumnya pekebun)"],
        ["4 — terendah", "Buffer tangkapan PKS", "Hanya lokasi PKS yang diketahui — 20 km bawaan, disesuaikan dengan jalan dan medan"],
      ],
    },
  },
  geometry: {
    title: "Aturan geometri",
    rules: [
      "Plot di atas 4 ha diajukan sebagai poligon area produksi sebenarnya; plot lebih kecil boleh berupa titik, tetapi poligon lebih disukai.",
      "Satu fitur adalah satu plot. Tidak ada poligon yang tumpang tindih, mengambang, atau memotong dirinya sendiri; cincin selalu tertutup.",
      "Kebun yang tidak seragam disegmentasi dulu (jalan, kanal, batas kadaster, tahun tanam), lalu setiap segmen dinilai sendiri.",
      "Setiap pemotongan menyimpan riwayatnya — induk, segmen, alasan, dan tanggal snapshot — agar bisa diaudit kembali ke sumbernya.",
    ],
  },
  qa: {
    title: "Pemeriksaan akurasi",
    table: {
      head: ["Kontrol", "Fungsinya"],
      rows: [
        ["Rubber-sheeting", "Menyelaraskan batas kadaster lama ke ortomosaik WGS 84"],
        ["Buffer pada tumpang tindih legal", "Mencegah derau batas menimbulkan penanda legalitas"],
        ["Satuan pemetaan minimum", "Membuang serpihan dan artefak sub-piksel"],
        ["Disiplin proyeksi", "Geometri dalam WGS 84; luas dalam proyeksi sama-luas"],
        ["Presisi", "Lintang dan bujur minimal enam desimal"],
        ["Tinjauan independen", "Sampel geometri disahkan oleh orang yang tidak menggambarnya"],
        ["Uji tampilan", "File harus terbuka dengan benar di GIS sebelum dianggap siap"],
      ],
    },
  },
  delivery: {
    title: "Format penyerahan",
    body: "Layer geolokasi basis pasokan diserahkan dalam format standar:",
    rules: [
      "Untuk Information System UE: GeoJSON, WGS 84 (EPSG:4326), [bujur, lintang], minimal enam desimal; Point, Polygon, atau MultiPolygon; maksimal 25 MB per file.",
      "Untuk integrasi GIS dan sistem risiko: Shapefile, KML, atau KMZ bila diminta.",
      "Peta dibangun per penugasan dari catatan sourcing operator sendiri. Tidak ada peta publik gabungan semua klien.",
    ],
  },
  monitoring: {
    title: "Pemantauan dan penilaian ulang",
    body: "Pemantauan mengikuti kelas A–F. Plot dinilai ulang — terhadap snapshot data baru yang dibekukan dan berversi — ketika:",
    triggers: [
      "ada kehilangan tutupan baru setelah 2020 yang tervalidasi;",
      "benchmarking negara oleh UE berubah;",
      "ada revisi SK atau batas, atau instrumen legalitas kedaluwarsa;",
      "basis pasokan berubah;",
      "muncul kekhawatiran yang berdasar (Pasal 31).",
    ],
  },
  palmtrace: {
    title: "Yang Anda lihat di PalmTrace",
    body: "Workspace menampilkan hasil prosedur ini: putusan, risiko, kategori, dan alasan ketidakpatuhan setiap plot, berdampingan dengan tutupan hutan JRC 2020 (versi {version}) serta citra Sentinel-2 bertanggal 2020 dan 2026 sebagai layer konteks. Layer konteks ditampilkan di samping putusan, tidak pernah dilebur ke dalamnya.",
  },
  not: {
    title: "Yang bukan merupakan hasil ini",
    items: [
      "Bukan nasihat hukum, dan tidak menggantikan keputusan operator maupun otoritas yang berwenang.",
      "Tidak mengklaim setiap rantai sudah punya poligon untuk setiap PKS — cakupan ditampilkan di samping setiap angka.",
      "Tidak memublikasikan data klien. Tidak ada isi halaman ini yang berasal dari rantai pasok klien.",
    ],
  },
  legal:
    "Dasar regulasi: Regulasi (UE) 2023/1115 sebagaimana diubah oleh Regulasi (UE) 2025/2650. Cutoff 31 Desember 2020. Indonesia saat ini diperlakukan sebagai risiko standar menurut Pasal 29, sehingga berlaku uji tuntas penuh. Tanggal penerapan, benchmarking, dan persyaratan Information System diperiksa di awal setiap penugasan.",
};

export const methodCopy: Record<Lang, MethodCopy> = { en, id };
