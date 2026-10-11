"""生成安卓启动图标：深底 + 主题绿「卫」字。

适配层（adaptive icon）要的是「108dp 画布、中间 66dp 安全区」的前景图，
所以每个密度出两张：ic_launcher_foreground（透明底，字缩在安全区）与
ic_launcher（老系统用的方图，底+字一起烤进去）。
"""
import os
from PIL import Image, ImageDraw, ImageFont

BASE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "app", "src", "main", "res")
BG = (0x0B, 0x0F, 0x0E, 255)
FG = (0x4E, 0xD8, 0xAF, 255)

# 密度 → (老式方图边长, adaptive 前景边长 108dp)
DENSITIES = {
    "mdpi": (48, 108),
    "hdpi": (72, 162),
    "xhdpi": (96, 216),
    "xxhdpi": (144, 324),
    "xxxhdpi": (192, 432),
}

FONT_CANDIDATES = [
    r"C:\Windows\Fonts\msyhbd.ttc",
    r"C:\Windows\Fonts\msyh.ttc",
    r"C:\Windows\Fonts\simhei.ttf",
]


def load_font(size):
    for path in FONT_CANDIDATES:
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size, index=0)
            except Exception:
                continue
    return ImageFont.load_default()


def draw_glyph(img, box, font_ratio=0.78):
    """在 box=(x0,y0,x1,y1) 里居中画「卫」。"""
    x0, y0, x1, y1 = box
    size = int((y1 - y0) * font_ratio)
    font = load_font(size)
    d = ImageDraw.Draw(img)
    text = "卫"
    l, t, r, b = d.textbbox((0, 0), text, font=font)
    w, h = r - l, b - t
    d.text(((x0 + x1 - w) / 2 - l, (y0 + y1 - h) / 2 - t), text, font=font, fill=FG)


def main():
    for name, (legacy, fg) in DENSITIES.items():
        out = os.path.join(BASE, f"mipmap-{name}")
        os.makedirs(out, exist_ok=True)

        # adaptive 前景：整张透明，字只占中间安全区（108dp 里的 66dp）
        fore = Image.new("RGBA", (fg, fg), (0, 0, 0, 0))
        pad = (fg - int(fg * 66 / 108)) // 2
        draw_glyph(fore, (pad, pad, fg - pad, fg - pad))
        fore.save(os.path.join(out, "ic_launcher_foreground.png"))

        # 老系统方图：圆角深底 + 字
        sq = Image.new("RGBA", (legacy, legacy), (0, 0, 0, 0))
        d = ImageDraw.Draw(sq)
        d.rounded_rectangle([0, 0, legacy - 1, legacy - 1], radius=int(legacy * 0.22), fill=BG)
        draw_glyph(sq, (int(legacy * 0.1), int(legacy * 0.1), int(legacy * 0.9), int(legacy * 0.9)))
        sq.save(os.path.join(out, "ic_launcher.png"))
        sq.save(os.path.join(out, "ic_launcher_round.png"))

    print("icons written to", BASE)


if __name__ == "__main__":
    main()
