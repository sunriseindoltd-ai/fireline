// Minimal typings for the parts of d3-sankey 0.12 this app uses (the package
// ships no types and @types/d3-sankey isn't installed).
declare module "d3-sankey" {
  export type SankeyNodeLayout = {
    x0: number;
    x1: number;
    y0: number;
    y1: number;
    value: number;
    depth: number;
  };
  export type SankeyLinkLayout<N> = {
    source: N & SankeyNodeLayout;
    target: N & SankeyNodeLayout;
    value: number;
    width: number;
    y0: number;
    y1: number;
  };
  export type SankeyGraph<N, L> = {
    nodes: (N & SankeyNodeLayout)[];
    links: (L & SankeyLinkLayout<N>)[];
  };
  export interface SankeyGenerator<N, L> {
    (graph: { nodes: N[]; links: L[] }): SankeyGraph<N, L>;
    nodeId(fn: (node: N) => string): SankeyGenerator<N, L>;
    nodeWidth(width: number): SankeyGenerator<N, L>;
    nodePadding(padding: number): SankeyGenerator<N, L>;
    nodeAlign(align: (node: SankeyNodeLayout, n: number) => number): SankeyGenerator<N, L>;
    nodeSort(sort: ((a: N, b: N) => number) | null): SankeyGenerator<N, L>;
    extent(extent: [[number, number], [number, number]]): SankeyGenerator<N, L>;
  }
  export function sankey<N, L>(): SankeyGenerator<N, L>;
  export function sankeyLinkHorizontal(): (link: unknown) => string | null;
  export function sankeyJustify(node: SankeyNodeLayout, n: number): number;
  export function sankeyLeft(node: SankeyNodeLayout, n: number): number;
}
