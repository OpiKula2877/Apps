"""Build every app icon from build/icon.png (the OK logo shared by all OpiKula apps).

Run: python scripts/make-icons.py   (needs PySide6)
Outputs: build/icon-1024.png (installers) and resources/icon.png (window, tray).
"""

from collections import deque
from pathlib import Path

from PySide6.QtCore import Qt
from PySide6.QtGui import QColor, QGuiApplication, QImage, QPainter

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "build" / "icon.png"


def is_light(c: QColor) -> bool:
    return c.alpha() < 40 or min(c.red(), c.green(), c.blue()) > 200


def master() -> QImage:
    img = QImage(str(SOURCE)).convertToFormat(QImage.Format.Format_ARGB32)
    w, h = img.width(), img.height()
    # Bounding box of the dark rounded square.
    step = 2
    xs, ys = [], []
    for y in range(0, h, step):
        for x in range(0, w, step):
            c = img.pixelColor(x, y)
            if c.alpha() > 200 and max(c.red(), c.green(), c.blue()) < 80:
                xs.append(x)
                ys.append(y)
    left, right, top, bottom = min(xs), max(xs), min(ys), max(ys)
    crop = img.copy(left, top, right - left + 1, bottom - top + 1)
    # Light pixels connected to the edges (outside the rounded corners) become transparent.
    cw, ch = crop.width(), crop.height()
    seen = bytearray(cw * ch)
    queue = deque()
    for x in range(cw):
        queue.extend([(x, 0), (x, ch - 1)])
    for y in range(ch):
        queue.extend([(0, y), (cw - 1, y)])
    clear = QColor(0, 0, 0, 0)
    while queue:
        x, y = queue.popleft()
        i = y * cw + x
        if seen[i]:
            continue
        seen[i] = 1
        if not is_light(crop.pixelColor(x, y)):
            continue
        crop.setPixelColor(x, y, clear)
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if 0 <= nx < cw and 0 <= ny < ch and not seen[ny * cw + nx]:
                queue.append((nx, ny))
    side = max(cw, ch)
    square = QImage(side, side, QImage.Format.Format_ARGB32)
    square.fill(Qt.GlobalColor.transparent)
    p = QPainter(square)
    p.drawImage((side - cw) // 2, (side - ch) // 2, crop)
    p.end()
    return square


def scaled(img: QImage, size: int) -> QImage:
    return img.scaled(size, size, Qt.AspectRatioMode.KeepAspectRatio, Qt.TransformationMode.SmoothTransformation)


def main() -> None:
    QGuiApplication([])
    icon = master()
    scaled(icon, 1024).save(str(ROOT / "build" / "icon-1024.png"))
    scaled(icon, 512).save(str(ROOT / "resources" / "icon.png"))
    print("icons ok", icon.width())


if __name__ == "__main__":
    main()
