import 'package:flutter/services.dart';

class NativeBridge {
  NativeBridge._();

  static const _channel = MethodChannel('com.subscriptonarc.mobile/native');

  static Future<String?> getSessionCookie() async {
    try {
      return await _channel.invokeMethod<String>('getSessionCookie');
    } on MissingPluginException {
      return null;
    }
  }

  static Future<void> saveSessionCookie(String cookie) {
    return _channel.invokeMethod<void>('saveSessionCookie', {'cookie': cookie});
  }

  static Future<void> clearSession() async {
    try {
      await _channel.invokeMethod<void>('clearSession');
    } on MissingPluginException {
      // Non-Android previews do not have the encrypted session bridge.
    }
  }

  static Future<String?> startWebLogin() {
    return _channel.invokeMethod<String>('startWebLogin');
  }

  static Future<void> openWebRoute(String url) {
    return _channel.invokeMethod<void>('openWebRoute', {'url': url});
  }

  static Future<String?> getInitialLink() {
    return _channel.invokeMethod<String>('getInitialLink');
  }
}
