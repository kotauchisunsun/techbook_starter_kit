# EPUB visual QA

Run in a browser-enabled development or CI environment. The script opens the actual ZIP archive in EPUB.js 0.3.93 using Playwright Chromium, rather than rendering extracted XHTML as a normal web page.

```sh
npx playwright install --with-deps chromium-headless-shell
node scripts/render-epub.js output/epub/book.epub output/epub-visual
node scripts/render-epub.js path/to/original.epub output/epub-visual-original --baseline
```

The dependencies are `playwright`, `epubjs@0.3.93`, and `jszip@3.10.1`. Each run captures every spine item and every page at 600 × 780 and 360 × 780. The output directories contain page PNGs and `report.json` with spine locations, visible headings, image status, code colors, font metrics, and code/MathML overflow diagnostics. `--widths=600,360`, `--height=780`, and `--max-pages=1000` override the defaults.

The normal run fails for missing images, code or math fragments extending past their column, missing token colors, external network dependencies, renderer errors, skipped spine items, or pagination loops. `--baseline` records visual diagnostics without failing for them so the original artifact remains available for comparison. It does not suppress reader/runtime failures. A safety page limit is a failure, not a successful early stop. On failure, the partial report and captured images are retained.

Upload the output directory with an `if: always()` artifact step in CI, even when rendering fails. Preserve the generated EPUB alongside the PNGs. Inspect the cover, TOC, code, aligned equal signs, fractions and radicals, diagrams, and back cover at both widths. This verifies EPUB.js in Chromium only; it is not a claim about Apple Books, Kobo, Kindle, or every reading system.

## Stress fixture

`scripts/fixtures/epub-stress.md` deliberately includes a long unbroken code token, a long equation, and multiline equations. Compile it into a separate EPUB, not the published book. From the repository root, create a temporary config such as `tmp/epub-stress.config.js`:

```js
import config from '../vivliostyle.epub.config.js';

export default {
  ...config,
  title: 'EPUB stress fixture',
  workspaceDir: '.vivliostyle/epub-stress',
  entry: ['scripts/fixtures/epub-stress.md'],
  cover: undefined,
  output: [{ path: 'output/epub-stress/stress.epub', format: 'epub' }],
};
```

Run the normal EPUB preparation first so the configured font, stylesheet, and image assets exist. Then compile and capture the fixture:

```sh
npm run prebuild:epub
mkdir -p output/epub-stress
npx vivliostyle build --config tmp/epub-stress.config.js
node scripts/render-epub.js output/epub-stress/stress.epub output/epub-stress-visual
```

The long equation can legitimately reveal that an expression needs explicit multiline authoring or a renderer fallback. Do not silence that result by clipping content or shrinking the whole book. Geometry diagnostics locate possible clipping; inspect the screenshots before judging the fix.
