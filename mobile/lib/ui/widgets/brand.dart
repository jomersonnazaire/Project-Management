import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';

/// Branding from packages/shared/src/brand.ts (m8-polish).
abstract final class Brand {
  static const name = 'OpsTrack';
  static const tagline = 'by Jomerson & Grok';
  static const footer = '$name · $tagline';

  /// Logo purple: splash gradient only (decision f). The theme stays indigo #3F51B5.
  static const purple = Color(0xFF5355E0);
  static const purpleLight = Color(0xFF8789FF);
}

/// Full lockup (login, set password). `white` for the purple splash.
class BrandLogo extends StatelessWidget {
  const BrandLogo({super.key, this.height = 48, this.white = false});
  final double height;
  final bool white;
  @override
  Widget build(BuildContext context) => SvgPicture.asset(
    white ? 'assets/brand/logo-white.svg' : 'assets/brand/logo.svg',
    height: height,
    semanticsLabel: '${Brand.name} ${Brand.tagline}',
  );
}

/// Square icon for app bars (Home, More).
class BrandIcon extends StatelessWidget {
  const BrandIcon({super.key, this.size = 28});
  final double size;
  @override
  Widget build(BuildContext context) => SvgPicture.asset(
    'assets/brand/icon.svg',
    width: size,
    height: size,
    semanticsLabel: Brand.name,
  );
}
