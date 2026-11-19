# ADR-0010 — Borracha que corta traços

**Status:** aceita

## Contexto
A spec pede uma borracha que remova **partes** de um traço, não o traço inteiro, sem transformar a
página em imagem, com undo/redo e considerando a espessura do traço e o tamanho da borracha.

## Decisão

### Geometria (`core/geometry/erase.ts`, pura, sem DOM)
- Cada movimento do ponteiro vira uma **passada**: um segmento entre a posição anterior e a atual, com
  o raio da borracha (uma "cápsula"). Movimentos rápidos não pulam traços.
- Um ponto é apagado se `distância(ponto, passada) ≤ raio da borracha + raio do traço naquele ponto`.
  Assim a espessura real (inclusive com pressão) entra na colisão.
- **Subdivisão local:** segmentos do traço mais longos que `raio/2` e próximos da passada são
  subdivididos antes do teste. Sem isso, um traço de 2 pontos (uma linha reta rápida) seria apagado
  inteiro ao ser tocado no meio. Só os segmentos próximos são subdivididos, então o traço não cresce
  sem necessidade.
- Sequências de pontos não apagados viram **pedaços** com novos ids, o mesmo estilo e a pressão
  original nas pontas (o corte não afina o traço). Pedaços com menos de 2 pontos são descartados. Um
  pedaço que passaria de `maxPointsPerStroke` é dividido, repetindo o ponto de junção.
- Pré-filtro por bounding box: só traços cuja caixa cruza a da passada são testados.

### Gesto (`core/eraseSession.ts`)
- Durante o gesto, uma `EraseSession` aplica as passadas sobre uma **cópia de trabalho** da página. O
  store não muda, e o renderer mostra essa cópia como pré-visualização.
- Ao soltar, a sessão compara a página original com a cópia e gera **uma única**
  `REPLACE_ELEMENTS`: `removed` = originais que sumiram (índices anteriores) e `added` = elementos novos
  (índices posteriores). Pedaços criados e apagados no mesmo gesto nunca aparecem na operação. Um
  undo desfaz o gesto inteiro, e os elementos voltam à camada original.
- `pointercancel` descarta a sessão sem tocar no documento.

### Interação
- O tamanho da borracha é em **pixels de tela** (o raio lógico é `tamanho / 2 / escala`): a sensação é
  a mesma em qualquer zoom. Um cursor circular aparece na camada ao vivo durante o gesto.
- A **ponta traseira da caneta** (Surface, Wacom e similares chegam como `pointerType: "pen"` com
  `button: 5`) apaga sem precisar trocar de ferramenta.
- A rejeição de palma vale também para a borracha: depois de detectar caneta, o toque faz pan.

## Consequências
- Apagar não depende de pixels. O documento continua 100% vetorial e exportável.
- O custo por movimento é proporcional aos traços dentro da caixa da passada. Para páginas muito
  densas, um índice espacial pode substituir o pré-filtro linear sem mudar a API.
- A mesma `EraseSession` pode servir no futuro a uma borracha "por objeto" (remover o traço inteiro),
  bastando trocar a função de geometria.
