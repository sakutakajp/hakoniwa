/** ニューヨークの既存ホーム構図。距離と注視点は台座幅に対する比率。 */
export const homeCamera = Object.freeze({
  azimuth: 0,
  elevation: 22.8,
  distance: 4.86,
  targetHeight: 0.24,
  // 基準の縦画角。最終画角は各作品の外形と画面の縦横比から求める。
  fov: 13.44,
});

/** 台座の占有率をそろえ、高い中身は上端4%の余白まで許容する。 */
export const homeFraming = Object.freeze({
  paddingX: 0.029,
  paddingXNarrow: 0.05,
  paddingTop: 0.305,
  paddingBottom: 0.15,
  minTop: 0.04,
});
