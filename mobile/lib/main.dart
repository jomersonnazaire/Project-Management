import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'app.dart';
import 'state/providers.dart' show noAutoRetry;

void main() =>
    runApp(const ProviderScope(retry: noAutoRetry, child: XceleratePmApp()));
