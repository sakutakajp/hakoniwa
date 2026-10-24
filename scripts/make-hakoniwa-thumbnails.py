"""共通カメラで台座の大きさをそろえて撮った作品画像から一覧用WebPを生成する。
撮影: node scripts/capture-hakoniwa-thumbnails.mjs http://127.0.0.1:3000
変換: python3 scripts/make-hakoniwa-thumbnails.py test-results/home-thumbnails
依存: Pillow。元の3D描画の色・構図を保ち、外部画像は使用しない。
"""
from pathlib import Path
import sys
from PIL import Image

source = Path(sys.argv[1])
destination = Path("public/images/hakoniwa")
destination.mkdir(parents=True, exist_ok=True)
for slug in ["sand-pedestal", "nyc-diorama", "library-diorama", "dino-diorama", "electric-town-diorama"]:
    image = Image.open(source / f"{slug}.png").convert("RGB")
    if image.size != (900, 650):
        raise ValueError(f"{slug}: 一覧画像は900×650で撮影してください（{image.size}）")
    image.save(destination / f"{slug}.webp", quality=88, method=6)
