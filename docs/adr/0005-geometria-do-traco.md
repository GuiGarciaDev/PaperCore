# ADR-0005 — Geometria do traço: implementação própria, suavização na renderização

**Status:** aceita

## Contexto
Havia duas opções: usar `perfect-freehand` (pequena e madura) ou escrever a nossa. O objetivo do
projeto inclui demonstrar engenharia e produzir conteúdo técnico.

## Decisão
- **Implementação própria**, isolada em `core/geometry/strokeOutline.ts` (função pura, sem DOM):
  1. Remove pontos consecutivos repetidos.
  2. Suaviza posições e raios com um filtro [¼, ½, ¼] em duas passadas, mantendo as extremidades.
  3. Calcula as normais pela tangente central e desloca cada ponto ±raio.
  4. Monta o polígono: lado esquerdo, ponta final (semicírculo), lado direito ao contrário e ponta
     inicial. O preenchimento usa a regra `nonzero`.
  5. Adiciona círculos de reforço onde a curva vira mais de ~75° **ou** onde o raio de curvatura local
     (comprimento do segmento ÷ ângulo de giro) é menor que o raio do traço. Nesses pontos o lado
     interno do contorno se dobra sobre si mesmo, e a regra `nonzero` deixaria um buraco. Isso foi
     descoberto por um teste: a suavização transforma voltas fechadas em curvas de raio pequeno, que o
     critério só de ângulo não detectava.
- **Armazenamos os pontos de entrada** e suavizamos na renderização. Isso permite melhorar o algoritmo
  sem migrar documentos. A contrapartida é que documentos antigos podem mudar levemente de aparência.
- Na captura, descartamos pontos a menos de ~0,75 px de tela do anterior. O último ponto é sempre
  mantido.

## Consequências
Se a qualidade não for suficiente, trocamos por `perfect-freehand` atrás da mesma assinatura
(`strokeOutline(points, width, hasPressure)`), sem tocar no renderizador nem no documento.
