import 'package:flutter/foundation.dart';

import '../services/api_client.dart';
import '../services/native_bridge.dart';

enum AuthStatus { booting, signedOut, signedIn }

class AppController extends ChangeNotifier {
  AppController({ApiClient? api}) : _api = api ?? ApiClient();

  final ApiClient _api;

  AuthStatus status = AuthStatus.booting;
  bool busy = false;
  bool refreshing = false;
  String? error;
  String? notice;
  String? pendingEmail;
  String? wallet;
  String? email;
  String? role;
  bool isEmbedded = false;
  double balance = 0;
  Map<String, dynamic> settings = {};
  Map<String, dynamic> vaultData = {};
  Map<String, dynamic> merchantData = {};
  List<dynamic> receipts = [];
  List<dynamic> subscriptions = [];
  List<dynamic> dms = [];
  DateTime? lastUpdated;

  bool get isMerchant => role == 'ENTERPRISE';
  bool get isUser => role == 'USER';

  Future<void> bootstrap() async {
    status = AuthStatus.booting;
    notifyListeners();
    try {
      final cookie = await NativeBridge.getSessionCookie();
      if (cookie == null || cookie.isEmpty) {
        status = AuthStatus.signedOut;
        return;
      }
      _api.setSessionCookie(cookie);
      final session = await _api.session();
      if (session['loggedIn'] != true) {
        await _clearLocalSession();
        status = AuthStatus.signedOut;
        return;
      }
      _applySession(session);
      status = AuthStatus.signedIn;
      await refresh();
      await _openInitialLink();
    } catch (_) {
      await _clearLocalSession();
      status = AuthStatus.signedOut;
    } finally {
      notifyListeners();
    }
  }

  Future<bool> requestOtp(String value) async {
    final normalized = value.trim().toLowerCase();
    if (!RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$').hasMatch(normalized)) {
      _setError('Enter a valid email address.');
      return false;
    }
    return _runAction(() async {
      final account = await _api.checkAccount(normalized);
      if (account['exists'] != true) {
        throw const ApiException(
          'No SubScript account uses this email. Create one on the website first.',
        );
      }
      if (account['authMethod'] == 'wallet') {
        throw const ApiException(
          'This email belongs to a wallet-only account. Use Web3 sign in.',
        );
      }
      await _api.sendOtp(normalized);
      pendingEmail = normalized;
      notice = 'A 6-digit code was sent to $normalized.';
    });
  }

  Future<bool> verifyOtp(String code) async {
    final currentEmail = pendingEmail;
    if (currentEmail == null) {
      _setError('Request a new code first.');
      return false;
    }
    if (!RegExp(r'^\d{6}$').hasMatch(code.trim())) {
      _setError('Enter the 6-digit verification code.');
      return false;
    }
    return _runAction(() async {
      await _api.verifyOtp(currentEmail, code.trim());
      await NativeBridge.saveSessionCookie(_sessionCookieOrThrow());
      final session = await _api.session();
      _applySession(session);
      status = AuthStatus.signedIn;
      await refresh();
    });
  }

  Future<bool> signInWithWeb() async {
    return _runAction(() async {
      final cookie = await NativeBridge.startWebLogin();
      if (cookie == null || cookie.isEmpty) return;
      _api.setSessionCookie(cookie);
      final session = await _api.session();
      if (session['loggedIn'] != true) {
        throw const ApiException('The web sign-in did not create a session.');
      }
      _applySession(session);
      status = AuthStatus.signedIn;
      await refresh();
    });
  }

  Future<void> refresh() async {
    if (status != AuthStatus.signedIn || wallet == null || refreshing) return;
    refreshing = true;
    error = null;
    notifyListeners();
    try {
      final results = await Future.wait([
        _api.settings(),
        _api.walletBalance(wallet!),
        if (isUser) _api.subscriptions() else Future.value(<dynamic>[]),
        if (isUser) _api.dms() else Future.value(<dynamic>[]),
        if (isUser) _api.vaults() else Future.value(<String, dynamic>{}),
        if (isMerchant)
          _api.merchantSnapshot()
        else
          Future.value(<String, dynamic>{}),
      ]);
      final settingsPayload = results[0] as Map<String, dynamic>;
      settings =
          settingsPayload['settings'] as Map<String, dynamic>? ?? const {};
      receipts = settingsPayload['receipts'] is List
          ? settingsPayload['receipts'] as List
          : const [];
      balance = results[1] as double;
      subscriptions = results[2] as List<dynamic>;
      dms = results[3] as List<dynamic>;
      vaultData = results[4] as Map<String, dynamic>;
      merchantData = results[5] as Map<String, dynamic>;
      lastUpdated = DateTime.now();
    } on ApiException catch (exception) {
      if (exception.statusCode == 401) {
        await _clearLocalSession();
        status = AuthStatus.signedOut;
      }
      error = exception.message;
    } catch (_) {
      error = 'Could not refresh your account. Pull down to retry.';
    } finally {
      refreshing = false;
      notifyListeners();
    }
  }

  Future<String> createPaymentLink({
    required String amount,
    required String title,
    required String description,
  }) async {
    final data = await _api.createPaymentLink(
      amount: amount,
      title: title,
      description: description,
    );
    return data['checkoutUrl']?.toString() ?? '';
  }

  Future<void> sendFunds({
    required String recipient,
    required String amount,
  }) async {
    await _api.sendFunds(recipient: recipient, amount: amount);
    await refresh();
  }

  Future<void> cancelSubscription(String id) async {
    await _api.cancelSubscription(id);
    await refresh();
  }

  Future<void> openWebRoute(String pathOrUrl) async {
    final url = pathOrUrl.startsWith('https://')
        ? pathOrUrl
        : '${ApiClient.baseUrl}$pathOrUrl';
    await NativeBridge.openWebRoute(url);
    if (status == AuthStatus.signedIn && _api.hasSession) {
      final session = await _api.session();
      _applySession(session);
      await refresh();
    }
  }

  Future<void> logout() async {
    busy = true;
    notifyListeners();
    try {
      await _api.logout();
    } catch (_) {
      // Local session removal still signs the device out.
    }
    await _clearLocalSession();
    _resetAccount();
    status = AuthStatus.signedOut;
    busy = false;
    notifyListeners();
  }

  void clearMessages() {
    error = null;
    notice = null;
    notifyListeners();
  }

  void resetOtp() {
    pendingEmail = null;
    error = null;
    notice = null;
    notifyListeners();
  }

  Future<bool> _runAction(Future<void> Function() action) async {
    if (busy) return false;
    busy = true;
    error = null;
    notice = null;
    notifyListeners();
    try {
      await action();
      return true;
    } on ApiException catch (exception) {
      error = exception.message;
      return false;
    } catch (_) {
      error = 'Something went wrong. Check your connection and try again.';
      return false;
    } finally {
      busy = false;
      notifyListeners();
    }
  }

  void _applySession(Map<String, dynamic> session) {
    wallet = session['wallet']?.toString();
    email = session['email']?.toString();
    role = session['role']?.toString();
    isEmbedded = session['isEmbedded'] == true;
  }

  String _sessionCookieOrThrow() {
    // ApiClient owns the freshly parsed HttpOnly cookie until it is handed to
    // the Android Keystore bridge for persistence.
    final cookie = _api.sessionCookie;
    if (cookie == null) throw const ApiException('Session could not be saved.');
    return cookie;
  }

  Future<void> _openInitialLink() async {
    final link = await NativeBridge.getInitialLink();
    if (link != null && link.startsWith('https://')) {
      await NativeBridge.openWebRoute(link);
    }
  }

  Future<void> _clearLocalSession() async {
    _api.setSessionCookie(null);
    await NativeBridge.clearSession();
  }

  void _resetAccount() {
    wallet = null;
    email = null;
    role = null;
    isEmbedded = false;
    balance = 0;
    settings = {};
    vaultData = {};
    merchantData = {};
    receipts = [];
    subscriptions = [];
    dms = [];
    lastUpdated = null;
    pendingEmail = null;
    error = null;
    notice = null;
  }

  void _setError(String message) {
    error = message;
    notifyListeners();
  }

  @override
  void dispose() {
    _api.dispose();
    super.dispose();
  }
}
