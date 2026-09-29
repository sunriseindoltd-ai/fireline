import type { Lang } from "@/lib/copy";

/**
 * Supporting documents shown on every supply chain's Documents tab. The
 * files are client-neutral ("May be shared with clients & partners"), so the
 * same set serves every tenant. They live in private-data/docs/ locally and
 * under `docs/` in R2 (scripts/upload-docs-to-r2.mjs); src/routes/docs/$.ts
 * serves them to signed-in sessions only.
 */
export type SupportDoc = {
  file: string;
  lang: Lang;
  code: string;
  version: string;
  title: string;
  subtitle: string;
  pages: number;
  bytes: number;
};

export const SUPPORT_DOCS: readonly SupportDoc[] = [
  {
    file: "EL-SOP-EUDR-001_v1.1_EN.pdf",
    lang: "en",
    code: "EL-SOP-EUDR-001",
    version: "v1.1",
    title: "EUDR Geospatial Due Diligence Assessment",
    subtitle: "Oil Palm Supply Chain Compliance Pipeline",
    pages: 116,
    bytes: 7669254,
  },
  {
    file: "EL-SOP-EUDR-001_v1.1_ID.pdf",
    lang: "id",
    code: "EL-SOP-EUDR-001",
    version: "v1.1",
    title: "Penilaian Uji Tuntas Geospasial EUDR",
    subtitle: "Pipeline Kepatuhan Rantai Pasok Kelapa Sawit",
    pages: 115,
    bytes: 7642507,
  },
];

export function docHref(doc: SupportDoc, download = false) {
  return `/docs/${encodeURIComponent(doc.file)}${download ? "?download=1" : ""}`;
}
