# ADR-0008 — Persistência plugável, por página (planejada para a Etapa 6)

**Status:** proposta

## Decisão
- A persistência fica no subpath `papercore/storage`. O core funciona sem ela.
- O adaptador salva **páginas sujas**, não o documento inteiro (`savePages`). Isso casa com a
  sincronização por página da aplicação (snapshot por página com revisão).
- O autosave usa uma "geração" incrementada a cada mudança. Ao terminar um salvamento, se a geração
  avançou, o estado volta para `dirty` em vez de `saved`.
- Há flush em `visibilitychange`/`pagehide` e `flush()` público.
- Mudanças com `reason: "load"` não sujam o documento.
- `saved` = "persistido no adaptador". A sincronização com o servidor é exclusiva da aplicação, que pode
  implementar o próprio adaptador.
