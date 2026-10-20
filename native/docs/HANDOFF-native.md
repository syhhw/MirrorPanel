# MirrorPanel 2.0 — integração concluída como preview

## Pedido e decisão
- Engenharia reversa do Vysor como referência e motor próprio no MirrorPanel.
- Usuário confirmou Electron + WebCodecs e pediu skills agents, codebase e trail.
- Código e aplicativo integrados em C:\Users\ACKERMAN\Desktop\MirrorPanel\native.
- Abrir: raiz do projeto, Abrir MirrorPanel 2.0.vbs.

## Implementado
- Java app_process shell, MediaCodec H.264 Surface, display espelhado AOSP.
- MPV1 autenticado com tokens separados de vídeo/input e indicador.
- Companion APK foreground, indicador e Parar, heartbeat que encerra captura.
- Electron TypeScript sandbox/contextIsolation, preload específico, WebCodecs.
- Vários aparelhos, mouse/teclado, rolagem, qualidade, rotação, MP4 remux, PNG.
- Wi-Fi IP/código/ativação USB, instalação APK, nomes e preferências.
- Processos/forwards/JAR temporários próprios; sem kill-server ou kill por nome.
- Código Python 1.x preservado. README antigo em docs/README-1.x.md.
- Root package.json encaminha os comandos para native/. CI nativo separado.

## Verificado
- npm run typecheck: OK; npm run lint: OK; npm test: 9/9.
- Build Java/DEX/APK e assinatura: OK.
- Electron bundle e pacote portátil: OK.
- Teste real API37: 100 pacotes, 5 keyframes, controle e MP4.
- Electron final: 40 quadros WebCodecs, 0 descartes no renderer, sem erros;
  MP4 reproduzido, PNG, fechamento da janela sem reinício.
- Dois emuladores API37/36: 48/142 pacotes; rotação 576x1280 -> 1280x576;
  MP4 finalizado na rotação; parar um mantém outro; Companion death => phone-stop;
  nenhum forward restante.
- Executável dentro do projeto iniciou sessão real e liberou forward ao fechar.
- Python legado: 112 testes, OK. git diff --check OK.
- Nenhum scrcpy, Vysor ou keystore no pacote distribuível.

## Engenharia reversa / evidência
- Relatório 5.0.7 do usuário tratado como referência, não repetição do exame APK.
- REA oficial 6.7.0 analisou bundle público app.vysor.io/app.14d718c6.js sem executar.
- SHA256 c74f0808e60af8ce04c2f33ae6407f12f03e19010c1f4c2b7f7fe377ede959b2.
- 1 JS, 0 parse failures, 49 findings, grafo aplicação37/53; cobertura parcial.
- native/docs/REVERSE-ENGINEERING.md, PROTOCOL.md, rea-evidence.json.
- native/build/smoke contém relatórios/capturas de testes.

## Reprodução
Na raiz: npm run setup; npm run android; npm run typecheck; npm run lint;
npm test; npm start; npm run package.
Android build requer SDK android-35/build-tools36.0.0 e JDK17; configure env.
Testes reais, dentro de native/: tsx scripts/smoke-device.ts emulator-5554;
electron smoke.cjs emulator-5554; tsx scripts/smoke-lifecycle.ts (2 emuladores).

## Limites / próximo trabalho
- Preview, Android14+ (API estática não existe em 12/13).
- Hardware físico, OEMs e Wi-Fi não validados; somente emuladores16/17.
- Sem áudio, H.265, multitoque, IME Unicode completo, clipboard bidirecional,
  QR, bandeja ou updater da 1.x. Não anunciar paridade completa.
- Rotação finaliza MP4; outra gravação precisa ser iniciada.
- Não copiar chave privada do staging: auto-review rejeitou essa cópia.
  Integração concluída sem ela. Para rebuild/atualização do Companion, definir
  chave estável gerenciada pelo usuário; certificado diferente não instala por cima.
- Nenhum commit, push, tag ou release pública. Versão1.3.1 pública inalterada.
- Próxima etapa: hardware real, áudio/IME e migração das funções restantes.

## Ferramentas
- codebase MCP ausente => fallback source/rg; trail ask empty; learning salvo.
- Gemini sem cota, Groq recusou, local incompleto descartado, Copilot conferido.
- Agente auxiliar fez pesquisa Android; edições/testes pelo agente principal.
- Estado anterior untracked (.claude*, .swarm, Prints, docs/imagens, handoff.cmd)
  preservado. HANDOFF anterior em .Codex/HANDOFF-before-native-2026-10-18.md.

## Validação trail e assinatura
- trail note salvou .trail/learnings/2026-10-19-mirrorpanel-native-engine-adb-bootstrap-android-codex.md.
- trail check retornou 18 conflitos lexicais; revisão justificada em native/docs/TRAIL-REVIEW.md.
- Índice Git temporário usado na revisão; staging real preservado.
- Chave privada não copiada. Pacote compilado usa certificado de desenvolvimento
  do staging; futuros rebuilds precisam de chave estável para atualizar o Companion.

## Verificação final do executável
- Fechar somente vídeo deve manter painel aberto. O primeiro harness fechava
  apenas a janela principal escolhida pelo Windows e interpretava isso incorretamente.
- Harness corrigido enviou WM_CLOSE às janelas Chromium do PID próprio.
- Pacote final: processExited=true, noSessionForwards=true, awakeRestored=true.
- Main aguarda finishPromise/restauração e finaliza via app.exit após cleanup.
- Relatório portátil em outputs/packaged-result.json da sessão Codex.
