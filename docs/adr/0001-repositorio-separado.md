# ADR-0001 — Repositório separado e consumo local

**Status:** aceita

## Contexto
O motor de desenho é a parte tecnicamente mais rica do produto e tem uma fronteira natural: não
depende de nenhuma regra de negócio da plataforma de estudos. Também queremos divulgá-lo de forma
independente, com playground, posts e futura publicação no npm.

## Decisão
- O PaperCore vive num repositório próprio. A aplicação o consome por `"papercore": "file:../PaperCore"`
  (o npm cria um symlink) durante todo o MVP, com `npm run build:watch` rodando no motor.
- A publicação no npm só acontece quando a API passar algumas semanas sem mudanças incompatíveis.
- A aplicação consumidora **deve** configurar `resolve.dedupe: ["react", "react-dom"]` no Vite. O
  symlink faz o app enxergar o `node_modules` do motor, e sem dedupe carregam-se duas cópias do React.

## Consequências
- Mudanças que tocam os dois lados viram dois commits. Com o link local não há ciclo de release.
- Toda feature pedida pelo app passa pela pergunta "isso é genérico?". Regras do app (por exemplo,
  "travar após submissão") ficam no app, e o motor só oferece o mecanismo (`readOnly`).
