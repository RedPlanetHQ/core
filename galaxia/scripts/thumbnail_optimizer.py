#!/usr/bin/env python3
"""
Thumbnail Optimizer — Pfeifer Galaxia OS
100% kostenlos: Pillow + Ollama Multimodal Critique

Usage:
    python3 thumbnail_optimizer.py --title "Video Titel" --style tech-bold-red --output thumb.png
    python3 thumbnail_optimizer.py --title "Video Titel" --critique thumb.png
"""

import argparse
import json
import subprocess
import sys
from pathlib import Path

try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:
    print("Pillow nicht installiert: pip install pillow")
    sys.exit(1)

# Thumbnail Groesse (YouTube Standard)
WIDTH = 1280
HEIGHT = 720

# Style Definitionen
STYLES = {
    "tech-bold-red": {
        "bg_color": (20, 20, 20),
        "text_color": (255, 255, 255),
        "accent_color": (255, 40, 40),
        "overlay_opacity": 180,
        "font_size": 80,
    },
    "money-green": {
        "bg_color": (10, 30, 10),
        "text_color": (255, 215, 0),
        "accent_color": (0, 200, 80),
        "overlay_opacity": 160,
        "font_size": 75,
    },
    "clean-minimal": {
        "bg_color": (245, 248, 252),
        "text_color": (30, 30, 30),
        "accent_color": (0, 100, 200),
        "overlay_opacity": 0,
        "font_size": 70,
    },
    "shock-yellow": {
        "bg_color": (255, 220, 0),
        "text_color": (0, 0, 0),
        "accent_color": (255, 0, 0),
        "overlay_opacity": 100,
        "font_size": 90,
    },
}


def create_thumbnail(title: str, style_name: str, output_path: str, subtitle: str = ""):
    """Erstelle ein YouTube Thumbnail mit Pillow."""
    style = STYLES.get(style_name, STYLES["tech-bold-red"])

    # Neues Bild
    img = Image.new("RGB", (WIDTH, HEIGHT), style["bg_color"])
    draw = ImageDraw.Draw(img)

    # Accent Bar (oben)
    draw.rectangle([(0, 0), (WIDTH, 8)], fill=style["accent_color"])
    # Accent Bar (unten)
    draw.rectangle([(0, HEIGHT - 8), (WIDTH, HEIGHT)], fill=style["accent_color"])

    # Gradient Overlay (simuliert)
    if style["overlay_opacity"] > 0:
        for y in range(HEIGHT // 2, HEIGHT):
            opacity = int(style["overlay_opacity"] * (y - HEIGHT // 2) / (HEIGHT // 2))
            draw.line(
                [(0, y), (WIDTH, y)],
                fill=(*style["accent_color"], opacity),
            )

    # Font laden (Fallback auf Default)
    font_size = style["font_size"]
    try:
        font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", font_size)
        font_small = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", font_size // 2)
    except OSError:
        font = ImageFont.load_default()
        font_small = font

    # Text wrappen
    words = title.upper().split()
    lines = []
    current_line = ""
    for word in words:
        test = f"{current_line} {word}".strip()
        bbox = draw.textbbox((0, 0), test, font=font)
        if bbox[2] > WIDTH - 100:
            if current_line:
                lines.append(current_line)
            current_line = word
        else:
            current_line = test
    if current_line:
        lines.append(current_line)

    # Text zeichnen (zentriert)
    total_height = len(lines) * (font_size + 10)
    y_start = (HEIGHT - total_height) // 2

    for i, line in enumerate(lines):
        bbox = draw.textbbox((0, 0), line, font=font)
        text_width = bbox[2] - bbox[0]
        x = (WIDTH - text_width) // 2
        y = y_start + i * (font_size + 10)

        # Schatten
        draw.text((x + 3, y + 3), line, fill=(0, 0, 0), font=font)
        # Text
        draw.text((x, y), line, fill=style["text_color"], font=font)

    # Subtitle (wenn vorhanden)
    if subtitle:
        bbox = draw.textbbox((0, 0), subtitle, font=font_small)
        text_width = bbox[2] - bbox[0]
        draw.text(
            ((WIDTH - text_width) // 2, HEIGHT - 80),
            subtitle,
            fill=style["accent_color"],
            font=font_small,
        )

    # Speichern
    img.save(output_path, "PNG", quality=95)
    print(f"✓ Thumbnail gespeichert: {output_path}")
    print(f"  Style: {style_name}")
    print(f"  Groesse: {WIDTH}x{HEIGHT}")
    return output_path


def critique_thumbnail(image_path: str):
    """AI Critique via Ollama Multimodal (llama4 oder qwen2-vl)."""
    import base64

    with open(image_path, "rb") as f:
        img_b64 = base64.b64encode(f.read()).decode()

    prompt = """Analysiere dieses YouTube Thumbnail kritisch:
1. Ist der Text lesbar auf mobilen Geraeten (120x67px)?
2. Ist das Farbschema aufmerksamkeitsstark?
3. Gibt es einen klaren Fokuspunkt?
4. Wuerdest du darauf klicken? Warum/warum nicht?
5. Bewertung 1-10 mit konkreten Verbesserungsvorschlaegen.

Antworte auf Deutsch, kurz und direkt."""

    # Versuche llama4 (multimodal), dann qwen2-vl als Fallback
    for model in ["llama4", "qwen2-vl"]:
        try:
            result = subprocess.run(
                ["ollama", "run", model],
                input=f"[img]{img_b64}[/img]\n{prompt}",
                capture_output=True,
                text=True,
                timeout=120,
            )
            if result.returncode == 0 and result.stdout.strip():
                print(f"\n🎨 Thumbnail Critique ({model}):\n")
                print(result.stdout)
                return result.stdout
        except Exception:
            continue

    print("Kein Multimodal-Modell verfuegbar. Installiere: ollama pull llama4")
    return None


def create_ab_variants(title: str, output_dir: str):
    """Erstelle A/B Varianten in verschiedenen Styles."""
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    variants = []
    for style_name in STYLES:
        output_path = output_dir / f"thumb_{style_name}.png"
        create_thumbnail(title, style_name, str(output_path))
        variants.append(str(output_path))

    print(f"\n✓ {len(variants)} A/B Varianten erstellt in {output_dir}")
    return variants


def main():
    parser = argparse.ArgumentParser(description="Galaxia Thumbnail Optimizer")
    parser.add_argument("--title", required=True, help="Video Titel")
    parser.add_argument("--style", default="tech-bold-red", choices=list(STYLES.keys()))
    parser.add_argument("--output", default="thumbnail.png", help="Output Pfad")
    parser.add_argument("--subtitle", default="", help="Untertitel")
    parser.add_argument("--critique", action="store_true", help="AI Critique ausfuehren")
    parser.add_argument("--ab-test", action="store_true", help="Alle Style-Varianten erstellen")

    args = parser.parse_args()

    if args.ab_test:
        output_dir = Path(args.output).parent / "ab_variants"
        create_ab_variants(args.title, str(output_dir))
    else:
        create_thumbnail(args.title, args.style, args.output, args.subtitle)

    if args.critique:
        target = args.output
        if args.ab_test:
            target = str(Path(args.output).parent / "ab_variants" / f"thumb_{args.style}.png")
        critique_thumbnail(target)


if __name__ == "__main__":
    main()
