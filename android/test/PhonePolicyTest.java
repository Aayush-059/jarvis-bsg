package com.jarvis.app;
public final class PhonePolicyTest {
  static void check(boolean value) { if (!value) throw new AssertionError(); }
  public static void main(String[] args) {
    check(PhonePolicy.screenAllowed("com.google.android.youtube"));
    check(!PhonePolicy.screenAllowed("com.android.settings"));
    check(!PhonePolicy.screenAllowed("com.game.example"));
    check(PhonePolicy.fresh(29999, 0));
    check(!PhonePolicy.fresh(30000, 0));
    check(!PhonePolicy.fresh(0, 1));
    check(PhonePolicy.MAX_STEPS == 6);
    check(PhonePolicy.safeText("hello"));
    check(!PhonePolicy.safeText("hi\n"));
    check(!PhonePolicy.safeText(new String(new char[501]).replace('\0', 'a')));
    System.out.println("Native policy checks passed");
  }
}