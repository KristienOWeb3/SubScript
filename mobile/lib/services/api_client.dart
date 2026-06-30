import 'dart:convert';

import 'package:http/http.dart' as http;

class ApiException implements Exception {
  const ApiException(this.message, {this.statusCode});

  final String message;
  final int? statusCode;

  @override
  String toString() => message;
}

class ApiClient {
  ApiClient({http.Client? client}) : _client = client ?? http.Client();

  static const baseUrl = 'https://www.subscriptonarc.com';
  static const _rpcUrl = 'https://rpc.testnet.arc.network';
  static const _usdcAddress = '0x3600000000000000000000000000000000000000';

  final http.Client _client;
  String? _sessionCookie;

  bool get hasSession => _sessionCookie?.isNotEmpty == true;
  String? get sessionCookie => _sessionCookie;

  void setSessionCookie(String? cookie) {
    _sessionCookie = cookie?.trim();
  }

  Future<Map<String, dynamic>> checkAccount(String email) {
    return post('/api/auth/check-account', {'email': email},
        authenticated: false);
  }

  Future<Map<String, dynamic>> sendOtp(String email) {
    return post('/api/auth/otp/send', {'email': email}, authenticated: false);
  }

  Future<Map<String, dynamic>> verifyOtp(String email, String code) async {
    final response = await _request(
      'POST',
      '/api/auth/otp/verify',
      body: {'email': email, 'code': code, 'rememberMe': true},
      authenticated: false,
    );
    final setCookie = response.headers['set-cookie'];
    final match = setCookie == null
        ? null
        : RegExp(r'(subscript_session_token=[^;,\s]+)').firstMatch(setCookie);
    if (match == null) {
      throw const ApiException('The server did not return a mobile session.');
    }
    _sessionCookie = match.group(1);
    return _decode(response);
  }

  Future<Map<String, dynamic>> session() => get('/api/auth/session');

  Future<Map<String, dynamic>> settings() => get('/api/user/settings');

  Future<List<dynamic>> subscriptions() async {
    final data = await get('/api/user/subscriptions');
    return _list(data['subscriptions']);
  }

  Future<List<dynamic>> dms() async {
    final data = await get('/api/user/dms');
    return _list(data['dms']);
  }

  Future<Map<String, dynamic>> vaults() async {
    try {
      return await get('/api/user/vault/config');
    } on ApiException {
      return const {};
    }
  }

  Future<Map<String, dynamic>> merchantSnapshot() async {
    final results = await Future.wait([
      _safeGet('/api/merchant/profile'),
      _safeGet('/api/merchant/subscriptions'),
      _safeGet('/api/merchant/plans'),
      _safeGet('/api/payment-links'),
      _safeGet('/api/merchant/payroll'),
    ]);
    return {
      'profile': results[0],
      'subscriptions': results[1],
      'plans': results[2],
      'paymentLinks': results[3],
      'payroll': results[4],
    };
  }

  Future<double> walletBalance(String address) async {
    final cleanAddress = address.toLowerCase().replaceFirst('0x', '');
    if (!RegExp(r'^[0-9a-f]{40}$').hasMatch(cleanAddress)) return 0;
    final callData = '0x70a08231${cleanAddress.padLeft(64, '0')}';
    final response = await _client
        .post(
          Uri.parse(_rpcUrl),
          headers: const {'Content-Type': 'application/json'},
          body: jsonEncode({
            'jsonrpc': '2.0',
            'id': 1,
            'method': 'eth_call',
            'params': [
              {'to': _usdcAddress, 'data': callData},
              'latest',
            ],
          }),
        )
        .timeout(const Duration(seconds: 15));
    final payload = jsonDecode(response.body) as Map<String, dynamic>;
    final raw = payload['result']?.toString();
    if (raw == null || raw == '0x' || !raw.startsWith('0x')) return 0;
    return BigInt.parse(raw.substring(2), radix: 16).toDouble() / 1000000;
  }

  Future<Map<String, dynamic>> createPaymentLink({
    required String amount,
    required String title,
    required String description,
  }) {
    return post('/api/user/payment-links', {
      'amountUsdc': amount,
      'title': title,
      'description': description,
      'expiresInHours': 24 * 7,
    });
  }

  Future<Map<String, dynamic>> sendFunds({
    required String recipient,
    required String amount,
  }) async {
    var resolved = recipient.trim();
    if (!RegExp(r'^0x[a-fA-F0-9]{40}$').hasMatch(resolved)) {
      final alias = await get(
        '/api/merchant/alias?alias=${Uri.encodeQueryComponent(resolved)}',
        authenticated: false,
      );
      resolved = alias['address']?.toString() ?? '';
    }
    if (!RegExp(r'^0x[a-fA-F0-9]{40}$').hasMatch(resolved)) {
      throw const ApiException('Recipient address or .sub name was not found.');
    }
    return post('/api/user/wallet/send', {
      'receiverAddress': resolved,
      'amountUsdc': amount,
    });
  }

  Future<void> cancelSubscription(String subscriptionId) async {
    await post('/api/user/subscription/cancel', {
      'subscriptionId': subscriptionId,
    });
  }

  Future<void> logout() async {
    try {
      await post('/api/auth/logout', const {});
    } finally {
      _sessionCookie = null;
    }
  }

  Future<Map<String, dynamic>> get(
    String path, {
    bool authenticated = true,
  }) async {
    final response = await _request(
      'GET',
      path,
      authenticated: authenticated,
    );
    return _decode(response);
  }

  Future<Map<String, dynamic>> post(
    String path,
    Map<String, dynamic> body, {
    bool authenticated = true,
  }) async {
    final response = await _request(
      'POST',
      path,
      body: body,
      authenticated: authenticated,
    );
    return _decode(response);
  }

  Future<Map<String, dynamic>> _safeGet(String path) async {
    try {
      return await get(path);
    } on ApiException catch (error) {
      return {'error': error.message, 'statusCode': error.statusCode};
    }
  }

  Future<http.Response> _request(
    String method,
    String path, {
    Map<String, dynamic>? body,
    bool authenticated = true,
  }) async {
    final uri = Uri.parse('$baseUrl$path');
    final headers = <String, String>{
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'Origin': baseUrl,
      if (authenticated && hasSession) 'Cookie': _sessionCookie!,
    };
    final response = method == 'GET'
        ? await _client
            .get(uri, headers: headers)
            .timeout(const Duration(seconds: 20))
        : await _client
            .post(uri, headers: headers, body: jsonEncode(body ?? const {}))
            .timeout(const Duration(seconds: 30));
    if (response.statusCode < 200 || response.statusCode >= 300) {
      final payload = _tryDecode(response.body);
      throw ApiException(
        payload['error']?.toString() ??
            payload['message']?.toString() ??
            'Request failed (${response.statusCode}).',
        statusCode: response.statusCode,
      );
    }
    return response;
  }

  Map<String, dynamic> _decode(http.Response response) {
    return _tryDecode(response.body);
  }

  Map<String, dynamic> _tryDecode(String body) {
    if (body.trim().isEmpty) return {};
    final decoded = jsonDecode(body);
    return decoded is Map<String, dynamic> ? decoded : {'data': decoded};
  }

  List<dynamic> _list(dynamic value) => value is List ? value : const [];

  void dispose() {
    _client.close();
  }
}
