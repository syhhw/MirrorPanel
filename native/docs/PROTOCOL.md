# MPV1 — preview 4

Protocolo original do MirrorPanel. Desktop e servidor geram um socket abstrato
`mp_<128 bits hex>` e dois tokens aleatórios de 256 bits. A inicialização passa
os dois tokens em 128 caracteres ASCII pelo stdin de `adb shell -T`, mantido aberto.
O token do fluxo não aparece em argumentos. O segundo autentica o Companion
visível e seu canal privado de áudio/IME/heartbeat.

`MIRRORPANEL_READY <porta>` anuncia o TCP loopback Android do Companion.
O desktop aloca `adb forward tcp:0 localabstract:<nome>`, conecta em loopback e
envia o token do fluxo em 32 bytes. Comparação por `MessageDigest.isEqual`.
Captura começa somente com o indicador ativo. Bootstrap, conexão e heartbeat
têm prazo; perda do Companion encerra o motor.

## Framing binário

Cabeçalho de 20 bytes big endian, seguido do payload:

| Offset | Tipo | Campo |
|---|---|---|
| 0 | uint32 | magic `0x4d505631` |
| 4 | uint8 | tipo |
| 5 | uint8 | bit 0 keyframe; bit 1 configuração de codec |
| 6 | uint16 | reservado, zero |
| 8 | uint32 | comprimento, máximo 8 MiB no fluxo desktop |
| 12 | uint64 | timestamp em microssegundos, inteiro seguro no JavaScript |

- 1: metadata JSON, dimensões lógicas/codificadas, rotação e codec H.264.
- 2: H.264 Annex-B; SPS/PPS em pacote config; timestamp MediaCodec.
- 3: AAC-LC bruto, 48 kHz, 2 canais; AudioSpecificConfig em pacote config.
- 4: término do fluxo, com motivo UTF-8. `companion-lost` indica perda do
  canal autenticado e admite reconexão; `phone-stop` só é aceito como motivo
  explícito de versões anteriores. EOF ou exit code 0 não indicam intenção do usuário.
- 5: estado JSON: `{kind:'audio',state,message}`, `{kind:'text',id,ok,message}`
  ou `{kind:'heartbeat'}`. O último encaminha a confirmação autenticada do
  Companion ao desktop, mantendo viva uma conexão sem quadros novos.
- 6: heartbeat, exclusivo do canal Companion e ecoado pelo servidor.
- 7: comando JSON privado, exclusivo do canal Companion.

O canal Companion limita payload a 128 KiB. Escritas de frames são sincronizadas,
pois áudio, status e heartbeat podem ser produzidos por threads diferentes.
Vídeo e áudio compartilham o relógio monotônico Android; áudio usa AudioTimestamp
quando disponível e acumula amostras para evitar deriva por leitura.

O main limita quatro mensagens de vídeo e doze de áudio em trânsito. O renderer
confirma cada pacote e fecha VideoFrame/AudioData. Ao perder referência de vídeo,
descarta até keyframe e pede sync com limitação. Áudio mantém até 250 ms agendados,
com latência inicial de 45 ms; parar limpa fontes e suspende AudioContext.

## Controle desktop → Android

uint32 BE de tamanho + JSON UTF-8, até 128 KiB:

- `touch`: action 0 down/1 up/2 move/3 cancel; `id` alterado e `pointers:[{id,x,y}]`.
- Coordenadas finitas normalizadas [0,1], até dez contatos únicos; IDs externos 0..31.
- O servidor mapeia IDs externos a slots Android 0..9 estáveis até UP/CANCEL.
  Nunca indexa estruturas nativas com IDs externos altos. A ordem da lista
  define índices do MotionEvent; o bitfield do índice é calculado separadamente.
- Formato legado de toque único `{x,y}` usa ID externo 0.
- `key`: código Android 0..400; down/up gerados pelo motor.
- `text`: UTF-8 válido, até 64 KiB, sem surrogates isolados, com ID de ACK.
- `ime-restore`: teclado anterior; comando interno autenticado para o Companion.
- `audio-stop`, `sync`, `stop`: encerramento de áudio, keyframe, término da sessão.

Texto é commitado por InputConnection no thread principal Android, somente com
editor real ativo. Sem editor, retorna erro; não guarda texto para a próxima tela.
ACK/status saem por executor limitado, evitando rede no thread principal.
Composição é enviada após compositionend; colagem preserva o texto recebido.

## Ciclo de vida e gravação

Rotação cancela contatos, reinicia encoder e finaliza MP4 anterior. Áudio é
iniciado por Activity autorizada pelo token, diálogo MediaProjection e serviço
foreground. Usa AudioPlaybackCapture de mídia; não usa fonte de microfone.

Encerramento limpa somente processo/forward/JAR próprios, finaliza MP4 e restaura
IME e stay-awake. Stop durante início aguarda operações pendentes e recolhe
alocações tardias. Renderer morto encerra a sessão; phone-stop legado não reconecta.
Fechar a Activity de orientação e dispensar a notificação não encerram o fluxo.

MP4 fragmentado recebe H.264 convertido Annex-B→AVCC e AAC sem reencodificação.
Começa no keyframe; timestamps dos dois fluxos usam a mesma origem. Áudio anterior
ao primeiro vídeo é descartado. Troca de orientação/áudio finaliza o arquivo.
