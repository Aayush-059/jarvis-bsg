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
  static final String APP_URL = "https://xyz-jarvis-aayush-com-np059.lovable.app";
  static final String HOST = Uri.parse(APP_URL).getHost();
  WebView web;

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
  @Override public void onBackPressed() { if (web.canGoBack()) web.goBack(); else super.onBackPressed(); }
}
