from pathlib import Path
from PIL import Image, ImageDraw


output = Path(__file__).parent / "dist"
for size in (192, 512):
    image = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    scale = size / 64

    def box(left, top, right, bottom):
        return tuple(round(value * scale) for value in (left, top, right, bottom))

    draw.rounded_rectangle(box(0, 0, 64, 64), radius=round(18 * scale), fill="#8398eb")
    draw.ellipse(box(13, 15, 38, 40), fill="white")
    draw.ellipse(box(36, 32, 54, 50), fill="#dce5ff")
    image.save(output / f"icon-{size}.png", optimize=True)
