import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../state/app_controller.dart';
import '../ui/design_system.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _emailController = TextEditingController();
  final _codeController = TextEditingController();
  bool _emailOpen = false;

  @override
  void dispose() {
    _emailController.dispose();
    _codeController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final controller = context.watch<AppController>();
    final enteringCode = controller.pendingEmail != null;

    return Scaffold(
      body: AppBackdrop(
        child: SafeArea(
          child: SingleChildScrollView(
            padding: const EdgeInsets.fromLTRB(24, 52, 24, 30),
            child: Column(
              children: [
                const BrandMark(size: 52),
                const SizedBox(height: 18),
                const Text.rich(
                  TextSpan(
                    children: [
                      TextSpan(text: 'SUBSCRIPT '),
                      TextSpan(
                        text: 'signin',
                        style: TextStyle(
                          color: SubScriptColors.lime,
                          fontStyle: FontStyle.italic,
                          fontWeight: FontWeight.w400,
                        ),
                      ),
                    ],
                  ),
                  style: TextStyle(
                    color: Colors.white,
                    fontSize: 26,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                const SizedBox(height: 4),
                const Text(
                  'DECENTRALIZED PAYMENT PROTOCOL',
                  style: TextStyle(
                    color: Colors.white38,
                    fontSize: 10,
                    letterSpacing: 1.8,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: 34),
                GlassCard(
                  padding: const EdgeInsets.fromLTRB(24, 26, 24, 24),
                  borderColor: Colors.white24,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      const Row(
                        children: [
                          Expanded(
                            child: FittedBox(
                              fit: BoxFit.scaleDown,
                              alignment: Alignment.centerLeft,
                              child: Eyebrow('Authenticate'),
                            ),
                          ),
                          SizedBox(width: 12),
                          Expanded(
                            child: FittedBox(
                              fit: BoxFit.scaleDown,
                              alignment: Alignment.centerRight,
                              child: Eyebrow(
                                'Secure sign in',
                                color: Colors.white38,
                              ),
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 18),
                      const Divider(),
                      const SizedBox(height: 18),
                      Text(
                        enteringCode
                            ? 'Enter the verification code sent to ${controller.pendingEmail}.'
                            : 'Connect your registered payout wallet or email to access your SubScript dashboard.',
                        textAlign: TextAlign.center,
                        style: Theme.of(context).textTheme.bodyLarge?.copyWith(
                              color: Colors.white60,
                              height: 1.5,
                            ),
                      ),
                      const SizedBox(height: 24),
                      if (!_emailOpen && !enteringCode) ...[
                        _AuthChoiceButton(
                          icon: Icons.mail_outline_rounded,
                          label: 'Continue with Email',
                          onPressed: controller.busy
                              ? null
                              : () => setState(() => _emailOpen = true),
                        ),
                        const SizedBox(height: 14),
                        _AuthChoiceButton(
                          label: 'Continue with Google',
                          light: true,
                          onPressed:
                              controller.busy ? null : controller.signInWithWeb,
                        ),
                        const SizedBox(height: 22),
                        const Row(
                          children: [
                            Expanded(child: Divider()),
                            Padding(
                              padding: EdgeInsets.symmetric(horizontal: 12),
                              child: Eyebrow(
                                'or use web3',
                                color: Colors.white30,
                              ),
                            ),
                            Expanded(child: Divider()),
                          ],
                        ),
                        const SizedBox(height: 22),
                        ElevatedButton.icon(
                          onPressed:
                              controller.busy ? null : controller.signInWithWeb,
                          icon:
                              const Icon(Icons.account_balance_wallet_outlined),
                          label: const Text('CONNECT WEB3 WALLET'),
                        ),
                      ] else if (!enteringCode) ...[
                        TextField(
                          key: const Key('email-field'),
                          controller: _emailController,
                          keyboardType: TextInputType.emailAddress,
                          autofillHints: const [AutofillHints.email],
                          textInputAction: TextInputAction.done,
                          decoration: const InputDecoration(
                            labelText: 'Account email',
                            hintText: 'you@example.com',
                            prefixIcon: Icon(Icons.mail_outline_rounded),
                          ),
                          onSubmitted: controller.busy
                              ? null
                              : (_) => controller.requestOtp(
                                    _emailController.text,
                                  ),
                        ),
                        const SizedBox(height: 14),
                        ElevatedButton(
                          key: const Key('send-code-button'),
                          onPressed: controller.busy
                              ? null
                              : () => controller.requestOtp(
                                    _emailController.text,
                                  ),
                          child: controller.busy
                              ? const _ButtonLoader()
                              : const Text('SEND CODE'),
                        ),
                        TextButton(
                          onPressed: controller.busy
                              ? null
                              : () {
                                  controller.clearMessages();
                                  setState(() => _emailOpen = false);
                                },
                          child: const Text('Use another method'),
                        ),
                      ] else ...[
                        TextField(
                          key: const Key('otp-field'),
                          controller: _codeController,
                          keyboardType: TextInputType.number,
                          maxLength: 6,
                          textAlign: TextAlign.center,
                          style: const TextStyle(
                            fontSize: 24,
                            fontWeight: FontWeight.w900,
                            letterSpacing: 8,
                          ),
                          decoration: const InputDecoration(
                            counterText: '',
                            hintText: '000000',
                          ),
                        ),
                        const SizedBox(height: 14),
                        ElevatedButton(
                          key: const Key('verify-code-button'),
                          onPressed: controller.busy
                              ? null
                              : () => controller.verifyOtp(
                                    _codeController.text,
                                  ),
                          child: controller.busy
                              ? const _ButtonLoader()
                              : const Text('VERIFY & CONTINUE'),
                        ),
                        TextButton(
                          onPressed: controller.busy
                              ? null
                              : () {
                                  _codeController.clear();
                                  controller.resetOtp();
                                  setState(() => _emailOpen = true);
                                },
                          child: const Text('Use a different email'),
                        ),
                      ],
                      if (controller.error != null) ...[
                        const SizedBox(height: 12),
                        _MessageBox(
                          message: controller.error!,
                          color: SubScriptColors.danger,
                        ),
                      ],
                      if (controller.notice != null) ...[
                        const SizedBox(height: 12),
                        _MessageBox(
                          message: controller.notice!,
                          color: SubScriptColors.teal,
                        ),
                      ],
                      const SizedBox(height: 18),
                      Wrap(
                        alignment: WrapAlignment.center,
                        crossAxisAlignment: WrapCrossAlignment.center,
                        children: [
                          const Text(
                            "Don't have an account? ",
                            style: TextStyle(color: Colors.white38),
                          ),
                          GestureDetector(
                            onTap: () => controller.openWebRoute('/signup'),
                            child: const Text(
                              'Sign Up',
                              style: TextStyle(
                                color: SubScriptColors.lime,
                                fontWeight: FontWeight.w900,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _AuthChoiceButton extends StatelessWidget {
  const _AuthChoiceButton({
    required this.label,
    required this.onPressed,
    this.icon,
    this.light = false,
  });

  final String label;
  final VoidCallback? onPressed;
  final IconData? icon;
  final bool light;

  @override
  Widget build(BuildContext context) {
    return OutlinedButton.icon(
      onPressed: onPressed,
      icon: icon == null
          ? const SizedBox.shrink()
          : Icon(icon, color: light ? Colors.black : SubScriptColors.lime),
      label: Text(label),
      style: OutlinedButton.styleFrom(
        foregroundColor: light ? Colors.black : Colors.white,
        backgroundColor: light ? Colors.white : Colors.white.withOpacity(0.04),
        minimumSize: const Size.fromHeight(54),
        side: BorderSide(color: light ? Colors.white : Colors.white12),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(17)),
        textStyle: const TextStyle(
          fontFamily: 'Sukar',
          fontWeight: FontWeight.w900,
          letterSpacing: 0.4,
        ),
      ),
    );
  }
}

class _MessageBox extends StatelessWidget {
  const _MessageBox({required this.message, required this.color});

  final String message;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: color.withOpacity(0.08),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: color.withOpacity(0.22)),
      ),
      child: Text(
        message,
        textAlign: TextAlign.center,
        style: TextStyle(color: color, fontSize: 12, height: 1.4),
      ),
    );
  }
}

class _ButtonLoader extends StatelessWidget {
  const _ButtonLoader();

  @override
  Widget build(BuildContext context) {
    return const SizedBox(
      width: 20,
      height: 20,
      child: CircularProgressIndicator(strokeWidth: 2, color: Colors.black),
    );
  }
}
