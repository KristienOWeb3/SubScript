import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';

import 'screens/login_screen.dart';
import 'screens/merchant_shell.dart';
import 'screens/user_shell.dart';
import 'state/app_controller.dart';
import 'ui/design_system.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  SystemChrome.setSystemUIOverlayStyle(
    const SystemUiOverlayStyle(
      statusBarColor: SubScriptColors.background,
      statusBarIconBrightness: Brightness.light,
      systemNavigationBarColor: SubScriptColors.background,
      systemNavigationBarIconBrightness: Brightness.light,
    ),
  );
  runApp(const SubScriptApp());
}

class SubScriptApp extends StatelessWidget {
  const SubScriptApp({super.key, this.controller});

  final AppController? controller;

  @override
  Widget build(BuildContext context) {
    return ChangeNotifierProvider<AppController>(
      create: (_) {
        final value = controller ?? AppController();
        if (controller == null) value.bootstrap();
        return value;
      },
      child: MaterialApp(
        title: 'SubScript',
        debugShowCheckedModeBanner: false,
        theme: buildSubScriptTheme(),
        home: const _AppRouter(),
      ),
    );
  }
}

class _AppRouter extends StatelessWidget {
  const _AppRouter();

  @override
  Widget build(BuildContext context) {
    final controller = context.watch<AppController>();
    switch (controller.status) {
      case AuthStatus.booting:
        return const _BootScreen();
      case AuthStatus.signedOut:
        return const LoginScreen();
      case AuthStatus.signedIn:
        if (controller.role == null) return const _RoleSetupScreen();
        return controller.isMerchant
            ? const MerchantShell()
            : const UserShell();
    }
  }
}

class _BootScreen extends StatelessWidget {
  const _BootScreen();

  @override
  Widget build(BuildContext context) {
    return const Scaffold(
      body: AppBackdrop(
        child: Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              BrandMark(size: 72),
              SizedBox(height: 20),
              Eyebrow('SubScript'),
              SizedBox(height: 20),
              SizedBox(
                width: 22,
                height: 22,
                child: CircularProgressIndicator(
                  strokeWidth: 2,
                  color: SubScriptColors.lime,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _RoleSetupScreen extends StatelessWidget {
  const _RoleSetupScreen();

  @override
  Widget build(BuildContext context) {
    final controller = context.read<AppController>();
    return Scaffold(
      body: AppBackdrop(
        child: SafeArea(
          child: Center(
            child: Padding(
              padding: const EdgeInsets.all(24),
              child: GlassCard(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const BrandMark(size: 52),
                    const SizedBox(height: 18),
                    Text(
                      'Finish account setup',
                      style: Theme.of(context).textTheme.headlineMedium,
                    ),
                    const SizedBox(height: 10),
                    const Text(
                      'Choose your SubScript account role once, then the native dashboard will open automatically.',
                      textAlign: TextAlign.center,
                      style: TextStyle(color: Colors.white54, height: 1.5),
                    ),
                    const SizedBox(height: 20),
                    ElevatedButton(
                      onPressed: () => controller.openWebRoute('/signup'),
                      child: const Text('FINISH SETUP'),
                    ),
                    const SizedBox(height: 8),
                    TextButton(
                      onPressed: controller.logout,
                      child: const Text('Sign out'),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
