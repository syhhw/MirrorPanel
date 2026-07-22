# MirrorPanel

Painel para gerenciar o espelhamento e a gravação de vários aparelhos Android ao mesmo tempo, usando [scrcpy](https://github.com/Genymobile/scrcpy) e o ADB por baixo dos panos — sem precisar mexer em linha de comando.

[![Baixar MirrorPanel](https://img.shields.io/badge/Baixar-MirrorPanel--Setup.exe-1f6feb?style=for-the-badge&logo=windows&logoColor=white)](https://github.com/syhhw/MirrorPanel/releases/latest/download/MirrorPanel-Setup.exe)

> **O MirrorPanel não espelha nada sozinho.** Todo o trabalho pesado — captura de tela, decodificação de vídeo, controle do aparelho — é feito pelo [scrcpy](https://github.com/Genymobile/scrcpy), criado por **Romain Vimont ([rom1v](https://github.com/rom1v))** e mantido pela [Genymobile](https://github.com/Genymobile). Este projeto é só uma interface gráfica por cima dele (e do ADB), pra deixar o uso com vários aparelhos mais simples e visual. Sem o scrcpy, o MirrorPanel não existiria — todo o crédito técnico é deles.

## O que ele faz

- Detecta automaticamente os celulares conectados por USB e lista todos, parados, até você decidir o que espelhar.
- Espelha a tela de qualquer aparelho com um clique em **Iniciar** — cada um numa janela própria, do tamanho certo (sem esticar nem cortar).
- Ativa Wi-Fi num aparelho conectado por cabo com um botão. Reconhece que é o mesmo aparelho físico (mesmo depois de tirar o cabo) e nunca abre duas janelas pro mesmo celular.
- Se o espelhamento cair (cabo com mau contato, scrcpy travou), tenta reconectar sozinho em segundo plano antes de incomodar — só avisa e pergunta se quer tentar de novo se isso realmente falhar.
- Grava a tela e tira prints, salvando tudo organizado em **Vídeos\MirrorPanel Media**, com um modo leve (bitrate/fps/resolução reduzidos) pra aparelhos mais antigos não travarem durante a gravação.
- Ajusta qualidade (codec, bitrate, taxa de quadros, áudio) individualmente por aparelho, direto pela interface.
- Mantém a tela do celular sempre ligada enquanto está espelhando.
- Interface em modo escuro, com a mesma cara de aplicativo moderno do Windows 11.
- Minimiza para a bandeja do Windows; fechar o painel encerra tudo de forma organizada (scrcpy e o servidor do adb), sem deixar processo solto nem pasta bloqueada.
- Verifica atualizações automaticamente ao abrir (e tem um botão pra checar na hora que quiser).

## Como instalar

Baixe o instalador mais recente na aba [Releases](https://github.com/syhhw/MirrorPanel/releases) deste repositório e rode o `MirrorPanel-Setup.exe`. O instalador deixa escolher o idioma (português ou inglês), a pasta de instalação, e se quer atalho na área de trabalho e no Menu Iniciar.

## Como usar

1. Conecte o celular ao PC por USB, com a depuração USB ativada (Configurações → Opções do desenvolvedor).
2. Abra o MirrorPanel — os aparelhos detectados aparecem na lista, prontos pra usar.
3. Clique em **Iniciar** no aparelho que quiser espelhar.
4. Use os botões ao lado de cada aparelho pra ativar Wi-Fi, gravar, tirar print ou ajustar a qualidade daquele aparelho especificamente.

## Baseado em

Este projeto usa e distribui os seguintes componentes de terceiros:

- [scrcpy](https://github.com/Genymobile/scrcpy) (Genymobile) — Apache License 2.0
- [Android Debug Bridge (adb)](https://developer.android.com/tools/adb) (Android Open Source Project) — Apache License 2.0

## Licença

Distribuído sob a Apache License 2.0 — veja o arquivo [LICENSE](LICENSE).
