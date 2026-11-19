# ADR-0003 — Modelo do documento

**Status:** aceita

## Decisões
1. **Tamanho por página** (`page.size`). `document.defaultPageSize` serve só para páginas novas. Isso
   permite proporções diferentes por página.
2. **Sem campo "número da página"**: a ordem do array é a ordem das páginas. Guardar as duas coisas
   causaria divergência.
3. **Pontos em array plano com passo fixo 3** (`[x, y, p, …]`) e `hasPressure` no traço. Ocupa cerca de
   3× menos memória que objetos `{x, y, pressure}` e gera um JSON menor. Usamos passo fixo (pressão 0,5
   quando não há) para simplificar a leitura, ao custo de ~33% a mais em traços de mouse.
4. **Quantização em 2 casas** na finalização do traço. O documento em memória é idêntico ao serializado,
   o que torna o round-trip exato.
5. **Cores apenas `#rrggbb`**. Uma futura exportação SVG interpolaria a cor em atributos, e aceitar
   qualquer string seria um vetor de injeção. Tinta opaca também simplifica a renderização.
6. **Espessura da caneta em unidades lógicas**: o traço escala com o zoom, como no papel.
7. **`schemaVersion` ≠ revisão de persistência.** A versão do schema descreve o formato. A revisão
   (controle otimista de concorrência) é responsabilidade de quem persiste.
8. **Validação estrita com cópia normalizada.** Chaves desconhecidas são rejeitadas. O resultado é
   montado só com campos conhecidos, para que dados importados nunca sejam usados por referência
   (também evita `__proto__` vindo do JSON).
9. Validador escrito à mão, sem Zod. Para um único tipo de elemento, uma dependência não se justifica.

## Extensão
Novos elementos entram na união `PaperElement` (discriminada por `type`), com validador e renderizador
próprios. Novos campos obrigatórios exigem `schemaVersion + 1` e uma migração pura `v → v+1`.
