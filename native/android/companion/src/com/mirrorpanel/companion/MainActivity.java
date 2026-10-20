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

        status = text(getString(R.string.status_ready), 13, FOG, false);
        status.setPadding(dp(12), dp(6), dp(14), dp(6));
        status.setCompoundDrawablePadding(dp(8));
        LinearLayout.LayoutParams chip = new LinearLayout.LayoutParams(-2, -2);
        chip.topMargin = dp(28);
        layout.addView(status, chip);

        heading = text(getString(R.string.heading_idle), 26, FROST, true);
        layout.addView(heading, margins(dp(16)));
        description = text(getString(R.string.description_idle), 16, FOG, false);
        layout.addView(description, margins(dp(10)));

        LinearLayout list = new LinearLayout(this);
        list.setOrientation(LinearLayout.VERTICAL);
        list.setBackground(rounded(SURFACE, dp(18)));
        list.setPadding(dp(20), dp(18), dp(20), dp(20));
        list.addView(text(getString(R.string.steps_title), 15, FROST, true));
        String[] lines = {
            getString(R.string.step_debugging),
            getString(R.string.step_cable),
            getString(R.string.step_choose),
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

        TextView footer = text(getString(R.string.footer), 13, FOG, false);
        layout.addView(footer, margins(dp(24)));

        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.setBackgroundColor(ABYSS);
        scroll.addView(layout);
        setContentView(scroll);
        showState(false);
        // Sessions start in ConnectActivity; this screen only explains why one could not.
        if (getIntent().getBooleanExtra(EXTRA_INDICATOR_BLOCKED, false)) {
            heading.setText(R.string.heading_indicator_blocked);
            description.setText(R.string.description_indicator_blocked);
        }
    }

    @Override
    public void onResume() {
        super.onResume();
        if (SessionService.isRunning()) {
            showState(true);
            heading.setText(R.string.heading_mirroring);
            description.setText(R.string.description_mirroring);
        }
    }

    /** A small status pill: grey dot while waiting, glass dot once the desktop is connected. */
    private void showState(boolean connected) {
        status.setText(connected ? R.string.status_connected : R.string.status_ready);
        status.setTextColor(connected ? FROST : FOG);
        status.setBackground(rounded(SURFACE, dp(999)));
        GradientDrawable dot = rounded(connected ? GLASS : FOG, dp(4));
        dot.setSize(dp(8), dp(8));
        status.setCompoundDrawablesRelativeWithIntrinsicBounds(dot, null, null, null);
        steps.setVisibility(connected ? View.GONE : View.VISIBLE);
    }
}
