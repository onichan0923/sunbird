package dev.sunbird.appearance;

import android.app.Activity;
import android.app.Application;
import android.content.Context;
import android.content.ContextWrapper;
import android.graphics.drawable.ColorDrawable;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.view.ViewTreeObserver;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.view.ViewGroup;
import android.view.inspector.WindowInspector;
import java.util.IdentityHashMap;

// Paint only the system-owned status inset. A drawable has no input or accessibility surface.
public final class StatusBar implements Application.ActivityLifecycleCallbacks, ViewTreeObserver.OnWindowFocusChangeListener, View.OnAttachStateChangeListener {
    private static final Handler main = new Handler(Looper.getMainLooper());
    private static StatusBar owner;
    private final IdentityHashMap<View, Strip> strips = new IdentityHashMap<>();
    private final IdentityHashMap<View, ControlSurfaces> controls = new IdentityHashMap<>();
    private int color;
    private boolean light;

    public static void set(Application app, boolean enabled, int color, boolean darkIcons) {
        main.post(() -> {
            if (!enabled) {
                if (owner != null) {
                    app.unregisterActivityLifecycleCallbacks(owner);
                    for (Strip strip : owner.strips.values()) strip.remove();
                    owner.strips.clear();
                    for (View root : owner.controls.keySet().toArray(new View[0])) owner.forgetControls(root);
                    owner = null;
                }
                return;
            }
            if (owner == null) {
                owner = new StatusBar();
                app.registerActivityLifecycleCallbacks(owner);
            }
            owner.color = color;
            owner.light = darkIcons;
            for (Strip strip : owner.strips.values()) strip.update(color, darkIcons);
            if (Build.VERSION.SDK_INT >= 29) {
                for (View root : WindowInspector.getGlobalWindowViews()) {
                    if (!(root.getLayoutParams() instanceof WindowManager.LayoutParams)) continue;
                    WindowManager.LayoutParams params = (WindowManager.LayoutParams) root.getLayoutParams();
                    owner.observeControls(root);
                    if (params.type != WindowManager.LayoutParams.TYPE_BASE_APPLICATION) continue;
                    // DecorContext may wrap the application. Content views are
                    // normally inflated with the Activity's themed context.
                    Activity activity = findActivity(root, 4);
                    if (activity != null) owner.attach(activity);
                    else owner.install(root, null);

                }
            }
        });
    }

    private static Activity findActivity(View view, int depth) {
        Context context = view.getContext();
        while (context instanceof ContextWrapper) {
            if (context instanceof Activity) return (Activity) context;
            Context next = ((ContextWrapper) context).getBaseContext();
            if (next == context) break;
            context = next;
        }
        if (depth > 0 && view instanceof ViewGroup) {
            ViewGroup group = (ViewGroup) view;
            for (int i = 0; i < Math.min(6, group.getChildCount()); i++) {
                Activity activity = findActivity(group.getChildAt(i), depth - 1);
                if (activity != null) return activity;
            }
        }
        return null;
    }

    private void observeControls(View root) {
        if (controls.containsKey(root)) return;
        controls.put(root, null);
        root.addOnAttachStateChangeListener(this);
        if (root.isAttachedToWindow()) onViewAttachedToWindow(root);
    }

    private void forgetControls(View root) {
        ControlSurfaces paint = controls.remove(root);
        if (paint != null) paint.remove();
        root.removeOnAttachStateChangeListener(this);
        ViewTreeObserver observer = root.getViewTreeObserver();
        if (observer.isAlive()) observer.removeOnWindowFocusChangeListener(this);
    }

    private final Runnable scanWindows = () -> {
        if (owner == this && Build.VERSION.SDK_INT >= 29)
            for (View root : WindowInspector.getGlobalWindowViews()) observeControls(root);
    };

    public void onWindowFocusChanged(boolean focused) {
        main.removeCallbacks(scanWindows);
        main.post(scanWindows);
        // Window registration and focus dispatch can occur in different traversals.
        main.postDelayed(scanWindows, 120);
    }

    public void onViewAttachedToWindow(View root) {
        if (owner != this || controls.get(root) != null) return;
        controls.put(root, new ControlSurfaces(root));
        root.getViewTreeObserver().addOnWindowFocusChangeListener(this);
        root.postInvalidateOnAnimation();
    }

    public void onViewDetachedFromWindow(View v) { forgetControls(v); }

    private void install(View root, Window window) {
        observeControls(root);
        Strip existing = strips.get(root);
        if (existing != null) {
            if (existing.window != null || window == null) return;
            existing.remove();
        }
        Strip strip = new Strip(root, window);
        strips.put(root, strip);
        strip.update(color, light);
    }

    private void attach(Activity activity) {
        if (!activity.isDestroyed()) install(activity.getWindow().getDecorView(), activity.getWindow());
    }

    public void onActivityResumed(Activity activity) { attach(activity); }
    public void onActivityDestroyed(Activity activity) {
        Strip strip = strips.remove(activity.getWindow().getDecorView());
        if (strip != null) strip.remove();
    }
    public void onActivityCreated(Activity a, Bundle b) {}
    public void onActivityStarted(Activity a) {}
    public void onActivityPaused(Activity a) {}
    public void onActivityStopped(Activity a) {}
    public void onActivitySaveInstanceState(Activity a, Bundle b) {}

    private static final class Strip implements ViewTreeObserver.OnPreDrawListener {
        final Window window;
        final View decor;
        final ColorDrawable paint = new ColorDrawable();
        final int oldColor;
        final boolean oldContrast, oldIcons;


        Strip(View decor, Window window) {
            this.window = window;
            this.decor = decor;
            oldColor = window != null ? window.getStatusBarColor() : 0;
            oldContrast = Build.VERSION.SDK_INT >= 29 && window != null && window.isStatusBarContrastEnforced();
            oldIcons = (decor.getSystemUiVisibility() & View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR) != 0;
            decor.getOverlay().add(paint);
            decor.getViewTreeObserver().addOnPreDrawListener(this);
        }

        void icons(boolean dark) {
            int flags = decor.getSystemUiVisibility();
            int next = dark ? flags | View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR : flags & ~View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
            if (next != flags) decor.setSystemUiVisibility(next);
        }

        void update(int color, boolean dark) {
            paint.setColor(color);
            if (window != null && Build.VERSION.SDK_INT >= 29) window.setStatusBarContrastEnforced(false);
            if (window != null) window.setStatusBarColor(color);
            icons(dark);
            onPreDraw();
        }

        public boolean onPreDraw() {
            WindowInsets insets = decor.getRootWindowInsets();
            int top = 0;
            if (insets != null) {
                top = Build.VERSION.SDK_INT >= 30 ? insets.getInsets(WindowInsets.Type.statusBars()).top
                    : insets.getSystemWindowInsetTop();
            }
            if (top != paint.getBounds().bottom || decor.getWidth() != paint.getBounds().right)
                paint.setBounds(0, 0, decor.getWidth(), top);
            return true;
        }

        void remove() {
            decor.getViewTreeObserver().removeOnPreDrawListener(this);
            decor.getOverlay().remove(paint);
            if (window != null) window.setStatusBarColor(oldColor);
            if (window != null && Build.VERSION.SDK_INT >= 29) window.setStatusBarContrastEnforced(oldContrast);
            icons(oldIcons);
        }
    }
}
