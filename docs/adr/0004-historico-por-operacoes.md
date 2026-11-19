# ADR-0004 — Histórico por operações, uma pilha por página

**Status:** aceita

## Decisão
- Operações: `ADD_ELEMENTS`, `REMOVE_ELEMENTS` e `REPLACE_ELEMENTS`, sempre com `{ index, element }`.
  - `removed[].index` refere-se ao estado **anterior** e `added[].index` ao estado **posterior**.
  - Aplicar: remover em ordem decrescente de índice e inserir em ordem crescente.
  - Inverter: trocar `removed` por `added`. O undo restaura cada elemento na camada original.
- A borracha que corta traços gera **um** `REPLACE_ELEMENTS` por gesto.
- **Uma pilha por página.** Desfazer só afeta a página ativa, como num caderno de verdade. Uma pilha
  global obrigaria o undo a "pular" de página, o que surpreende o usuário.
- Operações estruturais de páginas (criar, excluir, duplicar, reordenar, trocar fundo) não entram no
  histórico do MVP. A aplicação confirma antes de excluir uma página.
- O limite por página (`maxHistoryPerPage`) descarta as operações mais antigas.

## Consequências
Os elementos são imutáveis e compartilhados entre o documento e o histórico, então o custo de memória é
proporcional ao que foi alterado. Mover e transformar elementos no futuro podem usar
`REPLACE_ELEMENTS` (o mesmo id em `removed` e `added`) ou ganhar um `UPDATE_ELEMENTS` dedicado.
