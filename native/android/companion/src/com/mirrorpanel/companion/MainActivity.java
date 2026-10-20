package com.mirrorpanel.companion;

import android.app.Activity;
import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

/** Connection guidance only. Closing this screen never stops the desktop session. */
public final class MainActivity extends Activity {

    static final String EXTRA_INDICATOR_BLOCKED = "indicator-blocked";

    private TextView heading, description, connection;

    private int dp(float value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private TextView label(String text, int size, int color) {
        TextView view = new TextView(this);
        view.setText(text);
        view.setTextSize(size);
        view.setTextColor(color);
        view.setLineSpacing(dp(3), 1);
        return view;
    }

    @Override
    public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setStatusBarColor(Color.rgb(0, 117, 164));
        getWindow().setNavigationBarColor(Color.rgb(0, 117, 164));
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.setBackgroundColor(Color.rgb(0, 143, 190));
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setPadding(dp(28), dp(28), dp(28), dp(28));
        TextView brand = label("MirrorPanel", 20, Color.WHITE);
        brand.setTypeface(null, android.graphics.Typeface.BOLD);
        layout.addView(brand);
        connection = label("PRONTO PARA CONECTAR", 11, Color.rgb(209, 243, 255));
        connection.setPadding(0, dp(8), 0, 0);
        layout.addView(connection);
        LinearLayout.LayoutParams illustration = new LinearLayout.LayoutParams(-1, dp(250));
        illustration.topMargin = dp(32);
        layout.addView(new ConnectionDrawing(this), illustration);
        heading = label("Abra o MirrorPanel no computador", 27, Color.WHITE);
        layout.addView(heading);
        description = label(
            "Conecte este aparelho por USB e selecione Espelhar no painel do computador.",
            16,
            Color.rgb(222, 246, 255)
        );
        description.setPadding(0, dp(16), 0, dp(24));
        layout.addView(description);
        TextView guide = label(
            "1. Ative a depuração USB nas opções do desenvolvedor.\n\n2. Conecte o cabo e autorize o computador quando o Android perguntar.\n\n3. Abra o MirrorPanel no computador e selecione este aparelho.",
            15,
            Color.WHITE
        );
        guide.setPadding(0, dp(22), 0, dp(22));
        guide.setVisibility(View.GONE);
        Button help = new Button(this);
        help.setText("Como conectar");
        help.setTextColor(Color.rgb(0, 99, 147));
        help.setOnClickListener(v ->
            guide.setVisibility(guide.getVisibility() == View.VISIBLE ? View.GONE : View.VISIBLE)
        );
        LinearLayout.LayoutParams button = new LinearLayout.LayoutParams(-2, -2);
        button.gravity = Gravity.START;
        layout.addView(help, button);
        layout.addView(guide);
        TextView footer = label(
            "A janela, o teclado, o áudio e as capturas são controlados pelo computador. Você pode fechar esta tela e continuar usando o celular.",
            13,
            Color.rgb(209, 243, 255)
        );
        footer.setPadding(0, dp(28), 0, 0);
        layout.addView(footer);
        scroll.addView(layout);
        setContentView(scroll);
        // Sessions start in ConnectActivity; this screen only explains why one could not.
        if (getIntent().getBooleanExtra(EXTRA_INDICATOR_BLOCKED, false)) {
            heading.setText("Ative o indicador de conexão");
            description.setText(
                "Permita as notificações do MirrorPanel nas configurações do Android e tente conectar novamente pelo computador."
            );
        }
    }

    @Override
    public void onResume() {
        super.onResume();
        if (SessionService.isRunning()) {
            connection.setText("CONECTADO AO COMPUTADOR");
            heading.setText("Seu Android está no computador");
            description.setText(
                "Continue usando seus aplicativos. Para ajustar a janela, gravar ou encerrar o espelhamento, use o MirrorPanel no computador."
            );
        }
    }

    private static final class ConnectionDrawing extends View {

        private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);

        ConnectionDrawing(Context context) {
            super(context);
            setImportantForAccessibility(IMPORTANT_FOR_ACCESSIBILITY_NO);
        }

        private void rect(Canvas c, float l, float t, float r, float b, float radius, int color) {
            paint.setColor(color);
            c.drawRoundRect(l, t, r, b, radius, radius, paint);
        }

        @Override
        protected void onDraw(Canvas canvas) {
            super.onDraw(canvas);
            canvas.save();
            float scale = Math.min(getWidth() / 320f, getHeight() / 230f);
            canvas.translate((getWidth() - 320 * scale) / 2, (getHeight() - 230 * scale) / 2);
            canvas.scale(scale, scale);
            rect(canvas, 18, 16, 274, 174, 10, Color.rgb(225, 240, 247));
            rect(canvas, 29, 29, 263, 158, 3, Color.rgb(38, 83, 120));
            for (int row = 0; row < 2; row++) for (int col = 0; col < 4; col++) {
                paint.setColor(row == 1 && col == 2 ? Color.rgb(71, 197, 212) : Color.rgb(161, 201, 221));
                canvas.drawCircle(65 + 43 * col, 72 + 39 * row, 12, paint);
            }
            rect(canvas, 131, 174, 161, 200, 1, Color.rgb(197, 223, 234));
            rect(canvas, 95, 198, 197, 208, 4, Color.rgb(225, 240, 247));
            rect(canvas, 236, 84, 304, 210, 9, Color.WHITE);
            rect(canvas, 243, 98, 297, 191, 2, Color.rgb(38, 83, 120));
            paint.setColor(Color.rgb(71, 197, 212));
            canvas.drawCircle(270, 142, 16, paint);
            paint.setColor(Color.rgb(161, 201, 221));
            canvas.drawCircle(270, 201, 4, paint);
            canvas.restore();
        }
    }
}
