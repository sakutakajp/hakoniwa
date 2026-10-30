/** このLayerの公開一覧以外だけをnoindexにし、ホストのSEOには触れない。 */
export const ROBOTS_NOINDEX = 'noindex, follow';
export function shouldNoindex(path: string): boolean {
  const pathname = path.split(/[?#]/)[0]!.replace(/\/+$/, '');
  return pathname.startsWith('/ja/hakoniwa/') && pathname !== '/ja/hakoniwa/index.html';
}
export function withNoindexMeta(html: string): string {
  // 個別のindex指定と衝突させず、検索エンジン別の指定も一本化する。
  const clean = html.replace(/<meta\b(?=[^>]*\bname\s*=\s*(?:"(?:robots|googlebot|bingbot)"|'(?:robots|googlebot|bingbot)'|(?:robots|googlebot|bingbot)(?=\s|\/?>)))[^>]*>/gi, '');
  const meta = `<meta name="robots" content="${ROBOTS_NOINDEX}">`;
  if (/<\/head\s*>/i.test(clean)) return clean.replace(/<\/head\s*>/i, `${meta}</head>`);
  // 既存の短縮HTML（headタグを省略したリダイレクト等）も対象。
  if (/<html\b[^>]*>/i.test(clean)) return clean.replace(/<html\b[^>]*>/i, match => match + meta);
  return meta + clean;
}
