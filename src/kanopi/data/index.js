// @ts-nocheck
import { FileDataAdapter } from './FileDataAdapter.js';
export function createAdapter(config) {
  switch (config.dataSource) {
    case 'file': return new FileDataAdapter(config);
    // case 'api': return new ApiDataAdapter(config);
    default: throw new Error(`Unknown dataSource: ${config.dataSource}`);
  }
}
