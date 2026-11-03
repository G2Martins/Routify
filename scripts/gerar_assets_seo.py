#!/usr/bin/env python3
"""Gera os PNGs de compartilhamento e os ícones do site público (apps/mobile/public).

Rodar uma vez, e de novo só se a logo ou o texto do cartão mudarem:

    apps/api/.venv/Scripts/python.exe scripts/gerar_assets_seo.py     # Windows
    apps/api/.venv/bin/python scripts/gerar_assets_seo.py             # Linux

Entrada: apps/mobile/assets/Logo_Routify_icon.png e a fonte Geist (node_modules do app: `npm ci`).
Saída (versionada): og-image.png (1200x630), apple-touch-icon.png (180), icon-192.png, icon-512.png.
Só Pillow, que já está no venv da API. Cores = tokens da marca em apps/mobile/src/constants/Theme.ts.
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

RAIZ = Path(__file__).resolve().parent.parent
MOBILE = RAIZ / "apps" / "mobile"
SAIDA = MOBILE / "public"
ICONE = MOBILE / "assets" / "Logo_Routify_icon.png"
FONTES = MOBILE / "node_modules" / "@expo-google-fonts" / "geist"

# Tokens (Theme.ts): brand.* e a paleta escura.
NAVY, NAVY_FUNDO = (15, 31, 68), (10, 15, 29)
AZUL, CIANO, TEAL = (2, 107, 248), (5, 155, 194), (9, 198, 164)
TEXTO, TEXTO_SUAVE = (241, 245, 251), (167, 178, 198)

# Caixa do ladrilho dentro dos 1024 px da logo (bbox do alfa) e o recorte sem cantos transparentes.
LADRILHO = (147, 155, 877, 871)
RECORTE_ICONE = (214, 215, 810, 811)  # quadrado de 596 px, só o miolo do ladrilho


def fonte(peso: str, tamanho: int) -> ImageFont.FreeTypeFont:
    caminho = FONTES / peso / f"Geist_{peso}.ttf"
    if not caminho.exists():
        raise SystemExit(f"Fonte ausente: {caminho}. Rode `npm ci` em apps/mobile.")
    return ImageFont.truetype(str(caminho), tamanho)


def ajustar(texto: str, peso: str, tamanho: int, largura_max: int) -> ImageFont.FreeTypeFont:
    """Reduz o corpo até o texto caber na largura."""
    while tamanho > 12:
        f = fonte(peso, tamanho)
        if f.getlength(texto) <= largura_max:
            return f
        tamanho -= 1
    return fonte(peso, tamanho)


def mistura(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def cartao_og() -> Image.Image:
    w, h = 1200, 630
    img = Image.new("RGB", (w, h), NAVY)
    d = ImageDraw.Draw(img)
    for y in range(h):  # fundo: navy da logo descendo para o fundo escuro do app
        d.line([(0, y), (w, y)], fill=mistura(NAVY, NAVY_FUNDO, y / h))
    for x in range(w):  # faixa da marca (azul, ciano, teal), a assinatura da logo
        t = x / (w - 1)
        d.line([(x, h - 12), (x, h)], fill=mistura(AZUL, CIANO, t * 2) if t < 0.5 else mistura(CIANO, TEAL, t * 2 - 1))

    ladrilho = Image.open(ICONE).convert("RGBA").crop(LADRILHO)
    alt = 330
    ladrilho = ladrilho.resize((round(ladrilho.width * alt / ladrilho.height), alt), Image.LANCZOS)
    x0, y0 = 96, (h - 12 - alt) // 2
    img.paste(ladrilho, (x0, y0), ladrilho)

    x = x0 + ladrilho.width + 64
    larg = w - x - 72
    d.text((x, 150), "Routify", font=ajustar("Routify", "700Bold", 124, larg), fill=TEXTO)
    d.text((x, 292), "Roteamento preditivo", font=ajustar("Roteamento preditivo", "500Medium", 50, larg), fill=TEXTO)
    d.text((x, 354), "para Brasília/DF", font=ajustar("para Brasília/DF", "500Medium", 50, larg), fill=TEXTO)
    sub = "Modelo LIA · trânsito ao vivo · TCC 2026"
    d.text((x, 448), sub, font=ajustar(sub, "400Regular", 29, larg), fill=TEXTO_SUAVE)
    return img


def main() -> None:
    SAIDA.mkdir(parents=True, exist_ok=True)
    cartao_og().save(SAIDA / "og-image.png", optimize=True)

    miolo = Image.open(ICONE).convert("RGBA").crop(RECORTE_ICONE).convert("RGB")
    for nome, lado in (("apple-touch-icon.png", 180), ("icon-192.png", 192), ("icon-512.png", 512)):
        miolo.resize((lado, lado), Image.LANCZOS).save(SAIDA / nome, optimize=True)

    for nome in ("og-image.png", "apple-touch-icon.png", "icon-192.png", "icon-512.png"):
        print(f"{nome}: {(SAIDA / nome).stat().st_size / 1024:.0f} KB")


if __name__ == "__main__":
    main()
