# Revisão trail — preview 4

Em 19/10/2026, `trail check --base HEAD` comparou 71 arquivos e cinco learnings.
Retornou exit 1 e 20 alertas, com diff limitado aos primeiros 400 KB. Não é
registrado como check verde. Foi usado índice Git temporário, sem alterar o
staging do usuário, e não houve commit/push/PR.

Revisão manual:

- `mirrorpanel/test/profile`: coincidência com a learning de não executar
  instâncias concorrentes. Os harnesses físicos rodaram em série; o produto
  mantém o lock de instância única e não cria perfis de teste.
- `vysor web`, `Android 2.0 → 265`, `mediacodec`: associações da documentação e
  termos genéricos já analisados na revisão preview3. Não foi incorporado código
  Vysor, alterado o mínimo Android nem reintroduzido profile sem level.
- `preview3 control session/window control`: a revisão corrige precisamente o
  teste incompleto anterior. Agora há registro separado de janelas e verificação
  física dos controles depois de oito falhas provocadas.
- `notification session`: o manifesto continua declarando permissões de
  notificação/foreground. O deleteIntent foi removido; não se elimina o indicador.
- `companion android main/status/exception`: referências genéricas; a Activity
  desenha orientação e o executor/bridge continuam responsáveis por comunicação.
- `text content status`: Java TextView de orientação é outro contexto. No
  renderer, o callback de vídeo não apaga mais os filhos do overlay.
- `never put token`: o token de vídeo continua no stdin/socket, não argv/logs.
  A Activity recebe o token separado do Companion via Intent, contrato já
  existente. Não registra esse valor nem o token de vídeo em logs de erro.

O relatório PREVIEW4.md registra alcance e limitações dos testes. As learnings
anteriores foram preservadas; a nova explica a correção pedida pelo usuário.
