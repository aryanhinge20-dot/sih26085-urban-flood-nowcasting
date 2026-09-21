# Smart India Hackathon browser icons — source

Downloaded 2026-09-21 from the official Smart India Hackathon website. The files are unmodified:

| File here | Official URL |
|---|---|
| `sih-favicon-official.png` (57×58) | https://sih.gov.in/img/favicon-sih.png (the site's own favicon) |
| `sih-logo-official.png` (181×92) | https://sih.gov.in/img1/SIH-Logo.png |

Derived browser icons in `frontend-react/public/`. None is redrawn, recoloured or stretched; each is only centred on
a square canvas and resized:

| Icon | Made from |
|---|---|
| `favicon.ico` (16, 32, 48 px), `favicon-16x16.png`, `favicon-32x32.png` | `sih-favicon-official.png`, centred on a transparent square, downscaled |
| `apple-touch-icon.png` (180×180) | the bulb mark cropped from `sih-logo-official.png` (pixels 2–74 × 4–85), centred on white with a 12 % margin |

The largest official copy of the mark is about 82 px tall, so the 180 px icon is an upscale and is slightly soft.
A vector or high-resolution file from the SIH organisers would replace it. No web manifest exists, so no 192/512 px
PWA icons are generated. The FloodNet logo and header inside the app are unchanged.
