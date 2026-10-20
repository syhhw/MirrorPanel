# Validação — MirrorPanel 2.0 preview 2

Data: 19/10/2026. Resultados obtidos por execução; itens pendentes estão separados.

| Verificação | Resultado |
|---|---|
| TypeScript `tsc --noEmit` | Passou |
| ESLint `src tests` | Passou |
| Testes Node/tsx | 13/13 passaram |
| Regressão Java PointerSlots | Passou: IDs esparsos, retirada intermediária, reuso, limite e CANCEL |
| Java/DEX/APK | Build passou; assinatura APK v3 verificada |
| Electron bundle/portátil | Build preview.2 passou |
| Emulador telefone Android 17/API 37 | Vídeo, Unicode, três contatos, áudio e gravação passaram |
| Interface Electron no emulador | 232 frames de vídeo, zero descartes, 213 de áudio; sem crash |
| Composição e colagem | Texto não sai antes de compositionend; colagem e Unicode exatos |
| Alt+clique pela UI | Sequência DOWN, POINTER_DOWN, POINTER_UP, UP recebida no Android |
| Reprodução MP4 da UI | H.264 576×1280; AAC estéreo 48 kHz, tom medido 440,24 Hz |
| Áudio desligado | Não continuou produzindo pacotes após Stop |
| Texto sem editor | Rejeitado; não ficou aguardando a próxima tela |
| Queda do renderer | Sessão encerra, não reconecta, restaura IME/tela e remove seu forward |
| Telefone API 37 + TV API 36 simultâneos | 59/144 pacotes; parar um manteve o outro ativo |
| Rotação | 576×1280 → 1280×576; MP4 anterior finalizado corretamente |
| Companion encerrado na TV | phone-stop; forwards restaurados, sem encerramento global de ADB |
| Moto G30 Android 12: motor + interface | Unicode, três contatos, áudio, MP4 e restauração passaram; sem reinício Android |
| Executável integrado ao projeto | Preview.2: 22 frames WebCodecs, zero descartes; fechamento/IME/tela/forwards verificados |

Os testes usam um fixture próprio, com texto, registro de contatos e tom de
440 Hz. Não usam dados pessoais. MP4 foi efetivamente decodificado pelo Electron,
incluindo amostras de áudio; existência de arquivo não foi usada como prova.
O teste do executável encontrou e corrigiu uma sessão mantida após destruição
do WebContents pelo CDP. A repetição passou; tanto janela normal quanto renderer
destruído agora encerram os recursos próprios.

## Moto G30 físico, Android 12/API 31

Reteste concluído em 19/10/2026 após o desbloqueio pelo usuário. A suíte do
motor passou com 331 pacotes de vídeo e 485 de áudio. Unicode permaneceu exato,
incluindo idiomas, combinantes e emoji ZWJ; texto fora de um editor foi rejeitado.

Três contatos com IDs externos 3, 9 e 17 chegaram ao Android como slots 0, 1 e 2.
A retirada do contato intermediário preservou 0 e 2; movimento e CANCEL passaram.
O PID de system_server permaneceu 31698 durante a rodada, com o mesmo boot ID.
Não houve repetição do reinício causado pelo código anterior.

A interface também passou: 269 frames de vídeo decodificados, zero descartes,
408 frames de áudio; digitação, composição adiada até compositionend, colagem
e Alt+clique produziram os eventos e textos esperados. O áudio ao vivo teve
pico de 0,1848. O MP4 da interface foi realmente decodificado: vídeo 576×1280,
AAC estéreo a 48.000 Hz, duração de áudio 2,155 s e tom medido de 439,51 Hz
(fixture de 440 Hz). Screenshot, parar áudio e fechar sem reconectar passaram.

A primeira tentativa encontrou o APK de teste antigo no aparelho: ele ignorava
o modo readonly e falhou a asserção de ausência de editor. Os hashes confirmaram
a divergência. Após atualizar somente o fixture, a sequência completa passou.
Não foi necessária alteração no código do produto nesta retomada.

Gboard, configuração de tela ligada e lista de forwards foram restaurados.
Fixture encerrado, sem erros de renderer. As evidências físicas completas estão
em `MirrorPanel-preview2-MotoG30-evidencias.json` na pasta de entrega.

## Limites da matriz

- API 29 é o mínimo do código; Android 10/11/13/14/15 e outros OEMs não foram
  executados nesta rodada. API 31 usa o adaptador antigo; API 37 usa o novo.
- Até dez contatos são aceitos e o alocador foi testado; a UI foi exercitada com
  dois contatos via mouse, e o motor com três. Não foi usado monitor multitouch físico.
- Áudio testado com app que permite captura; política de outros apps pode impedir som.
- Wi-Fi em rede física, chamadas e conteúdo protegido não certificados. A observação de 20 minutos da preview5 está registrada em PREVIEW5.md.
- Não há alegação de benchmark de latência nem de equivalência total ao Vysor.

## Evidências reproduzíveis

`build/smoke/feature-result-emulator.json`, `ui-feature-result.json`,
`media-result.json`, `renderer-crash-result.json`, imagens e MP4 acompanham o
ambiente de teste. Um resumo selecionado acompanha a entrega em `outputs`.
Os comandos para reproduzir ficam no README; o fixture não entra no portátil.


## Preview5 — 19/10/2026

## Observação contínua final — aprovada

**1200.21 s contínuos (20:27:17–20:47:17, UTC−3), 119 amostras, zero falhas e zero eventos de fechamento.**

- Mesma sessão `866b49f1e983`, janela `2`, transporte PID `4212` e Companion PID `12929` em todas as amostras.
- Sinais de vida: 227 → 1424; quadros decodificados: 1135 → 1672; descartes no fim: 0.
- Nenhuma tentativa de reconexão, falha do renderer ou aviso durante o intervalo.
- O processo Android do Vysor permaneceu `31382`; a janela Vysor continuou aberta e foi conferida visualmente na mesma mudança de tela.
- A sessão também foi exercitada com reduções reais de borda, minimizar/restaurar e maximizar/restaurar. Alguns desses gestos ocorreram antes do início do intervalo final; não foram tratados como falhas nem somados à duração mínima.
- Não foram injetadas falhas nem reiniciado o aplicativo durante essa medição. Os testes de falha controlada são separados.

O resultado demonstra estabilidade neste aparelho e neste intervalo; não é garantia de ausência de falha em qualquer duração ou configuração.


Testes físicos e limites completos em `PREVIEW5.md`. Node22/22, lint, TypeScript, build e package aprovados.
