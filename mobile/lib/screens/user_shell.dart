import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';
import 'package:qr_flutter/qr_flutter.dart';

import '../services/api_client.dart';
import '../state/app_controller.dart';
import '../ui/design_system.dart';

class UserShell extends StatefulWidget {
  const UserShell({super.key});

  @override
  State<UserShell> createState() => _UserShellState();
}

class _UserShellState extends State<UserShell> {
  int _index = 0;

  static const _labels = ['Home', 'Links', 'Send Out', 'DMs', 'Profile'];
  static const _icons = [
    Icons.home_rounded,
    Icons.link_rounded,
    Icons.send_rounded,
    Icons.chat_bubble_rounded,
    Icons.person_rounded,
  ];

  @override
  Widget build(BuildContext context) {
    final controller = context.watch<AppController>();
    final pages = [
      _HomePage(onSend: () => setState(() => _index = 2)),
      const _PaymentLinksPage(),
      const _SendPage(),
      const _DmPage(),
      const _ProfilePage(),
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
                          const Eyebrow('SubScript'),
                          const SizedBox(height: 2),
                          Text(
                            _labels[_index],
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
                      tooltip: 'Refresh',
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
              if (controller.error != null)
                Container(
                  width: double.infinity,
                  margin: const EdgeInsets.symmetric(horizontal: 20),
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(
                    color: SubScriptColors.danger.withOpacity(0.08),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Text(
                    controller.error!,
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                      color: SubScriptColors.danger,
                      fontSize: 11,
                    ),
                  ),
                ),
              Expanded(
                child: IndexedStack(index: _index, children: pages),
              ),
            ],
          ),
        ),
      ),
      bottomNavigationBar: _BottomNav(
        index: _index,
        onChanged: (value) => setState(() => _index = value),
        icons: _icons,
        labels: _labels,
        badge: controller.dms
            .where((item) => _map(item)['status'] == 'PENDING')
            .length,
      ),
    );
  }
}

class _BottomNav extends StatelessWidget {
  const _BottomNav({
    required this.index,
    required this.onChanged,
    required this.icons,
    required this.labels,
    required this.badge,
  });

  final int index;
  final ValueChanged<int> onChanged;
  final List<IconData> icons;
  final List<String> labels;
  final int badge;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: const BoxDecoration(
        color: Color(0xF20A0A0D),
        border: Border(top: BorderSide(color: Color(0x14FFFFFF))),
      ),
      child: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(8, 8, 8, 8),
          child: Row(
            children: List.generate(icons.length, (itemIndex) {
              final selected = itemIndex == index;
              return Expanded(
                child: Semantics(
                  selected: selected,
                  label: labels[itemIndex],
                  child: InkWell(
                    onTap: () => onChanged(itemIndex),
                    borderRadius: BorderRadius.circular(18),
                    child: AnimatedContainer(
                      duration: const Duration(milliseconds: 180),
                      padding: const EdgeInsets.symmetric(vertical: 9),
                      decoration: BoxDecoration(
                        color: selected
                            ? SubScriptColors.lime.withOpacity(0.11)
                            : Colors.transparent,
                        borderRadius: BorderRadius.circular(18),
                        border: Border.all(
                          color: selected
                              ? SubScriptColors.lime.withOpacity(0.25)
                              : Colors.transparent,
                        ),
                      ),
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Stack(
                            clipBehavior: Clip.none,
                            children: [
                              Icon(
                                icons[itemIndex],
                                size: 21,
                                color: selected
                                    ? SubScriptColors.lime
                                    : Colors.white38,
                              ),
                              if (itemIndex == 3 && badge > 0)
                                Positioned(
                                  right: -10,
                                  top: -7,
                                  child: Container(
                                    padding: const EdgeInsets.symmetric(
                                      horizontal: 5,
                                      vertical: 2,
                                    ),
                                    decoration: BoxDecoration(
                                      color: SubScriptColors.danger,
                                      borderRadius: BorderRadius.circular(20),
                                    ),
                                    child: Text(
                                      badge > 9 ? '9+' : '$badge',
                                      style: const TextStyle(
                                        color: Colors.white,
                                        fontSize: 8,
                                        fontWeight: FontWeight.w900,
                                      ),
                                    ),
                                  ),
                                ),
                            ],
                          ),
                          const SizedBox(height: 4),
                          Text(
                            labels[itemIndex],
                            maxLines: 1,
                            style: TextStyle(
                              color: selected ? Colors.white : Colors.white38,
                              fontSize: 9,
                              fontWeight: FontWeight.w900,
                            ),
                          ),
                        ],
                      ),
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

class _HomePage extends StatelessWidget {
  const _HomePage({required this.onSend});

  final VoidCallback onSend;

  @override
  Widget build(BuildContext context) {
    final controller = context.watch<AppController>();
    return RefreshIndicator(
      onRefresh: controller.refresh,
      color: SubScriptColors.lime,
      backgroundColor: SubScriptColors.panel,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(20, 12, 20, 30),
        children: [
          GlassCard(
            borderColor: SubScriptColors.lime.withOpacity(0.16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Eyebrow('Arc USDC Balance', color: Colors.white54),
                    StatusPill(label: 'Live'),
                  ],
                ),
                const SizedBox(height: 12),
                Text(
                  '\$${controller.balance.toStringAsFixed(2)}',
                  style: Theme.of(context).textTheme.headlineLarge?.copyWith(
                        fontSize: 38,
                      ),
                ),
                const SizedBox(height: 5),
                Text(
                  '${controller.balance.toStringAsFixed(2)} USDC',
                  style: const TextStyle(color: Colors.white54),
                ),
                const SizedBox(height: 18),
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        controller.settings['alias'] == null
                            ? shortAddress(controller.wallet)
                            : '${controller.settings['alias']}.sub',
                        style: const TextStyle(
                          color: SubScriptColors.lime,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                    ),
                    Text(
                      shortAddress(controller.wallet),
                      style: const TextStyle(
                        color: Colors.white38,
                        fontFamily: 'monospace',
                        fontSize: 12,
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
          const SizedBox(height: 16),
          Row(
            children: [
              Expanded(
                child: _QuickAction(
                  icon: Icons.qr_code_2_rounded,
                  label: 'Receive',
                  onTap: () => _showReceiveSheet(context, controller),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: _QuickAction(
                  icon: Icons.send_rounded,
                  label: 'Send',
                  onTap: onSend,
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: _QuickAction(
                  icon: Icons.qr_code_scanner_rounded,
                  label: 'Scan',
                  onTap: () => controller.openWebRoute('/user?scan=1'),
                ),
              ),
            ],
          ),
          const SizedBox(height: 28),
          _SectionHeader(
            title: 'Prepaid Metered Vaults',
            trailing: '${_vaultList(controller.vaultData).length}',
          ),
          const SizedBox(height: 12),
          if (_vaultList(controller.vaultData).isEmpty)
            const EmptyPanel(
              icon: Icons.shield_outlined,
              title: 'No prepaid vaults',
              message: 'Metered service balances will appear here.',
            )
          else
            ..._vaultList(controller.vaultData)
                .take(3)
                .map((vault) => _VaultCard(data: _map(vault))),
          const SizedBox(height: 28),
          _SectionHeader(
            title: 'Active Subscriptions',
            trailing: '${controller.subscriptions.length}',
          ),
          const SizedBox(height: 12),
          if (controller.subscriptions.isEmpty)
            const EmptyPanel(
              icon: Icons.layers_clear_outlined,
              title: 'No active subscriptions',
              message: 'Plans you approve will appear here.',
            )
          else
            ...controller.subscriptions
                .take(5)
                .map((item) => _SubscriptionCard(data: _map(item))),
        ],
      ),
    );
  }

  void _showReceiveSheet(BuildContext context, AppController controller) {
    final wallet = controller.wallet ?? '';
    showModalBottomSheet<void>(
      context: context,
      backgroundColor: SubScriptColors.panel,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
      ),
      builder: (context) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(24, 24, 24, 30),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Eyebrow('Receive USDC'),
              const SizedBox(height: 18),
              Container(
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(22),
                ),
                child: QrImageView(data: wallet, size: 190),
              ),
              const SizedBox(height: 16),
              Text(
                wallet,
                textAlign: TextAlign.center,
                style: const TextStyle(
                  color: Colors.white60,
                  fontFamily: 'monospace',
                  fontSize: 12,
                ),
              ),
              const SizedBox(height: 18),
              ElevatedButton.icon(
                onPressed: () async {
                  await Clipboard.setData(ClipboardData(text: wallet));
                  if (context.mounted) {
                    ScaffoldMessenger.of(context).showSnackBar(
                      const SnackBar(content: Text('Wallet address copied.')),
                    );
                  }
                },
                icon: const Icon(Icons.copy_rounded),
                label: const Text('COPY ADDRESS'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _PaymentLinksPage extends StatefulWidget {
  const _PaymentLinksPage();

  @override
  State<_PaymentLinksPage> createState() => _PaymentLinksPageState();
}

class _PaymentLinksPageState extends State<_PaymentLinksPage> {
  final _amount = TextEditingController();
  final _title = TextEditingController(text: 'USDC payment');
  final _note = TextEditingController();
  bool _busy = false;
  String? _result;

  @override
  void dispose() {
    _amount.dispose();
    _title.dispose();
    _note.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.fromLTRB(20, 12, 20, 30),
      children: [
        const Eyebrow('Payment Links'),
        const SizedBox(height: 7),
        Text(
          'Create a shareable USDC checkout link.',
          style: Theme.of(context).textTheme.headlineMedium,
        ),
        const SizedBox(height: 18),
        GlassCard(
          child: Column(
            children: [
              TextField(
                controller: _amount,
                keyboardType:
                    const TextInputType.numberWithOptions(decimal: true),
                decoration: const InputDecoration(
                  labelText: 'Amount (USDC)',
                  prefixIcon: Icon(Icons.attach_money_rounded),
                  hintText: '25.00',
                ),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: _title,
                decoration: const InputDecoration(
                  labelText: 'Title',
                  prefixIcon: Icon(Icons.title_rounded),
                ),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: _note,
                minLines: 2,
                maxLines: 4,
                decoration: const InputDecoration(
                  labelText: 'Memo',
                  hintText: 'What is this payment for?',
                ),
              ),
              const SizedBox(height: 16),
              ElevatedButton.icon(
                onPressed: _busy ? null : _create,
                icon: const Icon(Icons.link_rounded),
                label: Text(_busy ? 'CREATING…' : 'CREATE PAYMENT LINK'),
              ),
            ],
          ),
        ),
        if (_result != null) ...[
          const SizedBox(height: 16),
          GlassCard(
            borderColor: SubScriptColors.lime.withOpacity(0.25),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Eyebrow('Your shareable link'),
                const SizedBox(height: 10),
                Text(
                  _result!,
                  style: const TextStyle(
                    color: Colors.white70,
                    fontFamily: 'monospace',
                    fontSize: 11,
                  ),
                ),
                const SizedBox(height: 14),
                OutlinedButton.icon(
                  onPressed: () async {
                    await Clipboard.setData(ClipboardData(text: _result!));
                    if (context.mounted) {
                      ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(content: Text('Payment link copied.')),
                      );
                    }
                  },
                  icon: const Icon(Icons.copy_rounded),
                  label: const Text('Copy link'),
                ),
              ],
            ),
          ),
        ],
      ],
    );
  }

  Future<void> _create() async {
    if (double.tryParse(_amount.text) == null ||
        double.parse(_amount.text) <= 0) {
      _showError('Enter a valid amount.');
      return;
    }
    setState(() => _busy = true);
    try {
      final url = await context.read<AppController>().createPaymentLink(
            amount: _amount.text.trim(),
            title: _title.text.trim(),
            description: _note.text.trim(),
          );
      if (mounted) setState(() => _result = url);
    } on ApiException catch (error) {
      _showError(error.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _showError(String message) {
    ScaffoldMessenger.of(context)
        .showSnackBar(SnackBar(content: Text(message)));
  }
}

class _SendPage extends StatefulWidget {
  const _SendPage();

  @override
  State<_SendPage> createState() => _SendPageState();
}

class _SendPageState extends State<_SendPage> {
  final _recipient = TextEditingController();
  final _amount = TextEditingController();
  bool _busy = false;

  @override
  void dispose() {
    _recipient.dispose();
    _amount.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final controller = context.watch<AppController>();
    return ListView(
      padding: const EdgeInsets.fromLTRB(20, 12, 20, 30),
      children: [
        const Eyebrow('Send Out'),
        const SizedBox(height: 7),
        Text(
          'Send Arc USDC instantly.',
          style: Theme.of(context).textTheme.headlineMedium,
        ),
        const SizedBox(height: 18),
        GlassCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Eyebrow('Available', color: Colors.white38),
              const SizedBox(height: 4),
              Text(
                '${controller.balance.toStringAsFixed(2)} USDC',
                style: Theme.of(context).textTheme.titleLarge,
              ),
              const SizedBox(height: 20),
              TextField(
                controller: _recipient,
                decoration: const InputDecoration(
                  labelText: 'Recipient',
                  hintText: '0x… or alice.sub',
                  prefixIcon: Icon(Icons.alternate_email_rounded),
                ),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: _amount,
                keyboardType:
                    const TextInputType.numberWithOptions(decimal: true),
                decoration: const InputDecoration(
                  labelText: 'Amount (USDC)',
                  hintText: '10.00',
                  prefixIcon: Icon(Icons.attach_money_rounded),
                ),
              ),
              const SizedBox(height: 16),
              ElevatedButton.icon(
                onPressed: _busy ? null : _send,
                icon: const Icon(Icons.send_rounded),
                label: Text(_busy ? 'SENDING…' : 'REVIEW & SEND'),
              ),
              const SizedBox(height: 12),
              const Text(
                'Embedded-wallet transfers are signed by the same secured backend used by the website.',
                textAlign: TextAlign.center,
                style: TextStyle(
                  color: Colors.white30,
                  fontSize: 10,
                  height: 1.4,
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 16),
        OutlinedButton.icon(
          onPressed: () => controller.openWebRoute('/user?tab=batch'),
          icon: const Icon(Icons.group_rounded),
          label: const Text('Open batch send'),
        ),
      ],
    );
  }

  Future<void> _send() async {
    final amount = double.tryParse(_amount.text);
    if (_recipient.text.trim().isEmpty || amount == null || amount <= 0) {
      _show('Enter a valid recipient and amount.');
      return;
    }
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: SubScriptColors.panelRaised,
        title: const Text('Confirm transfer'),
        content: Text(
          'Send ${amount.toStringAsFixed(2)} USDC to ${_recipient.text.trim()}?',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text(
              'Send',
              style: TextStyle(color: SubScriptColors.lime),
            ),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    setState(() => _busy = true);
    try {
      await context.read<AppController>().sendFunds(
            recipient: _recipient.text.trim(),
            amount: _amount.text.trim(),
          );
      _recipient.clear();
      _amount.clear();
      _show('Transfer submitted successfully.');
    } on ApiException catch (error) {
      _show(error.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _show(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(context)
        .showSnackBar(SnackBar(content: Text(message)));
  }
}

class _DmPage extends StatelessWidget {
  const _DmPage();

  @override
  Widget build(BuildContext context) {
    final controller = context.watch<AppController>();
    if (controller.dms.isEmpty) {
      return const Padding(
        padding: EdgeInsets.fromLTRB(20, 12, 20, 30),
        child: EmptyPanel(
          icon: Icons.forum_outlined,
          title: 'No payment threads',
          message: 'Requests and transfer messages will appear here.',
        ),
      );
    }
    return ListView.separated(
      padding: const EdgeInsets.fromLTRB(20, 12, 20, 30),
      itemCount: controller.dms.length,
      separatorBuilder: (_, __) => const SizedBox(height: 10),
      itemBuilder: (context, index) {
        final dm = _map(controller.dms[index]);
        final incoming = dm['receiverAddress']?.toString().toLowerCase() ==
            controller.wallet?.toLowerCase();
        final peer = incoming ? dm['senderName'] : dm['receiverName'];
        final createdAt = DateTime.tryParse(dm['createdAt']?.toString() ?? '');
        return GlassCard(
          padding: const EdgeInsets.all(16),
          onTap: () => controller.openWebRoute('/user?tab=inbox'),
          child: Row(
            children: [
              CircleAvatar(
                backgroundColor: incoming
                    ? SubScriptColors.lime.withOpacity(0.12)
                    : SubScriptColors.teal.withOpacity(0.12),
                child: Icon(
                  incoming
                      ? Icons.south_west_rounded
                      : Icons.north_east_rounded,
                  color: incoming ? SubScriptColors.lime : SubScriptColors.teal,
                  size: 19,
                ),
              ),
              const SizedBox(width: 13),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      peer?.toString() ?? 'SubScript account',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: Colors.white,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      dm['title']?.toString() ??
                          dm['description']?.toString() ??
                          dm['messageType']?.toString() ??
                          'Payment message',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style:
                          const TextStyle(color: Colors.white38, fontSize: 11),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 10),
              Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  if (dm['amountUsdc'] != null)
                    Text(
                      '${formatUsdcMicros(dm['amountUsdc'])} USDC',
                      style: const TextStyle(
                        color: SubScriptColors.lime,
                        fontWeight: FontWeight.w900,
                        fontSize: 12,
                      ),
                    ),
                  const SizedBox(height: 4),
                  Text(
                    createdAt == null
                        ? ''
                        : DateFormat('MMM d').format(createdAt.toLocal()),
                    style: const TextStyle(color: Colors.white24, fontSize: 10),
                  ),
                ],
              ),
            ],
          ),
        );
      },
    );
  }
}

class _ProfilePage extends StatelessWidget {
  const _ProfilePage();

  @override
  Widget build(BuildContext context) {
    final controller = context.watch<AppController>();
    final backup = _map(controller.settings['walletBackup']);
    return ListView(
      padding: const EdgeInsets.fromLTRB(20, 12, 20, 30),
      children: [
        GlassCard(
          child: Column(
            children: [
              CircleAvatar(
                radius: 34,
                backgroundColor: SubScriptColors.lime.withOpacity(0.12),
                child: const Icon(
                  Icons.person_rounded,
                  color: SubScriptColors.lime,
                  size: 30,
                ),
              ),
              const SizedBox(height: 14),
              Text(
                controller.settings['alias'] == null
                    ? 'SubScript User'
                    : '${controller.settings['alias']}.sub',
                style: Theme.of(context).textTheme.titleLarge,
              ),
              const SizedBox(height: 5),
              Text(
                controller.email ?? shortAddress(controller.wallet),
                style: const TextStyle(color: Colors.white38),
              ),
              const SizedBox(height: 14),
              StatusPill(
                label: backup['available'] == true
                    ? 'Wallet backup ready'
                    : 'Backup required',
                color: backup['available'] == true
                    ? SubScriptColors.teal
                    : SubScriptColors.gold,
              ),
            ],
          ),
        ),
        const SizedBox(height: 22),
        const _SectionHeader(title: 'Account & Security'),
        const SizedBox(height: 10),
        _SettingsTile(
          icon: Icons.language_rounded,
          title: 'Profile & .sub name',
          subtitle: 'Manage your public identity',
          onTap: () => controller.openWebRoute('/user?tab=dns'),
        ),
        _SettingsTile(
          icon: Icons.shield_outlined,
          title: 'Wallet backup',
          subtitle: 'OTP-protected export and recovery',
          onTap: () => controller.openWebRoute('/user?tab=dns'),
        ),
        _SettingsTile(
          icon: Icons.notifications_none_rounded,
          title: 'Notifications',
          subtitle: 'Push, email and debit alerts',
          onTap: () => controller.openWebRoute('/user?tab=dns'),
        ),
        const SizedBox(height: 22),
        _SectionHeader(
          title: 'Recent Activity',
          trailing: '${controller.receipts.length}',
        ),
        const SizedBox(height: 10),
        if (controller.receipts.isEmpty)
          const EmptyPanel(
            icon: Icons.receipt_long_outlined,
            title: 'No recent receipts',
            message: 'Completed payments will be listed here.',
          )
        else
          ...controller.receipts
              .take(8)
              .map((item) => _ReceiptTile(data: _map(item))),
        const SizedBox(height: 22),
        OutlinedButton.icon(
          onPressed: () => controller.openWebRoute('/user'),
          icon: const Icon(Icons.open_in_new_rounded),
          label: const Text('Open complete web dashboard'),
        ),
        const SizedBox(height: 10),
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

class _QuickAction extends StatelessWidget {
  const _QuickAction({
    required this.icon,
    required this.label,
    required this.onTap,
  });

  final IconData icon;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(19),
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 15),
        decoration: BoxDecoration(
          color: Colors.white.withOpacity(0.035),
          borderRadius: BorderRadius.circular(19),
          border: Border.all(color: Colors.white.withOpacity(0.07)),
        ),
        child: Column(
          children: [
            Icon(icon, color: SubScriptColors.lime, size: 23),
            const SizedBox(height: 7),
            Text(
              label,
              style: const TextStyle(
                color: Colors.white70,
                fontSize: 11,
                fontWeight: FontWeight.w900,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _SectionHeader extends StatelessWidget {
  const _SectionHeader({required this.title, this.trailing});

  final String title;
  final String? trailing;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Expanded(
          child: Text(
            title.toUpperCase(),
            style: const TextStyle(
              color: Colors.white70,
              fontSize: 11,
              fontWeight: FontWeight.w900,
              letterSpacing: 1.5,
            ),
          ),
        ),
        if (trailing != null)
          StatusPill(label: trailing!, color: Colors.white38),
      ],
    );
  }
}

class _SubscriptionCard extends StatelessWidget {
  const _SubscriptionCard({required this.data});

  final Map<String, dynamic> data;

  @override
  Widget build(BuildContext context) {
    final active = data['status'] == 'ACTIVE';
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: GlassCard(
        padding: const EdgeInsets.all(16),
        child: Row(
          children: [
            const CircleAvatar(
              backgroundColor: Color(0x14CCFF00),
              child: Icon(Icons.layers_rounded, color: SubScriptColors.lime),
            ),
            const SizedBox(width: 13),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    data['merchantName']?.toString() ?? 'Merchant',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      color: Colors.white,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    '${formatUsdcMicros(data['amountCapUsdc'])} USDC / cycle',
                    style: const TextStyle(color: Colors.white38, fontSize: 11),
                  ),
                ],
              ),
            ),
            Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                StatusPill(
                  label: data['status']?.toString() ?? 'Unknown',
                  color: active ? SubScriptColors.teal : SubScriptColors.gold,
                ),
                if (active)
                  TextButton(
                    onPressed: () => _confirmCancel(context),
                    child: const Text(
                      'Cancel',
                      style: TextStyle(
                        color: SubScriptColors.danger,
                        fontSize: 10,
                      ),
                    ),
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _confirmCancel(BuildContext context) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: SubScriptColors.panelRaised,
        title: const Text('Cancel subscription?'),
        content: const Text(
          'Paid access remains available until the current period ends.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Keep plan'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text(
              'Cancel plan',
              style: TextStyle(color: SubScriptColors.danger),
            ),
          ),
        ],
      ),
    );
    if (confirmed != true || !context.mounted) return;
    try {
      await context.read<AppController>().cancelSubscription(
            data['subscriptionId']?.toString() ?? '',
          );
    } on ApiException catch (error) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(error.message)),
        );
      }
    }
  }
}

class _VaultCard extends StatelessWidget {
  const _VaultCard({required this.data});

  final Map<String, dynamic> data;

  @override
  Widget build(BuildContext context) {
    final balance = data['balanceUsdc'] ?? data['balance_usdc'] ?? '0';
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: GlassCard(
        padding: const EdgeInsets.all(16),
        child: Row(
          children: [
            const Icon(Icons.shield_outlined, color: SubScriptColors.lime),
            const SizedBox(width: 12),
            Expanded(
              child: Text(
                data['merchantName']?.toString() ?? 'Metered service',
                style: const TextStyle(
                  color: Colors.white,
                  fontWeight: FontWeight.w900,
                ),
              ),
            ),
            Text(
              '${formatUsdcMicros(balance)} USDC',
              style: const TextStyle(
                color: SubScriptColors.lime,
                fontWeight: FontWeight.w900,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _SettingsTile extends StatelessWidget {
  const _SettingsTile({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.onTap,
  });

  final IconData icon;
  final String title;
  final String subtitle;
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
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    style: const TextStyle(
                      color: Colors.white,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                  Text(
                    subtitle,
                    style: const TextStyle(color: Colors.white38, fontSize: 11),
                  ),
                ],
              ),
            ),
            const Icon(Icons.chevron_right_rounded, color: Colors.white24),
          ],
        ),
      ),
    );
  }
}

class _ReceiptTile extends StatelessWidget {
  const _ReceiptTile({required this.data});

  final Map<String, dynamic> data;

  @override
  Widget build(BuildContext context) {
    final date = DateTime.tryParse(data['createdAt']?.toString() ?? '');
    return ListTile(
      contentPadding: const EdgeInsets.symmetric(horizontal: 4),
      leading: const CircleAvatar(
        backgroundColor: Color(0x0FFFFFFF),
        child:
            Icon(Icons.receipt_long_outlined, color: Colors.white54, size: 20),
      ),
      title: Text(
        '${formatUsdcMicros(data['amountUsdc'])} USDC',
        style:
            const TextStyle(color: Colors.white, fontWeight: FontWeight.w900),
      ),
      subtitle: Text(
        date == null
            ? data['status']?.toString() ?? ''
            : DateFormat('MMM d, yyyy · HH:mm').format(date.toLocal()),
        style: const TextStyle(color: Colors.white38, fontSize: 11),
      ),
      trailing: StatusPill(label: data['status']?.toString() ?? 'Pending'),
    );
  }
}

List<dynamic> _vaultList(Map<String, dynamic> data) {
  for (final key in ['vaults', 'configs', 'items']) {
    if (data[key] is List) return data[key] as List;
  }
  return const [];
}

Map<String, dynamic> _map(dynamic value) {
  return value is Map<String, dynamic> ? value : <String, dynamic>{};
}
