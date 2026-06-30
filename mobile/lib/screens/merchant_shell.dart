import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';

import '../state/app_controller.dart';
import '../ui/design_system.dart';

class MerchantShell extends StatefulWidget {
  const MerchantShell({super.key});

  @override
  State<MerchantShell> createState() => _MerchantShellState();
}

class _MerchantShellState extends State<MerchantShell> {
  int _index = 0;

  @override
  Widget build(BuildContext context) {
    final controller = context.watch<AppController>();
    const labels = ['Overview', 'Payments', 'Business', 'Profile'];
    const icons = [
      Icons.dashboard_rounded,
      Icons.payments_rounded,
      Icons.auto_graph_rounded,
      Icons.business_rounded,
    ];
    final pages = [
      const _MerchantOverview(),
      const _MerchantPayments(),
      const _MerchantTools(),
      const _MerchantProfile(),
    ];

    return Scaffold(
      body: AppBackdrop(
        child: SafeArea(
          bottom: false,
          child: Column(
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(20, 12, 20, 10),
                child: Row(
                  children: [
                    const BrandMark(size: 38),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Eyebrow('SubScript Business'),
                          Text(
                            labels[_index],
                            style: const TextStyle(
                              color: Colors.white,
                              fontSize: 18,
                              fontWeight: FontWeight.w900,
                            ),
                          ),
                        ],
                      ),
                    ),
                    IconButton(
                      onPressed:
                          controller.refreshing ? null : controller.refresh,
                      icon: controller.refreshing
                          ? const SizedBox(
                              width: 20,
                              height: 20,
                              child: CircularProgressIndicator(
                                strokeWidth: 2,
                                color: SubScriptColors.lime,
                              ),
                            )
                          : const Icon(Icons.refresh_rounded),
                    ),
                  ],
                ),
              ),
              Expanded(child: IndexedStack(index: _index, children: pages)),
            ],
          ),
        ),
      ),
      bottomNavigationBar: DecoratedBox(
        decoration: const BoxDecoration(
          color: Color(0xF20A0A0D),
          border: Border(top: BorderSide(color: Color(0x14FFFFFF))),
        ),
        child: SafeArea(
          top: false,
          child: Row(
            children: List.generate(labels.length, (itemIndex) {
              final selected = itemIndex == _index;
              return Expanded(
                child: InkWell(
                  onTap: () => setState(() => _index = itemIndex),
                  child: Padding(
                    padding: const EdgeInsets.symmetric(vertical: 10),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(
                          icons[itemIndex],
                          color:
                              selected ? SubScriptColors.lime : Colors.white38,
                        ),
                        const SizedBox(height: 4),
                        Text(
                          labels[itemIndex],
                          style: TextStyle(
                            color: selected ? Colors.white : Colors.white38,
                            fontSize: 10,
                            fontWeight: FontWeight.w900,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              );
            }),
          ),
        ),
      ),
    );
  }
}

class _MerchantOverview extends StatelessWidget {
  const _MerchantOverview();

  @override
  Widget build(BuildContext context) {
    final controller = context.watch<AppController>();
    final subs = _firstList(
      _asMap(controller.merchantData['subscriptions']),
      ['subscriptions', 'items'],
    );
    final plans = _firstList(
      _asMap(controller.merchantData['plans']),
      ['plans', 'items'],
    );
    final links = _firstList(
      _asMap(controller.merchantData['paymentLinks']),
      ['links', 'paymentLinks', 'items'],
    );
    final available = formatUsdcMicros(
      controller.settings['availableBalanceUsdc'],
    );

    return RefreshIndicator(
      onRefresh: controller.refresh,
      color: SubScriptColors.lime,
      backgroundColor: SubScriptColors.panel,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(20, 12, 20, 30),
        children: [
          GlassCard(
            borderColor: SubScriptColors.gold.withOpacity(0.2),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Eyebrow('Available Settlement', color: Colors.white54),
                    StatusPill(
                      label: 'Business',
                      color: SubScriptColors.gold,
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                Text(
                  '\$$available',
                  style: Theme.of(context).textTheme.headlineLarge?.copyWith(
                        fontSize: 38,
                      ),
                ),
                const SizedBox(height: 4),
                Text(
                  'Arc USDC · ${shortAddress(controller.wallet)}',
                  style: const TextStyle(color: Colors.white38),
                ),
              ],
            ),
          ),
          const SizedBox(height: 14),
          Row(
            children: [
              Expanded(
                child: _MetricCard(
                  label: 'Subscribers',
                  value: '${subs.length}',
                  color: SubScriptColors.teal,
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: _MetricCard(
                  label: 'Plans',
                  value: '${plans.length}',
                  color: SubScriptColors.lime,
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: _MetricCard(
                  label: 'Links',
                  value: '${links.length}',
                  color: SubScriptColors.gold,
                ),
              ),
            ],
          ),
          const SizedBox(height: 26),
          const Eyebrow('Recent Settlements', color: Colors.white54),
          const SizedBox(height: 10),
          if (controller.receipts.isEmpty)
            const EmptyPanel(
              icon: Icons.receipt_long_outlined,
              title: 'No recent settlements',
              message: 'Successful customer payments will appear here.',
            )
          else
            ...controller.receipts.take(8).map(
                  (item) => _MerchantReceipt(data: _asMap(item)),
                ),
        ],
      ),
    );
  }
}

class _MerchantPayments extends StatelessWidget {
  const _MerchantPayments();

  @override
  Widget build(BuildContext context) {
    final controller = context.watch<AppController>();
    final plans = _firstList(
      _asMap(controller.merchantData['plans']),
      ['plans', 'items'],
    );
    final subscriptions = _firstList(
      _asMap(controller.merchantData['subscriptions']),
      ['subscriptions', 'items'],
    );
    final links = _firstList(
      _asMap(controller.merchantData['paymentLinks']),
      ['links', 'paymentLinks', 'items'],
    );
    return ListView(
      padding: const EdgeInsets.fromLTRB(20, 12, 20, 30),
      children: [
        Row(
          children: [
            Expanded(
              child: Text(
                'Payments & subscriptions',
                style: Theme.of(context).textTheme.headlineMedium,
              ),
            ),
            IconButton(
              onPressed: () => controller.openWebRoute('/merchant'),
              icon: const Icon(Icons.add_circle_outline_rounded),
              color: SubScriptColors.lime,
            ),
          ],
        ),
        const SizedBox(height: 18),
        _NativeListSection(
          title: 'Plans',
          items: plans,
          empty: 'No published plans',
          titleFor: (item) => item['name']?.toString() ?? 'Subscription plan',
          subtitleFor: (item) => '${formatUsdcMicros(item['amountUsdc'])} USDC',
        ),
        const SizedBox(height: 24),
        _NativeListSection(
          title: 'Active Subscribers',
          items: subscriptions,
          empty: 'No active subscribers',
          titleFor: (item) =>
              item['customerName']?.toString() ??
              shortAddress(item['customerAddress']?.toString()),
          subtitleFor: (item) => item['status']?.toString() ?? 'Active',
        ),
        const SizedBox(height: 24),
        _NativeListSection(
          title: 'Payment Links',
          items: links,
          empty: 'No payment links',
          titleFor: (item) => item['title']?.toString() ?? 'Hosted checkout',
          subtitleFor: (item) => '${formatUsdcMicros(item['amountUsdc'])} USDC',
        ),
      ],
    );
  }
}

class _MerchantTools extends StatelessWidget {
  const _MerchantTools();

  @override
  Widget build(BuildContext context) {
    final controller = context.read<AppController>();
    const tools = [
      (
        Icons.auto_graph_rounded,
        'Analytics',
        'MRR, churn, revenue and retry health',
        '/merchant?tab=analytics',
      ),
      (
        Icons.groups_rounded,
        'Payroll',
        'Recurring USDC campaigns and recipients',
        '/merchant/payroll',
      ),
      (
        Icons.key_rounded,
        'API Keys',
        'Test and live integration credentials',
        '/merchant?tab=api',
      ),
      (
        Icons.webhook_rounded,
        'Webhooks',
        'Signed fulfillment events and replay',
        '/merchant?tab=webhooks',
      ),
      (
        Icons.workspace_premium_rounded,
        'Premium',
        'Advanced billing and payout controls',
        '/merchant/upgrade',
      ),
    ];
    return ListView(
      padding: const EdgeInsets.fromLTRB(20, 12, 20, 30),
      children: [
        Text(
          'Business tools',
          style: Theme.of(context).textTheme.headlineMedium,
        ),
        const SizedBox(height: 6),
        const Text(
          'The dashboard shell is native. Advanced configuration opens the hosted secure workflow only when needed.',
          style: TextStyle(color: Colors.white38, height: 1.45),
        ),
        const SizedBox(height: 18),
        ...tools.map(
          (tool) => Padding(
            padding: const EdgeInsets.only(bottom: 10),
            child: GlassCard(
              padding: const EdgeInsets.all(17),
              onTap: () => controller.openWebRoute(tool.$4),
              child: Row(
                children: [
                  Container(
                    width: 46,
                    height: 46,
                    decoration: BoxDecoration(
                      color: SubScriptColors.lime.withOpacity(0.1),
                      borderRadius: BorderRadius.circular(15),
                    ),
                    child: Icon(tool.$1, color: SubScriptColors.lime),
                  ),
                  const SizedBox(width: 14),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          tool.$2,
                          style: const TextStyle(
                            color: Colors.white,
                            fontWeight: FontWeight.w900,
                          ),
                        ),
                        Text(
                          tool.$3,
                          style: const TextStyle(
                            color: Colors.white38,
                            fontSize: 11,
                          ),
                        ),
                      ],
                    ),
                  ),
                  const Icon(Icons.chevron_right_rounded,
                      color: Colors.white24),
                ],
              ),
            ),
          ),
        ),
      ],
    );
  }
}

class _MerchantProfile extends StatelessWidget {
  const _MerchantProfile();

  @override
  Widget build(BuildContext context) {
    final controller = context.watch<AppController>();
    return ListView(
      padding: const EdgeInsets.fromLTRB(20, 12, 20, 30),
      children: [
        GlassCard(
          child: Column(
            children: [
              const CircleAvatar(
                radius: 34,
                backgroundColor: Color(0x18D4A853),
                child: Icon(
                  Icons.storefront_rounded,
                  color: SubScriptColors.gold,
                  size: 30,
                ),
              ),
              const SizedBox(height: 14),
              Text(
                controller.settings['alias'] == null
                    ? 'SubScript Business'
                    : '${controller.settings['alias']}.sub',
                style: Theme.of(context).textTheme.titleLarge,
              ),
              const SizedBox(height: 5),
              Text(
                controller.email ?? shortAddress(controller.wallet),
                style: const TextStyle(color: Colors.white38),
              ),
            ],
          ),
        ),
        const SizedBox(height: 16),
        _MerchantMenuTile(
          icon: Icons.domain_rounded,
          title: 'Profile & DNS',
          onTap: () => controller.openWebRoute('/merchant?tab=settings'),
        ),
        _MerchantMenuTile(
          icon: Icons.account_balance_wallet_outlined,
          title: 'Payout settings',
          onTap: () => controller.openWebRoute('/merchant?tab=settings'),
        ),
        _MerchantMenuTile(
          icon: Icons.privacy_tip_outlined,
          title: 'Confidentiality',
          onTap: () => controller.openWebRoute('/merchant?tab=settings'),
        ),
        const SizedBox(height: 12),
        OutlinedButton.icon(
          onPressed: controller.busy ? null : controller.logout,
          icon: const Icon(Icons.logout_rounded),
          label: const Text('Sign out'),
          style: OutlinedButton.styleFrom(
            foregroundColor: SubScriptColors.danger,
            side: BorderSide(color: SubScriptColors.danger.withOpacity(0.3)),
          ),
        ),
      ],
    );
  }
}

class _MetricCard extends StatelessWidget {
  const _MetricCard({
    required this.label,
    required this.value,
    required this.color,
  });

  final String label;
  final String value;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 16),
      decoration: BoxDecoration(
        color: color.withOpacity(0.06),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: color.withOpacity(0.15)),
      ),
      child: Column(
        children: [
          Text(
            value,
            style: TextStyle(
              color: color,
              fontSize: 24,
              fontWeight: FontWeight.w900,
            ),
          ),
          Text(
            label,
            style: const TextStyle(
              color: Colors.white38,
              fontSize: 9,
              fontWeight: FontWeight.w900,
            ),
          ),
        ],
      ),
    );
  }
}

class _NativeListSection extends StatelessWidget {
  const _NativeListSection({
    required this.title,
    required this.items,
    required this.empty,
    required this.titleFor,
    required this.subtitleFor,
  });

  final String title;
  final List<dynamic> items;
  final String empty;
  final String Function(Map<String, dynamic>) titleFor;
  final String Function(Map<String, dynamic>) subtitleFor;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Expanded(child: Eyebrow(title, color: Colors.white54)),
            StatusPill(label: '${items.length}', color: Colors.white38),
          ],
        ),
        const SizedBox(height: 10),
        if (items.isEmpty)
          EmptyPanel(
            icon: Icons.inbox_outlined,
            title: empty,
            message: 'New activity will appear here automatically.',
          )
        else
          ...items.take(6).map((value) {
            final item = _asMap(value);
            return Padding(
              padding: const EdgeInsets.only(bottom: 9),
              child: GlassCard(
                padding: const EdgeInsets.all(15),
                child: Row(
                  children: [
                    const Icon(
                      Icons.bolt_rounded,
                      color: SubScriptColors.lime,
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            titleFor(item),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              color: Colors.white,
                              fontWeight: FontWeight.w900,
                            ),
                          ),
                          Text(
                            subtitleFor(item),
                            style: const TextStyle(
                              color: Colors.white38,
                              fontSize: 11,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            );
          }),
      ],
    );
  }
}

class _MerchantReceipt extends StatelessWidget {
  const _MerchantReceipt({required this.data});

  final Map<String, dynamic> data;

  @override
  Widget build(BuildContext context) {
    final date = DateTime.tryParse(data['createdAt']?.toString() ?? '');
    return ListTile(
      contentPadding: EdgeInsets.zero,
      leading: const CircleAvatar(
        backgroundColor: Color(0x1400D2B4),
        child: Icon(Icons.south_west_rounded, color: SubScriptColors.teal),
      ),
      title: Text(
        '+${formatUsdcMicros(data['amountUsdc'])} USDC',
        style: const TextStyle(
          color: SubScriptColors.teal,
          fontWeight: FontWeight.w900,
        ),
      ),
      subtitle: Text(
        date == null
            ? shortAddress(data['payerAddress']?.toString())
            : DateFormat('MMM d, yyyy · HH:mm').format(date.toLocal()),
        style: const TextStyle(color: Colors.white38, fontSize: 11),
      ),
      trailing: StatusPill(label: data['status']?.toString() ?? 'Confirmed'),
    );
  }
}

class _MerchantMenuTile extends StatelessWidget {
  const _MerchantMenuTile({
    required this.icon,
    required this.title,
    required this.onTap,
  });

  final IconData icon;
  final String title;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 9),
      child: GlassCard(
        padding: const EdgeInsets.all(15),
        onTap: onTap,
        child: Row(
          children: [
            Icon(icon, color: SubScriptColors.lime),
            const SizedBox(width: 13),
            Expanded(
              child: Text(
                title,
                style: const TextStyle(
                  color: Colors.white,
                  fontWeight: FontWeight.w900,
                ),
              ),
            ),
            const Icon(Icons.chevron_right_rounded, color: Colors.white24),
          ],
        ),
      ),
    );
  }
}

Map<String, dynamic> _asMap(dynamic value) {
  return value is Map<String, dynamic> ? value : <String, dynamic>{};
}

List<dynamic> _firstList(
  Map<String, dynamic> source,
  List<String> keys,
) {
  for (final key in keys) {
    if (source[key] is List) return source[key] as List<dynamic>;
  }
  return const [];
}
