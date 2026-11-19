# PaperCore

Motor de desenho vetorial para **cadernos digitais** na web: escrita à mão com caneta sensível à
pressão, páginas com fundo pautado ou quadriculado, histórico por operações e renderização em Canvas 2D.
O core não depende de React nem de DOM.

> Status: **as 7 etapas do MVP concluídas**: fundação, renderização, caneta, borracha que corta
> traços, páginas e somente leitura, persistência com autosave, componente React e testes de ponta a
> ponta. Veja o [plano](docs/SPEC.md#16-etapas).

## Testar no navegador

```bash
npm install
npm run dev          # abre o playground em http://localhost:5173
```

O playground importa o código-fonte direto, então qualquer mudança em `src/` aparece na hora.

**No tablet ou celular (mesma rede Wi-Fi):**

```bash
npm run dev:lan      # HTTPS na rede local; abra o endereço "Network" que o Vite mostrar
```

O navegador vai alertar sobre o certificado autoassinado. Isso é esperado em desenvolvimento. O HTTPS
é necessário porque algumas APIs só existem em contexto seguro.

No console do playground, `paper` é o motor (por exemplo, `paper.getDocument()`). O playground grava
o documento no IndexedDB do navegador: recarregar a página reabre o último caderno.

## Scripts

| Script | O que faz |
|---|---|
| `npm run dev` | Playground com hot reload |
| `npm run dev:lan` | Playground com HTTPS acessível pela rede local |
| `npm test` | Testes unitários (Vitest; engine e React em happy-dom) |
| `npm run test:e2e` | Testes de ponta a ponta no playground (Playwright, com o Chrome instalado) |
| `npm run typecheck` | Tipos de todo o projeto **e** do core sem a lib DOM |
| `npm run lint` | ESLint, incluindo as regras de fronteira entre camadas |
| `npm run build` | Gera `dist/` (ESM + `.d.ts`) |
| `npm run build:watch` | Build contínuo, para uso com o link local |
| `npm run check` | Tudo acima, em sequência |

## Uso

```ts
import { createPaperCore } from "papercore";

const engine = createPaperCore(document.querySelector("#caderno")!, {
  document: documentoSalvo,   // opcional
  keyboardShortcuts: true,    // Ctrl/⌘+Z só com a superfície em foco
});

engine.on("change", (change) => {
  // change.reason: "user" | "undo" | "redo" | "load"
  // change.changedPageIds: salve só essas páginas
});

engine.setPenStyle({ color: "#2563eb", width: 4 });
engine.setReadOnly(true);       // por exemplo, depois que a resposta foi submetida
const json = engine.exportJSON();
engine.destroy();
```

O container precisa ter tamanho definido pelo CSS. O motor cria e gerencia os canvases dentro dele.

### Persistência (`papercore/storage`)

```ts
import { createAutosave, IndexedDbStorageAdapter } from "papercore/storage";

const storage = new IndexedDbStorageAdapter();
const salvo = await storage.load(documentId);            // null se não existir
const engine = createPaperCore(container, { document: salvo ?? undefined });
const autosave = createAutosave(engine, storage);        // debounce + só páginas alteradas
if (!salvo) await autosave.saveAll();                     // primeiro salvamento

autosave.on("state", ({ status }) => indicador(status)); // idle | dirty | saving | saved | error
await autosave.flush();                                   // antes de enviar uma resposta, por exemplo
```

O app pode implementar o próprio `StorageAdapter` (por exemplo, gravar localmente e enfileirar para
o servidor). `saved` significa "gravado no adaptador", não "sincronizado".

### React (`papercore/react`)

```tsx
import { DrawingSurface, useEngineState } from "papercore/react";

function Caderno() {
  const [engine, setEngine] = useState<PaperCore | null>(null);
  const state = useEngineState(engine);
  return (
    <>
      <button disabled={!state?.canUndo} onClick={() => engine?.undo()}>Desfazer</button>
      <DrawingSurface options={{ keyboardShortcuts: true }} onEngine={setEngine} />
    </>
  );
}
```

React é `peerDependency` opcional: quem usa só `papercore` não precisa dele. A toolbar fica com a
aplicação (o playground é o exemplo).

## Usar em outro projeto (link local)

```jsonc
// package.json do projeto consumidor
"dependencies": { "papercore": "file:../PaperCore" }
```

Rode `npm run build:watch` aqui. No Vite do projeto consumidor, configure
`resolve.dedupe: ["react", "react-dom"]`: sem isso, o symlink faz o app carregar duas cópias do React
(motivo no [ADR-0001](docs/adr/0001-repositorio-separado.md)).

## Arquitetura

```
src/core/          modelo, validação, migrações, operações, histórico, store, geometria  (sem DOM)
src/rendering/     viewport, camadas de canvas, fundos, traços
src/interaction/   entrada normalizada, política de ponteiros, ferramentas, gestos
src/storage/       adaptadores (memória, IndexedDB) e autosave          → papercore/storage
src/react/         <DrawingSurface>, useDrawingEngine, useEngineState   → papercore/react
src/engine.ts      junta tudo em createPaperCore()
playground/        app de demonstração (visual baseado no estudo de UI da Womp)
e2e/               testes Playwright no playground
```

- [Especificação revisada](docs/SPEC.md)
- [Decisões de arquitetura (ADRs)](docs/adr)

## Licença

MIT
