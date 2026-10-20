# MirrorPanel 2.0 — preview 5

Electron + TypeScript + WebCodecs, com motor Android próprio. O pacote executa
sem Python, scrcpy ou Vysor. Inclui o ADB oficial para transporte USB/Wi-Fi.

## Usar

Abra `dist/MirrorPanel-win32-x64/MirrorPanel.exe` ou **Abrir MirrorPanel 2.0.vbs**
na raiz do projeto. Mantenha os arquivos da pasta portátil juntos.

1. Android **10 ou superior**, depuração USB ativada e computador autorizado.
2. Clique no botão circular **Espelhar** ao lado do aparelho. O app instala seu
   Companion e mostra um indicador no celular.
3. Clique num campo de texto para digitar ou colar. Acentos, idiomas, composição
   e sequências de emoji são enviados pelo IME MirrorPanel, sem normalização.
4. **Alt+clique** fixa um dedo. Arraste com o mouse para usar o segundo; outro
   Alt+clique libera a âncora. Esc cancela contatos. Uma tela touch no PC pode
   enviar até dez contatos simultâneos.
5. Clique no **fone** e autorize a captura no Android para ouvir áudio de mídia.
   O controle de volume afeta o computador. Inicie áudio antes de gravar para
   incluir a faixa AAC no MP4.

Clique direito/Esc: Voltar; clique do meio/Home: Início; End: recentes;
F11: tela cheia; Ctrl+V: colar. A barra oferece PNG e gravação MP4.
Fechar a janela de vídeo ou usar Parar no painel do computador encerra a sessão.
O aplicativo Android mostra orientação e estado da conexão; fechar essa tela
ou dispensar a notificação não encerra o espelhamento.
Use a engrenagem para qualidade, nome do aparelho e controles adicionais.
Na preview 3, a janela tem barra superior única, vídeo ajustado à proporção
do aparelho e navegação inferior. Heartbeats mantêm a conexão em telas paradas;
ausência real de resposta continua sendo detectada pelo watchdog.
Na preview 5, o arraste das bordas é livre; após 500 ms sem movimento, a janela
acomoda o vídeo pela maior dimensão, mantendo a proporção. Reduza a altura em
retrato para reduzir o espelho; estreitar apenas a lateral faz a largura voltar.
Maximizar e tela cheia centralizam o vídeo. Os botões de navegação têm animação
ao pressionar com mouse ou teclado.
Arraste arquivos locais para a janela de espelhamento: um APK sozinho é instalado
naquele aparelho; outros arquivos (até 20 por vez, 4 GB cada) vão para a pasta
Download do celular sem sobrescrever nomes existentes. Pastas de rede são recusadas.
Os controles da janela continuam funcionando mesmo sem sessão. Perdas do
Companion admitem recuperação; após falhas repetidas, Reconectar tenta novamente
na mesma janela. A reconexão não restaura uma janela que você minimizou.
Falhas do renderer tentam recuperar a imagem na mesma janela e transporte,
cancelando contatos pendentes. Após três recuperações, a janela oferece Reconectar
e preserva Fechar/Minimizar. O áudio precisa ser ativado novamente após essa falha.
O diagnóstico local fica em `%APPDATA%/MirrorPanel/diagnostics/lifecycle.jsonl`;
registra origem de fechamento, estado e contadores, sem texto digitado ou clipboard.
O teclado anterior é restaurado ao encerrar. Se o Android reiniciar durante uma
sessão, selecione seu teclado habitual em Configurações → Idioma e entrada.

## Recursos

- Janelas independentes por aparelho, nomes, qualidade e preferências persistidas.
- H.264 MediaCodec → WebCodecs; áudio de reprodução → AAC 48 kHz estéreo → AudioDecoder.
- Multitoque com identidade estável, arrasto, rolagem, teclas e Unicode até 64 KiB por envio.
- MP4 com vídeo e áudio originais, sem reencodificação; capturas PNG.
- Reconexão limitada, cancelamento de entrada, recuperação após perda de vídeo.
- USB, conexão Wi-Fi por IP, pareamento por código, ativação TCP/IP via USB.
- Instalação de APK por seletor ou arraste para a janela e logs locais.
- Envio de arquivos por arraste para Download, com nomes seguros e sem sobrescrever.

Arquivos ficam em `Vídeos/MirrorPanel Media`. O aplicativo só remove seus
processos, forwards e JARs temporários; não encerra o servidor ADB compartilhado.
O Companion é visível e pode ser desinstalado normalmente.

## Compatibilidade e limites

O caminho Android 10–13 usa SurfaceControl; Android 14+ usa DisplayManager.
A matriz exata de testes e falhas corrigidas está em `docs/VALIDATION.md`.
O mínimo API 29 é uma decisão de implementação, não certificação de todas as ROMs.

Áudio depende da política do aplicativo Android: apps podem impedir captura;
chamadas, conteúdo protegido e microfone não são capturados. A permissão do
sistema é solicitada a cada nova captura quando exigida pelo Android.
Unicode é preservado; os glifos disponíveis dependem do app e das fontes do celular.

Rotação, mudança no áudio ou encerramento finalizam a gravação corrente. Inicie
outro arquivo depois da alteração. Não há H.265, clipboard bidirecional, QR,
bandeja ou atualização automática nesta preview. Wi-Fi ainda não tem validação
em rede física nesta rodada. Não há alegação de paridade completa com Vysor.

## Compilar e verificar

Windows x64, Node >=22.12, Python 3, JDK 17, SDK `platforms;android-35` e
`build-tools;36.0.0`. Configure `JAVA_HOME` e `ANDROID_HOME` se necessário.
Esses requisitos são de desenvolvimento; o usuário do portátil não precisa deles.

```powershell
npm ci
node node_modules/electron/install.js
npm run android
npm run typecheck
npm run lint
npm test
npm run test:android
npm run package
```

O build usa uma chave de desenvolvimento local em `build/android`. Ela não
entra no pacote. Para reproduzir atualizações do Companion, use a mesma chave
estável via `MIRRORPANEL_KEYSTORE`, `MIRRORPANEL_STORE_PASSWORD` e
`MIRRORPANEL_KEY_ALIAS`. Não há remoção automática de app com assinatura diferente.

Testes reais exigem aparelhos de teste autorizados e desbloqueados:

```powershell
python scripts/build-fixture.py
adb -s SERIAL install -r build/android/fixture.apk
node_modules/.bin/tsx scripts/smoke-features.ts SERIAL
node_modules/electron/dist/electron.exe smoke-features.cjs SERIAL
node_modules/electron/dist/electron.exe scripts/verify-media.cjs CAMINHO_MP4
node_modules/electron/dist/electron.exe smoke-preview5.cjs SERIAL
node_modules/electron/dist/electron.exe smoke-visual.cjs SERIAL
node_modules/electron/dist/electron.exe smoke-window-lifecycle.cjs SERIAL
node_modules/.bin/tsx scripts/smoke-stability.ts SERIAL 90 final
node_modules/.bin/tsx scripts/smoke-lifecycle.ts SERIAL_ROTACAO SERIAL_STOP
```

O fixture produz texto, eventos e um tom de 440 Hz; seus dados são privados ao app.
`smoke-preview5.cjs` instala o fixture por evento de drop Chromium, provoca
falhas de renderer e verifica recuperação, ripple, resize e controles.
`smoke-renderer-crash.cjs` é um alias dessa suíte. `smoke-window-lifecycle.cjs`
testa perda do Companion e geometria por Electron.setBounds; isso não substitui
arrastar bordas com mouse. Veja os limites e evidências em `docs/PREVIEW5.md`.
O teste de lifecycle muda temporariamente rotação no primeiro aparelho e encerra
o Companion no segundo. O fixture, evidências e chaves não entram no portátil.

## Engenharia

`docs/PROTOCOL.md` descreve MPV1; `docs/REVERSE-ENGINEERING.md` registra a análise
REA do instalador, Electron, APK, DLL e WASM do Vysor e os limites observados.
O MirrorPanel usa código e interface próprios. Nenhum recurso do Vysor é distribuído.

`docs/PREVIEW3.md` registra a correção de reconexões, a referência visual e os
testes desta revisão. O teste TCP precisa de acesso local a 127.0.0.1.
`docs/PREVIEW4.md` documenta o resize nativo, a vida independente das janelas e
os testes com falhas provocadas no Companion.

Código original Apache-2.0; Electron e mp4-muxer MIT. Avisos Chromium acompanham
o Electron e os do ADB ficam em `resources/adb`. Chromium inclui `ffmpeg.dll`
internamente; o app não invoca um programa FFmpeg externo.
