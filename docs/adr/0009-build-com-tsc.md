# ADR-0009 — Build da biblioteca com `tsc`

**Status:** aceita

## Contexto
A spec original sugeria Vite em library mode, e a revisão sugeria tsup. O Vite não gera `.d.ts` sem
plugin, e o tsup está em modo de manutenção.

## Decisão
- A biblioteca é compilada com **`tsc`** (`tsconfig.build.json`): ESM, um arquivo por módulo, `.d.ts`,
  declaration maps e source maps. Não há bundling: quem consome já tem um bundler, e manter os módulos
  separados favorece o tree-shaking.
- Os imports internos usam a extensão `.js` (`moduleResolution: NodeNext`), então o `dist` funciona tanto
  em bundlers quanto no Node.
- O Vite é usado só para o playground.

## Consequências
Uma dependência a menos. Se no futuro precisarmos de CSS empacotado ou de um bundle UMD, reavaliamos.
