import 'package:flutter/material.dart';

/// Shared KPI tile (Home task KPIs and Portfolio): 12dp radius from the card theme,
/// labelMedium label over a headlineMedium value.
class KpiCard extends StatelessWidget {
  const KpiCard(this.label, this.value, this.bg, this.fg, {super.key});
  final String label, value;
  final Color bg, fg;
  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    return Card(
      color: bg,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(KpiGrid.radius),
      ),
      child: Padding(
        padding: const EdgeInsets.all(KpiGrid.inner),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text(label, style: t.labelMedium?.copyWith(color: fg)),
            const SizedBox(height: 8),
            Text(value, style: t.headlineMedium?.copyWith(color: fg)),
          ],
        ),
      ),
    );
  }
}

/// Shared KPI grid: 2 columns (1 at large text), [gap] on both axes and a minimum
/// height from [aspectRatio] so both sections look identical. Callers sit inside the 16dp
/// page inset ([pagePadding]).
class KpiGrid extends StatelessWidget {
  const KpiGrid({super.key, required this.children});
  final List<Widget> children;
  static const pagePadding = 16.0, gap = 12.0, radius = 12.0, inner = 16.0;
  static const aspectRatio = 1.5;

  @override
  Widget build(BuildContext context) {
    final cols = MediaQuery.textScalerOf(context).scale(10) > 15 ? 1 : 2;
    return LayoutBuilder(
      builder: (context, c) {
        final w = (c.maxWidth - gap * (cols - 1)) / cols;
        return Column(
          key: const Key('kpiGrid'),
          children: [
            for (var i = 0; i < children.length; i += cols)
              Padding(
                padding: EdgeInsets.only(top: i == 0 ? 0 : gap),
                child: IntrinsicHeight(
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      for (var j = i; j < i + cols; j++) ...[
                        if (j > i) const SizedBox(width: gap),
                        Expanded(
                          child: ConstrainedBox(
                            constraints: BoxConstraints(
                              minHeight: w / aspectRatio,
                            ),
                            child: j < children.length
                                ? children[j]
                                : const SizedBox(),
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
              ),
          ],
        );
      },
    );
  }
}
