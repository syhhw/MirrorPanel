# Vysor 5.0.7 → decisões do MirrorPanel 2.0

Data: 19/10/2026. Análise local do instalador fornecido, ASAR extraído, APK
instalado, módulos nativos e comportamento da instância isolada. A cobertura
abaixo distingue inventário, decompilação e observação em execução.

## Identidade dos artefatos

| Artefato | SHA-256 / identidade |
|---|---|
| Vysor-win-5.0.7.exe, 125.900.016 bytes | `f21330b807368e516f87d193d76f51f53dfbfb84ae4e6dbcb9bda7814670ba53` |
| app.asar | `b4ac35a9926a307835f0e6bb695957e7af7da305a7c984ed4c88dd9f72e6c348` |
| APK incluído no ASAR | `4e0959161399532ab658e5020d22602c217cf17dec9c211502af6d5783ba3bfc` |
| APK instalado e extraído do Moto G30 | `2f862e923a9ebcd21c2d8898c683b47a5362568c7091dd8e80337952b5020b5f` |
| video_decode.dll | `d01f9c3dbaf631392d0a3df00417d89fa2114caf4fc054c0cb5b5f2335e8489e` |
| módulo WASM, 92.608 bytes | `9ce921dd677d32811a11a1e90a5d2075d50c1b9b565f7872d32188f215e5452b` |

O instalador fornecido coincide byte a byte com o download oficial analisado e
possui assinatura Authenticode Vysor Inc. Os dois APKs exibem 4.2.2, mas têm
versionCode diferentes: incluído1674514800; instalado1708394400. A tentativa
de instalar o mais antigo foi recusada pelo Android; não houve downgrade nem
desinstalação. O estudo de métodos abaixo usa o APK instalado mais novo.

## REA configurado e executado

REA 6.7.0, Ghidra 12.1.4, JADX headless0.7.1, Apktool 3.0.3, JDK21 e WABT 1.0.42.
Perfil profundo: heap4 GiB, prazo30min, até1milhão de nós semânticos globais e por
arquivo. O adaptador JADX efetivamente usa um worker; a máquina ter16 processadores
não transforma esse limite em paralelismo. Configuração MCP validada com207tools.
O wrapper `Documents/Codex/Tools/REA/rea-deep.ps1` preserva os parâmetros.

O setup passou sete verificações reais, incluindo decompilações PE e APK de
controle. WABT foi adicionado e validou o módulo do próprio Vysor. Os relatórios
REA de origem ficam em `work/vysor-full` da sessão; `rea-evidence-index.json`
registra identidade, operação, evidência e hash de cada relatório.

## Caminho reconstruído

1. O instalador contém um pacote Squirrel, runtime Electron24.3 e app.asar.
   O processo de fundo gerencia aparelhos/ADB e abre a janela por dispositivo.
2. `VysorControlBase.writer` escolhe dimensões e cria `StdOutDevice` com uma
   `SurfaceControlVirtualDisplayFactory`; define bitrate/baseline e registra
   o display de captura. Evidência `ev_c79ff2471b19386fab566862c16bcb2e84b5f4b8df1f85a455617ed722301ca5`.
3. A fábrica tenta SurfaceControl por reflexão, define superfície, projeção e
   layer stack, observa rotação e destrói o display ao liberar. Há fallback
   para assinatura estática DisplayManager.createVirtualDisplay. Esse achado
   confirma que exigir Android 14 no primeiro MirrorPanel era uma limitação da
   nossa implementação, não uma necessidade do conceito de espelhamento.
4. `StdOutDevice.Writer.encode` retira buffers MediaCodec, guarda codec config
   e escreve um cabeçalho little endian de12 bytes: comprimento total menos4,
   PTS convertido para milissegundos e indicador de keyframe; segue o payload.
   Libera cada output buffer. Evidência
   `ev_2ea9d6057059e39802388b41e0fa2883397cb5b4f92407cfd4a92e216a56a20c`.
5. `manageVideoSocket` delega a uma coroutine. Seu wrapper isolado não demonstra
   todos os detalhes de transporte/reconexão. O protocolo do MirrorPanel é MPV1
   próprio, documentado separadamente, e não depende de interoperar com Vysor.
6. O desktop possui workers H.264, renderizadores canvas e módulos WASM/nativo.
   Ghidra encontrou5.997 procedimentos e948strings definidas no DLL. A função
   exportada `PPP_InitializeModule` é um thunk em0x1800054c5 para0x18002e1d0;
   seu pseudocódigo inicializa o módulo ou retorna erro. Isso demonstra a
   fronteira de plugin, não uma leitura completa de todos os decodificadores.
7. WABT validou101 funções definidas, três imports e oito exports no WASM.
   Nomes minificados c..j não foram tratados como descrições semânticas.

## Entrada, áudio e experiência

`VysorIME.sendText` chama InputConnection.commitText. O desktop usa composição
e textarea para entrada internacional. O controle Android constrói arrays de
PointerProperties/PointerCoords e injeta MotionEvent com IDs/ação/pressão.
`handleCommand` também trata teclado, mouse, rolagem, sync-frame e bitrate.

Na interface estática, Alt+clique mantém um primeiro dedo, outro contato usa
outro ID e existe marcador visual. O caminho touch examinado no bundle usa o
primeiro targetTouch; isso não prova suporte arbitrário a dez dedos na UI Vysor.

O áudio Android 10 usa Activity com consentimento MediaProjection e serviço de
AudioPlaybackCapture; a implementação observada solicita PCM float48k estéreo.
O desktop possui AudioWorklet correspondente. Os usos solicitados pelo código
não anulam as restrições de captura do Android ou a opção dos apps de impedir áudio.

Decisões aplicadas no MirrorPanel com código próprio:

| Referência observada | Implementação MirrorPanel |
|---|---|
| IME internacional | IME próprio, UTF-8/ACK, composição e colagem sem normalização |
| MotionEvent com vários pontos | Até dez contatos; IDs de transporte mapeados a slots nativos estáveis |
| Alt+clique e marcador | Âncora visual, segundo dedo com mouse, Esc/blur cancela |
| Áudio consentido | PlaybackCapture → AAC → AudioDecoder, volume e MP4 com som |
| Barra de ações de dispositivo | Ícones próprios, navegação Android, PNG, gravação, áudio, fullscreen |
| Qualidade e janelas por aparelho | Preferências por serial e isolamento de processos/forwards |

## Execução observada e limites

Uma instância Vysor separada foi iniciada com perfil de análise e CDP loopback.
O inventário de aparelhos e a interface free5.0.7 foram observados. Hashes dos
scripts carregados offline coincidiram com os arquivos extraídos. Ao iniciar
espelhamento do emulador API 37, o Vysor exibiu **Unable to connect to control socket**.
Não se atribui a ele funcionamento nessa versão com base apenas na análise estática.

A captura ativa REA devolveu `hook_conflict` e zero eventos IPC. O observador
Electron passivo do REA reconheceu apenas file:// e não as páginas app://.
O CDP direto foi usado como observação complementar, identificado como tal.
Não há alegação de captura ponta a ponta de todos os eventos IPC em execução.

O grafo estático abrange138 arquivos,82JavaScript,835.235 nós AST, zero erros de
parse,549 findings,125.631 nós semânticos,137.500 relações e44.018 unknowns. Foram
identificadas duas BrowserWindows,17 operações IPC, quatro canais literais e13dinâmicos.
Limitações preservadas: fatos do vendor excederam o orçamento de transferência;
HTML inline do safe-mode não foi analisado; canais dinâmicos permanecem incertos.
Houve divergência entre hash declarado no ASAR e bytes observados do ADB incluído;
a análise continuou registrando a inconsistência, sem considerá-los equivalentes.

“Ponta a ponta” aqui significa rastrear instalador→desktop→captura Android→fluxo→
renderização e entrada/áudio, com as lacunas acima. Não significa descompilar
todas as funções, validar todo recurso Pro ou anunciar paridade completa.

## Regressão encontrada no Android 12

O teste físico com IDs externos3,9,17 interrompeu o system_server em
InputTarget::addPointers. O AOSP Android 12 aceita IDs 0..31, mas usa
`pointerTransforms[MAX_POINTERS]` com MAX_POINTERS16, indexado pelo ID.
A pilha do Moto G30 é compatível com esse acesso inválido; o tombstone completo
do fabricante não foi obtido, portanto não se atribui ao binário um diagnóstico
mais específico que o demonstrado. O motor agora mapeia contatos em slots 0..9,
mantém o slot até UP e não renumera contatos restantes. Testes de JVM cobrem
IDs esparsos, retirada intermediária, reuso, limite de dez e cancelamento.
O reteste físico em 19/10/2026 confirmou três contatos, saída intermediária e
CANCEL no Moto G30 Android 12, sem reinício de system_server; áudio e Unicode
também passaram. Evidências em VALIDATION.md e no relatório físico da entrega.

Fontes primárias: [limites de Input.h](https://android.googlesource.com/platform/frameworks/native/+/refs/tags/android-12.0.0_r1/include/input/Input.h#178),
[vetor InputTarget](https://android.googlesource.com/platform/frameworks/native/+/refs/tags/android-12.0.0_r1/services/inputflinger/dispatcher/InputTarget.h#111),
[indexação em addPointers](https://android.googlesource.com/platform/frameworks/native/+/refs/tags/android-12.0.0_r1/services/inputflinger/dispatcher/InputTarget.cpp#54).

O MirrorPanel mantém implementação e identidade próprias. O código extraído,
APK, DLL, WASM, marcas e recursos Vysor ficam fora da distribuição.
