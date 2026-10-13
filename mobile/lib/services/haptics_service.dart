import 'package:flutter/services.dart';

abstract final class SubScriptHaptics {
  static bool enabled = true;

  /// Featherlight tick for navigation tabs, chips, and PIN digits (10ms)
  static Future<void> microTick() async {
    if (!enabled) return;
    try {
      await HapticFeedback.selectionClick();
    } catch (_) {}
  }

  /// Crisp snap for buttons, toggles, pull-to-refresh trigger (20ms)
  static Future<void> lightSnap() async {
    if (!enabled) return;
    try {
      await HapticFeedback.lightImpact();
    } catch (_) {}
  }

  /// Solid affirmative punch for primary actions, approvals, Review & Send (35ms)
  static Future<void> mediumImpact() async {
    if (!enabled) return;
    try {
      await HapticFeedback.mediumImpact();
    } catch (_) {}
  }

  /// Heavy impact for destructive steps or large locks (60ms)
  static Future<void> heavyThud() async {
    if (!enabled) return;
    try {
      await HapticFeedback.heavyImpact();
    } catch (_) {}
  }

  /// Rewarding staccato double pulse for payments confirmed & address copied
  static Future<void> successDouble() async {
    if (!enabled) return;
    try {
      await HapticFeedback.lightImpact();
      await Future.delayed(const Duration(milliseconds: 45));
      await HapticFeedback.mediumImpact();
    } catch (_) {}
  }

  /// Warning double tap for threshold alerts and cancellation prompts
  static Future<void> warning() async {
    if (!enabled) return;
    try {
      await HapticFeedback.mediumImpact();
      await Future.delayed(const Duration(milliseconds: 40));
      await HapticFeedback.mediumImpact();
    } catch (_) {}
  }

  /// Harsh triple pulse for PIN errors, reverts, and declined transactions
  static Future<void> error() async {
    if (!enabled) return;
    try {
      await HapticFeedback.vibrate();
    } catch (_) {}
  }

  /// Sustained hold latch for destructive confirmation (120ms)
  static Future<void> holdLatch() async {
    if (!enabled) return;
    try {
      await HapticFeedback.heavyImpact();
    } catch (_) {}
  }
}
