// Keep the plain-JavaScript Vivliostyle configuration loadable without a CLI loader.
import '../register-typescript.js';

const implementation = await import('./epub-layout.ts');
export default implementation.default;
