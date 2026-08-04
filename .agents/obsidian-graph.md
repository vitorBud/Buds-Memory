# Agente Obsidian Graph

## Missao

Transformar a Obsidian em ponto central do Buds Memory: visual forte,
organizado, interativo e fiel ao que a IA aprendeu.

## Arquivos Principais

- `front-end/src/components/BrainMap.tsx`
- `front-end/src/components/HomeBrain.tsx`
- `front-end/src/index.css`
- `front-end/src/types/index.ts`
- `front-end/src/services/api.ts`
- `Back-end/cognitive/knowledge_graph.py`
- `Back-end/cognitive/memory.py`
- `Back-end/cognitive/rag.py`
- `Back-end/cognitive_api.py`

## Regras

- Cada ponto visual deve representar conhecimento real quando possivel:
  memorias, documentos, entidades, topicos, projetos ou codebase.
- Nao crie grafo fake como fonte principal se existem dados reais no backend.
- A tela Obsidian deve ser grande, chamativa e usavel.
- Zoom, arraste, hover e clique devem funcionar em desktop e mobile.
- Painel de detalhes nao deve cobrir o grafo inteiro sem necessidade.
- Importar PDF/texto pela Obsidian deve atualizar memorias/grafo.
- Backup local deve ficar acessivel, mas sem poluir a tela.
- Preserve performance: muitos pontos, mas baixo travamento.

## Dados Usados

Frontend:

- `getCognitiveMemories(limit)`
- `getKnowledgeGraph(limit)`
- `getSessionKnowledge(session_id)`

Backend:

- `GET /api/cognitive/memory`
- `GET /api/cognitive/graph`
- `GET /api/sessions/<session_id>/knowledge`
- `POST /api/sessions/<session_id>/knowledge`

## Pontos Sensíveis

- O backend pode estar ligado ou desligado; o visual nao deve congelar inutilmente.
- Quando houver poucas memorias, mostrar estado vazio bonito.
- Quando houver muitas memorias, usar layout compacto tipo mapa de estrelas.
- Evite labels gigantes em todos os nos; use tooltip/detalhe para texto longo.
- Importancia pode influenciar tamanho, mas nao deve deixar pontos invisiveis.

## Validacao

```bash
cd front-end
npm run build
```

Testar manualmente:

- Obsidian com backend desligado.
- Obsidian com backend ligado.
- Zoom.
- Arraste/giro.
- Clique em memoria.
- Importacao de PDF/texto.
- Mobile Safari.

## Resultado Esperado

Uma Obsidian parecida com um cerebro vivo: cheia de pontos, conexoes, agrupamentos
e detalhes uteis, sem sobreposicoes ou controles quebrados.
