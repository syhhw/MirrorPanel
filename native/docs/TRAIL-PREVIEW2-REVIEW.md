# Revisão dos alertas trail — preview 2

`trail check --base HEAD` executado em 19/10/2026 com índice Git temporário.
O staging do usuário permaneceu inalterado. Resultado: exit1,20conflitos
lexicais. O diff excedeu400 KB; a própria ferramenta informou cobertura parcial.
Este resultado não é anunciado como check verde ou revisão exaustiva.

Os alertas foram confrontados com os fontes e testes:

- “vysor web”: documentação da referência; o produto não carrega o bundle Vysor.
- “Android de2.0 para265”: associação numérica incorreta entre versão do produto
  e H.265 listado como não implementado. Manifest minSdk29, target35.
- “mediacodec”: a decisão rejeitou forçar profile sem level, não o MediaCodec.
  Vídeo deriva configuração SPS; captura e AAC usam MediaCodec deliberadamente.
- “companion/android/main/send/status/exception”: tokens genéricos. Respostas
  passam pelo executor limitado; input permanece no main thread por exigência IME.
- “set/user/enabled/test/capture”: fixture e preparação/restauração de rotação.
  Não são evidência de retorno ao fluxo de teste descartado.
- “token/byte/adb”: bootstrap continua ASCII128 caracteres no stdin aberto;
  os32 bytes no socket autenticado são uma fronteira diferente e correta.
- “native ids”: PointerSlots é precisamente a correção. Emite apenas0..9 e os
  testes demonstram IDs externos3,9,17 sendo remapeados para0,1,2.

Uma nova learning foi registrada sem editar a anterior. Ainda não houve commit
ou PR. A revisão manual e os testes reais constam em VALIDATION.md.

Reteste físico: check repetido após os relatórios e a terceira learning.
Continuou exit1 com20 alertas lexicais, limite400KB,64arquivos/3learnings.
Nenhum fonte do produto mudou nesta retomada; os alertas têm as mesmas causas
registradas acima. Testes físicos completos passaram; o trail não é marcado PASS.
