# Agente Frontend Liquid Glass

## Missao

Evoluir a interface do Buds Memory mantendo a experiencia premium, compacta,
responsiva e inspirada em Apple Liquid Glass. Este agente cuida de Home, Chat,
Voice Mode, configuracoes, navegacao, responsividade mobile e performance no
Windows.

## Arquivos Principais

- `front-end/src/App.tsx`
- `front-end/src/tailwind.css`
- `front-end/src/styles/`
- `front-end/src/components/ChatWindow.tsx`
- `front-end/src/components/ChatInput.tsx`
- `front-end/src/components/Sidebar.tsx`
- `front-end/src/components/VoiceMode.tsx`
- `front-end/src/components/StatusPanel.tsx`
- `front-end/src/components/BootScreen.tsx`
- `front-end/src/services/api.ts`
- `front-end/src/types/index.ts`
- `front-end/src/utils/runtime.ts`

## Regras

- Reaproveite componentes existentes antes de criar novos.
- Mantenha Home, Chat, Voice, Obsidian, Focus, Map e Configuracoes acessiveis.
- Nao coloque funcionalidades importantes escondidas sem caminho de volta.
- Nao polua o chat com botoes demais.
- Use `lucide-react` para icones.
- Preserve o design Liquid Glass no Mac e use o perfil Windows quando a UI pesar.
- O mobile precisa funcionar em Safari e Chrome.
- Sempre respeite `env(safe-area-inset-bottom)` em barras fixas mobile.
- Evite `100vh` puro em telas mobile; prefira `100dvh`/`100svh` quando aplicavel.
- Nao faca chamadas HTTP diretas em componentes; use `services/api.ts`.
- No Windows, evite `backdrop-filter`, `filter: blur`, sombras grandes e
  animacoes em areas que repintam durante digitacao, streaming ou troca de tela.
- No Windows, nao medir `scrollHeight` do textarea a cada tecla.

## Pontos Sensíveis

- `App.tsx` concentra muito estado global; altere com cuidado.
- `tailwind.css` concentra tokens/base e regras responsivas globais; os módulos
  em `src/styles/` concentram classes por tela.
- `tailwind.css` tem perfil `:root[data-platform='windows']`; mantenha essa camada
  no fim do arquivo para ganhar prioridade.
- `VoiceMode.tsx` usa microfone/permissao; nao deixe escutando por padrao.
- O chat mobile deve manter input e sidebar usaveis sem cobrir mensagens.
- As configuracoes agora devem parecer uma tela/painel organizado, nao um modal apertado.
- `HomeBrain.tsx` e `BrainMap.tsx` usam Three.js; no Windows mantenha pixel ratio
  baixo, antialias controlado e FPS limitado.

## Validacao

```bash
cd front-end
npm run build
```

Quando mexer em mobile, testar visualmente:

- Home
- Chat com sidebar aberta/fechada
- Voice Mode
- Obsidian
- Focus
- Map
- Configuracoes

## Resultado Esperado

Interface fluida, elegante e compacta, com sensacao de app nativo Apple e sem
quebras visuais em desktop ou celular. No Windows, fluidez tem prioridade sobre
blur e efeitos caros.
