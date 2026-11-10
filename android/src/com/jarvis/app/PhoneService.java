package com.jarvis.app;

import android.accessibilityservice.AccessibilityService;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;
import android.view.WindowManager;
import android.view.Gravity;
import android.view.View;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Button;
import android.os.Bundle;
import android.os.SystemClock;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.ArrayList;
import java.util.UUID;

/** Only an opted-in YouTube session; approval is rendered by native code. */
public class PhoneService extends AccessibilityService {
  static PhoneService instance;
  boolean active;
  int steps;
  String token, observed;
  long issued;
  View overlay;
  interface Reply { void done(JSONObject result); }
  static JSONObject result(boolean ok, String reason) {
    JSONObject r = new JSONObject();
    try { r.put("ok", ok); if (reason != null) r.put("reason", reason); } catch (Exception e) {}
    return r;
  }
  @Override protected void onServiceConnected() { instance = this; }
  @Override public void onAccessibilityEvent(AccessibilityEvent e) {}
  @Override public void onInterrupt() { halt(); }
  @Override public void onDestroy() { halt(); instance = null; super.onDestroy(); }
  void halt() { active = false; token = null; observed = null; removeOverlay(); }
  void begin() { halt(); active = true; steps = 0; }
  void removeOverlay() {
    if (overlay != null) { try { ((WindowManager)getSystemService(WINDOW_SERVICE)).removeView(overlay); } catch (Exception e) {} overlay = null; }
  }
  ArrayList<AccessibilityNodeInfo> nodes() {
    AccessibilityNodeInfo root = getRootInActiveWindow();
    ArrayList<AccessibilityNodeInfo> out = new ArrayList<>();
    if (root == null || !PhonePolicy.screenAllowed(String.valueOf(root.getPackageName()))) return out;
    collect(root, out, 0);
    return out;
  }
  void collect(AccessibilityNodeInfo n, ArrayList<AccessibilityNodeInfo> out, int depth) {
    if (n == null || depth > 20 || out.size() >= 120 || !n.isVisibleToUser()) return;
    if (n.isPassword()) { out.clear(); throw new SecurityException("Sensitive field blocked"); }
    out.add(n);
    for (int i=0; i<n.getChildCount(); i++) collect(n.getChild(i), out, depth+1);
  }
  String label(AccessibilityNodeInfo n) {
    String s = String.valueOf(n.getText() == null ? "" : n.getText()) + " " + String.valueOf(n.getContentDescription() == null ? "" : n.getContentDescription());
    return s.trim().substring(0, Math.min(s.trim().length(), 500));
  }
  JSONArray describe(ArrayList<AccessibilityNodeInfo> nodes) throws Exception {
    JSONArray a = new JSONArray();
    for (int i=0; i<nodes.size(); i++) {
      AccessibilityNodeInfo n = nodes.get(i);
      JSONObject o = new JSONObject();
      o.put("id", i); o.put("label", label(n)); o.put("clickable", n.isClickable()); o.put("editable", n.isEditable());
      android.graphics.Rect b = new android.graphics.Rect(); n.getBoundsInScreen(b); o.put("bounds", b.toShortString());
      a.put(o);
    }
    return a;
  }
  void confirm(String message, Runnable approve, Runnable decline) {
    removeOverlay();
    LinearLayout box = new LinearLayout(this); box.setOrientation(LinearLayout.VERTICAL); box.setPadding(24,24,24,24);
    box.setBackgroundColor(android.graphics.Color.DKGRAY);
    TextView title = new TextView(this); title.setText("JARVIS · YouTube session active\n" + message); title.setTextColor(android.graphics.Color.WHITE); box.addView(title);
    Button yes = new Button(this); yes.setText("Approve this action"); box.addView(yes);
    Button no = new Button(this); no.setText("STOP / Decline"); box.addView(no);
    yes.setOnClickListener(v -> { removeOverlay(); approve.run(); });
    no.setOnClickListener(v -> { halt(); decline.run(); });
    WindowManager.LayoutParams p = new WindowManager.LayoutParams(WindowManager.LayoutParams.MATCH_PARENT, WindowManager.LayoutParams.WRAP_CONTENT, WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY, WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE, android.graphics.PixelFormat.TRANSLUCENT);
    p.gravity = Gravity.TOP; overlay = box; ((WindowManager)getSystemService(WINDOW_SERVICE)).addView(box,p);
  }
  void request(String action, JSONObject in, Reply reply) {
    if (!active || steps >= PhonePolicy.MAX_STEPS) { reply.done(result(false,"Start an approved YouTube session; maximum six actions.")); return; }
    try {
      ArrayList<AccessibilityNodeInfo> ns = nodes();
      if (ns.isEmpty()) { halt(); reply.done(result(false,"YouTube must be in front. Other apps and protected screens are blocked.")); return; }
      String screen = describe(ns).toString();
      if (action.equals("android_read_screen")) {
        confirm("Share accessible YouTube screen text with your JARVIS AI? Screen text is untrusted.", () -> {
          try {
            ArrayList<AccessibilityNodeInfo> fresh = nodes();
            if (fresh.isEmpty() || !screen.equals(describe(fresh).toString())) { reply.done(result(false,"Screen changed. Read again.")); return; }
            token = UUID.randomUUID().toString(); issued = SystemClock.elapsedRealtime(); observed = screen; steps++;
            JSONObject r = result(true,null); r.put("screen_token",token); r.put("nodes",describe(fresh)); r.put("note","Untrusted screen data. Latest upload/channel identity are not established by this read."); reply.done(r);
          } catch (Exception e) { reply.done(result(false,"Screen read blocked.")); }
        }, () -> reply.done(result(false,"User stopped the session.")));
        return;
      }
      if (token == null || !token.equals(in.optString("screen_token")) || !PhonePolicy.fresh(SystemClock.elapsedRealtime(),issued) || !screen.equals(observed)) {
        token = null; reply.done(result(false,"Expired or changed screen. Read again.")); return;
      }
      int id = in.optInt("node_id",-1);
      if (id<0 || id>=ns.size()) { reply.done(result(false,"Unknown target.")); return; }
      AccessibilityNodeInfo node = ns.get(id);
      String target = label(node), text = in.optString("text");
      if (target.toLowerCase(java.util.Locale.ROOT).matches(".*(password|payment|purchase|buy|delete|permission|sign in|account|subscribe|membership).*")) {
        reply.done(result(false,"Sensitive action requires manual control.")); return;
      }
      boolean type = action.equals("android_type");
      if ((!type && !action.equals("android_click")) || (type && (!node.isEditable() || !PhonePolicy.safeText(text))) || (!type && !node.isClickable())) {
        reply.done(result(false,"Unsupported target or text.")); return;
      }
      long stamp = issued; token = null;
      confirm((type ? "Type exact text:\n"+text : "Click (may submit publicly):") + "\nTarget: " + target + "\nApp: YouTube\nCheck the channel and video yourself before approving a public comment.", () -> {
        try {
          ArrayList<AccessibilityNodeInfo> fresh = nodes();
          if (!active || !PhonePolicy.fresh(SystemClock.elapsedRealtime(),stamp) || !screen.equals(describe(fresh).toString()) || id>=fresh.size()) { reply.done(result(false,"Screen or approval expired. Nothing executed.")); return; }
          Bundle b = new Bundle(); b.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE,text);
          boolean accepted = fresh.get(id).performAction(type ? AccessibilityNodeInfo.ACTION_SET_TEXT : AccessibilityNodeInfo.ACTION_CLICK, b); steps++;
          JSONObject r = result(false,"Action requested; final outcome is unverified. Read the screen again before claiming success or retrying a comment."); r.put("requested",accepted); reply.done(r);
        } catch(Exception e) { reply.done(result(false,"Action blocked.")); }
      }, () -> reply.done(result(false,"User stopped the session.")));
    } catch (Exception e) { halt(); reply.done(result(false,"Screen access blocked.")); }
  }
}