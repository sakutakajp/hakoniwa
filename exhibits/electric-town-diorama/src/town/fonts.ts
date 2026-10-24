/*! 看板の書体: Dela Gothic One (c) 2020 The Dela Gothic Project Authors / DotGothic16 (c) 2020 The DotGothic16 Project Authors /
 * Zen Maru Gothic (c) 2021 The Zen Maru Gothic Project Authors / RocknRoll One (c) 2020 The RocknRoll Project Authors /
 * Bungee (c) 2023 The Bungee Project Authors — SIL Open Font License 1.1 (https://openfontlicense.org)。使う文字だけに絞って埋め込み */
import { SIGN_FONTS } from './fontData';

/**
 * 看板の書体を読み込む（埋め込みのデータから。ネットワークは使わない）。
 * 読み込めない・時間がかかるときは待たずに進み、看板は端末の書体で描く
 */
export async function loadSignFonts(timeoutMs = 4000): Promise<void> {
  if (typeof FontFace === 'undefined' || typeof document === 'undefined' || !document.fonts) return;
  const loads = SIGN_FONTS.map(async (f) => {
    const bin = Uint8Array.from(atob(f.data), (c) => c.charCodeAt(0));
    const face = new FontFace(f.family, bin.buffer, { weight: '400', style: 'normal', display: 'block' });
    await face.load();
    document.fonts.add(face);
  });
  let timer = 0;
  await Promise.race([
    Promise.allSettled(loads),
    new Promise<void>((resolve) => {
      timer = window.setTimeout(resolve, timeoutMs);
    }),
  ]);
  window.clearTimeout(timer);
}
