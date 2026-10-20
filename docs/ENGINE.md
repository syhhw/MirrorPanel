# MirrorPanel 2.0 — arquitetura

Electron + TypeScript + WebCodecs, motor Android próprio. Preview 4, 19/10/2026.

```text
Painel Electron → Session manager → ADB oficial → app_process (UID shell)
                                    │              MediaCodec H.264 / display
                                    └→ Companion   indicador / IME / áudio
Janela Electron ← IPC limitado ← forward MPV1 ← captura e estados autenticados
 WebCodecs canvas + AudioDecoder                → InputManager / commitText
 PNG e MP4 H.264 + AAC
```

Main controla processos, arquivos e ADB. Preload expõe operações específicas;
renderer tem sandbox, contextIsolation, CSP local e nodeIntegration desativado.
Dois tokens aleatórios separam fluxo desktop e canal privado do Companion.
O servidor só captura enquanto o indicador autenticado estiver ativo.

## Android

API29–33: SurfaceControl com superfície MediaCodec e layer stack do display real.
API34+: assinatura estática DisplayManager espelhadora. O mínimo do produto
agora é Android10; OEMs/versões não testados constam na matriz de validação.

Multitoque valida estados e mapeia IDs externos a slots Android0..9 estáveis.
Isso evita o problema do InputTarget Android12 com IDs altos. UP libera apenas
o contato alterado; CANCEL, rotação e encerramento liberam o gesto.

Unicode usa um InputMethodService próprio, sem ler conteúdo do editor. O teclado
anterior é salvo e restaurado no encerramento. Texto requer editor ativo e ACK.
Composição e colagem preservam os code points, com limite64KiB por comando.

Áudio usa Activity de consentimento MediaProjection e AudioPlaybackCapture;
somente reprodução permitida pelos aplicativos. AAC-LC48k estéreo é codificado
com MediaCodec, com timestamps monotônicos e fila limitada. Não usa microfone.

## Desktop e lifecycle

Vídeo: WebCodecs + canvas. Áudio: AudioDecoder + AudioContext, volume, fila
limitada e interrupção das fontes agendadas ao parar. MP4 remuxa H.264/AAC sem
reencodificar; PNG vem do canvas. Rotação e mudança de áudio finalizam o MP4 atual.

Uma sessão possui um processo, um forward e um JAR temporário. Nunca usa
kill-server ou kill por nome. Limpeza aguarda operações ADB tardias, restaura
IME/stay-awake e encerra apenas os recursos que possui. Falha do renderer cancela contatos pendentes e recarrega a imagem na mesma
janela, preservando o transporte Android; filas destinadas ao renderer antigo são
descartadas. Há três recuperações automáticas; depois disso, Reconectar continua
disponível e os controles da janela permanecem utilizáveis. Destruir a janela
encerra a sessão. Inícios concorrentes para o mesmo aparelho são serializados. Fechar a tela de orientação Android não encerra o espelho. Desconexões inesperadas têm até
três tentativas de reconexão. Troca USB→Wi-Fi pode exigir novo Iniciar.

O heartbeat autenticado do Companion é encaminhado como status MPV1 ao PC.
O watchdog de 15 s mede ausência de comunicação, não ausência de quadros novos.
Assim uma tela estática permanece conectada sem desativar detecção de falhas.

As janelas usam moldura própria, barra superior de 38 px, navegação inferior
de 48 px. O arraste nativo é livre; após 500 ms sem resize, o vídeo e a janela
são acomodados pela maior dimensão, com tolerância de 3 px e limites do monitor.
Maximizar/fullscreen usam vídeo contido e centralizado; o estado é reenviado ao
recuperar um renderer. O registro de janelas
independe das sessões, permitindo fechar/minimizar mesmo desconectado. Ações de janela
aceitam apenas o sender proprietário e uma lista fechada de comandos.

Perda do Companion é falha de conexão recuperável, não pedido de parada.
Exit code zero também não implica intenção do usuário. O app Android mostra
orientação e conexão; a notificação não encerra o serviço quando dispensada.

## Referências e estado

- `native/docs/PROTOCOL.md`: contratos, limites, autenticação e timestamps.

H.265, clipboard bidirecional, QR, bandeja e updater ainda não implementados.
O pacote 2.0 não usa a versão Python. Nenhum código ou recurso de terceiros
participa do motor além do ADB oficial e do Electron. Chromium mantém seu componente interno ffmpeg.dll.

## APK, interação e diagnóstico (preview 5)

O preload converte um File real em caminho via webUtils.getPathForFile. O main
valida arquivo local APK/ZIP, tamanho e janela proprietária; o instalador usa
argv `adb install -r`, sem shell e com trava por aparelho. O seletor do painel
compartilha esse instalador. Arquivos sintéticos do renderer não viram caminhos.

Ripple de navegação: expansão de 250 ms, opacidade 0,25, mínimo de 250 ms e
saída de 300 ms. Mouse e teclado não duplicam a ação Android.

Diagnóstico local rotativo (2 MiB + um anterior): ciclo de janela, comandos
nativos de fechar/minimizar/maximizar, falhas do renderer, início/fim, heartbeat,
contagem de pacotes e PID do transporte. Não registra tokens, texto, clipboard
ou argumentos ADB. Falha de gravação do diagnóstico não interrompe o produto.
