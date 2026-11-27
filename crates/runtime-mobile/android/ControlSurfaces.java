package dev.sunbird.appearance;

import android.graphics.Canvas;
import android.graphics.ColorFilter;
import android.graphics.Matrix;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.PixelFormat;
import android.graphics.Rect;
import android.graphics.RectF;
import android.graphics.drawable.Drawable;
import android.view.View;
import android.view.ViewGroup;
import android.view.ViewParent;
import android.view.ViewTreeObserver;
import android.widget.TextView;
import java.util.ArrayList;
import java.util.IdentityHashMap;
import java.util.Iterator;
import java.util.Map;

/** Decorations owned by invisible, zero-size plugin children in this window. */
final class ControlSurfaces implements ViewTreeObserver.OnGlobalLayoutListener, ViewTreeObserver.OnPreDrawListener {
    private final View root;
    private final int tagKey;
    private final IdentityHashMap<ViewGroup, Surface> live = new IdentityHashMap<>();
    private boolean dirty = true;

    ControlSurfaces(View root) {
        this.root = root;
        int key = root.getResources().getIdentifier("wasm_native_id", "id", root.getContext().getPackageName());
        tagKey = key != 0 ? key : root.getResources().getIdentifier("wasm_native_id", "id", "com.discord");
        if (tagKey != 0) {
            root.getViewTreeObserver().addOnGlobalLayoutListener(this);
            root.getViewTreeObserver().addOnPreDrawListener(this);
        }
    }

    public void onGlobalLayout() { dirty = true; }

    private void collect(View node, IdentityHashMap<ViewGroup, String> marks) {
        Object id = node.getTag(tagKey);
        if (id instanceof String && ((String) id).startsWith("sunbird.m3e/") && node.getParent() instanceof ViewGroup) {
            marks.put((ViewGroup) node.getParent(), ((String) id).substring("sunbird.m3e/".length()));
            return;
        }
        if (node instanceof ViewGroup) {
            ViewGroup group = (ViewGroup) node;
            for (int i = 0; i < group.getChildCount(); i++) collect(group.getChildAt(i), marks);
        }
    }

    private void reconcile() {
        IdentityHashMap<ViewGroup, String> marks = new IdentityHashMap<>();
        collect(root, marks);
        Iterator<Map.Entry<ViewGroup, Surface>> it = live.entrySet().iterator();
        while (it.hasNext()) {
            Map.Entry<ViewGroup, Surface> entry = it.next();
            Surface surface = entry.getValue();
            if (!surface.spec.equals(marks.get(entry.getKey())) ||
                (surface instanceof Action && surface.host.getParent() != surface.owner)) {
                surface.owner.getOverlay().remove(surface);
                it.remove();
            }
        }
        for (Map.Entry<ViewGroup, String> mark : marks.entrySet()) {
            String spec = mark.getValue();
            if (spec.equals("seam") || spec.equals("seam-actions")) continue;
            ViewGroup host = mark.getKey();
            Surface surface = live.get(host);
            if (surface == null) {
                String[] f = spec.split("/");
                try {
                    if (f.length == 2 && f[0].equals("pane")) {
                        surface = new Corners(host, spec, Long.parseLong(f[1], 16));
                    } else if (f.length == 3 && f[0].equals("action") && host.getParent() instanceof ViewGroup) {
                        surface = new Action(host, spec, Long.parseLong(f[1], 16), Float.parseFloat(f[2]), tagKey);
                    } else continue;
                } catch (NumberFormatException ignored) { continue; }
                live.put(host, surface);
                surface.owner.getOverlay().add(surface);
            }
            if (surface instanceof Corners) {
                ((Corners) surface).headers.clear();
                ((Corners) surface).toolbars.clear();
            }
            if (surface instanceof Action) ((Action) surface).findLabel();
        }
        for (Map.Entry<ViewGroup, String> mark : marks.entrySet()) {
            boolean toolbar = mark.getValue().equals("seam-actions");
            if (!toolbar && !mark.getValue().equals("seam")) continue;
            for (ViewParent up = mark.getKey().getParent(); up instanceof ViewGroup; up = up.getParent()) {
                Surface pane = live.get(up);
                if (pane instanceof Corners) {
                    Corners corners = (Corners) pane;
                    (toolbar ? corners.toolbars : corners.headers).add(mark.getKey());
                    break;
                }
            }
        }
    }

    public boolean onPreDraw() {
        if (dirty) { dirty = false; reconcile(); }
        for (Surface surface : live.values()) surface.position();
        return true;
    }

    void remove() {
        ViewTreeObserver observer = root.getViewTreeObserver();
        if (observer.isAlive()) {
            observer.removeOnGlobalLayoutListener(this);
            observer.removeOnPreDrawListener(this);
        }
        for (Surface surface : live.values()) surface.owner.getOverlay().remove(surface);
        live.clear();
    }

    private abstract static class Surface extends Drawable {
        final ViewGroup host;
        final ViewGroup owner;
        final String spec;
        final int color;
        final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        Surface(ViewGroup host, ViewGroup owner, String spec, long color) {
            this.host = host;
            this.owner = owner;
            this.spec = spec;
            this.color = (int) color;
            paint.setColor(this.color);
        }
        float dp(float value) { return value * host.getResources().getDisplayMetrics().density; }
        boolean contains(View descendant) {
            for (ViewParent ancestor = descendant.getParent(); ancestor instanceof View; ancestor = ancestor.getParent())
                if (ancestor == host) return true;
            return false;
        }
        abstract void position();
        public int getOpacity() { return PixelFormat.TRANSLUCENT; }
        public void setColorFilter(ColorFilter filter) { paint.setColorFilter(filter); }
        public void setAlpha(int alpha) { paint.setAlpha(alpha); }
    }

    private static class Action extends Surface {
        private final float radius;
        private final Rect labelBounds = new Rect();
        private TextView label;
        private final Matrix transform = new Matrix();
        private final Matrix nextTransform = new Matrix();
        private final RectF mapped = new RectF();
        private final Rect bounds = new Rect();
        private float alpha;
        private final Rect visible = new Rect();
        private boolean pressed;
        private final int tagKey;
        Action(ViewGroup host, String spec, long color, float radius, int tagKey) {
            // View.draw draws its own foreground after its overlay. The parent draws
            // this decoration after the button has completed both operations.
            super(host, (ViewGroup) host.getParent(), spec, color);
            this.radius = dp(radius);
            this.tagKey = tagKey;
        }
        void findLabel() {
            TextView next = singleLabel(host, 0);
            if (label != next) { label = next; invalidateSelf(); }
        }
        private TextView singleLabel(View node, int depth) {
            if (node instanceof TextView) return (TextView) node;
            if (!(node instanceof ViewGroup) || depth >= 7) return null;
            ViewGroup group = (ViewGroup) node;
            TextView found = null;
            for (int i = 0; i < group.getChildCount(); i++) {
                View child = group.getChildAt(i);
                Object tag = child.getTag(tagKey);
                if (tag instanceof String && ((String) tag).startsWith("sunbird.m3e/")) continue;
                if (child.getVisibility() != View.VISIBLE || child.getWidth() == 0 || child.getHeight() == 0) continue;
                if (found != null) return null;
                found = singleLabel(child, depth + 1);
                if (found == null) return null;
            }
            return found;
        }
        void position() {
            nextTransform.setTranslate(host.getLeft() - owner.getScrollX(), host.getTop() - owner.getScrollY());
            nextTransform.preConcat(host.getMatrix());
            mapped.set(0, 0, host.getWidth(), host.getHeight());
            nextTransform.mapRect(mapped);
            mapped.roundOut(bounds);
            setBounds(bounds);
            if (!transform.equals(nextTransform) || host.isDirty() || (label != null && label.isDirty()) ||
                pressed != host.isPressed() || alpha != host.getAlpha()) invalidateSelf();
            transform.set(nextTransform);
            boolean wasPressed = pressed;
            pressed = host.isPressed();
            // Stateless Phoenix backgrounds may not invalidate the parent when
            // Android releases a delayed press inside a scrolling container.
            if (pressed || wasPressed) owner.postInvalidateOnAnimation();
            alpha = host.getAlpha();
        }
        public void draw(Canvas canvas) {
            if (label == null || host.getParent() != owner || !host.isEnabled() || !label.isShown() ||
                !contains(label) || host.getAlpha() <= 0f || !host.getLocalVisibleRect(visible)) return;
            int outer = canvas.save();
            canvas.concat(transform);
            canvas.clipRect(visible);
            if (host.getAlpha() < 1f)
                canvas.saveLayerAlpha(0, 0, host.getWidth(), host.getHeight(), Math.round(255 * host.getAlpha()));
            labelBounds.set(0, 0, label.getWidth(), label.getHeight());
            host.offsetDescendantRectToMyCoords(label, labelBounds);
            int fill = color;
            if (host.isPressed()) {
                int ink = label.getCurrentTextColor();
                fill = android.graphics.Color.rgb(channel(color, ink, 16), channel(color, ink, 8), channel(color, ink, 0));
            }
            paint.setColor(fill);
            canvas.drawRoundRect(0, 0, host.getWidth(), host.getHeight(), radius, radius, paint);
            canvas.translate(labelBounds.left, labelBounds.top);
            label.draw(canvas);
            canvas.restoreToCount(outer);
        }
        private static int channel(int bg, int fg, int shift) {
            return (((bg >>> shift & 255) * 9) + (fg >>> shift & 255)) / 10;
        }
    }

    private static class Corners extends Surface {
        final ArrayList<View> headers = new ArrayList<>();
        final ArrayList<View> toolbars = new ArrayList<>();
        private int join;
        private final Path path = new Path();
        private final Rect rect = new Rect();
        private final Rect visible = new Rect();
        private final float radius;
        Corners(ViewGroup host, String spec, long color) { super(host, host, spec, color); radius = dp(26); }
        void position() {
            int y = -1, left = 0, right = 0;
            for (View header : headers) {
                if (!contains(header) || !header.isShown() || header.getHeight() == 0 || !header.getLocalVisibleRect(visible) ||
                    visible.bottom < header.getHeight()) continue;
                rect.set(0, 0, header.getWidth(), header.getHeight());
                host.offsetDescendantRectToMyCoords(header, rect);
                if (rect.bottom > y && rect.bottom >= 0 && rect.bottom < host.getHeight()) {
                    y = rect.bottom; left = rect.left; right = rect.right;
                }
            }
            if (y < 0) {
                setBounds(0, 0, 0, 0);
                return;
            }
            // Two separately laid out header copies can expose a strip of the list
            // above the arc. Repaint only the empty band below their visible actions.
            int bottom = -1;
            for (View toolbar : toolbars) {
                if (!contains(toolbar) || !toolbar.isShown() || !toolbar.getLocalVisibleRect(visible)) continue;
                rect.set(visible);
                host.offsetDescendantRectToMyCoords(toolbar, rect);
                bottom = Math.max(bottom, rect.bottom);
            }
            join = y;
            int top = bottom < 0 ? y : Math.min(y, Math.max(y - Math.round(dp(8)), bottom));
            setBounds(left, top, right, y + (int)Math.ceil(radius));
        }
        protected void onBoundsChange(Rect b) {
            path.reset();
            if (b.isEmpty()) return;
            float r = Math.min(radius, b.width() / 2f);
            if (b.top < join) path.addRect(b.left, b.top, b.right, join, Path.Direction.CW);
            path.moveTo(b.left,join); path.lineTo(b.left+r,join);
            path.arcTo(b.left,join,b.left+2*r,join+2*r,270,-90,false); path.close();
            path.moveTo(b.right,join); path.lineTo(b.right-r,join);
            path.arcTo(b.right-2*r,join,b.right,join+2*r,270,90,false); path.close();
        }
        public void draw(Canvas canvas) { canvas.drawPath(path, paint); }
    }
}
