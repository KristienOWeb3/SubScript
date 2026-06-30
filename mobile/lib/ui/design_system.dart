import 'package:flutter/material.dart';

abstract final class SubScriptColors {
  static const background = Color(0xFF060608);
  static const panel = Color(0xFF0C0C10);
  static const panelRaised = Color(0xFF121217);
  static const lime = Color(0xFFCCFF00);
  static const teal = Color(0xFF00D2B4);
  static const gold = Color(0xFFD4A853);
  static const danger = Color(0xFFFF6B7A);
}

ThemeData buildSubScriptTheme() {
  const border = Color(0x1FFFFFFF);
  return ThemeData(
    brightness: Brightness.dark,
    fontFamily: 'Sukar',
    scaffoldBackgroundColor: SubScriptColors.background,
    colorScheme: const ColorScheme.dark(
      primary: SubScriptColors.lime,
      secondary: SubScriptColors.teal,
      surface: SubScriptColors.panel,
      error: SubScriptColors.danger,
    ),
    textTheme: const TextTheme(
      headlineLarge: TextStyle(
        fontSize: 30,
        height: 1,
        fontWeight: FontWeight.w900,
        letterSpacing: -0.8,
      ),
      headlineMedium: TextStyle(
        fontSize: 22,
        fontWeight: FontWeight.w900,
        letterSpacing: -0.3,
      ),
      titleLarge: TextStyle(fontSize: 18, fontWeight: FontWeight.w900),
      titleMedium: TextStyle(fontSize: 15, fontWeight: FontWeight.w900),
      bodyLarge: TextStyle(fontSize: 15, color: Color(0xD9FFFFFF)),
      bodyMedium: TextStyle(fontSize: 13, color: Color(0x99FFFFFF)),
      labelLarge: TextStyle(
        fontSize: 12,
        fontWeight: FontWeight.w900,
        letterSpacing: 1,
      ),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: const Color(0x99000000),
      hintStyle: const TextStyle(color: Color(0x55FFFFFF)),
      labelStyle: const TextStyle(color: Color(0x99FFFFFF)),
      contentPadding: const EdgeInsets.symmetric(horizontal: 18, vertical: 16),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(16),
        borderSide: const BorderSide(color: border),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(16),
        borderSide: const BorderSide(color: border),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(16),
        borderSide: const BorderSide(color: SubScriptColors.lime),
      ),
      errorBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(16),
        borderSide: const BorderSide(color: SubScriptColors.danger),
      ),
    ),
    elevatedButtonTheme: ElevatedButtonThemeData(
      style: ElevatedButton.styleFrom(
        backgroundColor: SubScriptColors.lime,
        foregroundColor: Colors.black,
        minimumSize: const Size.fromHeight(54),
        elevation: 0,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(17)),
        textStyle: const TextStyle(
          fontFamily: 'Sukar',
          fontSize: 13,
          fontWeight: FontWeight.w900,
          letterSpacing: 1,
        ),
      ),
    ),
    snackBarTheme: SnackBarThemeData(
      backgroundColor: SubScriptColors.panelRaised,
      contentTextStyle: const TextStyle(color: Colors.white),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      behavior: SnackBarBehavior.floating,
    ),
    dividerTheme: const DividerThemeData(color: Color(0x12FFFFFF)),
  );
}

class AppBackdrop extends StatelessWidget {
  const AppBackdrop({super.key, required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: const BoxDecoration(
        color: SubScriptColors.background,
        gradient: RadialGradient(
          center: Alignment(-0.8, -1),
          radius: 1.2,
          colors: [
            Color(0x1629FF87),
            Color(0x0DCCFF00),
            SubScriptColors.background,
          ],
          stops: [0, 0.38, 1],
        ),
      ),
      child: child,
    );
  }
}

class GlassCard extends StatelessWidget {
  const GlassCard({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.all(20),
    this.borderColor,
    this.onTap,
  });

  final Widget child;
  final EdgeInsets padding;
  final Color? borderColor;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final card = Container(
      width: double.infinity,
      padding: padding,
      decoration: BoxDecoration(
        color: const Color(0xCC0C0C10),
        borderRadius: BorderRadius.circular(24),
        border: Border.all(color: borderColor ?? const Color(0x14FFFFFF)),
        boxShadow: const [
          BoxShadow(
              color: Color(0x59000000), blurRadius: 32, offset: Offset(0, 16)),
        ],
      ),
      child: child,
    );
    return onTap == null
        ? card
        : InkWell(
            onTap: onTap,
            borderRadius: BorderRadius.circular(24),
            child: card,
          );
  }
}

class BrandMark extends StatelessWidget {
  const BrandMark({super.key, this.size = 42});

  final double size;

  @override
  Widget build(BuildContext context) {
    return Image.asset(
      'assets/logo.png',
      width: size,
      height: size,
      fit: BoxFit.contain,
    );
  }
}

class Eyebrow extends StatelessWidget {
  const Eyebrow(this.text, {super.key, this.color = SubScriptColors.lime});

  final String text;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Text(
      text.toUpperCase(),
      style: TextStyle(
        color: color,
        fontSize: 10,
        fontWeight: FontWeight.w900,
        letterSpacing: 1.8,
      ),
    );
  }
}

class StatusPill extends StatelessWidget {
  const StatusPill({
    super.key,
    required this.label,
    this.color = SubScriptColors.teal,
  });

  final String label;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(
        color: color.withOpacity(0.1),
        borderRadius: BorderRadius.circular(100),
        border: Border.all(color: color.withOpacity(0.25)),
      ),
      child: Text(
        label.toUpperCase(),
        style: TextStyle(
          color: color,
          fontSize: 9,
          fontWeight: FontWeight.w900,
          letterSpacing: 1,
        ),
      ),
    );
  }
}

class EmptyPanel extends StatelessWidget {
  const EmptyPanel({
    super.key,
    required this.icon,
    required this.title,
    required this.message,
  });

  final IconData icon;
  final String title;
  final String message;

  @override
  Widget build(BuildContext context) {
    return GlassCard(
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 20),
        child: Column(
          children: [
            Icon(icon, color: Colors.white24, size: 34),
            const SizedBox(height: 12),
            Text(title, style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 6),
            Text(
              message,
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.bodyMedium,
            ),
          ],
        ),
      ),
    );
  }
}

String shortAddress(String? value) {
  if (value == null || value.length < 12) return value ?? '';
  return '${value.substring(0, 6)}…${value.substring(value.length - 4)}';
}

String formatUsdcMicros(dynamic value) {
  final raw = BigInt.tryParse(value?.toString() ?? '') ?? BigInt.zero;
  return (raw.toDouble() / 1000000).toStringAsFixed(2);
}
