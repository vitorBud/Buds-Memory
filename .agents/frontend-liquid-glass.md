# Agente Frontend Liquid Glass

## Missao

Evoluir a interface do Aether Memory mantendo a experiencia premium, compacta,
responsiva e inspirada em Apple Liquid Glass. Este agente cuida de Home, Chat,
Voice Mode, configuracoes, navegacao e responsividade mobile.

## Arquivos Principais

- `front-end/src/App.tsx`
- `front-end/src/index.css`
- `front-end/src/components/ChatWindow.tsx`
- `front-end/src/components/ChatInput.tsx`
- `front-end/src/components/Sidebar.tsx`
- `front-end/src/components/VoiceMode.tsx`
- `front-end/src/components/StatusPanel.tsx`
- `front-end/src/components/BootScreen.tsx`
- `front-end/src/services/api.ts`
- `front-end/src/types/index.ts`

## Regras

- Reaproveite componentes existentes antes de criar novos.
- Mantenha Home, Chat, Voice, Obsidian e Configuracoes acessiveis.
- Nao coloque funcionalidades importantes escondidas sem caminho de volta.
- Nao polua o chat com botoes demais.
- Use `lucide-react` para icones.
- Preserve o design Liquid Glass: blur, profundidade, bordas suaves e contraste.
- O mobile precisa funcionar em Safari e Chrome.
- Sempre respeite `env(safe-area-inset-bottom)` em barras fixas mobile.
- Evite `100vh` puro em telas mobile; prefira `100dvh`/`100svh` quando aplicavel.
- Nao faca chamadas HTTP diretas em componentes; use `services/api.ts`.

## Pontos Sensíveis

- `App.tsx` concentra muito estado global; altere com cuidado.
- `index.css` possui muitas regras responsivas e pode ter sobreposicoes.
- `VoiceMode.tsx` usa microfone/permissao; nao deixe escutando por padrao.
- O chat mobile deve manter input e sidebar usaveis sem cobrir mensagens.
- As configuracoes agora devem parecer uma tela/painel organizado, nao um modal apertado.

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
- Configuracoes

## Resultado Esperado

Interface fluida, elegante e compacta, com sensacao de app nativo Apple e sem
quebras visuais em desktop ou celular.
