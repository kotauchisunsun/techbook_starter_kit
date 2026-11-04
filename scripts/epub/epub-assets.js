// Generated assets are kept separate from source illustrations and PDF themes.
export const epubAssetDirectory = 'assets/epub-generated';

export function epubCoverEntries(config) {
  return config.entry.flatMap((entry, index) => {
    if (typeof entry !== 'object' || entry.rel !== 'cover') return [];
    const source = entry.imageSrc ?? (typeof config.cover === 'string' ? config.cover : config.cover?.src);
    return source ? [{ index, source, target: /\.svg$/i.test(source)
      ? `${epubAssetDirectory}/cover-${index}.png` : source }] : [];
  });
}
