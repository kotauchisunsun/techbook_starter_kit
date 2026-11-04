// Share the ordinary ESM module cache with callers already using --import tsx.
// Scoped tsImport would create separate processor instances for root configs.
import { register } from 'tsx/esm/api';

// Keep the shared hook active for processors that lazily import dependencies.
register();
