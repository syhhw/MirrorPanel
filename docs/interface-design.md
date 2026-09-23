# Interface do MirrorPanel

Direção: um utilitário de desktop discreto, com hierarquia clara entre aparelho,
estado e ações. Segoe UI aproxima o painel do Windows; Consolas fica restrita
a horários e combinações de teclas.

- Fundo #1c1c1c, superfície #25272a, divisor #3b3e43.
- Texto #f1f2f4, secundário #b0b5be, destaque #9bbcf2.
- Margens de 24 px, intervalos de 8/12/16 px; botões secundários sem caixas.
- Nome do aparelho à esquerda; estado e ação principal à direita.
- Ferramentas do aparelho em uma linha secundária com rótulos legíveis.
- Atividade em superfície recuada, com hora e nível alinhados, filtro de
  problemas, cópia e limpeza. Novas mensagens respeitam a posição de leitura.
- Diálogos com título, descrição, conteúdo agrupado e ações no rodapé.

Revisão contra o pedido: evitar caixas dentro de caixas, títulos pesados, brilho
decorativo e cores vivas em todos os ícones. O desenho depende de espaçamento,
alinhamento e estados legíveis, sem animações ornamentais. Controles ttk
preservam foco de teclado e comportamento nativo.
