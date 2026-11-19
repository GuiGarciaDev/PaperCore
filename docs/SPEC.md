# PaperCore — Especificação revisada

> Esta é a especificação consolidada do motor. Ela substitui o documento inicial e já incorpora
> as correções levantadas na revisão do planejamento. As decisões de arquitetura com mais contexto
> estão em [`docs/adr`](./adr).

## 1. Objetivo

PaperCore é uma biblioteca de desenho vetorial para a web, focada na experiência de um **caderno
digital** para resolver exercícios à mão (matemática, física, química…).

- Repositório independente. A aplicação de estudos o consome como dependência local
  (`"papercore": "file:../PaperCore"`) e, quando a API estabilizar, via npm.
- O motor **não conhece** usuários, questões, tentativas, autenticação, backend nem regras de negócio.
- O documento é **dado vetorial estruturado**. O canvas é só uma visualização, nunca a fonte da verdade.
- Prioridade absoluta: escrita fluida, precisa e confiável. Expansão para editor gráfico vem depois.

## 2. Princípios

1. Core sem React e **sem DOM** (verificado por ferramenta, ver §3).
2. Canvas 2D como renderizador inicial.
3. Coordenadas sempre em **unidades lógicas da página**, nunca em pixels físicos.
4. Documento com várias páginas, cada uma com tamanho próprio.
5. Histórico por **operações** (nunca snapshots por alteração), **uma pilha por página**.
6. Persistência **plugável e opcional**, por página, fora do core.
7. Modo **somente leitura** como funcionalidade de primeira classe.
8. API pública pequena. Nada de funcionalidade futura implementada "por precaução".

## 3. Arquitetura e fronteiras

```
src/
├── core/          modelo, validação, migrações, serialização, operações, histórico, store, geometria
├── rendering/     viewport (transformações), camadas de canvas, fundos, traços
├── interaction/   normalização de entrada, política de ponteiros, ferramentas, controlador de ponteiros
├── storage/       (Etapa 6) interface de adaptador, IndexedDB, memória, autosave
├── react/         (Etapa 7) <DrawingSurface> e hooks
├── engine.ts      cola as camadas: createPaperCore(container, options)
└── index.ts       API pública
playground/        app de demonstração (não é publicado)
tests/             testes unitários (Vitest)
```

Regras de dependência (ADR-0002):

| Camada | Pode importar |
|---|---|
| `core` | nada além de `core` — **sem DOM** (checado por `tsconfig.core.json`, que não inclui a lib DOM) |
| `rendering` | `core` |
| `interaction` | `core`, `rendering` |
| `storage` | `core` |
| `react` | API pública do pacote |

As regras são aplicadas pelo ESLint (`no-restricted-imports`) e pelo `npm run typecheck`.

**Subpaths do pacote** (`exports`): `papercore` (core e engine), `papercore/storage` (Etapa 6) e
`papercore/react` (Etapa 7). React será `peerDependency` **opcional**: quem não usa React não o instala.

## 4. Modelo de documento (schema v1)

```ts
interface PaperDocument {
  id: string;
  schemaVersion: 1;            // versão ESTRUTURAL do formato (≠ revisão de persistência do app)
  defaultPageSize: Size;       // usado só para criar páginas novas
  pages: PaperPage[];          // a ordem do array É a ordem das páginas (sem campo "número")
}

interface PaperPage {
  id: string;
  size: Size;                  // tamanho lógico por página (permite proporções diferentes)
  background: PageBackground;  // configuração, nunca imagem; separado dos elementos
  elements: PaperElement[];    // a ordem do array É a ordem de desenho (z-order)
}

type PageBackground =
  | { type: "blank"; color: HexColor }
  | { type: "ruled"; color: HexColor; lineColor: HexColor; spacing: number; lineWidth: number }
  | { type: "grid";  color: HexColor; lineColor: HexColor; spacing: number; lineWidth: number };

interface StrokeElement {
  id: string;
  type: "stroke";
  style: { color: HexColor; width: number }; // width em UNIDADES LÓGICAS (escala com o zoom)
  hasPressure: boolean;
  points: number[];            // plano: [x, y, p, x, y, p, …] — passo fixo 3, 2 casas decimais
}

type PaperElement = StrokeElement; // união discriminada por `type`: texto, formas e imagens entram aqui
```

Regras:
- `HexColor` aceita **somente** `#rrggbb`. Isso evita injeção quando houver exportação SVG e mantém a
  tinta opaca.
- Pontos fora da página são recortados nos limites durante a captura. Pressão em `[0, 1]`. Quando
  `hasPressure = false`, a pressão gravada é `0.5` e é ignorada na renderização.
- Coordenadas e pressão são quantizadas em 2 casas na finalização do traço, então o que está em memória
  é igual ao que é serializado.
- Bounding boxes ficam em **cache em memória** (WeakMap), nunca no documento.
- IDs: `[A-Za-z0-9_-]{1,64}`, únicos no documento inteiro. São gerados com `crypto.randomUUID` quando
  disponível, com fallback em `crypto.getRandomValues` (contextos HTTP inseguros, como o iPad acessando o
  computador pela rede local).

### 4.1 Validação, migração e importação
- `validateDocument` é **estrita**: rejeita chaves desconhecidas, tipos errados, números não finitos,
  cores inválidas, IDs duplicados e limites excedidos. Ela devolve uma **cópia normalizada**, montada só
  com campos conhecidos, então nada importado é usado por referência.
- `migrateDocument` aplica migrações puras `v → v+1`. Uma versão **mais nova** que a da biblioteca é
  rejeitada com `UNSUPPORTED_VERSION`, nunca aceita silenciosamente.
- `parseDocument(json)` verifica o tamanho antes do `JSON.parse`, depois migra e valida.
- Erros usam `PaperCoreError` com `code` (`INVALID_DOCUMENT`, `UNSUPPORTED_VERSION`, `IMPORT_TOO_LARGE`,
  `INVALID_JSON`, `READ_ONLY`, `PAGE_NOT_FOUND`, `LAST_PAGE`, `LIMIT_EXCEEDED`, `INVALID_ARGUMENT`).

## 5. Operações e histórico (ADR-0004)

```ts
type ElementOperation =
  | { type: "ADD_ELEMENTS";     pageId; added:   { index; element }[] }
  | { type: "REMOVE_ELEMENTS";  pageId; removed: { index; element }[] }
  | { type: "REPLACE_ELEMENTS"; pageId; removed: { index; element }[]; added: { index; element }[] };
```

- Os índices são guardados: `removed` usa índices do estado anterior e `added` usa os do estado
  posterior. Por isso o undo restaura cada elemento **na mesma camada**.
- A borracha que corta traços gera **um** `REPLACE_ELEMENTS` por gesto (remove o original e adiciona os
  pedaços).
- Um traço inteiro vira **uma** operação (nunca uma por ponto).
- **Uma pilha de undo/redo por página.** O undo só afeta a página ativa, e operações de uma página nunca
  tocam outra.
- Limite configurável por página (`maxHistoryPerPage`).
- `loadDocument` reinicia todo o histórico. Excluir uma página descarta o histórico dela.
- **Operações estruturais** (criar, excluir, duplicar e reordenar páginas, trocar fundo) **não entram no
  histórico do MVP**. Quem consome a API deve pedir confirmação antes de excluir uma página. "Limpar
  página" entra no histórico (é um `REMOVE_ELEMENTS`).

## 6. Store e eventos

`PaperStore` (core) guarda o documento com **atualizações imutáveis por página**: cada operação gera um
novo objeto de página e de documento, e os elementos são compartilhados. Snapshots são baratos e
seguros para `useSyncExternalStore`.

Evento `change`, que é tudo o que a aplicação precisa para persistir por página:

```ts
interface DocumentChange {
  reason: "user" | "undo" | "redo" | "load";
  changedPageIds: string[];
  addedPageIds: string[];
  deletedPageIds: string[];
  orderChanged: boolean;
}
```

`reason: "load"` **não** deve marcar o documento como sujo nem disparar autosave.

**Somente leitura** é aplicado no store: com `readOnly`, toda mutação lança `READ_ONLY`, e na engine as
ferramentas de edição viram pan. Zoom, pan e navegação entre páginas continuam funcionando.
Pode ser alterado em tempo de execução (`engine.setReadOnly(true)`).

## 7. Renderização (ADR-0006)

- **Três camadas de canvas**: fundo, traços confirmados e traço ao vivo. Desenhar só redesenha a camada
  ao vivo. A camada de traços só é redesenhada quando o documento ou o viewport mudam.
- **O canvas tem sempre o tamanho do viewport** (container × DPR), nunca página × zoom. O zoom é só uma
  transformação. O DPR efetivo é limitado para que o canvas não passe de ~16,7 M pixels (limite do
  Safari iOS, acima do qual o canvas fica em branco sem erro).
- O viewport é guardado como `{ zoom, centerX, centerY }` em coordenadas lógicas. A transformação
  `logical → screen` é calculada num único lugar (`rendering/viewport.ts`, funções puras e testadas).
  Redimensionar o container preserva o ponto central e o zoom.
- `zoom = 1` significa "página encaixada na largura" (com largura máxima). O centro é limitado para a
  página não sumir da tela.
- Traços: `Path2D` em cache por elemento (WeakMap, porque os elementos são imutáveis) e descarte dos que
  estão fora da área visível usando bounding box.
- Fundo pautado/quadriculado desenhado só na área visível, com espessura mínima de 1 pixel físico.
- Renderização agendada com `requestAnimationFrame` (no máximo um quadro por frame).

## 8. Traço (ADR-0005)

- **Armazenamos os pontos de entrada** (filtrados por distância mínima em pixels de tela) e **suavizamos
  na renderização**. Assim o algoritmo pode melhorar sem migrar dados.
- A geometria é **implementação própria** (`core/geometry/strokeOutline.ts`, função pura): suavização
  dos pontos e raios, contorno com raio variável pela pressão, pontas arredondadas e juntas reforçadas
  em curvas fechadas. Ela fica isolada atrás de uma função para poder ser trocada.
- Raio = `width/2 × (hasPressure ? 0.35 + 1.3·p : 1)`. Pressão 0,5 equivale à espessura nominal.
- Se o traço atingir `maxPointsPerStroke` durante o desenho, ele **continua em um novo traço** em vez de
  descartar pontos.

## 9. Entrada (ADR-0007)

- Os eventos DOM viram `InputSample { x, y, pressure, hasPressure, kind, time }`. As ferramentas só
  consomem amostras, então é possível testá-las sem DOM, inclusive com pressão de caneta simulada.
- Usa Pointer Events, `setPointerCapture`, `getCoalescedEvents()` quando disponível,
  `touch-action: none`, sem menu de contexto nem seleção de texto na superfície.
- **Um único ponteiro desenha por vez.**
- **Rejeição de palma (padrão ligado):** depois que uma caneta (`pointerType === "pen"`) é detectada, o
  toque deixa de desenhar e passa a fazer pan. Também é configurável quais tipos podem desenhar
  (`drawWith`).
- **Pinça com dois dedos** faz zoom e pan. Um segundo toque durante um traço feito com o dedo
  **cancela** esse traço. O dedo que sobra depois da pinça é ignorado até ser levantado.
- `pointercancel` descarta o traço em andamento. `lostpointercapture` sem `pointerup` e `blur` da janela
  **finalizam** o traço (preservam a tinta).
- Roda do mouse faz pan. `Ctrl`/`⌘` + roda faz zoom no cursor. Botão do meio faz pan.
- **Atalhos de teclado são opt-in** (`keyboardShortcuts: true`) e só funcionam com a superfície em foco.
  Nunca escutam `window`, para não conflitar com campos da aplicação.

## 10. Ferramentas

MVP: `pen`, `pan` e `eraser` (Etapa 4). Configurações centralizadas, com limites em `DEFAULT_LIMITS`:

- Caneta: cor (`#rrggbb`) e espessura (unidades lógicas).
- Borracha: tamanho em **pixels de tela**, para ter a mesma sensação em qualquer zoom. A colisão
  considera o raio da borracha somado ao raio do traço. Pedaços com menos de 2 pontos são descartados, e
  as pontas criadas pelo corte não são afinadas.

## 11. Persistência (Etapa 6, ADR-0008)

Ela fica fora do core, no subpath `papercore/storage`:

```ts
interface StorageAdapter {
  load(documentId: string): Promise<PaperDocument | null>;
  savePages(documentId: string, pages: PaperPage[], meta: DocumentMeta): Promise<void>; // só as sujas
  deletePages(documentId: string, pageIds: string[]): Promise<void>;
  deleteDocument(documentId: string): Promise<void>;
  list(): Promise<string[]>;
}
```

- Adaptadores incluídos: IndexedDB e memória. A aplicação de estudos implementa o **próprio adaptador**
  (grava localmente e põe na fila do servidor).
- Autosave com debounce, salvando só as páginas sujas. Estados: `idle | dirty | saving | saved | error`.
- **Correção da corrida:** cada salvamento guarda uma "geração". Se houve mudanças durante o `saving`,
  o estado volta para `dirty` e outro salvamento é agendado. Nunca vai para `saved` com mudanças
  pendentes.
- Há flush em `visibilitychange` e `pagehide`, e `flush(): Promise<void>` é público (o app faz flush
  antes de submeter uma resposta).
- `saved` significa "salvo no adaptador", **não** "sincronizado com o servidor". O indicador de
  sincronização é da aplicação.

## 12. Integração React (Etapa 7)

- A biblioteca entrega `<DrawingSurface>`, `useDrawingEngine` e `useEngineState`
  (`useSyncExternalStore`).
- **Toolbar, navegação de páginas e controles de zoom ficam no playground** como exemplo de uso. A
  aplicação consumidora usa o próprio design system.
- O componente é testado em `StrictMode`. `destroy()` é idempotente e remove listeners, observers, rAF e
  timers.

## 13. Integração local com a aplicação

- `"papercore": "file:../PaperCore"` (o npm cria um symlink), com `npm run build:watch` no motor.
- **Obrigatório na aplicação:** `resolve.dedupe: ["react", "react-dom"]` no Vite. Sem isso, o symlink
  faz o app carregar duas cópias do React ("Invalid hook call").
- O pacote não acessa `window`/`document` no topo dos módulos, então é seguro importá-lo em SSR.

## 14. Limites (centralizados em `core/config.ts`)

| Limite | Padrão |
|---|---|
| Páginas por documento | 200 |
| Elementos por página | 5 000 |
| Pontos por traço | 4 000 |
| Tamanho de importação | 20 MB (caracteres) |
| Operações de histórico por página | 200 |
| Zoom | 0,25× a 8× |
| Espessura da caneta | 0,5 a 40 |
| Tamanho da borracha | 4 a 120 px |
| Tamanho de página | 100 a 10 000 unidades |

Todos podem ser sobrescritos por `options.limits`.

## 15. Fora do escopo do MVP

Miniaturas de páginas, reordenação de páginas na UI, exportação PNG/SVG/PDF, seleção, texto, formas,
imagens, histórico persistente, colaboração, WebGL. O modelo, porém, já os permite: união discriminada
de elementos, operações com índice e `schemaVersion` com migrações.

## 16. Etapas

| # | Etapa | Entregável verificável |
|---|---|---|
| 1 | Fundação | Tooling, regras de fronteira, modelo, validação, migrações, serialização, **operações e histórico**, store |
| 2 | Renderização | Viewport, camadas, DPR, fundos, zoom/pan, redimensionamento. Playground com página visível |
| 3 | Entrada e caneta | `InputSample`, caneta com pressão, suavização, cancelamento, política de ponteiros e palma, pinça |
| 4 | Borracha | Corte de traços, `REPLACE_ELEMENTS`, undo/redo |
| 5 | Páginas e leitura | Criar, excluir, duplicar e navegar, somente leitura, eventos `change` |
| 6 | Storage | Interface, memória, IndexedDB, autosave com geração, `flush()` |
| 7 | React e distribuição | `<DrawingSurface>`, hooks, toolbar no playground, consumo pelo app, Playwright, documentação |

Cada etapa termina com testes passando (`npm run check`) e verificação manual no playground.
