package com.jarvis.app;

/** Pure native policy: AI output never grants access. */
public final class PhonePolicy {
  public static final String SCREEN_APP = "com.google.android.youtube";
  public static final long TOKEN_MS = 30000;
  public static final int MAX_STEPS = 6;
  public static boolean screenAllowed(String pkg) { return SCREEN_APP.equals(pkg); }
  public static boolean fresh(long now, long issued) { return now >= issued && now - issued < TOKEN_MS; }
  public static boolean safeText(String text) {
    if (text == null || text.length() == 0 || text.length() > 500) return false;
    for (int i = 0; i < text.length(); i++) if (Character.isISOControl(text.charAt(i))) return false;
    return true;
  }
}