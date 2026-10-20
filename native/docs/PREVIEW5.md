# MirrorPanel 2.0 preview 5 — correções e validação

## Observação contínua final — aprovada

**1200.21 s contínuos (20:27:17–20:47:17, UTC−3), 119 amostras, zero falhas e zero eventos de fechamento.**

- Mesma sessão `866b49f1e983`, janela `2`, transporte PID `4212` e Companion PID `12929` em todas as amostras.
- Sinais de vida: 227 → 1424; quadros decodificados: 1135 → 1672; descartes no fim: 0.
- Nenhuma tentativa de reconexão, falha do renderer ou aviso durante o intervalo.
- O processo Android do Vysor permaneceu `31382`; a janela Vysor continuou aberta e foi conferida visualmente na mesma mudança de tela.
- A sessão também foi exercitada com reduções reais de borda, minimizar/restaurar e maximizar/restaurar. Alguns desses gestos ocorreram antes do início do intervalo final; não foram tratados como falhas nem somados à duração mínima.
- Não foram injetadas falhas nem reiniciado o aplicativo durante essa medição. Os testes de falha controlada são separados.

O resultado demonstra estabilidade neste aparelho e neste intervalo; não é garantia de ausência de falha em qualquer duração ou configuração.

Windows x64; Moto G30 com Android 12/API 31; Vysor 5.0.7 aberto no mesmo aparelho. Versão instalada `2.0.0-preview.5`.

## Encerramentos: o que foi demonstrado

O código anterior reagia a `render-process-gone` encerrando o transporte Android e fechando a janela do espelho. Essa falha foi provocada de forma controlada. A correção recupera a imagem na mesma janela, sessão e processo Android, cancela dedos pendentes, descarta filas do renderer antigo e pede um novo quadro-chave. O estado de janela maximizada também é restaurado.

Três falhas consecutivas permitem recuperação automática. Se o renderer continua falhando, a janela mantém seus controles e oferece Reconectar, sem um ciclo infinito. Esse limite e a recuperação manual passaram no aparelho físico. Dois pedidos simultâneos de iniciar também não duplicaram a sessão. Após falha do renderer, o áudio precisa ser ativado novamente.

**A causa exata dos dois fechamentos antigos não foi comprovada.** Os registros antigos não informavam a origem; EOF/ServiceDestroyed descrevem uma conexão que terminou, não quem a encerrou. A consulta de eventos Windows não retornou um crash correspondente no intervalo examinado, o que também não exclui falha. Não atribuí retroativamente os dois episódios ao renderer. O novo diagnóstico local registra falha do renderer, ação da barra, fechamento nativo, início/fim da sessão, sinais de vida e contadores. Não grava texto digitado, clipboard, tokens ou argumentos ADB.

## Redimensionamento e navegação

O arraste das bordas agora segue o comportamento observado no Vysor: movimento nativo livre e acomodação proporcional 500 ms após o último resize, usando a maior dimensão do vídeo, descontando as barras. Uma redução só da largura pode voltar à largura anterior; em retrato, reduzir a altura reduz também a largura. Maximizar/tela cheia centralizam e contêm a imagem.

| Arraste real com mouse | Durante o movimento | Após acomodação |
|---|---:|---:|
| MirrorPanel, lateral, a partir de 398×967 | 316×967 | 398×967 |
| MirrorPanel, topo, a partir de 398×967 | 398×838 | 340×838 |
| Vysor, lateral, a partir de 372×912 | 291×912 | 372×912 |
| Vysor, altura, a partir de 372×912 | 372×838 | 338×838 |

As medidas são capturas externas das janelas, incluindo sua moldura. No MirrorPanel 340×838, o vídeo ocupa 338×751 pixels internos, além das barras. A diferença externa de dois pixels não representa deformação do conteúdo.

**Limite do teste manual:** a ferramenta de mouse bloqueia destino fora da janela. Reduções reais foram exercitadas; ampliação por arraste para fora não foi certificada. Ampliação por geometria programática e maximizar/restaurar passaram, mas não são apresentados como arraste físico.

Botões Voltar/Início/Recentes têm onda ao pressionar, com expansão de 250 ms e saída de 300 ms, suporte a teclado e preferência de movimento reduzido. A ação Android ocorre uma vez por clique. O menu usa o azul da barra. Implementação própria, sem copiar código ou recursos do Vysor.

## APK por arraste

O MirrorPanel agora aceita **um APK local por vez** arrastado para a janela do aparelho. A instalação usa o caminho do File real fornecido pelo Electron, valida arquivo/extensão/contêiner/tamanho, serializa instalações por aparelho e chama ADB com argumentos separados, sem shell. A janela informa andamento, sucesso ou erro. O seletor existente usa o mesmo instalador.

O fixture de teste foi entregue ao Chromium como arquivo real por `Input.dispatchDragEvent`, atravessou renderer → preload → main → ADB e foi instalado no Moto G30; `pm path` confirmou o pacote. Arquivo sintético criado pelo renderer foi rejeitado. **Isso valida o fluxo de drop e a instalação física; não é uma alegação de gesto manual do Explorador de Arquivos até a janela.**

## Testes de regressão

- Lint, TypeScript, build e empacotamento: aprovados.
- Node: **22 testes, 22 aprovados, zero falhas**. Incluem protocolo, Unicode, multitoque, ciclo de sessão, APK e geometria.
- JVM: alocação de IDs de toque aprovada.
- Suíte física preview5: resize, janela, ripple por mouse/teclado, APK, recuperação do renderer, toque cancelado, limite de tentativas, retry e close: aprovada.
- Unicode exato, composição adiada e colagem de caracteres combinados, árabe e emoji: aprovados.
- Multitoque: sequência DOWN/POINTER_DOWN/POINTER_UP/UP observada no aparelho.
- Áudio: 410 frames decodificados; pico ao vivo 0,1901. Vídeo: 269 frames, zero descartes na rodada de recursos.
- MP4 realmente decodificado: vídeo 576×1280 por 2,115 s; áudio estéreo a 48 kHz por 2,069 s; tom de teste medido em 440,238 Hz.

## Referência REA e escopo

A análise dirigida dos bundles Vysor encontrou o intervalo de 500 ms, tolerância de 3 px, ajuste pela maior dimensão, ripple e pipeline de drop. Artefato REA `ev_7f93b58077a18dc3bb57c38e166b5f61c2bfe8f39d6b676a31e28af1c7609acd`: dois bundles analisados, zero erros de parse; cobertura parcial, com 136 arquivos não selecionados. O trace de preventSnap não encontrou sementes e não foi usado como prova. A comparação real confirmou o comportamento do resize nos movimentos exercitados.

O motor continua próprio e não usa Vysor ou scrcpy em execução. O mínimo do código é Android 10; esta rodada física valida Android 12 no Moto G30. Não certifica todas as ROMs, Wi-Fi físico, chamadas ou conteúdo protegido.

## Evidências

- `preview5-features.json`: testes de recuperação, interface e drop.
- `ui-feature-result.json` e `media-result.json`: Unicode, multitoque, áudio e MP4.
- `preview5-real-resize.json` e `preview5-final-native-actions.json`: ações e medidas reais.
- `preview5-soak-samples.jsonl` e `preview5-soak-result.json`: observação contínua final.
- `preview5-package.json`: hash do pacote efetivamente instalado.

Resultados de preparação não foram somados ao teste final. Um observador inicial confundia falta de novos quadros em tela estática com travamento; suas amostras foram preservadas. A checagem corrigida exige sinais de vida contínuos, identidade estável e decodificação acompanhando os pacotes de vídeo recebidos. A sessão do aplicativo não foi reiniciada ao corrigir o observador.


## Encerramento e recuperação — rodada final separada

Após salvar a observação contínua, o X do espelho e o X do painel foram acionados pelo mouse. O diagnóstico registrou origem `toolbar`, `user-stop` e saída normal. Em seguida, uma suíte separada provocou oito perdas do Companion, em dois grupos: três recuperações automáticas e parada após a quarta em cada grupo. A janela permaneceu minimizada durante recuperação; os controles funcionaram sem sessão; Reconectar retomou na mesma janela; fechar não iniciou outra sessão. Teclado anterior, configuração de tela ligada e forwards ADB voltaram exatamente ao baseline. Zero erros na suíte. A geometria dessa suíte foi exercitada por Electron.setBounds, separadamente dos arrastes reais já descritos.

Resultado: `preview5-window-result.json`. Fechamentos deliberados: `preview5-deliberate-close-lifecycle.jsonl`; intervalo contínuo sem fechamento: `preview5-soak-lifecycle.jsonl`.


## Revisão Trail

O aprendizado foi salvo. `trail check` retornou 20 alertas lexicais e limitou o diff aos primeiros 400 KB; não é um check verde nem uma revisão completa. Os alertas foram lidos e contextualizados em `preview5-trail-review.md`, com o resultado bruto em `preview5-trail-check.txt`. O índice real do Git foi preservado e não houve commit/push.

## Abrir a versão entregue

Use **Abrir MirrorPanel 2.0.vbs** na pasta do projeto. O iniciador genérico do Windows ainda reconhece a instalação antiga 1.3.1; ela foi fechada quando apareceu durante a abertura final. O executável validado fica em `native/dist/MirrorPanel-win32-x64/MirrorPanel.exe`.
