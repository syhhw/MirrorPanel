# MirrorPanel 2.0: motor próprio + Electron

Status: **plano aprovado** (18/10/2026).
Objetivo: o MirrorPanel vira um app **Electron + Node.js (TypeScript)** que espelha e controla aparelhos Android sozinho, sem `scrcpy.exe` nem `scrcpy-server`. Continua open source sob Apache-2.0.
Referência de arquitetura: Vysor 5.0.7 (análise com o REA). O MirrorPanel segue a mesma ideia, com **código 100% original**.

---

## 1. Princípios

1. **Código original.** Do Vysor aproveitamos só a arquitetura. Nenhum código, APK, DLL ou recurso dele entra no repositório.
2. **Consentimento do dono do aparelho.** O motor só funciona com **Depuração USB ativada e autorizada** no aparelho. O app companheiro **MirrorPanel Companion** aparece na lista de apps e pode ser desinstalado a qualquer momento.
3. **Transparência.** Enquanto espelha, o aparelho mostra a notificação **"MirrorPanel está espelhando esta tela"**, e o PC sempre abre uma janela visível. Quando a sessão termina, o servidor encerra e a notificação some.
4. **Um app só.** Painel e espelhamento no mesmo app Electron. A versão Python/Tkinter (1.x) continua funcionando até a 2.0 ter paridade de recursos.
5. **Sem FFmpeg.** Decodificação com WebCodecs no Chromium do Electron (aceleração por hardware, sem questões de licença).

---

## 2. Arquitetura
_Seções de arquitetura, protocolo, fases e riscos: a completar._
