# ADR-0006 — Viewport e camadas de canvas

**Status:** aceita

## Decisão
- Estado do viewport: `{ zoom, centerX, centerY }`, com o centro em **coordenadas lógicas**. A
  transformação é derivada: `scale = fitScale × zoom` e `offset = centroDoContainer − centro × scale`.
  Redimensionar o container preserva o ponto central sem nenhum cálculo extra.
- Todas as conversões tela ↔ lógica ficam em `rendering/viewport.ts` (funções puras com testes). As
  ferramentas nunca calculam transformações por conta própria.
- **O canvas tem o tamanho do viewport**, nunca página × zoom. O DPR efetivo é reduzido se
  `largura × altura × DPR²` passar de 16 777 216 pixels, porque o Safari iOS deixa o canvas em branco
  acima do seu limite de memória, sem erro.
- Três camadas: fundo, traços confirmados e traço ao vivo. Durante a escrita só a camada ao vivo é
  redesenhada.
- `Path2D` em cache por elemento (WeakMap) e descarte por bounding box. Cache em bitmap durante pan/zoom
  só será feito se as medições mostrarem necessidade.

## Consequências
O zoom máximo não aumenta o uso de memória. Renderização incremental mais fina (regiões sujas, tiles)
pode ser adicionada dentro do renderer sem mudar o documento.
