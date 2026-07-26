# ASSETS — Prompts para geração (Sora = vídeo · Nano Banana = imagem)

Regras gerais para TODOS os assets:

- Fundo **preto puro (#000000)** — o site é preto, o asset precisa "derreter" na página.
- **Nenhum texto, logo, marca d'água ou assinatura** dentro do asset.
- Vídeos: **sem áudio**, loop perfeito (seamless), 8–10 segundos, mínimo 1080p.
- Imagens: PNG (ou JPG onde indicado), na resolução indicada ou maior.
- Depois de gerar, salve com o **nome de arquivo exato** indicado e jogue na pasta
  `public/assets/video/` ou `public/assets/img/`. O site detecta o arquivo e troca o
  placeholder automaticamente — não precisa mexer em código.

> O blob 3D do HERO é renderizado em **tempo real com Three.js** (reage ao mouse).
> O vídeo V1 abaixo é opcional: serve de fallback para navegadores sem WebGL
> e de material para posts/social.

---

## VÍDEOS (Sora)

### V1 — `hero-blob.mp4` *(opcional — fallback do 3D real-time)*
- **Formato:** 1:1 (mínimo 1080×1080) · 10s · loop seamless · sem áudio
- **Prompt:**
```
A single organic blob of liquid glass floating in the center of a pure black void,
slowly rotating and gently morphing its shape. The surface is highly reflective
iridescent glass with thin-film interference: oily rainbow reflections shifting
between electric blue, violet, magenta, teal and warm amber as it rotates.
Soft internal glow, subtle caustic light refractions inside the glass.
Studio black background, no floor, no horizon. Cinematic macro shot, shallow
depth of field, ultra realistic 3D render, octane style, 4K detail.
Slow elegant motion, seamless perfect loop, no camera movement.
No text, no logo, no watermark, no particles of dust.
```

### V2 — `chrome-waves.mp4`
- **Uso:** fundo sutil da seção "O que é OTC" (manifesto)
- **Formato:** 16:9 (mínimo 1920×1080) · 10s · loop seamless · sem áudio
- **Prompt:**
```
Dark liquid chrome metal surface flowing in slow motion, like black molten
mercury or heavy metallic silk fabric waving gently. Deep black background,
the waves catch thin highlights of cold silver light with very faint blue and
violet iridescent reflections on the crests. Elegant, hypnotic, luxurious slow
movement. Cinematic macro shot, high contrast, mostly darkness with selective
highlights. Ultra realistic 3D render, 4K detail. Seamless perfect loop,
fixed camera, no cuts. No text, no logo, no watermark.
```

### V3 — `blob-cta.mp4`
- **Uso:** fundo da seção final "Pronto para operar em outro nível?"
- **Formato:** 16:9 (mínimo 1920×1080) · 10s · loop seamless · sem áudio
- **Prompt:**
```
A large organic blob of iridescent liquid glass floating slightly right of
center in a pure black void, seen in a wide panoramic composition with
generous empty black space around it. The glass surface shows holographic
thin-film reflections: electric blue, violet, magenta and warm amber light
sliding across as it slowly rotates and morphs. Soft glow emanating from
inside the glass illuminating nothing else — pure black everywhere around.
Cinematic wide shot, ultra realistic 3D render, 4K detail. Very slow elegant
motion, seamless perfect loop, fixed camera. No text, no logo, no watermark.
```

---

## IMAGENS (Nano Banana)

### I1 — `poster-blob.jpg`
- **Uso:** poster/primeiro frame do hero (aparece antes do 3D carregar) + fallback
- **Formato:** 1:1 · 1600×1600 · JPG alta qualidade
- **Prompt:**
```
A single organic blob of iridescent liquid glass floating in the center of a
pure black void. Highly reflective holographic surface with oily rainbow
thin-film reflections in electric blue, violet, magenta, teal and warm amber.
Soft internal glow, subtle caustics inside the glass. Studio black background,
no floor, no shadow. Cinematic macro photography look, shallow depth of field,
ultra realistic 3D render, octane style, extremely detailed.
No text, no logo, no watermark.
```

### I2 — `obj-01.png` (card "Compra e venda de alto volume")
- **Formato:** 1:1 · 1200×1200 · PNG · fundo preto
- **Prompt:**
```
A small sharp shard of iridescent crystal glass floating centered on a pure
black background, photographed like a precious jewel. Angular faceted surfaces
with holographic thin-film reflections in electric blue, violet and warm amber.
Soft glow around the edges, subtle reflection fading below the object.
Minimal premium 3D render, ultra realistic, studio lighting from the side,
centered composition with generous black space around.
No text, no logo, no watermark.
```

### I3 — `obj-02.png` (card "Liquidez profunda")
- **Formato:** 1:1 · 1200×1200 · PNG · fundo preto
- **Prompt:**
```
A torus ring made of liquid iridescent glass floating centered on a pure black
background, slightly tilted in perspective. Smooth glossy surface with
holographic oil-slick reflections shifting between blue, violet, magenta and
amber. Soft internal glow, elegant thin highlights on the curves. Minimal
premium 3D render, ultra realistic, studio lighting, centered composition with
generous black space around. No text, no logo, no watermark.
```

### I4 — `obj-03.png` (card "Liquidação rápida e segura")
- **Formato:** 1:1 · 1200×1200 · PNG · fundo preto
- **Prompt:**
```
A perfect sphere of dark polished chrome floating centered on a pure black
background. The mirror surface shows subtle iridescent oil-slick reflections:
thin streaks of electric blue, violet and warm amber light sliding across the
dark metal. Mostly dark with selective highlights, extremely elegant. Minimal
premium 3D render, ultra realistic, studio lighting, centered composition with
generous black space around. No text, no logo, no watermark.
```

### I5 — `obj-04.png` (card "Atendimento dedicado")
- **Formato:** 1:1 · 1200×1200 · PNG · fundo preto
- **Prompt:**
```
A rounded cube of translucent holographic glass floating centered on a pure
black background, slightly rotated to show three faces. Frosted glass interior
with soft internal glow, surface showing thin-film iridescent reflections in
blue, violet, magenta and amber. Elegant, minimal, premium. Ultra realistic
3D render, studio lighting, centered composition with generous black space
around. No text, no logo, no watermark.
```

### I6 — `security-vault.png` (seção "Segurança & Compliance")
- **Formato:** 4:5 (retrato) · 1400×1750 · PNG · fundo preto
- **Prompt:**
```
An abstract circular vault door made of dark brushed titanium metal, seen
frontally, centered on a pure black background. At the exact center of the
vault, a core of glowing iridescent glass emitting soft holographic light in
blue, violet and amber. Concentric metallic rings with fine machined details
around the core. Dramatic side lighting revealing the brushed metal texture,
mostly dark image with selective highlights. Premium minimal 3D render,
ultra realistic, vertical portrait composition. No text, no logo, no watermark.
```

### I7 — `og.jpg` (imagem de compartilhamento social / Open Graph)
- **Formato:** 1200×630 · JPG
- **Prompt:**
```
Wide cinematic composition on a pure black background: dark liquid chrome
waves flowing across the lower third of the frame, and a single small
iridescent liquid glass blob floating in the right third, glowing softly with
holographic blue, violet and amber reflections. Lots of empty black space in
the upper left area. Premium, minimal, luxurious. Ultra realistic 3D render,
4K detail. No text, no logo, no watermark.
```

### I8 — `favicon.svg`
- Já incluído no projeto (SVG desenhado à mão: losango com gradiente iridescente).
- Quando a marca existir, substituir por um export SVG do símbolo oficial.

---

## Checklist de substituição

| Arquivo | Pasta destino | Status |
| --- | --- | --- |
| `hero-blob.mp4` | `public/assets/video/` | opcional (3D é real-time) |
| `chrome-waves.mp4` | `public/assets/video/` | pendente |
| `blob-cta.mp4` | `public/assets/video/` | pendente |
| `poster-blob.jpg` | `public/assets/img/` | placeholder incluído |
| `obj-01.png` … `obj-04.png` | `public/assets/img/` | placeholder incluído |
| `security-vault.png` | `public/assets/img/` | placeholder incluído |
| `og.jpg` | `public/assets/img/` | placeholder incluído |
