import type { TourStep } from "@/components/soy-tour";
import type { Lang } from "@/lib/copy";

/** Which page a PalmTrace tour step needs open; the workspace navigates there. */
export type PalmTourTab = "portfolio" | "summary" | "data";
export type PalmTourStep = TourStep & { tab?: PalmTourTab };

type PalmTourCopy = {
  steps: PalmTourStep[];
  next: string;
  back: string;
  skip: string;
  done: string;
  stepOf: string;
};

/** The PalmTrace reading guide (workspace.tsx), once per sign-in. */
export const palmTourCopy: Record<Lang, PalmTourCopy> = {
  en: {
    next: "Next",
    back: "Back",
    skip: "Skip",
    done: "Start exploring",
    stepOf: "Step {n} of {total}",
    steps: [
      {
        tab: "portfolio",
        title: "Welcome to PalmTrace",
        body: "A short tour of where things are. Skip it any time — the ? button at the top right brings it back.",
      },
      {
        tab: "portfolio",
        target: ".pf-groups",
        title: "Start from a group",
        body: "Each row is one supply-chain group: its mills, plots, mapped area and the share of plots that are EUDR compliant. Click a row to open it.",
      },
      {
        tab: "portfolio",
        target: ".scope",
        title: "Switch group any time",
        body: "The name here opens the list of all groups. Pick “Portfolio” to get back to the overview.",
      },
      {
        tab: "summary",
        target: ".app-tabs",
        title: "Four pages per group",
        body: "Summary holds the figures and charts. Map & data shows the mills and their plots. Monitoring and Documents hold reports and SOPs.",
      },
      {
        tab: "summary",
        target: ".summary-kpis",
        title: "The headline figures",
        body: "Hover the ⓘ for how each figure is counted. “Non-compliant plots” takes you straight to where they are.",
      },
      {
        tab: "summary",
        target: "#comply-list",
        title: "Which mills need attention",
        body: "Mills ranked by compliant or non-compliant plots. “Open on map” shows that mill's plots, already filtered.",
      },
      {
        tab: "data",
        target: ".side-panel",
        title: "The mill list",
        body: "The figure on the right is each mill's compliant share. Click a mill to load its plots on the map and open the plot table.",
      },
      {
        tab: "data",
        target: ".map-layers",
        title: "Layers and colours",
        body: "Choose what the map shows and colour the plots by compliance, risk, mitigation class or type. Click a legend row to filter.",
      },
      {
        tab: "data",
        target: ".assistant-launch",
        title: "Ask the data",
        body: "Ask in plain words — “which mills have the most non-compliant plots?”. Answers come from the dashboard's own figures.",
      },
      {
        target: ".acct-btn",
        title: "Settings",
        body: "Language and sign out are here — and, where your account has them, presentation mode and the client switch.",
      },
    ],
  },
  id: {
    next: "Lanjut",
    back: "Kembali",
    skip: "Lewati",
    done: "Mulai menjelajah",
    stepOf: "Langkah {n} dari {total}",
    steps: [
      {
        tab: "portfolio",
        title: "Selamat datang di PalmTrace",
        body: "Tur singkat letak fitur-fiturnya. Bisa dilewati kapan saja — tombol ? di kanan atas memunculkannya lagi.",
      },
      {
        tab: "portfolio",
        target: ".pf-groups",
        title: "Mulai dari grup",
        body: "Tiap baris satu grup rantai pasok: jumlah PKS, plot, luas terpetakan, dan porsi plot yang patuh EUDR. Klik baris untuk membukanya.",
      },
      {
        tab: "portfolio",
        target: ".scope",
        title: "Pindah grup kapan saja",
        body: "Nama di sini membuka daftar semua grup. Pilih “Portofolio” untuk kembali ke gambaran besar.",
      },
      {
        tab: "summary",
        target: ".app-tabs",
        title: "Empat halaman per grup",
        body: "Ringkasan berisi angka dan grafik. Peta & data menampilkan PKS beserta plotnya. Monitoring dan Dokumen berisi laporan dan SOP.",
      },
      {
        tab: "summary",
        target: ".summary-kpis",
        title: "Angka utama",
        body: "Arahkan kursor ke ⓘ untuk cara tiap angka dihitung. “Plot tidak patuh” langsung membawa Anda ke lokasinya.",
      },
      {
        tab: "summary",
        target: "#comply-list",
        title: "PKS yang perlu perhatian",
        body: "PKS diurutkan menurut plot patuh atau tidak patuh. “Buka di peta” menampilkan plot PKS itu, sudah tersaring.",
      },
      {
        tab: "data",
        target: ".side-panel",
        title: "Daftar PKS",
        body: "Angka di kanan = porsi plot patuh tiap PKS. Klik PKS untuk memuat plotnya di peta dan membuka tabel plot.",
      },
      {
        tab: "data",
        target: ".map-layers",
        title: "Layer dan warna",
        body: "Atur apa yang tampil di peta dan warnai plot menurut kepatuhan, risiko, kelas mitigasi atau tipe. Klik baris legenda untuk menyaring.",
      },
      {
        tab: "data",
        target: ".assistant-launch",
        title: "Tanya data",
        body: "Tanyakan dengan bahasa sehari-hari — “PKS mana yang plot tidak patuhnya paling banyak?”. Jawabannya diambil dari angka dashboard.",
      },
      {
        target: ".acct-btn",
        title: "Pengaturan",
        body: "Bahasa dan Keluar ada di sini — juga mode presentasi dan pindah klien, bila akun Anda punya aksesnya.",
      },
    ],
  },
};
