package com.jarvis.app;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.*;

// JARVIS for Android: opens the published JARVIS app in a full-screen window.
public class MainActivity extends Activity {
  static final String APP_URL = "https://jarvis-bsg.lovable.app";
  static final String HOST = Uri.parse(APP_URL).getHost();
  WebView web;
  WebMessagePort nativePort;
  java.util.Set<String> approved = new java.util.HashSet<String>();
  android.os.Handler handler = new android.os.Handler(android.os.Looper.getMainLooper());

  void closeBridge() { if (nativePort != null) { nativePort.close(); nativePort = null; } if (PhoneService.instance != null) PhoneService.instance.halt(); }
  boolean ownPage() { return APP_URL.equals(web.getUrl()) || (APP_URL + "/").equals(web.getUrl()); }
  void bridge() {
    if (!ownPage() || nativePort != null) return;
    WebMessagePort[] ports = web.createWebMessageChannel();
    nativePort = ports[0];
    final WebMessagePort source = nativePort;
    source.setWebMessageCallback(new WebMessagePort.WebMessageCallback() {
      @Override public void onMessage(WebMessagePort p, WebMessage m) {
        if (!ownPage() || source != nativePort) return;
        try {
          if (m.getData() == null || m.getData().length() > 8000) return;
          org.json.JSONObject r = new org.json.JSONObject(m.getData());
          String id = r.getString("id"), action = r.getString("action");
          org.json.JSONObject in = r.getJSONObject("input");
          if (id.length() > 80) return;
          PhoneService.Reply reply = result -> {
            if (source != nativePort || !ownPage()) return;
            try { org.json.JSONObject out = new org.json.JSONObject(); out.put("id",id); out.put("result",result); source.postMessage(new WebMessage(out.toString())); } catch (Exception e) {}
          };
          if (action.equals("stop")) { if (PhoneService.instance != null) PhoneService.instance.halt(); reply.done(PhoneService.result(true,null)); }
          else if (action.equals("apps")) pickApps(reply);
          else if (action.equals("accessibility")) {
            new android.app.AlertDialog.Builder(MainActivity.this).setTitle("Optional YouTube screen access")
              .setMessage("Enable JARVIS only if you consent to sharing approved YouTube screen text with your AI. Every action asks again. Other apps, passwords and payment actions are blocked.")
              .setPositiveButton("Open Android settings", (d,w) -> { startActivity(new Intent(android.provider.Settings.ACTION_ACCESSIBILITY_SETTINGS)); reply.done(PhoneService.result(false,"Enable JARVIS, return, then approve a YouTube launch.")); })
              .setNegativeButton("Cancel", (d,w) -> reply.done(PhoneService.result(false,"Declined."))).show();
          }
          else if (action.equals("android_open_app")) launch(in.optString("package_name"),reply);
          else if (action.equals("android_read_screen") || action.equals("android_click") || action.equals("android_type")) {
            if (PhoneService.instance == null) reply.done(PhoneService.result(false,"Optional accessibility service is off."));
            else PhoneService.instance.request(action,in,reply);
          } else reply.done(PhoneService.result(false,"Unknown Android action."));
        } catch (Exception e) {}
      }
    }, handler);
    web.postWebMessage(new WebMessage("jarvis-native-v1", new WebMessagePort[]{ports[1]}), Uri.parse(APP_URL));
  }
  void pickApps(PhoneService.Reply reply) {
    java.util.List<android.content.pm.ResolveInfo> apps = getPackageManager().queryIntentActivities(new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER),0);
    java.util.ArrayList<android.content.pm.ResolveInfo> filtered = new java.util.ArrayList<>();
    for (android.content.pm.ResolveInfo a : apps) if (!a.activityInfo.packageName.equals(getPackageName()) && !a.activityInfo.packageName.equals("com.android.settings")) filtered.add(a);
    String[] labels = new String[filtered.size()]; boolean[] checked = new boolean[labels.length];
    for (int i=0;i<labels.length;i++) { labels[i]=filtered.get(i).loadLabel(getPackageManager()).toString(); checked[i]=approved.contains(filtered.get(i).activityInfo.packageName); }
    new android.app.AlertDialog.Builder(this).setTitle("Allow JARVIS to open apps")
      .setMultiChoiceItems(labels, checked, (d,i,c)->checked[i]=c)
      .setPositiveButton("Save", (d,w)-> {
        approved.clear(); org.json.JSONArray a = new org.json.JSONArray();
        try { for(int i=0;i<labels.length;i++) if(checked[i]) { String pkg=filtered.get(i).activityInfo.packageName; approved.add(pkg); org.json.JSONObject o = new org.json.JSONObject(); o.put("label",labels[i]); o.put("package_name",pkg); a.put(o); } org.json.JSONObject r=PhoneService.result(true,null); r.put("apps",a); reply.done(r); } catch(Exception e) { reply.done(PhoneService.result(false,"Picker failed.")); }
      }).setNegativeButton("Cancel",(d,w)->reply.done(PhoneService.result(false,"Declined."))).show();
  }
  void launch(String pkg, PhoneService.Reply reply) {
    Intent launch = approved.contains(pkg) ? getPackageManager().getLaunchIntentForPackage(pkg) : null;
    if(launch == null) { reply.done(PhoneService.result(false,"Choose this installed app in the phone app picker first.")); return; }
    new android.app.AlertDialog.Builder(this).setTitle("Open approved app?").setMessage(pkg + "\nYouTube screen actions are optional and require approval each time.")
      .setPositiveButton("Open", (d,w)-> {
        try { if(PhoneService.instance != null && PhonePolicy.screenAllowed(pkg)) PhoneService.instance.begin(); startActivity(launch); reply.done(PhoneService.result(false,"App launch requested; foreground state is not yet verified.")); }
        catch(Exception e) { reply.done(PhoneService.result(false,"App could not be opened.")); }
      }).setNegativeButton("Cancel",(d,w)->reply.done(PhoneService.result(false,"Declined."))).show();
  }

  @Override protected void onCreate(Bundle b) {
    super.onCreate(b);
    web = new WebView(this);
    web.setBackgroundColor(Color.rgb(11, 18, 32));
    WebSettings s = web.getSettings();
    s.setJavaScriptEnabled(true);
    s.setDomStorageEnabled(true);
    s.setMediaPlaybackRequiresUserGesture(false);
    s.setAllowFileAccess(false);
    web.setWebViewClient(new WebViewClient() {
      @Override public void onPageStarted(WebView v, String url, android.graphics.Bitmap icon) { closeBridge(); }
      @Override public void onPageFinished(WebView v, String url) { handler.postDelayed(() -> bridge(), 2000); }
      // Other sites open in the phone's browser, never inside JARVIS.
      @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
        Uri u = r.getUrl();
        if (HOST.equals(u.getHost())) return false;
        try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (Exception e) {}
        return true;
      }
      @Override public void onReceivedError(WebView v, WebResourceRequest r, WebResourceError e) {
        if (r.isForMainFrame()) v.loadData("<body style='background:#0b1220;color:#cfe;font-family:sans-serif;padding:32px'><h2>JARVIS is offline</h2><p>Check your internet connection and reopen the app.</p></body>", "text/html", "utf-8");
      }
    });
    // Microphone only, only for the JARVIS site.
    web.setWebChromeClient(new WebChromeClient() {
      @Override public void onPermissionRequest(final PermissionRequest req) {
        runOnUiThread(new Runnable() { public void run() {
          if (!HOST.equals(req.getOrigin().getHost())) { req.deny(); return; }
          for (String r : req.getResources()) if (!PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(r)) { req.deny(); return; }
          if (checkSelfPermission("android.permission.RECORD_AUDIO") != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{"android.permission.RECORD_AUDIO"}, 1);
            req.deny(); // user taps the mic again after allowing
          } else req.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
        }});
      }
    });
    setContentView(web);
    if (b != null) web.restoreState(b); else web.loadUrl(APP_URL);
  }
  @Override protected void onSaveInstanceState(Bundle o) { super.onSaveInstanceState(o); web.saveState(o); }
  @Override protected void onDestroy() { closeBridge(); handler.removeCallbacksAndMessages(null); web.destroy(); super.onDestroy(); }
  @Override public void onBackPressed() { if (web.canGoBack()) web.goBack(); else super.onBackPressed(); }
}
