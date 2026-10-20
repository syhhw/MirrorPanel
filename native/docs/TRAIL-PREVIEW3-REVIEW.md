# Revisão trail — preview 3

`trail check --base HEAD` executado em 19/10/2026, com índice Git temporário.
O índice do usuário não foi modificado. Foram comparados 65 arquivos com quatro
learnings. Resultado: exit 1, 20 alertas; diff acima de 400 KB, cobertura parcial.
Este check não é apresentado como verde.

Revisão manual dos alertas:

- `test mirrorpanel mirror`, `mirrorpanel android companion`, `profile ... stop`:
  correspondência lexical com a learning de isolamento de testes. O produto
  não introduz múltiplos perfis ou instâncias concorrentes; requestSingleInstanceLock
  permanece. Perfis separados pertencem apenas aos harnesses, executados em série.
- `vysor web`: documentação da referência, não uso do bundle no produto. A
  auditoria confirma ausência de recursos Vysor/scrcpy no pacote.
- `Android 2.0 → 265`: associação numérica espúria com versão 2.0 e H.265 citado
  como não implementado. Não houve mudança de mínimo Android nesta revisão.
- `mediacodec media codec`: a decisão anterior rejeitou forçar profile sem level,
  não MediaCodec. A captura não passou a forçar aquele parâmetro.
- `companion android main/exception/send status`: identificadores genéricos.
  Status continua no executor; heartbeat encaminhado pelo leitor de socket,
  não pelo main thread Android. O thread principal continua responsável por IME.
- `set user enabled`: palavra genérica da preparação do fixture; não indica
  reintrodução do procedimento de rotação descartado na learning histórica.

As correções e testes reais estão em PREVIEW3.md. A nova learning não altera
as anteriores. Sem commit, push ou PR nesta etapa.
