// Keep the plain-JavaScript Vivliostyle configuration loadable without a CLI loader.
import '../register-typescript.js';

const implementation = await import('./epub-assets.ts');
export const { epubAssetDirectory, epubCoverEntries } = implementation;
