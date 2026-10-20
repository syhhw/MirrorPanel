# Preview 4 — janelas, redimensionamento e Companion

Validação em 19/10/2026, Windows x64, Moto G30 Android 12/API 31.

## Falhas confirmadas e correções

1. `window-action` consultava apenas sessões ativas. Quando `finishEntry`
   removia a sessão, fechar/minimizar/maximizar retornavam "Janela sem sessão".
   Agora um registro de janelas, com validação do webContents proprietário,
   existe até o fechamento da janela. Operações de captura/entrada continuam
   restritas a uma sessão ativa. Reiniciar reutiliza a janela existente.
2. O tamanho era proporcional somente ao receber metadata. O arraste permitia
   qualquer formato, gerando faixas pretas. `will-resize` agora preserva a
   proporção do vídeo, desconta os 86 px de controles, mantém a borda oposta e
   limita o tamanho à área útil. O mínimo foi reduzido para 240 px, com barra
   compacta. Restaurar após maximização também reenquadra o conteúdo.
3. Toda perda de socket do Companion virava `phone-stop`; exit code 0 também
   era tratado como intenção do usuário. Agora são `companion-lost` e
   `process-exit`, sujeitos a recuperação. A notificação não tem mais um
   deleteIntent que parava o serviço ao ser dispensada.
4. A Activity Android não tem mais o botão Parar. Mostra orientação, ilustração
   própria e estado da conexão. Fechar essa tela não interrompe a sessão.
   A notificação continua visível e abre informações. Permissão de áudio e
   mecanismos do próprio Android continuam disponíveis.
5. Após falhas repetidas, a janela conserva seus controles e oferece Reconectar.
   As tentativas não tiram uma janela do estado minimizado. A saída do renderer
   continua encerrando sua captura e limpando recursos.

## Referência e escolhas

O bundle local Vysor 5.0.7 `app.1f260ea3.js`, offsets 426820–428720, ajusta a
janela ao conteúdo por `setContentSize` após 500 ms. A análise estática não
encontrou `setAspectRatio` ou `will-resize` nesse caminho. O MirrorPanel usa
uma implementação própria de ajuste contínuo em eventos nativos do Windows;
não se afirma que o algoritmo interno seja idêntico ao Vysor.

Contrato de eventos consultado na [documentação oficial do Electron](https://www.electronjs.org/docs/latest/api/browser-window#event-will-resize).
`setBounds` não emite `will-resize`, evitando recursão no ajuste.

## Evidência desta revisão

- TypeScript, ESLint, build Electron e APK/JAR: passaram; assinatura APK v3.
- 19 testes Node passaram, incluindo TCP real e saída de processo com código 0.
- JVM PointerSlots passou.
- Dez eventos WM_SIZING nativos, enviados somente ao HWND/processo do harness:
  oito lados/cantos e dois extremos. O vídeo preencheu o viewport em todos.
  Não é teste de arraste humano nem de todas as combinações de monitores/DPI.
- Janela mínima observada: 240×619; viewport 240×533, canvas239,844×532,984.
  Máxima no monitor do teste: 407×990, viewport407×904.
- Oito force-stops controlados do Companion em dois ciclos. Em cada ciclo,
  três recuperações automáticas; a quarta falha chega ao estado terminal.
  Reconectar retomou o vídeo na mesma janela. Minimizar/maximizar/fechar foram
  acionados por eventos de mouse reais do renderer após o término da sessão.
- A janela permaneceu minimizada durante as recuperações. Sem janelas extras.
- Activity de orientação conferida por UI XML e screenshot; sem botão Parar;
  voltar dessa tela manteve o espelhamento.
- Unicode/composição/colagem, Alt+clique, áudio ao vivo e MP4 foram novamente
  testados na interface física. Resultados detalhados ficam nos outputs da sessão.

Um teste inicial expôs o callback do decoder apagando os elementos do overlay;
foi corrigido antes da execução completa aprovada. O harness usa o pwsh já
disponível, sem alterar políticas de execução do Windows. `am stopservice` foi
recusado por o serviço ser privado; a injeção de falha usa force-stop apenas
do pacote Companion de teste. Nenhum teste implica alterar outros aplicativos.

Continua sendo uma preview: não há certificação de horas de uso, todas as ROMs,
Wi-Fi físico nesta rodada ou paridade completa de recursos com Vysor. A história
de validação anterior permanece em PREVIEW3.md e VALIDATION.md.
