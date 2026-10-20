# MirrorPanel

Espelha e controla celulares Android no Windows, com motor próprio: Electron +
WebCodecs no computador e servidor Java no aparelho. Executa sem Python nem
programas de terceiros; o ADB oficial vem incluído. Versão atual: prévia 5.

Abra **Abrir MirrorPanel.vbs**. O executável fica em
`native/dist/MirrorPanel-win32-x64/MirrorPanel.exe`; mantenha a pasta inteira.
Conecte um Android **10+**, autorize a depuração USB e clique no celular desenhado no painel.

Recursos: vídeo H.264, áudio estéreo com autorização no celular, Unicode e
composição de texto, multitoque com Alt+clique, MP4 com som, PNG, fullscreen,
janelas por aparelho, qualidade, Wi-Fi, instalação de APK e envio de arquivos
por arraste para a pasta Download do celular.

O ícone de fone ativa áudio. Alt+clique fixa um dedo; arraste para usar o outro.
Esc cancela contatos ou volta. O Companion mostra orientação e estado; encerrar o espelhamento é feito pelo computador.

É uma preview. Áudio depende da política do aplicativo Android. H.265,
clipboard bidirecional, QR, bandeja e atualização automática ainda não existem.
Rotação e mudança do áudio finalizam a gravação atual.

A preview 5 acomoda a proporção depois de soltar a borda, recupera falhas do
renderer sem fechar a janela, aceita APK por arraste e anima os botões de navegação.
No celular, fechar a tela de orientação não interrompe o espelho.

## Desenvolvimento

O código ativo está em [native](native/README.md). Os arquivos Python históricos
não são iniciados nem incluídos no pacote. A documentação anterior fica em
[README 1.x](docs/README-1.x.md); releases públicas e tags anteriores não mudaram.

```powershell
npm run setup
npm run android
npm run typecheck
npm run lint
npm test
npm run test:android
npm start
npm run package
```

[Arquitetura](docs/ENGINE.md) · [Protocolo MPV1](native/docs/PROTOCOL.md) · [Build, testes e assinatura](native/README.md).

MirrorPanel usa Apache-2.0; Electron/mp4-muxer MIT; avisos ADB/Chromium acompanham
o portátil.
