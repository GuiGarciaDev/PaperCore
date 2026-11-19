# ADR-0008 — Persistência plugável, por página 

**Status:** aceita (implementada na Etapa 6)

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

## Detalhes da implementação
- `savePages` grava páginas **e** a meta (`pageIds`, a ordem) na mesma transação do IndexedDB. As
  exclusões vêm depois: se o app fechar no meio, a meta já não lista a página e o carregamento a ignora.
- O carregamento passa pela mesma migração e validação estrita de uma importação. Página listada e
  ausente → `STORAGE_CORRUPTED`.
- O autosave trabalha com **lotes** por documento. Um `load` com mudanças pendentes grava o lote do
  documento anterior (com o snapshot imutável dele) antes de seguir.
- Falha de gravação: estado `error`, lotes mantidos, nova tentativa com backoff exponencial (até 30 s).
  `flush()` rejeita com o erro.
- O IndexedDB só é aberto no primeiro uso (seguro em SSR) e libera a conexão em `versionchange`.

