# ADR-0007 — Entrada, política de ponteiros e gestos

**Status:** aceita

## Decisão
- Os eventos DOM são normalizados em `InputSample` (puro). As ferramentas só consomem amostras e são
  testáveis sem navegador, inclusive com pressão simulada, algo que o Playwright não reproduz bem.
- Pressão: `pen` usa a pressão real (mínimo 0,05). `mouse`/`touch` são tratados como sem pressão.
- **Um ponteiro desenha por vez.**
- **Rejeição de palma ligada por padrão**: depois de ver um `pen`, o toque passa a fazer pan e pinça.
- Pinça com dois dedos faz zoom e pan. Um segundo toque durante um traço feito com o dedo cancela o
  traço.
- `pointercancel` **descarta** o traço (o navegador assumiu o gesto). `lostpointercapture` sem `pointerup`
  e `blur` **finalizam** o traço, preservando a tinta.
- Atalhos de teclado são **opt-in** e restritos à superfície com foco (`tabIndex`). Nunca escutam
  `window`.
