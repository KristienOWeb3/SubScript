import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:subscript_mobile/main.dart';
import 'package:subscript_mobile/services/api_client.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const channel = MethodChannel('com.subscriptonarc.mobile/native');

  setUpAll(() async {
    final sukar = FontLoader('Sukar')
      ..addFont(rootBundle.load('assets/fonts/SukarRegular.ttf'))
      ..addFont(rootBundle.load('assets/fonts/SukarBold.ttf'))
      ..addFont(rootBundle.load('assets/fonts/SukarBlack.ttf'));
    await sukar.load();
  });

  setUp(() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, (_) async => null);
  });

  tearDown(() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, null);
  });

  testWidgets('bundled sign-in renders without loading the website', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(const SubScriptApp());
    await tester.pumpAndSettle();

    expect(find.text('DECENTRALIZED PAYMENT PROTOCOL'), findsOneWidget);
    expect(find.text('Continue with Email'), findsOneWidget);
    expect(find.text('Continue with Google'), findsOneWidget);
    expect(find.text('CONNECT WEB3 WALLET'), findsOneWidget);
    expect(tester.takeException(), isNull);
    await expectLater(
      find.byType(Scaffold),
      matchesGoldenFile('goldens/bundled-login.png'),
    );
  });

  testWidgets('email sign-in opens the native OTP form', (tester) async {
    await tester.pumpWidget(const SubScriptApp());
    await tester.pumpAndSettle();

    await tester.tap(find.text('Continue with Email'));
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('email-field')), findsOneWidget);
    expect(find.byKey(const Key('send-code-button')), findsOneWidget);
  });

  test('API client captures and reuses the backend session cookie', () async {
    String? sessionCookie;
    final client = ApiClient(
      client: MockClient((request) async {
        if (request.url.path.endsWith('/otp/verify')) {
          return http.Response(
            jsonEncode({
              'success': true,
              'wallet': '0x1111111111111111111111111111111111111111',
              'role': 'USER',
            }),
            200,
            headers: {
              'set-cookie':
                  'subscript_session_token=abc123; Path=/; HttpOnly; Secure',
            },
          );
        }
        sessionCookie = request.headers['Cookie'];
        return http.Response(jsonEncode({'loggedIn': true}), 200);
      }),
    );

    await client.verifyOtp('user@example.com', '123456');
    await client.session();

    expect(client.sessionCookie, 'subscript_session_token=abc123');
    expect(sessionCookie, 'subscript_session_token=abc123');
  });
}
