package com.mirrorpanel.companion;

import android.app.Activity;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

/** Connection guidance only. Closing this screen never stops the desktop session. */
public final class MainActivity extends Activity {

    static final String EXTRA_INDICATOR_BLOCKED = "indicator-blocked";

    /** The desktop palette, so the phone screen reads as the same product. */
    private static final int ABYSS = Color.rgb(14, 23, 28);
    private static final int SURFACE = Color.rgb(21, 34, 42);
    private static final int FROST = Color.rgb(230, 238, 240);
    private static final int FOG = Color.rgb(154, 170, 178);
    private static final int GLASS = Color.rgb(57, 194, 201);

    private TextView status, heading, description;
    private View steps;

    private int dp(float value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private TextView text(String value, float size, int color, boolean bold) {
        TextView view = new TextView(this);
        view.setText(value);
        view.setTextSize(size);
        view.setTextColor(color);
        view.setLineSpacing(dp(3), 1);
        if (bold) view.setTypeface(Typeface.create("sans-serif-medium", Typeface.BOLD));
        return view;
    }

    private static GradientDrawable rounded(int color, float radius) {
        GradientDrawable shape = new GradientDrawable();
        shape.setColor(color);
        shape.setCornerRadius(radius);
        return shape;
    }

    private static LinearLayout.LayoutParams margins(int top) {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, -2);
        params.topMargin = top;
        return params;
    }

    @Override
    public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setStatusBarColor(ABYSS);
        getWindow().setNavigationBarColor(ABYSS);

        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setPadding(dp(28), dp(36), dp(28), dp(28));

        LinearLayout brand = new LinearLayout(this);
        brand.setGravity(Gravity.CENTER_VERTICAL);
        ImageView mark = new ImageView(this);
        mark.setImageResource(R.drawable.logo_mark);
        mark.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
        brand.addView(mark, new LinearLayout.LayoutParams(dp(44), dp(44)));
        TextView name = text("MirrorPanel", 20, FROST, true);
        name.setPadding(dp(12), 0, 0, 0);
        brand.addView(name);
        layout.addView(brand);

        status = text("Pronto para conectar", 13, FOG, false);
        status.setPadding(dp(12), dp(6), dp(14), dp(6));
        status.setCompoundDrawablePadding(dp(8));
        LinearLayout.LayoutParams chip = new LinearLayout.LayoutParams(-2, -2);
        chip.topMargin = dp(28);
        layout.addView(status, chip);

        heading = text("Abra o MirrorPanel no computador", 26, FROST, true);
        layout.addView(heading, margins(dp(16)));
        description = text("Conecte este aparelho por USB e escolha Espelhar no painel do computador.", 16, FOG, false);
        layout.addView(description, margins(dp(10)));

        LinearLayout list = new LinearLayout(this);
        list.setOrientation(LinearLayout.VERTICAL);
        list.setBackground(rounded(SURFACE, dp(18)));
        list.setPadding(dp(20), dp(18), dp(20), dp(20));
        list.addView(text("Como conectar", 15, FROST, true));
        String[] lines = {
            "Ative a depuração USB nas opções do desenvolvedor.",
            "Conecte o cabo e autorize o computador quando o Android perguntar.",
            "No MirrorPanel do computador, escolha este aparelho.",
        };
        for (int index = 0; index < lines.length; index++) {
            LinearLayout row = new LinearLayout(this);
            TextView number = text(String.valueOf(index + 1), 13, ABYSS, true);
            number.setGravity(Gravity.CENTER);
            number.setBackground(rounded(GLASS, dp(11)));
            row.addView(number, new LinearLayout.LayoutParams(dp(22), dp(22)));
            TextView line = text(lines[index], 15, FROST, false);
            line.setPadding(dp(12), 0, 0, 0);
            row.addView(line, new LinearLayout.LayoutParams(0, -2, 1));
            list.addView(row, margins(dp(14)));
        }
        steps = list;
        layout.addView(list, margins(dp(28)));

        TextView footer = text(
            "A janela, o teclado, o áudio e as capturas são controlados pelo computador. Você pode fechar esta tela e continuar usando o celular.",
            13,
            FOG,
            false
        );
        layout.addView(footer, margins(dp(24)));

        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.setBackgroundColor(ABYSS);
        scroll.addView(layout);
        setContentView(scroll);
        showState(false);
        // Sessions start in ConnectActivity; this screen only explains why one could not.
        if (getIntent().getBooleanExtra(EXTRA_INDICATOR_BLOCKED, false)) {
            heading.setText("Ative o indicador de conexão");
            description.setText(
                "Permita as notificações do MirrorPanel nas configurações do Android e conecte de novo pelo computador."
            );
        }
    }

    @Override
    public void onResume() {
        super.onResume();
        if (SessionService.isRunning()) {
            showState(true);
            heading.setText("Seu Android está no computador");
            description.setText(
                "Continue usando seus aplicativos. Para ajustar a janela, gravar ou encerrar o espelhamento, use o MirrorPanel no computador."
            );
        }
    }

    /** A small status pill: grey dot while waiting, glass dot once the desktop is connected. */
    private void showState(boolean connected) {
        status.setText(connected ? "Conectado ao computador" : "Pronto para conectar");
        status.setTextColor(connected ? FROST : FOG);
        status.setBackground(rounded(SURFACE, dp(999)));
        GradientDrawable dot = rounded(connected ? GLASS : FOG, dp(4));
        dot.setSize(dp(8), dp(8));
        status.setCompoundDrawablesRelativeWithIntrinsicBounds(dot, null, null, null);
        steps.setVisibility(connected ? View.GONE : View.VISIBLE);
    }
}
