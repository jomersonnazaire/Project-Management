/// Philippine time (UTC+8) helpers. The API stores instants; days and times are PH (A-17).
const phOffset = Duration(hours: 8);

/// Wall-clock PH time of an instant, as a UTC DateTime whose fields read as PH time.
DateTime toPh(DateTime instant) => instant.toUtc().add(phOffset);

/// Date-only (local fields only, no time) for a PH instant.
DateTime phDate(DateTime instant) {
  final p = toPh(instant);
  return DateTime(p.year, p.month, p.day);
}

String ymd(DateTime d) =>
    '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

DateTime parseYmd(String s) {
  final p = s.split('-').map(int.parse).toList();
  return DateTime(p[0], p[1], p[2]);
}

/// "2026-10-09" + 08:30 PH → instant.
DateTime phInstant(DateTime date, int hour, int minute) => DateTime.utc(
  date.year,
  date.month,
  date.day,
  hour,
  minute,
).subtract(phOffset);

/// 427 → "07:07"; exact minutes, no rounding (formatHHMM in shared/tracker.ts).
String formatHHMM(num minutes) {
  final m = minutes < 0 ? 0 : minutes.floor();
  return '${(m ~/ 60).toString().padLeft(2, '0')}:${(m % 60).toString().padLeft(2, '0')}';
}

/// 1510 → "25h 10m".
String formatHoursMinutes(num minutes) {
  final m = minutes.round();
  return '${m ~/ 60}h ${(m % 60).toString().padLeft(2, '0')}m';
}

/// Seconds → "1:12:08" for the running bar.
String formatHMS(int seconds) {
  final s = seconds < 0 ? 0 : seconds;
  return '${s ~/ 3600}:${((s % 3600) ~/ 60).toString().padLeft(2, '0')}:${(s % 60).toString().padLeft(2, '0')}';
}

/// Instant → "08:00 AM" in PH time.
String formatTime12(DateTime instant) {
  final p = toPh(instant);
  final h = p.hour % 12 == 0 ? 12 : p.hour % 12;
  return '${h.toString().padLeft(2, '0')}:${p.minute.toString().padLeft(2, '0')} ${p.hour < 12 ? 'AM' : 'PM'}';
}

String hhmm24(int hour, int minute) =>
    '${hour.toString().padLeft(2, '0')}:${minute.toString().padLeft(2, '0')}';

const _months = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];
const _days = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
];

/// "Oct 7"
String shortDate(DateTime d) => '${_months[d.month - 1]} ${d.day}';

/// "Oct 7, 2026"
String longDate(DateTime d) => '${_months[d.month - 1]} ${d.day}, ${d.year}';

/// "Sunday, Oct 11, 2026"
String longDay(DateTime d) => '${_days[d.weekday - 1]}, ${longDate(d)}';

/// "Wed, Oct 7"
String longDayShort(DateTime d) =>
    '${_days[d.weekday - 1].substring(0, 3)}, ${shortDate(d)}';

/// Instant → "Oct 11, 2026, 09:12 AM" (PH).
String phDateTime(DateTime instant) {
  final p = toPh(instant);
  return '${longDate(p)}, ${formatTime12(instant)}';
}

/// "Oct 5–11" or "Sep 28–Oct 4" (weekRangeShort).
String weekRangeShort(DateTime start) {
  final end = start.add(const Duration(days: 6));
  return '${_months[start.month - 1]} ${start.day}–${start.month == end.month ? '' : '${_months[end.month - 1]} '}${end.day}';
}

/// whereWorkingQuestion(date, today) from apps/web/src/lib/format.ts.
String whereWorkingQuestion(DateTime date, DateTime today) {
  if (date == today) return 'Where are you working today?';
  return date.isBefore(today)
      ? 'Where were you working on ${longDayShort(date)}?'
      : 'Where will you be working on ${longDayShort(date)}?';
}

DateTime mondayOf(DateTime d) =>
    DateTime(d.year, d.month, d.day).subtract(Duration(days: d.weekday - 1));
