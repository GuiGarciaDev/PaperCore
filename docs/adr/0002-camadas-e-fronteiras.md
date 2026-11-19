# ADR-0002 — Camadas e fronteiras verificadas por ferramenta

**Status:** aceita

## Decisão
Camadas: `core` → `rendering` → `interaction` → `engine` (e, depois, `storage` e `react`).

- `core` não importa nenhuma outra camada e **não usa DOM**. Isso é verificado de duas formas:
  - `tsconfig.core.json` compila só `src/core` **sem a lib DOM**. Qualquer `window`, `document`,
    `console` ou `Path2D` no core quebra o `npm run typecheck`.
  - O ESLint (`no-restricted-imports`) proíbe o core de importar `rendering`, `interaction`, `storage`,
    `react` e `engine`, e proíbe `rendering` de importar `interaction`/`engine`.
- A API pública sai só de `src/index.ts`. Classes internas (store, renderer, controlador) não são
  exportadas.

## Consequências
A fronteira não depende de disciplina, e uma violação quebra o CI. O core pode ser testado em
Node puro, sem jsdom.
