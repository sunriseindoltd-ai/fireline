import type { Lang } from "@/lib/copy";

/**
 * Public About pages for SoyTrace and the Earthline Trace umbrella, and the
 * SoyTrace methodology (/soy/method). PalmTrace keeps its own About copy
 * (site-copy.ts) and methodology (method-copy.ts). Public pages: no client
 * names, places or figures — "the client" throughout. Every statement here
 * describes what the SoyTrace workspace actually does (soy-supply-copy.ts,
 * Data & method tab; scripts/prepare-adm-soy-supply.py).
 */

type About = { title: string; lead: string; sections: { title: string; body: string }[] };

export const aboutCopy: Record<"soy" | "umbrella", Record<Lang, About>> = {
  soy: {
    en: {
      title: "About SoyTrace",
      lead: "A map of the soybean fields around each facility a crushing plant buys through.",
      sections: [
        {
          title: "Why it exists",
          body: "A crushing plant sources soybeans from the farms around it and through elevators further out. Which fields lie inside each of those sourcing areas, what they have grown, and how the client classifies them is spread over GIS files and spreadsheets. SoyTrace puts it on one map, with the figures for every facility next to it.",
        },
        {
          title: "Who runs it",
          body: "SoyTrace is operated by Earthline’s geospatial team — the people who prepare the field data, build each catchment and review the results before a client sees them.",
        },
        {
          title: "How access works",
          body: "SoyTrace is not a self-serve platform. Each workspace is set up for one client by invitation, and each account sees only that client’s data.",
        },
      ],
    },
    id: {
      title: "Tentang SoyTrace",
      lead: "Peta ladang kedelai di sekitar setiap fasilitas tempat pabrik crushing membeli.",
      sections: [
        {
          title: "Mengapa ada",
          body: "Pabrik crushing membeli kedelai dari ladang di sekitarnya dan lewat elevator yang lebih jauh. Ladang mana saja yang ada di dalam tiap wilayah pasok itu, apa yang ditanam, dan bagaimana klien mengklasifikasikannya tersebar di file GIS dan spreadsheet. SoyTrace menaruh semuanya di satu peta, dengan angka tiap fasilitas di sampingnya.",
        },
        {
          title: "Siapa yang mengoperasikan",
          body: "SoyTrace dioperasikan tim geospasial Earthline — orang-orang yang menyiapkan data ladang, membangun tiap catchment, dan meninjau hasilnya sebelum dilihat klien.",
        },
        {
          title: "Bagaimana akses diberikan",
          body: "SoyTrace bukan platform swalayan. Setiap workspace disiapkan untuk satu klien melalui undangan, dan setiap akun hanya melihat data klien tersebut.",
        },
      ],
    },
  },
  umbrella: {
    en: {
      title: "About Earthline Trace",
      lead: "Commodity supply chains, mapped to the plot and the field.",
      sections: [
        {
          title: "What it is",
          body: "Earthline Trace is the home of Earthline’s supply-chain products: PalmTrace for palm oil — mills, plots and their EUDR analysis — and SoyTrace for soybeans — crushing plants, their catchments and the fields inside. One account and one sign-in reach every product a client uses.",
        },
        {
          title: "Who runs it",
          body: "Every product is operated by Earthline’s geospatial team, who prepare the data, run the analysis and review the results before a client sees them.",
        },
        {
          title: "How access works",
          body: "Earthline Trace is not self-serve. Workspaces are set up per client by invitation, and each account sees only the data it is entitled to.",
        },
      ],
    },
    id: {
      title: "Tentang Earthline Trace",
      lead: "Rantai pasok komoditas, dipetakan sampai ke plot dan ladang.",
      sections: [
        {
          title: "Apa ini",
          body: "Earthline Trace adalah rumah produk rantai pasok Earthline: PalmTrace untuk sawit — PKS, plot, dan analisis EUDR-nya — dan SoyTrace untuk kedelai — pabrik crushing, catchment-nya, dan ladang di dalamnya. Satu akun dan satu login untuk semua produk yang dipakai klien.",
        },
        {
          title: "Siapa yang mengoperasikan",
          body: "Setiap produk dioperasikan tim geospasial Earthline, yang menyiapkan data, menjalankan analisis, dan meninjau hasilnya sebelum dilihat klien.",
        },
        {
          title: "Bagaimana akses diberikan",
          body: "Earthline Trace bukan platform swalayan. Workspace disiapkan per klien melalui undangan, dan setiap akun hanya melihat data yang menjadi haknya.",
        },
      ],
    },
  },
};

type Table = { head: string[]; rows: string[][] };
type SoyMethod = {
  metaTitle: string;
  metaDescription: string;
  title: string;
  lead: string;
  onThisPage: string;
  role: { title: string; body: string };
  sources: { title: string; body: string; table: Table };
  catchments: { title: string; body: string; rules: string[] };
  fields: { title: string; body: string; rules: string[] };
  compliance: { title: string; body: string; rules: string[] };
  transport: { title: string; body: string; rules: string[] };
  units: { title: string; table: Table };
  privacy: { title: string; body: string };
  not: { title: string; items: string[] };
};

export const soyMethodCopy: Record<Lang, SoyMethod> = {
  en: {
    metaTitle: "Methodology · SoyTrace by Earthline",
    metaDescription:
      "How SoyTrace builds a crushing plant's sourcing areas: USDA field boundaries and crop history, catchments around the plant and its elevators, the client's compliance classification, and distance to rail and river.",
    title: "SoyTrace methodology",
    lead: "Where SoyTrace’s fields and figures come from, how each catchment is built, and what the numbers do and do not say.",
    onThisPage: "On this page",
    role: {
      title: "What SoyTrace does",
      body: "For a crushing plant and the elevators it buys through, SoyTrace draws each facility’s sourcing area (its catchment) and maps the soybean fields inside it — field by field, with eight seasons of crop history, the client’s own compliant / non-compliant classification and the rail and river network around them. It maps and counts; it does not issue its own verdict on a field.",
    },
    sources: {
      title: "Sources",
      body: "Every layer comes from a public dataset or from the client’s own delivery. SoyTrace keeps the source next to each figure (Data & method tab in the workspace).",
      table: {
        head: ["What", "Source", "Notes"],
        rows: [
          ["Field boundaries", "USDA NASS Crop Sequence Boundaries (CSB), 2018–2025", "Field outlines modelled from satellite crop maps — not legal parcels"],
          ["Crop per season", "USDA NASS Cropland Data Layer (CDL)", "One crop class per field per year, 2018–2025"],
          ["Facilities, catchment radii, compliance", "The client’s GIS delivery", "Plant and elevator locations, buffer radii, compliant / non-compliant fields"],
          ["Rail", "Federal Railroad Administration rail lines (07/2025)", "Active lines only; abandoned and excluded lines left out"],
          ["Rivers", "USGS National Hydrography Dataset, river areas", "Connected river-area systems of at least 50 km²"],
          ["Land cover (map layer)", "USGS Annual NLCD, 30 m, 2020 and 2025", "Context around the fields; cut to the catchments, no figure depends on it"],
        ],
      },
    },
    catchments: {
      title: "Catchments",
      body: "A catchment is a circle around a facility, with the radius the client uses for it.",
      rules: [
        "Radii follow the client’s buffers in the unit they were delivered in — nautical miles (1 NM = 1.852 km) or statute miles — and the workspace shows that unit.",
        "A field belongs to a catchment when its outline touches the circle.",
        "One field can sit in several catchments (the plant’s and an elevator’s, or two elevators’). Figures per catchment count it in each; combined figures count every field once.",
      ],
    },
    fields: {
      title: "Soybean fields and crop history",
      body: "A soybean field is a CSB field classed as soybeans in the latest season (2025).",
      rules: [
        "Crop history: what each field grew in each season from 2018 to 2025, and in how many of those eight seasons it was in soybeans.",
        "Areas are the field’s own CSB area, in acres, with hectares alongside.",
        "Field statistics per catchment: count, soybean area, field sizes, states and top counties.",
      ],
    },
    compliance: {
      title: "Compliant and non-compliant",
      body: "Compliant / non-compliant is the client’s classification. SoyTrace shows it exactly as delivered and does not re-assess it.",
      rules: [
        "Non-compliant area is the whole area of each field on the client’s non-compliant list.",
        "A non-compliant field is counted in a catchment when its centre point falls inside it.",
        "Shares are by area unless a table says it counts fields. They can be very small; SoyTrace shows them with up to three decimals rather than rounding to 0% or 100%.",
      ],
    },
    transport: {
      title: "Rail and river",
      body: "How much soybean area lies close to rail or barge transport, where hauling costs far less than by truck.",
      rules: [
        "Distance from each field to the nearest active rail line and to the major river system, in a straight line.",
        "Shown in bands of 5, 10 and 20 statute miles, for rail, river, and rail or river.",
        "Only fields in the states the rail and river data cover are counted; the workspace states the share of area this covers.",
      ],
    },
    units: {
      title: "Units",
      table: {
        head: ["Unit", "Equals", "Used for"],
        rows: [
          ["acre", "0.4047 ha", "Field and catchment areas (hectares alongside)"],
          ["nautical mile (NM)", "1.852 km", "Catchment radii delivered in NM"],
          ["statute mile (mi)", "1.609 km", "Radii delivered in miles; distance to rail and river"],
        ],
      },
    },
    privacy: {
      title: "Personal data",
      body: "Where the client supplies a field’s owner, it is visible only inside that client’s workspace: hidden in presentation mode and left out of every download.",
    },
    not: {
      title: "What SoyTrace does not do",
      items: [
        "It does not make its own deforestation, legality or compliance verdict on a field.",
        "A catchment is a potential sourcing area — it does not show which farm sold to which facility.",
        "Distances are straight lines, not haul routes.",
        "CSB boundaries are modelled field outlines, not surveyed or legal parcels.",
      ],
    },
  },
  id: {
    metaTitle: "Metodologi · SoyTrace oleh Earthline",
    metaDescription:
      "Cara SoyTrace membangun wilayah pasok pabrik crushing: batas ladang dan riwayat tanaman USDA, catchment di sekitar pabrik dan elevatornya, klasifikasi kepatuhan dari klien, serta jarak ke rel dan sungai.",
    title: "Metodologi SoyTrace",
    lead: "Dari mana ladang dan angka SoyTrace berasal, bagaimana tiap catchment dibangun, dan apa yang dikatakan — dan tidak dikatakan — oleh angkanya.",
    onThisPage: "Di halaman ini",
    role: {
      title: "Apa yang dilakukan SoyTrace",
      body: "Untuk sebuah pabrik crushing dan elevator tempat ia membeli, SoyTrace menggambar wilayah pasok tiap fasilitas (catchment-nya) dan memetakan ladang kedelai di dalamnya — ladang demi ladang, dengan riwayat tanaman delapan musim, klasifikasi comply / non-comply milik klien, serta jaringan rel dan sungai di sekitarnya. SoyTrace memetakan dan menghitung; ia tidak mengeluarkan putusan sendiri atas sebuah ladang.",
    },
    sources: {
      title: "Sumber",
      body: "Setiap layer berasal dari dataset publik atau dari kiriman klien sendiri. SoyTrace mencantumkan sumber di samping tiap angka (tab Data & metode di workspace).",
      table: {
        head: ["Apa", "Sumber", "Catatan"],
        rows: [
          ["Batas ladang", "USDA NASS Crop Sequence Boundaries (CSB), 2018–2025", "Batas ladang hasil model dari peta tanaman satelit — bukan persil legal"],
          ["Tanaman per musim", "USDA NASS Cropland Data Layer (CDL)", "Satu kelas tanaman per ladang per tahun, 2018–2025"],
          ["Fasilitas, radius catchment, kepatuhan", "Kiriman GIS klien", "Lokasi pabrik dan elevator, radius buffer, ladang comply / non-comply"],
          ["Rel", "Jalur rel Federal Railroad Administration (07/2025)", "Hanya jalur aktif; jalur terbengkalai dan yang dikecualikan tidak dipakai"],
          ["Sungai", "USGS National Hydrography Dataset, area sungai", "Sistem area sungai tersambung minimal 50 km²"],
          ["Tutupan lahan (layer peta)", "USGS Annual NLCD, 30 m, 2020 dan 2025", "Konteks di sekitar ladang; dipotong ke catchment, tidak ada angka yang bergantung padanya"],
        ],
      },
    },
    catchments: {
      title: "Catchment",
      body: "Catchment adalah lingkaran di sekitar sebuah fasilitas, dengan radius yang dipakai klien untuk fasilitas itu.",
      rules: [
        "Radius mengikuti buffer klien dalam satuan kirimannya — mil laut (1 NM = 1,852 km) atau mil biasa — dan workspace menampilkan satuan itu.",
        "Sebuah ladang masuk catchment bila batasnya menyentuh lingkaran.",
        "Satu ladang bisa berada di beberapa catchment (milik pabrik dan elevator, atau dua elevator). Angka per catchment menghitungnya di masing-masing; angka gabungan menghitung tiap ladang sekali.",
      ],
    },
    fields: {
      title: "Ladang kedelai dan riwayat tanaman",
      body: "Ladang kedelai adalah ladang CSB yang berkelas kedelai pada musim terakhir (2025).",
      rules: [
        "Riwayat tanaman: apa yang ditanam tiap ladang di setiap musim 2018–2025, dan berapa dari delapan musim itu berisi kedelai.",
        "Luas adalah luas CSB ladang itu sendiri, dalam acre, dengan hektar di sampingnya.",
        "Statistik ladang per catchment: jumlah, luas kedelai, ukuran ladang, negara bagian, dan county teratas.",
      ],
    },
    compliance: {
      title: "Comply dan non-comply",
      body: "Comply / non-comply adalah klasifikasi milik klien. SoyTrace menampilkannya persis seperti yang dikirim dan tidak menilai ulang.",
      rules: [
        "Luas non-comply adalah seluruh luas tiap ladang yang ada di daftar non-comply klien.",
        "Ladang non-comply dihitung di sebuah catchment bila titik tengahnya berada di dalamnya.",
        "Porsi dihitung menurut luas kecuali tabelnya menyebut jumlah ladang. Porsinya bisa sangat kecil; SoyTrace menampilkannya sampai tiga desimal, bukan dibulatkan menjadi 0% atau 100%.",
      ],
    },
    transport: {
      title: "Rel dan sungai",
      body: "Seberapa banyak luas kedelai yang dekat dengan angkutan rel atau tongkang, yang jauh lebih murah daripada truk.",
      rules: [
        "Jarak garis lurus dari tiap ladang ke jalur rel aktif terdekat dan ke sistem sungai utama.",
        "Ditampilkan dalam pita 5, 10, dan 20 mil biasa, untuk rel, sungai, dan rel atau sungai.",
        "Hanya ladang di negara bagian yang tercakup data rel dan sungai yang dihitung; workspace menyebutkan porsi luas yang tercakup.",
      ],
    },
    units: {
      title: "Satuan",
      table: {
        head: ["Satuan", "Setara", "Dipakai untuk"],
        rows: [
          ["acre", "0,4047 ha", "Luas ladang dan catchment (hektar di sampingnya)"],
          ["mil laut (NM)", "1,852 km", "Radius catchment yang dikirim dalam NM"],
          ["mil biasa (mi)", "1,609 km", "Radius yang dikirim dalam mil; jarak ke rel dan sungai"],
        ],
      },
    },
    privacy: {
      title: "Data pribadi",
      body: "Bila klien menyertakan pemilik ladang, data itu hanya terlihat di dalam workspace klien tersebut: disembunyikan di mode Presentasi dan tidak ikut di unduhan mana pun.",
    },
    not: {
      title: "Yang tidak dilakukan SoyTrace",
      items: [
        "Tidak membuat putusan deforestasi, legalitas, atau kepatuhan sendiri atas sebuah ladang.",
        "Catchment adalah wilayah pasok potensial — tidak menunjukkan ladang mana menjual ke fasilitas mana.",
        "Jarak adalah garis lurus, bukan rute angkut.",
        "Batas CSB adalah batas ladang hasil model, bukan persil hasil ukur atau persil legal.",
      ],
    },
  },
};
