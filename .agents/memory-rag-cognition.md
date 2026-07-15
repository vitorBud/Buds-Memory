# Agente Memoria RAG Cognicao

## Missao

Melhorar o segundo cerebro do Aether Memory: memoria, perfil do usuario, RAG,
resumos persistentes, extracao cognitiva, documentos e busca contextual.

## Arquivos Principais

- `Back-end/cognitive/memory.py`
- `Back-end/cognitive/rag.py`
- `Back-end/cognitive/conversation.py`
- `Back-end/cognitive/detector.py`
- `Back-end/cognitive/summarizer.py`
- `Back-end/cognitive/user_profile.py`
- `Back-end/cognitive/search.py`
- `Back-end/database_v2.py`
- `Back-end/database.py`

## Regras

- Nao salve trivialidades como memoria importante.
- Core Memory nunca deve expirar nem ser apagada por prune automatico.
- Perfil do usuario deve responder perguntas como "qual e meu nome?" sem depender do LLM.
- RAG deve ajudar, nao forcar citacao de fonte em conversa casual.
- Para perguntas vagas, use perfil, historico recente, resumo persistente e metadados de documentos.
- Nao invente conteudo de PDFs ou codebase quando a busca nao encontrar evidencia.
- Embeddings semanticos devem continuar opcionais; BM25 offline precisa funcionar.
- Evite processamento pesado no caminho critico do chat.
- Tarefas demoradas devem rodar em background quando possivel.

## Fluxos Importantes

- Memorias: `memory.save_memory`, `memory.recall`, `memory.consolidate_session`.
- Perfil: `user_profile.update_from_text`, `user_profile.get_profile_context`.
- RAG: `rag.index_document`, `rag.hybrid_search`, `rag.build_rag_context`.
- Conversa: `conversation.prepare_session_context`.
- Resumo longo: `summarizer.maybe_update_conversation_summary`.
- Detector: `detector.process_chat_async`.

## Pontos Sensíveis

- `knowledge_sources` salva documento completo e metadados.
- `embeddings` salva chunks.
- `conversation_summaries` preserva conversas longas.
- `memories` tem `is_core`, `locked`, `user_confirmed`, origem e importancia.
- Respostas pessoais devem diferenciar nome do usuario e nome da IA.

## Validacao

```bash
cd Back-end
env PYTHONPYCACHEPREFIX=/private/tmp/aether_pycache ambiente/bin/python -m py_compile cognitive/*.py app.py
```

Testes manuais uteis:

- "qual e meu nome?"
- "quem e voce?"
- "o que voce aprendeu do PDF?"
- "resuma aquele documento"
- "onde esta a funcao login?"

## Resultado Esperado

O Aether Memory deve parecer mais inteligente porque lembra o que importa,
recupera contexto certo e sabe admitir quando nao possui informacao.
