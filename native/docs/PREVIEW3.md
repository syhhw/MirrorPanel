# Preview 3 — interface e estabilidade

Data de validação: 19/10/2026. Aparelho físico: Moto G30, Android 12/API 31.

## Reconexões em telas paradas

Reproduzido na preview 2: o MediaCodec parava de emitir quadros quando a tela
ficava estática. O timeout TCP de 15 s confundia ausência de imagem nova com
queda de conexão. O teste anterior terminou com `timeout`, após 728 pacotes de
vídeo, sem evidência de desconexão USB (`stability-before.json`).

O servidor agora encaminha ao desktop o heartbeat do Companion autenticado,
como pacote MPV1 tipo 5, JSON `{"kind":"heartbeat"}`. Isso não cria quadros
falsos nem desativa o watchdog: uma perda real de resposta ainda encerra a sessão.
O heartbeat existe independentemente de vídeo, áudio e composição da tela.

O teste TCP real abre um socket local e reduz o timeout para 180 ms. Com apenas
heartbeats, a sessão permanece ativa por 650 ms. Ao cessarem, encerra uma única
vez por timeout, restaura o IME e remove o forward/JAR pertencentes à sessão.

No celular, 90 s na qualidade padrão (1920/60/8 Mbps) produziram 1166 pacotes de
vídeo e 93 heartbeats; nenhum encerramento inesperado. Após inatividade, uma
interação retomou os quadros. IME, stay-awake e forwards voltaram ao baseline.
Também houve 40 s de ociosidade na interface sem reconexão ou troca de janela.

## Interface baseada na referência observada

A comparação do usuário e os artefatos locais da análise REA do Vysor orientaram:

- Barra indigo de 38 px com nome, captura, gravação, áudio, tela cheia,
  configurações e controles de janela; moldura Windows duplicada removida.
- Navegação Android inferior de 48 px. Vídeo ajustado à proporção original,
  sem faixas laterais na janela inicial. Maximização e redimensionamento livre
  continuam preservando a imagem inteira, podendo deixar espaço preto.
- Painel claro com lista Android verde, conexão de rede azul, preferências e
  atividade recolhida. Sem cartões de recursos que o produto não implementa.
- Configurações por aparelho com nome, qualidade, presets, Wi-Fi, APK e Parar.
- Menu da janela com volume, colar, energia, fixação no topo e atalhos.

Os ícones, HTML, CSS e comportamento foram implementados no MirrorPanel.
Nenhum arquivo do Vysor foi incorporado. Referência local: bundle
`app.1f260ea3.js`, regiões toolbar 361269–363600, defaults 443992–446000,
navigation 367480–368150 e settings 395800–404500 (offsets da análise estática).
O screenshot anterior do Vysor em emulador registra a estrutura, mas tinha
erro de conexão; não é usado como prova de vídeo funcionando.

REA foi usado também para observar passivamente as duas páginas file:// desta
revisão: evidências `ev_6a610d82fc6de3720f45d4febc4b9c24a6f6480d8a0da908e601d16f84256f7c`
e `ev_53a634a11b0fd9f8d8a7b2844ac5a2997b5c858e9e31778e94c6d084a1bffcaa`.
Cobertura policy_filtered, sem execução de JS ou captura de código-fonte pelo
REA. Os testes ativos e screenshots foram produzidos pelo harness Electron.

## Verificação

- TypeScript, ESLint, build Electron e Android: passaram.
- Node: 14 testes passaram; JVM PointerSlots passou.
- Unicode, composição e colagem exatos no editor Android; Alt+clique gerou
  DOWN/POINTER_DOWN/POINTER_UP/UP com IDs estáveis.
- UI física: 253 quadros decodificados, nenhum descarte, 413 pacotes de áudio;
  fechar a janela encerrou sem reiniciar.
- MP4 decodificado: vídeo 576×1280, AAC estéreo 48 kHz, tom medido 440,156 Hz.
- Janela normal medida em 396×966 px: vídeo 396×880 px, viewport idêntico,
  barra superior 38 px e inferior 48 px.
- Minimizar, maximizar/restaurar, fixar/desafixar, abrir configurações a partir
  do espelho, preferência de serial e fechamento limpo passaram.
- IPC rejeita ação desconhecida e só aceita o sender proprietário da janela.
- Pacote auditado: 82 arquivos, sem chaves privadas, fixture, Vysor ou scrcpy.

Testes intermediários detectaram interferência de outra instância/reinstalação
do Companion; a instância antiga foi fechada normalmente antes da validação.
O harness de entrada passou a ignorar mouse externo nas suas próprias janelas,
para medir apenas os eventos sintéticos. Uma captura de diálogo feita antes
da pintura foi corrigida aguardando a composição antes do screenshot.
Falhas de harness agora preservam exit code não zero.

Não é certificação de todas as versões/ROMs, nem de horas de operação. A matriz
histórica de compatibilidade e os limites de áudio/Wi-Fi permanecem em
`VALIDATION.md`. Esta revisão não acrescenta iOS, compartilhamento remoto,
H.265, clipboard bidirecional ou outros recursos não implementados.
