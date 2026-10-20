# MirrorPanel — avaliação e proposta para 1.3.0

Avaliação em 09/09/2026, sobre o checkout local, incluindo alterações não commitadas.
Versão encontrada: `1.3.0-0`. Este documento não declara a versão pronta para publicação.

## Minha avaliação

O valor do MirrorPanel está em organizar o trabalho com vários Android: identificar,
conectar, espelhar, gravar e transferir arquivos sem exigir comandos. O projeto já
tem recursos úteis de produto: reconexão, nomes por aparelho, gravação leve, QR,
APK/XAPK, português/inglês e instalador com atualização. Há separação entre motor,
interface e updater, testes de regressão e uma pipeline de release que executa testes.

Eu posicionaria a 1.3.0 como uma versão de conexão simples e gravação confiável,
com a identidade visual renovada. Como hipótese de público inicial, testadores,
assistências e pessoas que demonstram ou gravam vários aparelhos parecem adequados.
Isso precisa de validação com usuários; não foi feita pesquisa de mercado.

## Identidade visual implementada nesta etapa

- Ícone com duas telas sobrepostas, azul/ciano/branco, desenhado no código existente.
- ICO com 10 tamanhos, de 16 a 256 px, usado pelo executável e instalador.
- Ícones da janela em múltiplas resoluções e mesma marca na bandeja.
- Fonte Inter 4.1 Regular/Bold empacotada, com licença e fallback para Segoe UI.
- Registro privado da fonte por processo; não instala a fonte no Windows.
- Fonte unificada em títulos, cartões, botões e diálogos. Logs/atalhos monoespaçados.
- Corrigida precedência de fontes: o antigo wildcard `*Font` anulava a hierarquia
  dos estilos ttk. Título principal agora usa 16 pt, corpo 9 pt, detalhes 8 pt.
- Workflow e spec local incluem os assets. Instalador aceita diretório de build
  alternativo para validar sem substituir a distribuição local anterior.

Prévia da interface real com dados fictícios: [português](visual-refresh/panel-pt.png)
e [inglês](visual-refresh/panel-en.png). [Ícone em vários tamanhos](visual-refresh/icon-sizes.png).

## O que eu resolveria antes do lançamento final

### 1. Atualização da prévia para a versão final

**Reproduzido em execução.** `updater._parse_version('1.3.0')` resulta em `(1,3,0)`;
`_parse_version('1.3.0-0')` resulta em `(1,3,0,0)`. A comparação considera a final
mais antiga, portanto uma instalação `1.3.0-0` não recebe `1.3.0` pelo atualizador.
O teste `test_build_suffix_beats_bare_version` preserva essa convenção antiga.

Fonte: `mirrorpanel/updater.py:23`, `mirrorpanel/updater.py:69`, `tests/test_updater.py:33`.

Definir convenção única de versões e uma transição para clientes já distribuídos.
Corrigir apenas o updater do novo instalador não corrige o comparador de quem
ainda usa o antigo. Se a prévia já foi distribuída, será preciso planejar uma
versão intermediária reconhecível ou orientar instalação manual.
Critério: testar upgrades desde versões 1.2.0-N e desde a prévia 1.3.0-0.
Segundo [SemVer](https://semver.org/lang/pt-BR/), pré-lançamentos precedem a versão final.

### 2. Encerramento deve afetar apenas sessões do MirrorPanel

**Constatação estática.** `kill_existing_scrcpy()` encerra por nome `scrcpy.exe`,
sem distinguir os processos iniciados pelo painel. É chamada na abertura e no
fechamento; `shutdown()` também encerra o servidor ADB, que pode estar compartilhado.
Isso pode interromper outro scrcpy ou ferramenta de desenvolvimento aberta.

Fonte: `mirrorpanel/mirror_engine.py:465`, `MirrorManager.shutdown`,
`mirrorpanel/panel.py:1229`.

Rastrear os processos da própria sessão e definir a propriedade do servidor ADB.
Critério: abrir/fechar MirrorPanel preservando uma sessão externa de scrcpy e ADB.
Nenhum encerramento real foi executado na revisão. Uma chamada de simulação foi
bloqueada por política automática sem razão detalhada; mantida análise estática.

### 3. Tornar o ciclo da gravação resistente a falhas

**Riscos identificados no código, ainda sem reprodução em aparelho.**
`start_recording()` usa modelo + horário até segundos como nome do arquivo;
dois aparelhos do mesmo modelo podem gerar o mesmo caminho. O estado de gravação
é marcado antes de verificar se o novo processo realmente iniciou. Reiniciar
o espelhamento por reconexão ou ajuste reutiliza `self.recording[serial]`.

Fonte: `mirrorpanel/mirror_engine.py:747`, `mirrorpanel/mirror_engine.py:978`.

Gerar arquivos únicos por dispositivo e segmento; confirmar início antes de exibir
sucesso; finalizar ou suspender o estado ao fechar/parar uma sessão. Validar o
comportamento real do scrcpy ao reabrir um destino existente antes de afirmar perda.
Critério: dois aparelhos iguais, queda durante gravação, alteração de qualidade,
falha ao iniciar e fechamento da janela; todos os arquivos recuperáveis e estados corretos.

### 4. Transferências não podem atrasar o controle dos aparelhos

**Constatação estática.** Envio/instalação usa a mesma thread/fila que detecção e
ações de iniciar/parar. Os timeouts de operações chegam a 120/180 s por chamada;
um lote percorre aparelhos sequencialmente. A janela continua desenhando, mas o
controle/detecção pode ficar esperando. No fechamento, `worker.join(timeout=5)`
não garante que essa thread terminou antes de alterar o estado compartilhado.

Fonte: `mirrorpanel/panel.py:1229`, `mirrorpanel/panel.py:1314`,
`App._shutdown_and_destroy`, `MirrorManager.install_xapk_to_device`.

Separar operações demoradas da detecção, com concorrência limitada e coordenação
explícita do estado. Critério: conseguir parar outro aparelho durante uma transferência
longa e fechar o painel durante o lote sem deixar trabalho ativo após o fechamento.

### 5. Identidade do aparelho precisa sobreviver à troca de conexão

**Constatação estática.** Apelidos ficam por serial ADB. A ativação de Wi-Fi copia
ajustes mas não apelidos. A UI e deduplicação classificam conexão sem fio pela
presença de `:`; seriais mDNS do pareamento QR não seguem necessariamente essa regra.

Fonte: `MirrorManager.set_nickname`, `MirrorManager.enable_wifi`,
`MirrorManager._dedupe_physical_devices`, `mirrorpanel/panel.py:866`.

Separar identidade física e transporte (USB/TCP/mDNS); manter apelido/qualidade
no aparelho físico. Critério: USB → Wi-Fi → QR sem perder ajustes nem duplicar linhas.

## Melhorias de experiência para a mesma versão

1. Estado vazio com duas ações claras: conectar por USB e parear por QR. O QR já
   existe; a mensagem vazia ainda direciona apenas para USB.
2. Estados visíveis de conexão, reconexão e operação pendente, com orientação útil.
   A documentação do [Android](https://developer.android.com/tools/adb) confirma
   que descoberta/conexão automática depende de mDNS; parear e conectar são etapas
   que merecem feedback distinto quando a rede impede a descoberta.
3. Perfis “Leve”, “Equilibrado” e “Alta qualidade” incluindo resolução. Hoje a
   gravação leve existe, mas os ajustes comuns ainda exigem codec/bitrate/fps.
4. Seleção de aparelhos para ações em lote, em vez de apenas todos/individual.
5. Abrir a pasta ou último arquivo após gravação/captura; diagnóstico exportável.

Eu priorizaria 1–3 depois dos problemas de confiabilidade. Galeria completa,
automação avançada, controle sincronizado e mudança de framework podem esperar.

## Preparação da distribuição

- Fixar dependências de runtime/build: `requirements.txt` e PyInstaller não têm versões.
- Validar integridade dos binários baixados e do instalador entregue pelo updater.
  Hoje há verificação de tamanho no updater, mas não hash/assinatura.
- Documentar requisitos, execução local, build e solução de problemas USB/Wi-Fi.
- Atualizar README/changelog com QR, transferências e aparência atual. O screenshot
  principal existente mostra 1.2.0-1; as novas imagens são previews, não hardware real.
- Extrair responsabilidades de `panel.py` gradualmente, ao alterar cada fluxo;
  não condicionar o lançamento a uma reescrita ampla.

## Evidência e limites da validação

- Baseline: 88 testes passaram. Após identidade visual: 91 testes passaram.
- Ruff essencial (`--isolated --select E4,E9,F`): passou.
- Ruff completo para `typography.py` e seus testes: passou.
- Ruff global herdado tinha 64 ocorrências antes das alterações. Não equivale a
  uma base global limpa; limpeza ampla está fora desta mudança visual.
- Compilação Python (`compileall`): passou.
- Prévia Tk real em PT/EN: família resolvida como Inter; três linhas de aparelho
  cabem na largura medida. Worker, rede, ADB e bandeja desativados nesse harness.
- PyInstaller: build local com fonte/licença incluídas e ícone incorporado.
- Inno Setup 7 local: compilação do instalador; CI ainda usa Inno 6.
- Não houve instalação real, teste com celulares ou validação completa de DPI/monitores.
- Não houve publicação, tag, commit ou push. O candidato mantém `1.3.0-0`.

Os próximos testes manuais devem cobrir instalação nova, upgrade preservando
preferências, QR em rede doméstica, 2–3 aparelhos, gravação com reconexão, coexistência
com scrcpy externo e janelas em escalas de 125%/150%.
